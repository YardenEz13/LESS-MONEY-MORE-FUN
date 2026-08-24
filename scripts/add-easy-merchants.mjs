#!/usr/bin/env node
/**
 * Add a `data/merchants.json` entry for every easy.co.il business behind an
 * ALREADY-APPROVED benefit (`data/generated/benefits.json`) that has none yet.
 *
 * Deliberately not the review queue. `validate:data` fails a merchant with no
 * domain, no venue and no *shipped* benefit — correctly, since nothing can
 * reach it yet — and every benefit still awaiting review is exactly that kind
 * of merchant until it clears review. Minting merchants for the whole queue
 * would fail validation the moment it ran, for names that may never approve.
 *
 * Without a merchant record, extraction mints `unmapped_<slug>`: the benefit
 * still lists, but it can never fire a geofence or match a shared link.
 * Benefit ids hash the merchant id, so run this BEFORE `publish:catalog` and
 * re-extract afterwards — ids for the newly-mapped merchants rebuild, they do
 * not update in place.
 *
 * Three deliberate limits:
 *
 * - **`name` is copied byte-for-byte** from the collected record. `resolveMerchantId`
 *   compares a normalised form of this string, so a "tidied" name silently
 *   stops matching its own benefits.
 * - **`domains` is always empty.** easy exposes no website, and a guessed domain
 *   makes the share sheet match the wrong shop — worse than matching nothing.
 * - **`venue_ids` is measured, not guessed**: the business's own coordinates
 *   must fall inside a venue's radius. A wrong venue fires a reminder at a shop
 *   that isn't there.
 *
 * Run: node scripts/add-easy-merchants.mjs [--write]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { categoriesFor } from './easy-category.mjs';

/** Byte-for-byte the app's rule (packages/extraction/src/store.ts). */
const normalizeMerchantName = (name) => name.trim().toLowerCase().replace(/[\s'"׳״־-]+/g, '');

function distance(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(rad(a.lat)) * Math.cos(rad(b.lat));
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const [published, raw, merchants, venues] = await Promise.all(
  [
    'data/generated/benefits.json',
    'collected/easy/merchants-raw.json',
    'data/merchants.json',
    'data/venues.json',
  ].map((p) => readFile(p, 'utf8').then(JSON.parse)),
);

const rawByName = new Map();
for (const m of raw) {
  const key = normalizeMerchantName(m.name);
  if (!rawByName.has(key)) rawByName.set(key, m);
}

const known = new Set(merchants.map((m) => normalizeMerchantName(m.name)));
const usedIds = new Set(merchants.map((m) => m.id));

const wanted = [
  ...new Set(
    published.filter((b) => b.merchant_id.startsWith('unmapped_')).map((b) => b.merchant_name),
  ),
];

const added = [];
let noRecord = 0;
let inVenue = 0;

for (const name of wanted) {
  const key = normalizeMerchantName(name);
  if (known.has(key)) continue;
  const source = rawByName.get(key);
  if (!source || source.lat == null) {
    noRecord += 1;
    continue;
  }

  // easy's own business id: stable across runs, unique, and honest about being
  // machine-generated rather than pretending to be a curated slug.
  let id = `easy_${source.easy_id}`;
  while (usedIds.has(id)) id = `${id}_x`;

  const venue_ids = venues.filter((v) => distance(source, v) <= v.radius_m).map((v) => v.id);
  if (venue_ids.length) inVenue += 1;

  added.push({
    id,
    name,
    domains: [],
    venue_ids,
    categories: categoriesFor(source.easy_category),
    ...(source.easy_category ? { label: source.easy_category } : {}),
  });
  usedIds.add(id);
  known.add(key);
}

console.log(`${wanted.length} merchants wanted by approved (not-yet-published) benefits`);
console.log(`  ${added.length} to add`);
console.log(`  ${noRecord} skipped — no scraped record with coordinates`);
console.log(`  ${inVenue} of the new ones sit inside a tracked mall`);
console.log(`  ${added.filter((m) => m.categories.length).length} got a category; the rest stay []`);

if (process.argv.includes('--write')) {
  await writeFile('data/merchants.json', JSON.stringify([...merchants, ...added], null, 2) + '\n', 'utf8');
  console.log(`\nwrote data/merchants.json (${merchants.length + added.length} merchants)`);
  console.log('Re-run extraction: benefit ids hash merchant_id, so these rows rebuild.');
} else {
  console.log('\ndry run — pass --write to apply');
}
