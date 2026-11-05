/** The sync runs unattended on the shipped catalog: dates forward only, no row lost. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'easyproof-'));
mkdirSync(join(root, 'collected/easy'), { recursive: true });
mkdirSync(join(root, 'data'));

const OLD = '2026-08-11T00:00:00.000Z';
const NEW = '2026-11-01T00:00:00.000Z';
writeFileSync(
  join(root, 'collected/easy/A.jsonl'),
  [
    { offer_url: 'u/proven', verified_at: NEW },
    { offer_url: 'u/older', verified_at: '2026-01-01T00:00:00.000Z' },
    { offer_url: 'u/unproven' },
  ]
    .map((r) => JSON.stringify(r))
    .join('\n'),
);
const row = (source_url) => ({ id: source_url, source_url, last_verified_at: OLD, value: 5 });
writeFileSync(
  join(root, 'data/benefits.json'),
  JSON.stringify([row('u/proven'), row('u/older'), row('u/unproven'), row('other')]),
);

execFileSync(process.execPath, ['scripts/sync-easy-proof.mjs'], {
  env: { ...process.env, SBR_ROOT: root },
  stdio: 'pipe',
});

const rows = JSON.parse(readFileSync(join(root, 'data/benefits.json'), 'utf8'));
assert.equal(rows.length, 4, 'no row is ever removed');
assert.equal(rows[0].last_verified_at, NEW, 'newer proof moves the date');
assert.equal(rows[1].last_verified_at, OLD, 'older proof must not move it back');
assert.equal(rows[2].last_verified_at, OLD, 'no proof, no change');
assert.equal(rows[3].last_verified_at, OLD, 'rows from other sources are untouched');
console.log('ok: easy proof moves dates forward only');
