/**
 * A re-crawl must not throw away link proofs it did not invalidate.
 *
 * easy allows only ~500 link checks a day. If every weekly crawl reset
 * `verified_at` on the lists it refreshed, coverage would be knocked back
 * faster than it could climb and would never reach 100% — a slow leak that
 * looks like nothing on any single run.
 *
 * Run: node scripts/scrape-keeps-verification.test.mjs
 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/** Two businesses, served completely so the crawl counts as complete. */
const BIZ = [
  { id: '111', bizname: 'עסק יציב', category: 'קטגוריה', bestsubcat: 'קטגוריה • 5% הנחה' },
  { id: '222', bizname: 'עסק משתנה', category: 'קטגוריה', bestsubcat: 'קטגוריה • 7% הנחה' },
];

// One server for both crawls: offer_url embeds the host, so a second server on
// a fresh port would change every url and mask the very thing under test.
let secondHeadline = 'קטגוריה • 7% הנחה';
const server = await new Promise((resolve) => {
  const s = createServer((req, res) => {
    if (req.url.startsWith('/list/')) {
      const state = { state: { listpage: { cat: { jsonlistparams: 'c=1' } } } };
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><script>window.__NUXT__=${JSON.stringify(state)};</script></html>`);
      return;
    }
    const list = [BIZ[0], { ...BIZ[1], bestsubcat: secondHeadline }];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ bizlist: { allbizim: '111|222', list } }));
  });
  s.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;

const dir = await mkdtemp(join(tmpdir(), 'easykeep-'));
await mkdir(join(dir, 'collected/easy'), { recursive: true });
const target = join(dir, 'collected/easy/MAX.jsonl');

const src = (await readFile(join(import.meta.dirname, 'scrape-easy.mjs'), 'utf8'))
  .replace("const BASE = 'https://easy.co.il';", `const BASE = '${base}';`)
  .replace(/const PROGRAMS = \{[\s\S]*?\n\};/, "const PROGRAMS = { MAX: 'max' };")
  .replace(
    /async function discoverLists\(\) \{[\s\S]*?\n\}/,
    'async function discoverLists() { return ["MAX"]; }',
  );
const stub = join(dir, 'scrape-easy.mjs');
await writeFile(stub, src, 'utf8');

async function crawl() {
  await execFileP(process.execPath, [stub], { cwd: dir });
  return new Map(
    (await readFile(target, 'utf8'))
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l))
      .map((r) => [r.offer_url.match(/(\d+)$/)[1], r]),
  );
}

// First crawl, then pretend the link checker proved both records.
await crawl();
const stamped = (await readFile(target, 'utf8'))
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => ({ ...JSON.parse(l), verified_at: '2026-01-01T00:00:00.000Z' }));
await writeFile(target, stamped.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

// Re-crawl. Business 111 is unchanged; 222's deal moved 7% -> 9%.
secondHeadline = 'קטגוריה • 9% הנחה';
const after = await crawl();
server.close();

assert.equal(
  after.get('111').verified_at,
  '2026-01-01T00:00:00.000Z',
  'an unchanged record must keep its proof across a re-crawl — otherwise coverage leaks away every week',
);
assert.equal(
  after.get('222').verified_at,
  undefined,
  'a record whose deal text changed is new and must re-earn its proof',
);
assert.notEqual(
  after.get('222').content_hash,
  createHash('sha256').update('nonsense').digest('hex'),
  'sanity: the changed record really did get a fresh hash',
);

console.log('ok: unchanged records keep verified_at, changed records lose it');
