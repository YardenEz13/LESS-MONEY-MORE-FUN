#!/usr/bin/env node
/**
 * Add a `data/programs.json` entry for every easy.co.il discount list that does
 * not have one, so its deals can reach the extraction pipeline at all — benefit
 * ids hash the program id, so an unmapped list is simply unextractable.
 *
 * Names come from easy's own hub titles, never invented. Category is inferred
 * from the title, and where the inference is weak the entry is marked so a
 * human can correct it rather than the guess passing silently as fact.
 *
 * `parent_id` is set for the obvious sub-brands (My MAX, max תמורה, ישראכרט
 * TOP…). That matters beyond tidiness: a card carries its issuer's benefits as
 * well as its own, and the matcher walks the parent chain.
 *
 * Run: node scripts/add-easy-programs.mjs --titles <slugs.json> [--write]
 */
import { readFile, writeFile } from 'node:fs/promises';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
};

/** slug -> parent program id, for lists that are a variant of a card we track. */
const PARENT = {
  'max-Kranot': 'max',
  'max-Tmura': 'max',
  'My-MAX': 'max',
  'Isracard-TOP-Members': 'isracard',
  youngstyle: 'isracard',
  'Tefahot-Card': 'isracard',
  'Calextra-Discounts': 'cal',
};

/** Deal-type lists, not clubs — nobody "holds" a Happy Hour. */
const NOT_A_CLUB = new Set([
  'Special-Offers', 'SMB-Vouchers', 'End-Of-Day-Deals', 'Happy-Hour', 'Tuesday-Market',
  'Business-Menu', 'Late-Night-Deal', 'Brunch', 'All-you-can-eat', 'Shawarma-Deal',
  'Happy-Gift', 'Wishing-Well',
  // The hub's own page, reached via filter links like /list/Discounts?open=1.
  // Its title is "פתוח עכשיו" — a filter, not something anyone holds.
  'Discounts',
  // Local trade campaigns: a town promoting its shops for a week. Real deals,
  // but not a membership a user could ever declare at onboarding.
  'Ramat-Gan-buy-Local', 'Menashe-Regional-Council-For-Businesses', 'Metzer',
  'Businesses-Week-in-Rishon-LeZion', 'Supporting-businesses-in-Ashkelon',
  'Emek-Yizrael-businesses',
]);

const CARD = /כרטיס|card|אשראי|mastercard|visa|amex|diners|אמקס|דיינרס|כאל|ישראכרט|max|לאומי|מזרחי|דיסקונט|מרכנתיל|פועלים/i;
/**
 * Note what is NOT here: "מועדון". It only means "club", and retail clubs use
 * it as freely as employer ones — matching on it filed רמי לוי המועדון, a
 * supermarket, under employer clubs.
 */
const EMPLOYER = /ארגון|עובדי|קרנות|גמלאי|מורים|שוטרים|אגד|הסתדרות|סטודנט|אוניברסיט|הייטק|ביטוח|רואי חשבון/i;

/** Cases no title-based rule gets right. Cheaper than a cleverer regex. */
const CATEGORY_OVERRIDE = {
  rami_levy_club: 'retail_club',
  tau: 'employer_club', // Tel Aviv University
  tov_plus_club: 'retail_club',
  yours_club: 'retail_club',
  your_club_for_pensioner: 'retail_club',
};

function slugToId(slug) {
  return slug
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
}

function classify(slug, title) {
  const override = CATEGORY_OVERRIDE[slugToId(slug)];
  if (override) return { category: override, sure: true };
  if (PARENT[slug]) return { category: 'credit_card', sure: true };
  const text = `${slug} ${title}`;
  if (CARD.test(text)) return { category: 'credit_card', sure: true };
  if (EMPLOYER.test(text)) return { category: 'employer_club', sure: true };
  // Everything else is a retail/consumer club as far as we can tell from a
  // title alone. Flagged, because a wrong category only shows up as a program
  // sitting in the wrong onboarding section — quiet, and annoying to trace.
  return { category: 'retail_club', sure: false };
}

const titles = JSON.parse(await readFile(arg('titles'), 'utf8'));
const programs = JSON.parse(await readFile('data/programs.json', 'utf8'));
const haveIds = new Set(programs.map((p) => p.id));

// Slugs already mapped in scrape-easy.mjs, by program id.
const MAPPED = new Set([
  'MAX', 'Cal-Discount', 'Isracard-Discounts', 'Isracard-Chever', 'Behatsdaa',
  'MAX-Behatsdaa', 'Hitech-Zone-members', 'Kranot-Police', 'Shufersal4u',
]);

const added = [];
const unsure = [];
// Case-insensitive: easy's slugs are inconsistent about capitalisation
// ("Businesses-week-..." vs "Supporting-Businesses-..."), and an exact-match
// exclusion list silently lets the odd one through.
const excluded = new Set([...NOT_A_CLUB].map((s) => s.toLowerCase()));
const mappedLower = new Set([...MAPPED].map((s) => s.toLowerCase()));

for (const [slug, title] of Object.entries(titles)) {
  if (mappedLower.has(slug.toLowerCase()) || excluded.has(slug.toLowerCase())) continue;
  const id = slugToId(slug);
  if (haveIds.has(id)) continue;

  const { category, sure } = classify(slug, title);
  const entry = {
    id,
    name: title,
    category,
    catalog_url: `https://easy.co.il/list/${slug}`,
    hint: `הטבות ${title} — כפי שמופיעות באיזי`,
  };
  if (PARENT[slug]) entry.parent_id = PARENT[slug];
  programs.push(entry);
  haveIds.add(id);
  added.push([slug, id, category, title]);
  if (!sure) unsure.push(`${id} (${title})`);
}

console.log(`${added.length} programs to add`);
for (const [slug, id, cat, title] of added) console.log(`  ${id.padEnd(34)} ${cat.padEnd(14)} ${title}`);
if (unsure.length) {
  console.log(`\ncategory inferred from the title alone for ${unsure.length} — worth a human glance:`);
  console.log('  ' + unsure.join(', '));
}

if (process.argv.includes('--write')) {
  await writeFile('data/programs.json', JSON.stringify(programs, null, 2) + '\n', 'utf8');
  console.log('\nwrote data/programs.json');
} else {
  console.log('\ndry run — pass --write to apply');
}

// slug -> program id, for scrape-easy.mjs PROGRAMS
console.log('\nPROGRAMS additions:');
console.log(added.map(([slug, id]) => `  ${/^[A-Za-z_$][\w$]*$/.test(slug) ? slug : `'${slug}'`}: '${id}',`).join('\n'));
