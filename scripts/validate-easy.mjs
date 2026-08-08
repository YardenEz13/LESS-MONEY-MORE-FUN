#!/usr/bin/env node
/**
 * Prove every collected deal points at a business that still exists.
 *
 * `/n/jsons/bizpage?bizid=N` answers this definitively: the business JSON for a
 * live id, HTTP 410 for one that is gone. That is a stronger check than fetching
 * the HTML page, which returns a soft shell for anything.
 *
 * Records that pass gain `verified_at` and, where easy has renamed the business
 * since the crawl, a corrected `merchant_name`. Records whose id is 410 are
 * removed — a deal you cannot open is worse than no deal.
 *
 * A network failure is NOT a deletion: an id we could not reach is left exactly
 * as it was and counted as `unreachable`, so a Cloudflare bad day can never
 * empty the catalog.
 *
 * Run after `npm run scrape:easy`:  node scripts/validate-easy.mjs
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const DIR = process.env.EASY_DIR ?? 'collected/easy';
/** Overridable so the deletion path can be tested against a local server. */
const BASE = process.env.EASY_BASE ?? 'https://easy.co.il';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Cloudflare throttles this endpoint hard. Retry a refusal a couple of times
 * with a long backoff before writing the id off as unreachable — a 403 is the
 * edge saying "slow down", not the site saying "no such business".
 */
async function bizpageWithRetry(bizid, attempt = 0) {
  const result = await bizpage(bizid);
  if (result.state !== 'unreachable' || attempt >= 1) return result;
  await sleep(20000);
  return bizpageWithRetry(bizid, attempt + 1);
}

/**
 * Stop a pass that is being blocked wholesale.
 *
 * Once Cloudflare closes the door, every remaining id costs its full backoff
 * and still fails — grinding through 800 of those takes hours to learn what
 * the first twenty already said. Better to stop, keep what was proven, and let
 * the next run pick up where this one left off.
 */
const GIVE_UP_AFTER = 20;

/** curl, for the same TLS-fingerprint reason as the scraper. */
async function bizpage(bizid) {
  const url = `${BASE}/n/jsons/bizpage?bizid=${bizid}`;
  const { stdout } = await execFileP(
    'curl',
    ['-s', '-w', '\n%{http_code}', '-A', UA, '-H', `Referer: ${BASE}/page/${bizid}`, url],
    { maxBuffer: 20 * 1024 * 1024 },
  );
  const nl = stdout.lastIndexOf('\n');
  const status = stdout.slice(nl + 1).trim();
  const body = stdout.slice(0, nl);
  if (status === '410') return { state: 'gone' };
  if (status !== '200') return { state: 'unreachable', detail: status };
  try {
    const name = JSON.parse(body)?.bizpage?.bizname;
    return name ? { state: 'live', name } : { state: 'unreachable', detail: 'no bizname' };
  } catch {
    return { state: 'unreachable', detail: 'unparseable' };
  }
}

/**
 * One worker, ~2.5s apart — the same cadence the crawler sustains across 96
 * lists without a single block. Two workers at 1.2s got 70% of a run 403'd,
 * which is slower than going slowly.
 */
async function pooled(items, worker, workers = 1, gapMs = 2500) {
  let cursor = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (cursor < items.length) {
        const item = items[cursor++];
        await worker(item);
        done += 1;
        if (done % 100 === 0) console.log(`  ${done}/${items.length}`);
        await sleep(gapMs);
      }
    }),
  );
}

/** Re-verify a record this old or older. A business does not vanish hourly. */
const MAX_AGE_MS = Number(process.env.EASY_MAX_AGE_DAYS ?? 7) * 24 * 60 * 60 * 1000;
const FRESH_BEFORE = Date.now() - MAX_AGE_MS;

const files = (await readdir(DIR)).filter((f) => f.endsWith('.jsonl'));
const byFile = new Map();
const ids = new Set();
const fresh = new Set();

for (const file of files) {
  const rows = (await readFile(`${DIR}/${file}`, 'utf8'))
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
  byFile.set(file, rows);
  for (const r of rows) {
    const id = r.offer_url?.match(/\/page\/(\d+)/)?.[1];
    if (!id) continue;
    ids.add(id);
    if (r.verified_at && Date.parse(r.verified_at) > FRESH_BEFORE) fresh.add(id);
  }
}

// Incremental on purpose. Cloudflare rations this endpoint, so a run that had
// to re-prove everything from scratch would never finish; skipping what is
// already proven lets successive runs converge on full coverage.
const todo = [...ids].filter((id) => !fresh.has(id));
const total = [...byFile.values()].reduce((n, rows) => n + rows.length, 0);
console.log(
  `${total} records across ${files.length} lists — ${ids.size} distinct businesses\n` +
    `${fresh.size} already verified within ${MAX_AGE_MS / 86400000}d, ${todo.length} to check\n`,
);

const verdicts = new Map();
let consecutiveFailures = 0;
let abandoned = false;

await pooled(todo, async (id) => {
  if (abandoned) return;
  let verdict;
  try {
    verdict = await bizpageWithRetry(id);
  } catch (err) {
    verdict = { state: 'unreachable', detail: err.message };
  }
  verdicts.set(id, verdict);

  if (verdict.state === 'unreachable') {
    consecutiveFailures += 1;
    if (consecutiveFailures >= GIVE_UP_AFTER) {
      abandoned = true;
      console.warn(
        `\n${GIVE_UP_AFTER} refusals in a row — the endpoint is throttling us. ` +
          'Stopping this pass and keeping what was proven; run again later.',
      );
    }
  } else {
    consecutiveFailures = 0;
  }
});

const now = new Date().toISOString();
let kept = 0;
let removed = 0;
let unreachable = 0;
let renamed = 0;
const goneList = [];
const renamedList = [];

for (const [file, rows] of byFile) {
  const out = [];
  for (const r of rows) {
    const id = r.offer_url?.match(/\/page\/(\d+)/)?.[1];
    const v = id ? verdicts.get(id) : undefined;

    if (v?.state === 'gone') {
      removed += 1;
      goneList.push(`${r.merchant_name} (${id}) in ${file}`);
      continue;
    }
    if (v?.state === 'live') {
      if (v.name && v.name !== r.merchant_name) {
        renamedList.push(`${r.merchant_name} -> ${v.name}`);
        renamed += 1;
        r.merchant_name = v.name;
      }
      r.verified_at = now;
      kept += 1;
    } else if (id && fresh.has(id)) {
      kept += 1; // proven by an earlier run and still inside the freshness window
    } else {
      unreachable += 1; // left untouched, keeps whatever verified_at it had
    }
    out.push(r);
  }
  await writeFile(`${DIR}/${file}`, out.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
}

const coverage = kept + unreachable > 0 ? Math.round((kept / (kept + unreachable)) * 100) : 0;
console.log(`\nverified live:  ${kept}`);
console.log(`removed (410):  ${removed}`);
console.log(`renamed:        ${renamed}`);
console.log(`unreachable:    ${unreachable}  (kept as-is — network, not proof of death)`);
console.log(`COVERAGE:       ${coverage}% of records carry a proven link`);
if (unreachable > 0) {
  console.log('Re-run to chase the rest; verified records are skipped, so it converges.');
}

if (goneList.length) {
  console.log('\ndelisted businesses:');
  for (const g of goneList.slice(0, 20)) console.log(`  ${g}`);
}
if (renamedList.length) {
  console.log('\nrenamed by easy since the crawl:');
  for (const r of renamedList.slice(0, 20)) console.log(`  ${r}`);
}

// Unreachable is tolerated; a run where nothing verified means the check itself
// is broken and its "all live" verdict must not be trusted.
if (kept === 0 && total > 0) {
  console.error('\nnothing could be verified — treat this run as failed, not as a clean bill');
  process.exitCode = 1;
}
