/**
 * The category table is regex over Hebrew, where the failure mode is silent:
 * a wrong hit files a builders' merchant under wine and nobody notices until
 * the advisor answers "where do I buy paint" with a bottle shop.
 *
 * Every case here is a real category string from
 * `collected/easy/merchants-raw.json` that the first draft of the table got
 * wrong — substring collisions (יין inside בניין), rule order (רשת מזון
 * swallowing רשת מזון מהיר) and errand-vs-subject (a photography *course* is
 * not a camera shop).
 *
 * Run: node scripts/easy-category.test.mjs
 */
import assert from 'node:assert/strict';
import { categoriesFor } from './easy-category.mjs';

const cases = [
  // Substring collisions: the second word of each pair contains the first.
  ['חנות יין', 'grocery'],
  ['חנות חומרי בניין', 'home'],
  ['רשת חנויות ספרים', 'books'],
  ['מספרה', 'beauty'],
  // Rule order: the more specific reading has to win.
  ['רשת מזון', 'grocery'],
  ['רשת מזון מהיר', 'dining'],
  ['סדנת יין ואלכוהול', 'leisure'],
  ['סדנת משחק', 'leisure'],
  // Learning about a trade is not a place to run that errand.
  ['לימודי צילום', null],
  ['בית ספר למוזיקה', null],
  ['מכללה', null],
  // Plain hits, so a refactor that empties the table fails here too.
  ['רשת תחנות דלק', 'fuel'],
  ['רשת חנויות פארם', 'pharmacy'],
  ['רשת חנויות בגדים', 'fashion'],
  ['רשת מחשבים וציוד היקפי', 'electronics'],
  ['בית קפה', 'dining'],
  ['רשת כלי בית ומטבח', 'home'],
  ['בית מלון', 'leisure'],
  // Unknown stays unknown rather than being forced into the nearest member.
  ['מוסך', null],
  ['משכנתאות', null],
  [null, null],
];

for (const [input, expected] of cases) {
  assert.deepEqual(
    categoriesFor(input),
    expected ? [expected] : [],
    `${input} should map to ${expected ?? 'nothing'}`,
  );
}

console.log(`easy-category: ${cases.length} mappings OK`);
