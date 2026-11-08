/** Gemini may read a page; it may not make up proof. Every guard the script relies on. */
import assert from 'node:assert/strict';
import { applyVerdicts, checkVerdict, normalize, pageToText, run, selectRows, venueBenefitIds } from './gemini-verify.mjs';

const OLD = '2026-08-01T00:00:00.000Z';
const row = (over = {}) => ({
  id: 'a', program_id: 'max', merchant_name: 'שלמה', type: 'percent', value: 18,
  source_url: 'https://x.test/a', last_verified_at: OLD, conditions: { raw_text_summary: 's' }, ...over,
});
const page = 'מועדון max: 18% הנחה על השכרת רכב בכל הסניפים עד סוף השנה';

// the quote must really be on the page
assert.equal(checkVerdict(row(), page, { verdict: 'still_offered', evidence: '18% הנחה על השכרת רכב' }), 'still_offered');
assert.equal(checkVerdict(row(), page, { verdict: 'still_offered', evidence: '25% הנחה על השכרת רכב' }), 'unclear');
assert.equal(checkVerdict(row(), page, { verdict: 'still_offered', evidence: 'קצר' }), 'unclear');
// whitespace and case do not defeat a real quote
assert.equal(checkVerdict(row(), page, { verdict: 'still_offered', evidence: '18%   הנחה על   השכרת רכב' }), 'still_offered');
// the row's own figure must be on the page, or it may have changed
assert.equal(checkVerdict(row({ value: 30 }), page, { verdict: 'still_offered', evidence: '18% הנחה על השכרת רכב' }), 'unclear');
assert.equal(checkVerdict(row({ value: 8 }), page, { verdict: 'still_offered', evidence: '18% הנחה על השכרת רכב' }), 'unclear');
// "no longer offered" needs a real quote too
assert.equal(checkVerdict(row(), 'המבצע הסתיים ביום שלישי', { verdict: 'not_offered', evidence: 'המבצע הסתיים ביום שלישי' }), 'not_offered');
assert.equal(checkVerdict(row(), page, { verdict: 'not_offered', evidence: 'המבצע הסתיים' }), 'unclear');
assert.equal(checkVerdict(row(), page, { verdict: 'whatever', evidence: page }), 'unclear');

// dates move forward only, nothing added or removed, only verified rows
const rows = [row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c', last_verified_at: '2999-01-01T00:00:00.000Z' })];
const now = new Date('2026-11-08T00:00:00.000Z');
const moved = applyVerdicts(rows, [{ id: 'a', verdict: 'still_offered' }, { id: 'b', verdict: 'not_offered' }, { id: 'c', verdict: 'still_offered' }], now);
assert.equal(moved, 1);
assert.equal(rows.length, 3);
assert.equal(rows[0].last_verified_at, now.toISOString());
assert.equal(rows[1].last_verified_at, OLD);
assert.equal(rows[2].last_verified_at, '2999-01-01T00:00:00.000Z');

assert.equal(normalize('  A‏  b '), 'a b');
assert.equal(pageToText('<p>x&nbsp;<b>y</b></p><script>bad()</script>'), 'x y');

// selection: stale only, oldest first, capped
const sel = selectRows([row({ id: '1', last_verified_at: '2026-10-01T00:00:00.000Z' }), row({ id: '2' }), row({ id: '3', last_verified_at: '2026-11-07T00:00:00.000Z' })], { minAgeDays: 14, max: 5, now: Date.parse('2026-11-08T00:00:00.000Z') });
assert.deepEqual(sel.map((r) => r.id), ['2', '1']);

// a host that refuses is respected: after 10 refusals the rest are skipped, no more requests
process.env.VERIFY_GAP_MS = '0';
let hits = 0;
const refuse = async () => { hits += 1; return { status: 403, ok: false }; };
const many = Array.from({ length: 15 }, (_, i) => row({ id: `r${i}`, source_url: `https://blocked.test/${i}` }));
const out = await run({ rows: many, key: 'k', opts: { minAgeDays: 1, max: 99 }, fetchImpl: refuse, log: () => {} });
assert.equal(hits, 10);
assert.equal(out.filter((r) => r.reason === 'host_refusing').length, 5);
assert.ok(out.every((r) => r.verdict === 'unclear'));

// end to end with a fake page and a fake Gemini
const ok = async () => ({ status: 200, ok: true, text: async () => `<p>${page}</p>` });
const gem = async () => ({ status: 200, ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ verdict: 'still_offered', evidence: '18% הנחה על השכרת רכב' }) }] } }] }) });
const done = await run({ rows: [row()], key: 'k', opts: { minAgeDays: 1, max: 9 }, fetchImpl: ok, geminiFetch: gem, log: () => {} });
assert.equal(done[0].verdict, 'still_offered');

assert.equal(typeof venueBenefitIds, 'function');
console.log('gemini-verify: ok');
