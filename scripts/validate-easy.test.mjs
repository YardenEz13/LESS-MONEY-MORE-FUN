/**
 * The validator deletes records, so the thing worth testing is exactly when it
 * does and does not: 404 must go, 200 must stay and be stamped, and a server
 * that is merely broken must change nothing.
 *
 * That last case is the dangerous one — treating "unreachable" as "dead" would
 * let one bad afternoon at the CDN wipe the whole catalog.
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
    const id = req.url.split('/').pop();
    if (id === '222') res.writeHead(404);
    else if (id === '333') res.writeHead(500); // broken, not proof of death
    else res.writeHead(200);
    res.end();
  });
  s.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;

const dir = await mkdtemp(join(tmpdir(), 'easyval-'));
const easyDir = join(dir, 'easy');
await mkdir(easyDir, { recursive: true });

const rec = (id, name) => ({
  site: 'easy.co.il',
  offer_url: `${base}/page/${id}`,
  merchant_name: name,
  terms_text: 't',
  content_hash: `h${id}`,
});
await writeFile(
  join(easyDir, 'Test.jsonl'),
  [rec('111', 'עסק חי'), rec('222', 'עסק שנסגר'), rec('333', 'לא נגיש')]
    .map((r) => JSON.stringify(r))
    .join('\n') + '\n',
  'utf8',
);

const { stdout } = await execFileP(
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

assert.ok(byId.has('111'), 'a live link must survive validation');
assert.ok(byId.get('111').verified_at, 'a live record must be stamped verified_at');

assert.equal(byId.has('222'), false, 'a 404 link must be removed');

assert.ok(byId.has('333'), 'an unreachable link must NOT be deleted — this is the data-loss bug');
assert.equal(
  byId.get('333').verified_at,
  undefined,
  'an unreachable record must not be stamped as verified',
);

// Coverage is the number that answers "is every deal proven". If it ever
// reports 100% while a record sits unproven, the metric is lying.
assert.match(stdout, /COVERAGE:\s+50%/, 'two of three records proven should report 50% coverage');

console.log('ok: 200 stamped, 404 removed, unreachable untouched, coverage honest');
