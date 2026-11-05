/**
 * The proposal decides what a human is asked to paste into merchants.json, so
 * the things worth testing are the two that would do damage if wrong: reusing
 * the benefit's existing merchant id (minting a new one re-keys every benefit
 * hash on promotion), and flagging a chain that the sidecar only knows one
 * branch of (promoting that fences one city and silently misses the rest).
 *
 * Run: node scripts/map-unmapped.test.mjs
 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const SCRIPT = resolve('scripts/map-unmapped.mjs');

const dir = await mkdtemp(join(tmpdir(), 'sbr-unmapped-'));
await mkdir(join(dir, 'data'), { recursive: true });
await mkdir(join(dir, 'collected', 'easy'), { recursive: true });

const benefit = (id, merchantId, merchantName) => ({
  id,
  program_id: 'max',
  merchant_id: merchantId,
  merchant_name: merchantName,
  type: 'percent',
  value: 10,
  conditions: { raw_text_summary: 'x' },
  source_url: 'https://example.com',
  last_verified_at: '2026-08-30T00:00:00Z',
  confidence_score: 0.9,
  reviewed_by_human: false,
});

const write = (p, v) => writeFile(join(dir, p), JSON.stringify(v), 'utf8');

await write('data/benefits.json', [
  benefit('b_known', 'known_shop', 'חנות ידועה'),
  benefit('b_chain', 'unmapped_רשת', 'רשת'),
  benefit('b_chain2', 'unmapped_רשת', 'רשת'),
  benefit('b_thin', 'unmapped_דק', 'דק'),
  benefit('b_gift', 'unmapped_gift', 'גיפט קארד נטען'),
]);
await write('data/merchants.json', [{ id: 'known_shop', name: 'חנות ידועה', branches: [] }]);
await write('data/venues.json', [
  { id: 'mall', name: 'mall', city: 'תל אביב', lat: 32.0741, lng: 34.7922, radius_m: 250 },
]);
// "רשת" has three collected branches; "דק" only one. Same normalized-name rule.
await write('collected/easy/merchants-raw.json', [
  { name: 'רשת', address: 'א', city: 'תל אביב', lat: 32.0741, lng: 34.7922 },
  { name: 'רשת', address: 'ב', city: 'חיפה', lat: 32.79, lng: 34.98 },
  { name: 'רשת', address: 'ג', city: 'ירושלים', lat: 31.77, lng: 35.21 },
  { name: 'דק', address: 'ד', city: 'דימונה', lat: 31.06, lng: 35.03 },
  { name: 'ללא מיקום', address: 'ה', city: null, lat: null, lng: null },
]);

const { stdout } = await execFileP(process.execPath, [SCRIPT], { cwd: dir });
const out = JSON.parse(await readFile(join(dir, 'collected/easy/unmapped-proposal.json'), 'utf8'));

const chain = out.located.find((e) => e.name === 'רשת');
const thin = out.located.find((e) => e.name === 'דק');

// A merchant that already exists is nobody's problem.
assert.equal(out.located.some((e) => e.id === 'known_shop'), false);
assert.equal(out.unlocatable.some((e) => e.id === 'known_shop'), false);

// The id is load-bearing: the proposal must reuse it, never mint one.
assert.equal(chain.merchant.id, 'unmapped_רשת');
assert.equal(chain.benefit_count, 2, 'both benefits counted against one merchant');
assert.equal(chain.merchant.branches.length, 3);
assert.equal(chain.review, null, 'three branches is not a thin chain');
assert.deepEqual(chain.merchant.venue_ids, ['mall'], 'the TLV branch sits inside the venue');

// The dangerous shape: one collected branch of something that may be national.
assert.equal(thin.review, 'few_branches_verify_chain_size');

// No coordinate anywhere, and the hint explains why without deciding it.
const gift = out.unlocatable.find((e) => e.id === 'unmapped_gift');
assert.equal(gift.hint, 'gift_card');
assert.equal(out.located.some((e) => e.id === 'unmapped_gift'), false);

// Never guessed — a wrong domain mis-matches the share sheet.
assert.deepEqual(chain.merchant.domains, []);

assert.match(stdout, /nothing in data\/ was modified/);

// --write promotes the clean chain and leaves the thin one behind. Getting this
// backwards is the one failure that reaches a user, as a reminder fired at a
// branch that is not there.
await execFileP(process.execPath, [SCRIPT, '--write'], { cwd: dir });
const after = JSON.parse(await readFile(join(dir, 'data/merchants.json'), 'utf8'));
const ids = after.map((m) => m.id);
assert.ok(ids.includes('unmapped_רשת'), 'the three-branch chain is promoted');
assert.equal(ids.includes('unmapped_דק'), false, 'the flagged one-branch match is not');
assert.equal(ids.includes('unmapped_gift'), false, 'nothing without a coordinate is');
assert.equal(after.find((m) => m.id === 'unmapped_רשת').branches.length, 3);
assert.equal(ids.filter((id) => id === 'known_shop').length, 1, 'existing rows survive once');

// Re-running must not duplicate: promotion is re-run every time the catalog grows.
await execFileP(process.execPath, [SCRIPT, '--write'], { cwd: dir });
const twice = JSON.parse(await readFile(join(dir, 'data/merchants.json'), 'utf8'));
assert.equal(twice.length, after.length, 'idempotent');

console.log('map-unmapped: ok');
