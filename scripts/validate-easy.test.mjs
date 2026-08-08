/**
 * The validator deletes records, so the thing worth testing is exactly when it
 * does and does not: gone (410) must go, live must stay and be stamped, and a
 * server that is merely broken must change nothing.
 *
 * That last case is the dangerous one — treating "unreachable" as "dead" would
 * let one bad Cloudflare afternoon wipe the whole catalog.
 *
 * Run: node scripts/validate-easy.test.mjs
 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

const server = await new Promise((resolve) => {
  const s = createServer((req, res) => {
    const id = new URL(req.url, 'http://x').searchParams.get('bizid');
    if (id === '111') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ bizpage: { bizid: id, bizname: 'שם מעודכן' } }));
    } else if (id === '222') {
      res.writeHead(410);
      res.end('gone');
    } else {
      res.writeHead(500); // broken, not proof of death
      res.end('boom');
    }
  });
  s.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;

const dir = await mkdtemp(join(tmpdir(), 'easyval-'));
const easyDir = join(dir, 'easy');
await mkdir(easyDir, { recursive: true });

const rec = (id, name) => ({
  site: 'easy.co.il',
  offer_url: `https://easy.co.il/page/${id}`,
  merchant_name: name,
  terms_text: 't',
  content_hash: `h${id}`,
});
await writeFile(
  join(easyDir, 'Test.jsonl'),
  [rec('111', 'שם ישן'), rec('222', 'עסק שנסגר'), rec('333', 'לא נגיש')]
    .map((r) => JSON.stringify(r))
    .join('\n') + '\n',
  'utf8',
);

await execFileP(
  process.execPath,
  [join(import.meta.dirname, 'validate-easy.mjs')],
  { cwd: dir, env: { ...process.env, EASY_BASE: base, EASY_DIR: easyDir } },
);
server.close();

const out = (await readFile(join(easyDir, 'Test.jsonl'), 'utf8'))
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));
const byId = new Map(out.map((r) => [r.offer_url.match(/(\d+)$/)[1], r]));

assert.ok(byId.has('111'), 'a live business must survive validation');
assert.ok(byId.get('111').verified_at, 'a live record must be stamped verified_at');
assert.equal(
  byId.get('111').merchant_name,
  'שם מעודכן',
  'a name easy has changed must be corrected from the source of truth',
);

assert.equal(byId.has('222'), false, 'a 410 business must be removed');

assert.ok(byId.has('333'), 'an unreachable business must NOT be deleted — this is the data-loss bug');
assert.equal(
  byId.get('333').verified_at,
  undefined,
  'an unreachable record must not be stamped as verified',
);

console.log('ok: 410 removed, live stamped and renamed, unreachable untouched');
