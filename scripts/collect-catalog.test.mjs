/**
 * The load-bearing logic here is the markdown -> sections split, because
 * `collected.ts` promotes the `חשוב לדעת` block to the top of the model prompt.
 * If that heading stops surviving the parse, the terms silently drop to the
 * bottom of a truncated prompt and this whole route goes back to yielding
 * headline percentages — the exact failure it exists to fix.
 *
 * Run: node scripts/collect-catalog.test.mjs
 */
import assert from 'node:assert/strict';
import { sectionsFromMarkdown, toRecord, merchantName } from './collect-catalog.mjs';

/**
 * Copied from a real max.co.il offer page as Firecrawl returns it, structure
 * intact. The point of the fixture is what it does NOT contain: `חשוב לדעת` is
 * a bare paragraph, not `## חשוב לדעת`. The catalogs style their labels with
 * CSS, so a parser that only understands ATX headings finds no terms anywhere.
 */
const PAGE = `[דלג אל תפריט ניווט](https://www.max.co.il/#navigation)

- [בית](https://www.max.co.il/ "")
- [הטבות](https://www.max.co.il/benefits/lobby "")
- ווטרלנד \\- פארק המים של אילת

# ווטרלנד \\- פארק המים של אילת

## החל מ-95 ₪ (תמורת פינוק)

![](https://www.max.co.il/SharedMedia/23743/waterland.jpg)

כל הפרטים

פארק מים חדיש ומשוכלל, 30% הנחה על כרטיס כניסה לפארק המים.

**פרטים נוספים:**

\\- תקף לכל ימי הפעילות

איך זה עובד?

- חובה לממש את השוברים ולבחור מועד הגעה

חשוב לדעת

\\*ניתן להזמין עד 2 פריטים ללקוח בחודש \\*ההטבה עד גמר המלאי \\*התשלום באמצעות כרטיס אשראי של max לא כולל כרטיסי בנק פועלים, FREE, DEBIT

תפריט

[עמוד הבית](https://www.max.co.il/)
`;

// --- the heading must survive, with its body attached ---
const sections = sectionsFromMarkdown(PAGE);
assert.ok('חשוב לדעת' in sections, 'binding terms heading must survive the parse');
assert.match(sections['חשוב לדעת'], /עד 2 פריטים ללקוח בחודש/);
assert.match(sections['חשוב לדעת'], /בנק פועלים/);

// Labels the page styles rather than marks up: bare line, bold line, question.
assert.ok('כל הפרטים' in sections, 'a bare short line is a heading on these pages');
assert.ok('פרטים נוספים' in sections, 'a bold-only line is a heading, colon trimmed');
assert.ok('איך זה עובד?' in sections, 'a question is a heading, not prose');

// An escaped bullet inside a terms block is body, not a new section — it is
// short and standalone and passes every other heading test.
assert.ok(!('תקף לכל ימי הפעילות' in sections), 'escaped bullets stay body');
assert.match(sections['פרטים נוספים'], /תקף לכל ימי הפעילות/);

// Chrome above the first heading is not a section, and link syntax is unwrapped.
assert.ok(!JSON.stringify(sections).includes('דלג אל תפריט ניווט'), 'skip-links must be dropped');
assert.ok(!sections['חשוב לדעת'].includes(']('), 'link syntax must be unwrapped');

// A heading whose only content is navigation links leaves no prose behind.
assert.ok(!('תפריט' in sections), 'nav-only headings must not become sections');

// --- the record carries terms first ---
const record = toRecord('https://www.max.co.il/benefits/plays/waterland', {
  markdown: PAGE,
  metadata: { title: 'ווטרלנד', description: '30% הנחה על כרטיס כניסה' },
}, { site: 'max.co.il', program: 'max' });

assert.ok(record, 'a real offer page must produce a record');
assert.equal(record.offer_url, 'https://www.max.co.il/benefits/plays/waterland');
assert.equal(record.merchant_name, 'ווטרלנד - פארק המים של אילת', 'the h1, not the meta title');
assert.equal(record.warning, undefined, 'a page with binding terms carries no warning');
// The merchant line leads (as in buildPageText), then the binding terms, and
// only then the marketing copy — so a truncated prompt loses the copy, not the
// conditions.
assert.ok(
  record.terms_text.indexOf('עד 2 פריטים') < record.terms_text.indexOf('פארק מים חדיש'),
  'binding terms must come ahead of marketing copy',
);
assert.ok(record.terms_text.startsWith('בית העסק: ווטרלנד'));
assert.match(record.content_hash, /^[0-9a-f]{64}$/);

// --- pages that are not offers are skipped, not sent to the model ---
assert.equal(
  toRecord('https://www.max.co.il/benefits', {
    markdown: '# עולם ההטבות\n\nלכל הקטגוריות\n',
    metadata: { title: 'עולם ההטבות' },
  }, { site: 'max.co.il', program: 'max' }),
  null,
  'a catalog index carries no offer and must be skipped',
);

// --- terms behind a link are flagged, not silently accepted ---
const noTerms = toRecord('https://www.max.co.il/benefits/x/y', {
  markdown: '# חנות הבגדים\n\n20% הנחה על כל החנות, מבצע לחברי מועדון בלבד\n',
  metadata: { title: 'חנות הבגדים' },
}, { site: 'max.co.il', program: 'max' });
assert.ok(noTerms, 'a legible offer without a terms block is still a record');
assert.match(noTerms.warning, /חשוב לדעת/);

// --- the merchant name is the business, not the SEO title ---
assert.equal(
  merchantName('# ווטרלנד \\- פארק המים של אילת\n\nגוף', 'ווטרלנד – MAX הטבות'),
  'ווטרלנד - פארק המים של אילת',
  'the h1 wins over the search-engine title, escapes resolved',
);
assert.equal(
  merchantName('no heading here', 'סטימצקי – MAX הטבות בכרטיס אשראי'),
  'סטימצקי',
  'without an h1, the title is trimmed at its brand separator',
);
assert.equal(
  merchantName('', 'פארק המים - אילת'),
  'פארק המים - אילת',
  'a hyphen inside a name is not a brand separator',
);

// --- the accessibility toolbar is chrome, not content ---
// Verbatim from a collected magiayoter record: 400 chars of font-size controls
// stood ahead of the first word about the offer.
const A11Y = `# ישראייר

he
עברית
⯈
enEnglishheעבריתruРусскийarالعربية
הצהרת נגישות
לפתיחת התפריט מכל מקום באתר F10
✔
הגדלת טקסט
100%
✔
זכוכית מגדלת
✔
ניגודיות גבוהה
✔
גופן קריא

חיילים טסים לאילת ב-20% הנחה, מבצע לחברי מועדון.
`;
const a11y = sectionsFromMarkdown(A11Y);
const body = a11y['ישראייר'];
assert.ok(body, 'the offer section survives');
assert.ok(!body.includes('הגדלת טקסט'), 'accessibility menu items must be stripped');
assert.ok(!body.includes('הצהרת נגישות'), 'accessibility declaration must be stripped');
assert.ok(!body.includes('enEnglish'), 'the language switcher blob must be stripped');
assert.ok(!body.includes('✔'), 'toolbar glyphs must be stripped');
assert.match(body, /חיילים טסים לאילת/, 'the actual offer text must survive');

// The zoom control renders as a bare `100%` — but so does a discount. Stripping
// bare percentages cost 4 max records and 4 terms blocks on the first live run.
const pct = sectionsFromMarkdown('# חנות\n\nמבצע הנחה\n\n20%\n\nלחברי מועדון\n');
assert.match(pct['חנות'], /20%/, 'a standalone discount must never be stripped as chrome');

// The same widget ships pointed on some sites. The pointed copy went straight
// through the filter into three collected catalogs.
const pointed = sectionsFromMarkdown(
  '# מועדון\n\nכְּלֵי נְגִישׁוּת סְגִירָה:\n- נִיגּוּדִיּוּת גְּבוֹהָה.\n- גְּוָנֵי אֲפוֹר\n- קוֹרֵא מָסַךְ Vee\n- הַגְדָּלַת טֵקְסְט\n\n15% הנחה לחברי מועדון\n',
);
assert.ok(!pointed['מועדון'].includes('נְגִישׁוּת'), 'the pointed widget must be stripped too');
assert.ok(!pointed['מועדון'].includes('גְּוָנֵי'), 'pointed list items must be stripped');
assert.match(pointed['מועדון'], /15% הנחה/, 'the offer survives the pointed widget');

// Controls the keyword list does not name, dropped because of the run they sit
// in. This is the case an ever-growing regex kept missing.
const unnamed = sectionsFromMarkdown(
  '# מועדון\n\nהַתְאָמַת רִיוּוּחַ בֵּין מִילִים:\n- הַגְדָּלַת רִיוּוּחַ\n- אִיפּוּס רִיוּוּחַ\n- הַסְתָּרַת תְּמוּנוֹת\n- סַמָּן גָּדוֹל כֵּהֶה\n- הַתְאָמָה לְקוֹרְאֵי מָסָךְ\n\n25% הנחה בכל החנויות לחברי מועדון\n',
);
assert.ok(!unnamed['מועדון'].includes('רִיוּוּחַ'), 'unnamed controls go with the run');
assert.ok(!unnamed['מועדון'].includes('תְּמוּנוֹת'), 'and so do their neighbours');
assert.match(unnamed['מועדון'], /25% הנחה/, 'the offer still survives');

// The theme picker renders its zoom levels as `100%`. Because `%` counted as
// offer vocabulary, those lines read as content and split the widget into
// fragments too short to detect — the widget then survived into 22 records.
const picker = sectionsFromMarkdown(
  '# אופטיקנה\n\n100%\n+\n100%\nצבע רקע\nצבע כותרת\nצבע טקסט\nאיפוס כל ההתאמות\n\n30% הנחה על משקפיים\n',
);
assert.ok(!picker['אופטיקנה'].includes('צבע רקע'), 'the theme picker goes with its run');
assert.ok(!picker['אופטיקנה'].includes('100%'), 'zoom levels are not offers');
assert.match(picker['אופטיקנה'], /30% הנחה/, 'the real discount survives');

// Bare backslashes are card separators on style.co.il, not content.
const litter = sectionsFromMarkdown('# מזון\n\n2 פיצות \\\\ לרכישה ב-₪146 \\\\ בשווי ₪177\n');
assert.ok(!litter['מזון'].includes('\\'), 'backslash litter must not reach the model');
assert.match(litter['מזון'], /לרכישה ב-₪146/, 'the price survives');

// A short genuine list must NOT be mistaken for a toolbar.
const realList = sectionsFromMarkdown(
  '# מבצע\n\n- 10% הנחה על נעליים\n- 15% הנחה על תיקים\n- 20% הנחה על מעילים\n- 5% הנחה על גרביים\n',
);
assert.match(realList['מבצע'], /10% הנחה על נעליים/, 'an offer list is not chrome');
assert.match(realList['מבצע'], /5% הנחה על גרביים/, 'every item of it survives');

// --- a catalog page has no single merchant ---
const catalog = toRecord('https://top.style.co.il/', {
  markdown: '# תקנון אתר ומדיניות הגנת הפרטיות\n\n20% הנחה, מבצע לחברי מועדון בכל החנויות\n',
  metadata: { title: 'תקנון אתר' },
}, { site: 'top.style.co.il', program: 'isracard_top_members', catalogPage: true });
assert.ok(catalog, 'a catalog page still produces a record');
assert.equal(catalog.merchant_name, undefined, 'a catalog page must not claim a merchant');
assert.ok(
  !catalog.terms_text.startsWith('בית העסק:'),
  'and must not open with a merchant line the matcher would trust',
);

// --- a single-page catalog keeps more of itself ---
const dense = { markdown: `# מועדון\n\nהטבה ${'א'.repeat(30_000)} 10% הנחה מועדון\n` };
assert.ok(
  toRecord('https://x/', dense, { site: 'x', program: 'p' }).terms_text.length <= 20_000,
  'a per-offer page is capped at 20k',
);
assert.ok(
  toRecord('https://x/', dense, { site: 'x', program: 'p', maxChars: 60_000 }).terms_text.length > 20_000,
  'a single-page catalog gets the larger window',
);

// --- markdown escapes do not leak into the terms ---
assert.ok(
  !record.terms_text.includes('\\'),
  'escape characters must not reach the model',
);

console.log('ok — collect-catalog');
