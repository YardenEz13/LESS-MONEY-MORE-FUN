/**
 * The one thing worth a test: a crawl cut short must not overwrite a good file.
 * A partial crawl looks like a smaller catalog, and writing it would read
 * downstream as "these deals were removed" — silently deleting real rows.
 *
 * Run: node scripts/scrape-easy.test.mjs   (~50s: exercises the real backoff)
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
  // Keep the test to one list; the guard is per-list.
  .replace(/const LISTS = \{[^}]*\};/, "const LISTS = { MAX: 'max' };");
const stub = join(dir, 'scrape-easy.mjs');
await writeFile(stub, src, 'utf8');

let exitedNonZero = false;
let stdout = '';
try {
  stdout = (await execFileP(process.execPath, [stub], { cwd: dir })).stdout;
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
