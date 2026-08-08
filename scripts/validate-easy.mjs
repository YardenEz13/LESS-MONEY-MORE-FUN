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

/** Two workers: enough to finish in minutes, slow enough not to get blocked. */
async function pooled(items, worker, workers = 2, gapMs = 1200) {
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

const files = (await readdir(DIR)).filter((f) => f.endsWith('.jsonl'));
const byFile = new Map();
const ids = new Set();

for (const file of files) {
  const rows = (await readFile(`${DIR}/${file}`, 'utf8'))
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
  byFile.set(file, rows);
  for (const r of rows) {
    const id = r.offer_url?.match(/\/page\/(\d+)/)?.[1];
    if (id) ids.add(id);
  }
}

const total = [...byFile.values()].reduce((n, rows) => n + rows.length, 0);
console.log(`${total} records across ${files.length} lists — ${ids.size} distinct businesses\n`);

const verdicts = new Map();
await pooled([...ids], async (id) => {
  try {
    verdicts.set(id, await bizpage(id));
  } catch (err) {
    verdicts.set(id, { state: 'unreachable', detail: err.message });
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
    } else {
      unreachable += 1; // left untouched, keeps whatever verified_at it had
    }
    out.push(r);
  }
  await writeFile(`${DIR}/${file}`, out.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
}

console.log(`\nverified live:  ${kept}`);
console.log(`removed (410):  ${removed}`);
console.log(`renamed:        ${renamed}`);
console.log(`unreachable:    ${unreachable}  (kept as-is — network, not proof of death)`);

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
