/**
 * The extractor decides what a deal *is*, so the things worth testing are the
 * ones that would put a wrong number in front of someone at a till: the value,
 * whether an unstated condition stays null, and whether an ambiguous line is
 * scored low enough to land in review instead of on the home screen.
 *
 * Run: node scripts/extract-easy.test.mjs
 */
import assert from 'node:assert/strict';
import { extractFromHeadline } from './extract-easy.mjs';

const PUBLISH_THRESHOLD = 0.85; // DEFAULT_MIN_CONFIDENCE in @sbr/core

const percent = extractFromHeadline('בית דפוס • 3.5% הנחה במעמד החיוב', 'דפוס עופר');
assert.equal(percent.type, 'percent');
assert.equal(percent.value, 3.5);
assert.equal(percent.merchant_name, 'דפוס עופר');

// The whole point of the null rule: easy states no terms, so every condition
// must come back "not written" rather than "no limit".
for (const key of ['min_spend', 'max_discount', 'valid_days', 'valid_hours', 'stacks_with_club', 'exclusions', 'usage_limit']) {
  assert.equal(percent.conditions[key], null, `${key} must be null when easy does not state it`);
}
assert.equal(percent.conditions.raw_text_summary.includes('3.5%'), true);

// easy is an aggregator and may omit a minimum spend the merchant enforces, so
// even a perfectly legible line must not auto-publish.
assert.ok(
  percent.confidence_score < PUBLISH_THRESHOLD,
  'an aggregator one-liner must land in review, never straight in front of a user',
);

const cashback = extractFromHeadline('5% החזר כספי מהתשלום לקנייה ברשתות המועדון', 'רשת');
assert.equal(cashback.type, 'cashback', 'החזר כספי is cashback, not a discount');
assert.equal(cashback.value, 5);

const bogo = extractFromHeadline('רשת בתי קפה • 1+1 על הזול', 'קפה');
assert.equal(bogo.type, 'bogo');
assert.equal(bogo.value, 0);

// Two sums quoted: the saving is the gap between them, which this line does not
// state. Guessing either number would overstate or understate the benefit.
const voucher = extractFromHeadline('שובר כספי בשווי 200₪ ב-159₪ בלבד', 'מנגו');
assert.equal(voucher.type, 'gift_card');
assert.ok(voucher.confidence_score < 0.6, 'a two-sum voucher line is ambiguous and must score low');
assert.equal(voucher.conditions.requires_voucher, true);

// A real expiry is data worth keeping; a dangling "בתוקף עד -" is not a date.
const dated = extractFromHeadline('4% הנחה במעמד החיוב בתוקף עד 31/12/2027', 'עסק');
assert.match(dated.valid_until, /^2027-12-31T/, 'an explicit expiry must be captured');
const dangling = extractFromHeadline('5% הנחה במעמד חיוב האשראי בתוקף עד -', 'עסק');
assert.equal(dangling.valid_until, null, '"בתוקף עד -" states no date and must stay null');

// Nonsense percentages must not be published as if real.
const silly = extractFromHeadline('900% הנחה', 'עסק');
assert.ok(silly.confidence_score < 0.5, 'an implausible percentage must be flagged for review');

// Nothing legible: better no benefit than an invented one.
assert.equal(extractFromHeadline('מקום לאכול • כשר רבנות מקומית', 'מסעדה'), null);
assert.equal(extractFromHeadline('', 'עסק'), null);

const online = extractFromHeadline('3% קאשבק אונליין', 'חנות');
assert.equal(online.conditions.channel, 'online');
// "במעמד החיוב" describes how the discount lands, not where you must buy.
assert.equal(percent.conditions.channel, null, 'in-store must not be inferred from "במעמד החיוב"');

console.log('ok: values parsed, conditions stay null, ambiguous lines score below the publish gate');
