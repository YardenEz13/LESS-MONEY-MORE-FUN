/**
 * Two failure modes, both of which have actually bitten:
 *
 * 1. A crawl cut short must not overwrite a good file. A partial crawl looks
 *    like a smaller catalog, and writing it would read downstream as "these
 *    deals were removed" — silently deleting real rows.
 * 2. A crawl that easy has started refusing must stop. The first 42-city run
 *    tripped the rate limiter at list 2 of 90 and kept going for four hours,
 *    failing every remaining list against a limiter it had already tripped.
 *
 * Run: node scripts/scrape-easy.test.mjs   (~5s)
 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const PREVIOUS = '{"merchant_name":"real deal that must survive"}\n';

/** Serve a valid list page and first bizlist page, then 403 every id batch. */
function startServer() {
  const server = createServer((req, res) => {
    if (req.url.startsWith('/list/')) {
      const state = { state: { listpage: { cat: { jsonlistparams: 'c=1' } } } };
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><script>window.__NUXT__=${JSON.stringify(state)};</script></html>`);
      return;
    }
    if (req.url.includes('allbizim=')) {
      res.writeHead(403); // the batch fails — this is the partial crawl
      res.end('<!DOCTYPE html><html><head><title>Just a moment...</title></head></html>');
      return;
    }
    // First page: 2 rows rendered, but 30 businesses listed — so batches follow.
    const ids = Array.from({ length: 30 }, (_, i) => `id${i}`);
    const row = (id) => ({ id, bizname: `עסק ${id}`, bestsubcat: 'קטגוריה • 5% הנחה' });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ bizlist: { allbizim: ids.join('|'), list: [row('id0'), row('id1')] } }));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const server = await startServer();
const base = `http://127.0.0.1:${server.address().port}`;

const dir = await mkdtemp(join(tmpdir(), 'easy-'));
await mkdir(join(dir, 'collected/easy'), { recursive: true });
const target = join(dir, 'collected/easy/MAX.jsonl');
await writeFile(target, PREVIOUS, 'utf8');

const src = (await readFile(join(import.meta.dirname, 'scrape-easy.mjs'), 'utf8'))
  .replace("const BASE = 'https://easy.co.il';", `const BASE = '${base}';`)
  // The retry schedule is tuned for a real rate limit (minutes), and the path
  // under test is what happens *after* the retries are spent. Waiting out
  // eleven real minutes to learn that would just get the test skipped.
  .replace(
    'const RETRY_WAITS_MS = [60000, 180000, 420000];',
    'const RETRY_WAITS_MS = [50, 50, 50];',
  );
const stub = join(dir, 'scrape-easy.mjs');
await writeFile(stub, src, 'utf8');

let exitedNonZero = false;
let stdout = '';
try {
  // `--list` skips hub discovery: the guard under test is per-list, and the
  // stub server has no hub to discover from.
  stdout = (await execFileP(process.execPath, [stub, '--list', 'MAX'], { cwd: dir })).stdout;
} catch (err) {
  exitedNonZero = true;
  stdout = err.stdout ?? '';
}
server.close();

// The first page did parse, so the run got far enough to have partial records —
// that is the dangerous case, not an outright failure.
assert.match(stdout, /30 listed, 2 fetched/, 'expected a partial crawl, got something else');
assert.equal(
  await readFile(target, 'utf8'),
  PREVIOUS,
  'partial crawl overwrote the committed catalog — this is the data-loss bug',
);
assert.equal(exitedNonZero, true, 'an incomplete crawl must exit non-zero so CI notices');
console.log('ok: partial crawl leaves the committed catalog untouched');


// --- 2. once easy is refusing us, stop asking -------------------------------

/** Serves a hub of five lists and 403s every bizlist call. */
function startHostileServer() {
  const server = createServer((req, res) => {
    if (req.url === '/list/Discounts') {
      const links = Array.from({ length: 5 }, (_, i) => ({ link: `/list/L${i}` }));
      const state = { state: { listpage: { cat: { jsonlistparams: 'c=1' } } }, links };
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><script>window.__NUXT__=${JSON.stringify(state)};</script></html>`);
      return;
    }
    if (req.url.startsWith('/list/')) {
      const state = { state: { listpage: { cat: { jsonlistparams: 'c=1' } } } };
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><script>window.__NUXT__=${JSON.stringify(state)};</script></html>`);
      return;
    }
    res.writeHead(403);
    res.end('<!DOCTYPE html><html><head><title>Just a moment...</title></head></html>');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const hostile = await startHostileServer();
const hostileBase = `http://127.0.0.1:${hostile.address().port}`;
const hostileDir = await mkdtemp(join(tmpdir(), 'easy-blocked-'));
await mkdir(join(hostileDir, 'collected/easy'), { recursive: true });
const hostileStub = join(hostileDir, 'scrape-easy.mjs');
await writeFile(
  hostileStub,
  (await readFile(join(import.meta.dirname, 'scrape-easy.mjs'), 'utf8'))
    .replace("const BASE = 'https://easy.co.il';", `const BASE = '${hostileBase}';`)
    .replace('const RETRY_WAITS_MS = [60000, 180000, 420000];', 'const RETRY_WAITS_MS = [10, 10, 10];')
    .replace('await sleep(3000);', 'await sleep(10);'),
  'utf8',
);

let blockedOut = '';
try {
  blockedOut = (await execFileP(process.execPath, [hostileStub], { cwd: hostileDir })).stdout;
} catch (err) {
  blockedOut = `${err.stdout ?? ''}${err.stderr ?? ''}`;
}
hostile.close();

assert.match(blockedOut, /failed in a row/, 'expected the run to announce that it gave up');
// Five lists are on offer and three are the give-up threshold, so lists 4 and 5
// must never be attempted. Without the breaker this is where four hours went.
assert.equal(
  (blockedOut.match(/FAILED/g) ?? []).length,
  3,
  'expected exactly 3 attempts before stopping, not a march through every list',
);
console.log('ok: a blocked crawl stops after 3 consecutive failures instead of grinding on');
