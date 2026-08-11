/**
 * publish:catalog decides what reaches a phone, so the case worth testing is
 * the one that used to fail silently: a benefit that was shipped, then sent
 * back to review, stayed live. Publishing was merge-only — it added and updated
 * but never removed — so un-approving something had no effect on users, and a
 * benefit whose merchant id changed left its old row in the catalog forever.
 *
 * Run: node scripts/publish-catalog.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

const benefit = (id, over = {}) => ({
  id,
  program_id: 'max',
  merchant_id: 'm1',
  merchant_name: 'עסק',
  type: 'percent',
  value: 5,
  conditions: { raw_text_summary: '5% הנחה' },
  source_url: `https://example.invalid/${id}`,
  confidence_score: 0.8,
  reviewed_by_human: true,
  ...over,
});

const dir = await mkdtemp(join(tmpdir(), 'sbr-publish-'));
await mkdir(join(dir, 'data', 'generated'), { recursive: true });

// Already live: keeper and pulled. `pulled` has since gone back to review.
await writeFile(
  join(dir, 'data', 'benefits.json'),
  JSON.stringify([benefit('keeper'), benefit('pulled')]),
  'utf8',
);
await writeFile(
  join(dir, 'data', 'generated', 'benefits.json'),
  JSON.stringify([benefit('keeper'), benefit('fresh')]),
  'utf8',
);
await writeFile(
  join(dir, 'data', 'generated', 'review-queue.json'),
  JSON.stringify([{ benefit: benefit('pulled', { reviewed_by_human: false }), reason: 'r', queued_at: 'now' }]),
  'utf8',
);

// SBR_ROOT, not cwd: the script resolves its paths from its own location, so
// without this it would publish the real catalog while the test looked isolated.
const { stdout } = await execFileP(
  process.execPath,
  [join(import.meta.dirname, 'publish-catalog.mjs')],
  { cwd: dir, env: { ...process.env, SBR_ROOT: dir } },
);

const shipped = JSON.parse(await readFile(join(dir, 'data', 'benefits.json'), 'utf8'));
const ids = new Set(shipped.map((b) => b.id));

assert.ok(ids.has('keeper'), 'an approved benefit must stay shipped');
assert.ok(ids.has('fresh'), 'a newly approved benefit must be added');
assert.equal(
  ids.has('pulled'),
  false,
  'a benefit back in the review queue must be WITHDRAWN from the catalog — leaving it live means un-approving does nothing to what users see',
);
assert.match(stdout, /withdrawn:\s+1/, 'the withdrawal must be reported, not done silently');

console.log('ok: approved stay, new ship, re-queued are withdrawn from the catalog');
