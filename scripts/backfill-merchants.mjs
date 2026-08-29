#!/usr/bin/env node
/**
 * Backfill `data/merchants.json` from the easy.co.il sidecar: branch
 * coordinates, the city each branch is in, what the shop sells, and the
 * source's own words for it.
 *
 * All four already exist in `collected/easy/merchants-raw.json` for 3925
 * businesses. Only the coordinates were ever read out of it, so the app knew
 * where 1057 merchants were and nothing whatsoever about what they were:
 *
 *   - `categories` reached 390 of 1057 merchants, so 1819 benefits could never
 *     answer a category question and the advisor's own example ("איפה לתדלק")
 *     had almost nothing to draw on.
 *   - `label` did not exist, so a list of 1057 mostly-unknown small businesses
 *     read as bare names — "מינימרקט קרן" with no hint that it is a grocer.
 *   - branches carried no city, so a list with no location fix could not say
 *     where anything was, and a user outside Gush Dan got an empty screen
 *     rather than "the catalog does not cover you yet".
 *
 * Matching is exact normalized-name equality, byte-for-byte the rule in
 * `packages/extraction/src/store.ts` and `scripts/mine-merchants.mjs`. No fuzzy
 * matching: a wrong match puts a shop on the wrong street and reminds someone
 * about a discount they cannot walk to.
 *
 * `branches` and `label` are rewritten from source each run — they are the
 * sidecar's facts, not ours. `categories` is only ever *filled*: 88 merchants
 * were classified by hand before the sidecar existed, and a regex table should
 * not overrule a person. Idempotent either way.
 *
 * Run: node scripts/backfill-merchants.mjs [--write]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { categoriesFor } from './easy-category.mjs';

const RAW = 'collected/easy/merchants-raw.json';
const MERCHANTS = 'data/merchants.json';

const normalizeMerchantName = (name) => name.trim().toLowerCase().replace(/[\s'"׳״־-]+/g, '');

/** Two branches of the same chain this close apart are one branch listed twice. */
const DUPLICATE_M = 50;

function distance(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat));
  return 2 * R * Math.asin(Math.sqrt(h));
}

const [raw, merchants] = await Promise.all(
  [RAW, MERCHANTS].map((p) => readFile(p, 'utf8').then(JSON.parse)),
);

const byName = new Map(merchants.map((m) => [normalizeMerchantName(m.name), m]));
const branchesFor = new Map(); // merchant id -> branches
const sourceFor = new Map(); // merchant id -> first sidecar row seen

for (const branch of raw) {
  const merchant = byName.get(normalizeMerchantName(branch.name));
  if (!merchant) continue;
  // Identity (what it sells, what it is called) survives a missing coordinate;
  // only the geofence needs one.
  if (!sourceFor.has(merchant.id) && branch.easy_category) sourceFor.set(merchant.id, branch);
  if (branch.lat == null || branch.lng == null) continue;

  const list = branchesFor.get(merchant.id) ?? [];
  // The sidecar lists a branch once per club it belongs to, so the same shop
  // arrives several times. Deduping on coordinates rather than on easy_id
  // because two ids can still describe one storefront.
  if (list.some((b) => distance(b, branch) < DUPLICATE_M)) continue;
  // `city` is nullish in the schema and stays absent rather than empty: an
  // unknown city must not render as a blank line under a shop name.
  list.push({ lat: branch.lat, lng: branch.lng, ...(branch.city ? { city: branch.city } : {}) });
  branchesFor.set(merchant.id, list);
}

let withBranches = 0;
let withCity = 0;
let labelled = 0;
let classified = 0;
let alreadyClassified = 0;
let totalBranches = 0;

for (const merchant of merchants) {
  const branches = branchesFor.get(merchant.id);
  if (branches?.length) {
    merchant.branches = branches;
    withBranches += 1;
    totalBranches += branches.length;
    if (branches.some((b) => b.city)) withCity += 1;
  }

  const source = sourceFor.get(merchant.id);
  if (source?.easy_category) {
    merchant.label = source.easy_category;
    labelled += 1;
    if (merchant.categories?.length) {
      alreadyClassified += 1;
    } else {
      const categories = categoriesFor(source.easy_category);
      if (categories.length) {
        merchant.categories = categories;
        classified += 1;
      }
    }
  }
}

const stillBare = merchants.filter((m) => !m.categories?.length).length;
console.log(`${merchants.length} merchants in ${MERCHANTS}`);
console.log(`  ${withBranches} carry ${totalBranches} branch coordinates (${withCity} with a city)`);
console.log(`  ${labelled} got a label from the source`);
console.log(`  ${classified} newly classified, ${alreadyClassified} left as hand-classified`);
console.log(`  ${stillBare} still have no category — they list and geofence, they just do not answer a category question`);

if (process.argv.includes('--write')) {
  await writeFile(MERCHANTS, `${JSON.stringify(merchants, null, 2)}\n`, 'utf8');
  console.log(`\nwrote ${MERCHANTS}`);
} else {
  console.log('\ndry run — pass --write to apply');
}
