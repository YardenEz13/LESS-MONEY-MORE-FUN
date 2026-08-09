#!/usr/bin/env node
/**
 * Prove every collected deal's link actually opens.
 *
 * A HEAD on the record's own `offer_url` is the whole check: easy answers 200
 * for a live business and 404 for one that is gone, and sends no body either
 * way. That tests exactly the URL the app will open — not a proxy for it — and
 * it costs nothing to download.
 *
 * This deliberately does NOT use `/n/jsons/bizpage`. That endpoint answers the
 * same question, but easy rate-limits the JSON API hard: a pass of ~2300 per-id
 * calls got 70% of itself 403'd and then blocked the API for hours, while plain
 * page requests kept working throughout. Nor does it correct renamed
 * businesses — the crawler rewrites `merchant_name` from `bizlist` on every
 * run, so that would be a second, slower source for something already fresh.
 *
 * Records that pass gain `verified_at`. Records whose page 404s are removed —
 * a deal you cannot open is worse than no deal. Anything else is left exactly
 * as it was: a refusal or a timeout is the network talking, not evidence a
 * business closed, and must never be allowed to empty the catalog.
 *
 * Run after `npm run scrape:easy`:  npm run validate:easy
 */
import { readFile, writeFile, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const DIR = process.env.EASY_DIR ?? 'collected/easy';
/** Overridable so the deletion path can be tested against a local server. */
const BASE = process.env.EASY_BASE ?? 'https://easy.co.il';
/** Re-verify a record this old or older. A business does not vanish hourly. */
const MAX_AGE_MS = Number(process.env.EASY_MAX_AGE_DAYS ?? 7) * 24 * 60 * 60 * 1000;
/** Stop a pass that is being refused wholesale rather than grinding through it. */
const GIVE_UP_AFTER = 20;
/**
 * Pause between requests. easy allows roughly 500 before it starts refusing,
 * regardless of how slowly they arrive, so a pass spends that budget and stops;
 * the recovery window is what actually gates throughput, not this number.
 */
const GAP_MS = Number(process.env.EASY_GAP_MS ?? 700);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * HEAD once, and give a non-answer one second chance.
 *
 * While easy is throttling, a share of requests come back as dropped
 * connections (`000`) rather than a clean status — interspersed with perfectly
 * good 200s. Without this retry those transient drops counted as refusals and
 * could trip the circuit breaker while the site was in fact still answering.
 */
async function checkUrlWithRetry(url) {
  const first = await checkUrl(url);
  if (first.state !== 'unreachable') return first;
  await sleep(4000);
  return checkUrl(url);
}

/** HEAD the page. 200 = live, 404/410 = gone, anything else = don't know. */
async function checkUrl(url) {
  // `-L` because easy 302s /page/<id> to its canonical SEO url. A redirect
  // means the link works — following it is what the app's browser would do,
  // and without this every redirecting link counted as a refusal.
  //
  // No `-o /dev/null`: curl runs directly here, not under a shell, so that path
  // does not exist on Windows. `-I` means the body is never sent anyway.
  const { stdout } = await execFileP(
    'curl',
    ['-s', '-I', '-L', '--max-redirs', '5', '-w', '\n%{http_code}', '-A', UA, '--max-time', '20', url],
    { maxBuffer: 1024 * 1024 },
  );
  const status = stdout.slice(stdout.lastIndexOf('\n') + 1).trim();
  if (status === '200') return { state: 'live' };
  if (status === '404' || status === '410') return { state: 'gone' };
  // 429, or a redirect into /captcha, means easy has decided we are asking too
  // much — not that anything is wrong with the link. Surfaced separately so a
  // throttled run says so plainly instead of blaming the data.
  const throttled = status === '429' || /captcha/i.test(stdout);
  return { state: 'unreachable', detail: throttled ? 'rate-limited' : status || 'no response' };
}

/**
 * Verdicts survive the process. A throttled pass can take hours, and writing
 * only at the end would throw away every link it had already proven.
 */
const CACHE = join(DIR, '.verified-cache.json');
const cache = await readFile(CACHE, 'utf8')
  .then(JSON.parse)
  .catch(() => ({}));

/**
 * Write then rename, so the cache is never observed half-written. It is
 * rewritten every 50 verdicts across a pass that can run for an hour; a crash
 * during a plain write would leave truncated JSON, and the next run would fail
 * to parse it and silently start from zero — throwing away the whole pass.
 */
async function saveCache() {
  await writeFile(`${CACHE}.tmp`, JSON.stringify(cache), 'utf8');
  await rename(`${CACHE}.tmp`, CACHE);
}

const files = (await readdir(DIR)).filter((f) => f.endsWith('.jsonl'));
const byFile = new Map();
const urls = new Set();
const fresh = new Set();
const freshBefore = Date.now() - MAX_AGE_MS;

for (const file of files) {
  const rows = (await readFile(`${DIR}/${file}`, 'utf8'))
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
  byFile.set(file, rows);
  for (const r of rows) {
    if (!r.offer_url) continue;
    urls.add(r.offer_url);
    if (r.verified_at && Date.parse(r.verified_at) > freshBefore) fresh.add(r.offer_url);
  }
}

// Incremental on purpose: skipping what is already proven lets successive runs
// converge on full coverage instead of restarting from zero every time.
const settled = (u) => fresh.has(u) || cache[u]?.state === 'live' || cache[u]?.state === 'gone';
const todo = [...urls].filter((u) => !settled(u));
const total = [...byFile.values()].reduce((n, rows) => n + rows.length, 0);
console.log(
  `${total} records across ${files.length} lists — ${urls.size} distinct links\n` +
    `${urls.size - todo.length} already settled, ${todo.length} to check\n`,
);

let consecutiveFailures = 0;
let sinceFlush = 0;
let abandoned = false;

for (const [index, url] of todo.entries()) {
  let verdict;
  try {
    verdict = await checkUrlWithRetry(url);
  } catch (err) {
    verdict = { state: 'unreachable', detail: err.message };
  }

  // Only settled facts are cached; an unreachable link is retried next run.
  if (verdict.state !== 'unreachable') cache[url] = verdict;
  if ((sinceFlush += 1) >= 50) {
    sinceFlush = 0;
    await saveCache();
  }
  if ((index + 1) % 200 === 0) console.log(`  ${index + 1}/${todo.length}`);

  if (verdict.state === 'unreachable') {
    if ((consecutiveFailures += 1) >= GIVE_UP_AFTER) {
      abandoned = true;
      console.warn(
        verdict.detail === 'rate-limited'
          ? `\neasy is rate-limiting us (429 / captcha) after ${GIVE_UP_AFTER} refusals in a row.\n` +
            'Stopping. This is a quota, not a fault in the data — wait a few hours and run\n' +
            'again; settled links are skipped, so each pass picks up where the last stopped.\n' +
            'Do not raise the request rate to compensate: that is what caused it.'
          : `\n${GIVE_UP_AFTER} refusals in a row — stopping this pass and keeping what was proven. ` +
            'Run again later; settled links are skipped, so it resumes.',
      );
      break;
    }
  } else {
    consecutiveFailures = 0;
  }

  await sleep(GAP_MS);
}

await saveCache();

const now = new Date().toISOString();
let kept = 0;
let removed = 0;
let unproven = 0;
const goneList = [];

for (const [file, rows] of byFile) {
  const out = [];
  for (const r of rows) {
    const verdict = cache[r.offer_url];
    if (verdict?.state === 'gone') {
      removed += 1;
      goneList.push(`${r.merchant_name} — ${r.offer_url} (${file})`);
      continue;
    }
    if (verdict?.state === 'live') {
      r.verified_at = now;
      kept += 1;
    } else if (fresh.has(r.offer_url)) {
      kept += 1; // proven by an earlier run, still inside the freshness window
    } else {
      unproven += 1; // untouched, keeps whatever verified_at it had
    }
    out.push(r);
  }
  await writeFile(`${DIR}/${file}`, out.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
}

const coverage = kept + unproven > 0 ? Math.round((kept / (kept + unproven)) * 100) : 0;
console.log(`\nverified live:  ${kept}`);
console.log(`removed (404):  ${removed}`);
console.log(`unproven:       ${unproven}  (kept as-is — network, not proof of death)`);
console.log(`COVERAGE:       ${coverage}% of records carry a proven link`);
if (unproven > 0) console.log('Run again to chase the rest; settled links are skipped.');

// Tolerating unproven records is the point. A pass where *nothing* verified
// means the check itself is broken, and its verdict must not be trusted.
if (kept === 0 && total > 0) {
  console.error('\nnothing could be verified — treat this run as failed, not as a clean bill');
  process.exitCode = 1;
}
if (abandoned) process.exitCode = 1;
