/**
 * A regional sweep must add coverage, never trade one region for another.
 *
 * easy geo-ranks its results, so a crawl anchored on Haifa returns Haifa's
 * businesses and not Tel Aviv's. With plain replace semantics, running the
 * `--lat/--lng` flags would swap 84% of the catalog for a handful of northern
 * shops and read downstream as a mass closure. That is why the flags existed
 * unused; this is the check that they are now safe.
 *
 * The other half matters just as much: an *unscoped* crawl must keep replacing,
 * because a union can add but can never retract, and a deal that genuinely
 * disappeared has to be able to leave the file.
 *
 * Run: node scripts/scrape-geo-sweep.test.mjs
 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

const TEL_AVIV = [
  { id: '111', bizname: 'קפה דיזנגוף', category: 'בית קפה', bestsubcat: 'בית קפה • 5% הנחה' },
  { id: '222', bizname: 'ספרים רוטשילד', category: 'ספרים', bestsubcat: 'ספרים • 7% הנחה' },
];
const HAIFA = [
  { id: '333', bizname: 'פלאפל הדר', category: 'מסעדה', bestsubcat: 'מסעדה • 9% הנחה' },
];

// The server answers by whether the request carried a lat — which is exactly
// how easy behaves, and the behaviour the union exists to survive.
const server = await new Promise((resolve) => {
  const s = createServer((req, res) => {
    if (req.url.startsWith('/list/')) {
      const state = { state: { listpage: { cat: { jsonlistparams: 'c=1' } } } };
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><script>window.__NUXT__=${JSON.stringify(state)};</script></html>`);
      return;
    }
    const north = req.url.includes('lat=');
    const list = north ? HAIFA : TEL_AVIV;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        bizlist: { allbizim: list.map((b) => b.id).join('|'), list },
      }),
    );
  });
  s.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;

const dir = await mkdtemp(join(tmpdir(), 'easygeo-'));
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

const names = async () =>
  (await readFile(target, 'utf8'))
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l).merchant_name);

await execFileP(process.execPath, [stub], { cwd: dir });
assert.deepEqual(
  (await names()).sort(),
  ['ספרים רוטשילד', 'קפה דיזנגוף'],
  'sanity: the unscoped crawl collected the default region',
);

// The northern sweep. Its results share no id with what is already on disk.
await execFileP(process.execPath, [stub, '--lat', '32.794', '--lng', '34.9896'], { cwd: dir });
const afterSweep = await names();

assert.deepEqual(
  afterSweep.sort(),
  ['ספרים רוטשילד', 'פלאפל הדר', 'קפה דיזנגוף'],
  'a geo sweep must add its region to the file, not replace what is already there',
);

// And the unscoped crawl still retracts: Tel Aviv only, Haifa gone.
await execFileP(process.execPath, [stub], { cwd: dir });
assert.deepEqual(
  (await names()).sort(),
  ['ספרים רוטשילד', 'קפה דיזנגוף'],
  'an unscoped crawl stays authoritative — without this a closed business could never leave the file',
);

server.close();
console.log('ok: geo sweeps accumulate, unscoped crawls still replace');
