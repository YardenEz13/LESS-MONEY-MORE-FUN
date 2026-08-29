/**
 * The one thing worth a test here: a price is not a discount.
 *
 * These pages carry both, phrased almost identically — `60 ₪ הנחה` against
 * `החל מ-270 ₪` and `כרטיס ליחיד ב-19 ₪`. Reading a price as a discount puts a
 * confidently wrong number in front of someone standing at a till, which is the
 * one failure the whole confidence gate exists to prevent.
 *
 * Run: node scripts/extract-catalog.test.mjs
 */
import assert from 'node:assert/strict';
import { parseOffer, parseConditions, toExtracted, toIsoDate, normalizeConditions } from './extract-catalog.mjs';

const record = (headings, extra = {}) => ({
  merchant_name: 'בית עסק',
  offer_url: 'https://www.max.co.il/benefits/plays/x',
  sections: Object.fromEntries(headings.map((h) => [h, 'גוף'])),
  terms_text: '',
  ...extra,
});

// --- discounts are read ---
assert.deepEqual(parseOffer(record(['60 ₪ הנחה ללקוח תמורת פינוק'])), { type: 'fixed', value: 60 });
assert.deepEqual(parseOffer(record(['50 ש"ח הנחה תמורת פינוק'])), { type: 'fixed', value: 50 });
assert.deepEqual(parseOffer(record(['30% הנחה על כרטיס כניסה'])), { type: 'percent', value: 30 });
assert.deepEqual(parseOffer(record(['הנחה של 15% לחברי מועדון'])), { type: 'percent', value: 15 });
assert.deepEqual(parseOffer(record(['5% קאשבק על כל עסקה'])), { type: 'cashback', value: 5 });
assert.deepEqual(parseOffer(record(['1+1 מתנה ברכישת כרטיסים'])), { type: 'bogo', value: 0 });

// --- prices are NOT discounts ---
assert.equal(parseOffer(record(['החל מ-270 ₪'])), null, 'a starting price is not a discount');
assert.equal(parseOffer(record(['כרטיס ליחיד ב-19 ₪ + מתנה'])), null, 'a ticket price is not a discount');
assert.equal(parseOffer(record(['זכאות לכרטיס ב- 55 ₪ + מתנה'])), null, 'an entitlement price is not a discount');
assert.equal(parseOffer(record(['החל מ-95 ₪ (תמורת פינוק)'])), null, 'nor is this one');
assert.equal(parseOffer(record(['14 ימים חינם על ביטול נסיעה'])), null, 'free days carry no discount value');
assert.equal(parseOffer(record(['כל הפרטים'])), null, 'a bare label states nothing');

// A misread line claiming more than 100% off is dropped, not published.
assert.equal(parseOffer(record(['120% הנחה'])), null, 'over 100% is a misread, not a giveaway');

// --- conditions are summarised, never invented ---
const terms = 'ניתן להזמין עד 2 פריטים ללקוח בחודש ההטבה עד גמר המלאי';
const c = parseConditions({ sections: { 'חשוב לדעת': terms }, terms_text: '' });
assert.equal(c.min_spend, null, 'an unstated minimum stays null, never 0');
assert.equal(c.stacks_with_club, null, 'unstated stacking stays null, never false');
assert.equal(c.max_discount, null);
// Bounded to the clause: these blocks have no punctuation between rules, so an
// unbounded match swallows the next two ("...בחודש מספר המקומות מוגבל הטבה שפג").
assert.equal(c.usage_limit, 'עד 2 פריטים ללקוח בחודש');
assert.match(c.raw_text_summary, /גמר המלאי/, 'the binding terms ride along verbatim');

// --- the record carries its own source, and cannot auto-publish ---
const e = toExtracted({
  merchant_name: 'בית עסק',
  offer_url: 'https://www.max.co.il/benefits/plays/x',
  sections: { '60 ₪ הנחה': 'גוף', 'חשוב לדעת': terms },
  terms_text: '',
});
assert.equal(e.source_url, 'https://www.max.co.il/benefits/plays/x', 'each benefit keeps its own page');
assert.ok(e.confidence_score < 0.85, 'a parsed record must never clear the publish gate');
assert.ok(e.confidence_reason.length > 0);

// --- dates the model returns in whatever the page used ---
// These reach a strict `datetime` parse downstream; one bad value aborted the
// whole max file mid-run.
assert.equal(toIsoDate('2026-08-31'), '2026-08-31', 'ISO passes through');
assert.equal(toIsoDate('31.08.2026'), '2026-08-31', 'Israeli DD.MM.YYYY is converted');
assert.equal(toIsoDate('31/08/2026'), '2026-08-31', 'slashes too');
assert.equal(toIsoDate('2026-09-31'), null, 'September has no 31st — Date would roll it into October');
assert.equal(toIsoDate('29.10'), null, 'a bare day.month has no year, and inventing one is a guess');
assert.equal(toIsoDate('31-08'), null, 'nor does this');
assert.equal(toIsoDate('5 שנים מיום הרכישה'), null, 'prose is not a date');
assert.equal(toIsoDate(null), null);
assert.equal(toIsoDate(''), null);

// --- every condition key must be present, or the benefit is silently dropped ---
// ExtractedConditions is .nullable() but not .optional(); the model returns only
// what it found, and 13 youngstyle benefits reached the catalog as zero.
const n = normalizeConditions({ raw_text_summary: 'שובר', requires_voucher: true });
for (const k of ['min_spend','max_discount','valid_days','valid_hours','channel',
                 'stacks_with_club','exclusions','usage_limit','requires_voucher','raw_text_summary']) {
  assert.ok(k in n, `conditions must always carry ${k}`);
}
assert.equal(n.min_spend, null, 'absent stays null, never 0');
assert.equal(n.stacks_with_club, null, 'absent stays null, never false');
assert.equal(n.requires_voucher, true, 'what the model did say survives');
assert.ok(normalizeConditions({}).raw_text_summary.length > 0, 'summary is required downstream');
assert.ok(normalizeConditions(null).raw_text_summary.length > 0);

console.log('ok — extract-catalog');
