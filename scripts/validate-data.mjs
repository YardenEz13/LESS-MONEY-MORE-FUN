#!/usr/bin/env node
/**
 * Catalog sanity check, run in CI.
 *
 * The app parses these files at startup, so a bad edit is a crash on launch
 * rather than a warning. Cross-file references (a merchant pointing at a venue
 * that doesn't exist, a benefit for a program nobody can declare) are not
 * expressible in the per-file schemas, so they're checked here.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = async (name) => JSON.parse(await readFile(resolve(repoRoot, 'data', name), 'utf8'));

const errors = [];
const fail = (message) => errors.push(message);

// `benefits.json` is the catalog the app actually bundles, so that is the one
// that has to be sound — validating the sample instead would let a bad promote
// reach a phone unchecked. The sample is validated too: it is the seed a fresh
// catalog is created from, and a broken seed is a broken first build.
const [programs, merchants, venues, benefits, sample] = await Promise.all([
  read('programs.json'),
  read('merchants.json'),
  read('venues.json'),
  read('benefits.json'),
  read('benefits.sample.json'),
]);

const programIds = new Set(programs.map((p) => p.id));
const merchantIds = new Set(merchants.map((m) => m.id));
const venueIds = new Set(venues.map((v) => v.id));

for (const [name, items] of [
  ['programs', programs],
  ['merchants', merchants],
  ['venues', venues],
  ['benefits', benefits],
]) {
  const ids = items.map((i) => i.id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length > 0) fail(`${name}: duplicate ids ${[...new Set(duplicates)].join(', ')}`);
}

for (const merchant of merchants) {
  for (const venueId of merchant.venue_ids) {
    if (!venueIds.has(venueId)) fail(`merchant ${merchant.id}: unknown venue ${venueId}`);
  }
  for (const domain of merchant.domains) {
    if (/^https?:\/\//.test(domain) || domain.includes('/')) {
      fail(`merchant ${merchant.id}: domain "${domain}" must be a bare hostname`);
    }
  }
}

for (const venue of venues) {
  // Israel's bounding box, roughly. A transposed lat/lng lands outside it.
  if (venue.lat < 29.4 || venue.lat > 33.4) fail(`venue ${venue.id}: lat ${venue.lat} out of range`);
  if (venue.lng < 34.2 || venue.lng > 35.9) fail(`venue ${venue.id}: lng ${venue.lng} out of range`);
  if (venue.radius_m < 50 || venue.radius_m > 1000) {
    fail(`venue ${venue.id}: radius ${venue.radius_m}m is outside the sane 50-1000m range`);
  }
}

let unmapped = 0;
for (const [file, list] of [
  ['benefits.json', benefits],
  ['benefits.sample.json', sample],
]) {
  for (const benefit of list) {
    if (!programIds.has(benefit.program_id)) {
      fail(`${file} ${benefit.id}: unknown program ${benefit.program_id}`);
    }
    // An `unmapped_*` id is what the extractor mints when a scraped merchant
    // isn't in merchants.json yet. That is a supported state, not an error —
    // the benefit still lists, it just can't fire a geofence or match a share
    // until someone adds the merchant. Counted so the number stays visible.
    if (benefit.merchant_id.startsWith('unmapped_')) {
      unmapped += 1;
    } else if (!merchantIds.has(benefit.merchant_id)) {
      fail(`${file} ${benefit.id}: unknown merchant ${benefit.merchant_id}`);
    }
    if (benefit.type === 'percent' && benefit.value > 100) {
      fail(`${file} ${benefit.id}: ${benefit.value}% discount`);
    }
    if (!/^https?:\/\//.test(benefit.source_url)) {
      fail(`${file} ${benefit.id}: source_url must be a URL a user can open`);
    }
    if (Number.isNaN(Date.parse(benefit.last_verified_at))) {
      fail(`${file} ${benefit.id}: last_verified_at is not a date`);
    }
    for (const field of ['valid_from', 'valid_until']) {
      const value = benefit[field];
      if (value != null && Number.isNaN(Date.parse(value))) {
        fail(`${file} ${benefit.id}: ${field} "${value}" is not a parseable instant`);
      }
    }
  }
}

// A merchant with neither a domain nor a venue is not useless — its benefits
// still appear in the list. What it cannot do is be surfaced *proactively*: no
// domain means a shared URL won't match it, no venue means walking into the mall
// won't remind you. So the hard failure is reserved for a merchant that carries
// no benefits either, which is genuinely dead weight; the rest is a note, and
// the note is the backlog of what to go and verify.
//
// `any_merchant` is exempt outright: a flat cashback card applies everywhere
// rather than at a shop, and is reached by combining with another merchant's
// offer (see UNIVERSAL_MERCHANT_ID in @sbr/core).
const UNIVERSAL_MERCHANT_ID = 'any_merchant';
const merchantsWithBenefits = new Set([...benefits, ...sample].map((b) => b.merchant_id));

// "Can this merchant be found by standing somewhere" — a branch coordinate or a
// curated venue id both answer yes. Counting only `venue_ids` is what let this
// number read 88/1057 while the sidecar held 2048 usable coordinates, and a
// metric that measures the wrong join hides the outage it exists to report.
const hasPlace = (m) => m.venue_ids.length > 0 || (m.branches ?? []).length > 0;

const noReach = merchants.filter(
  (m) => m.id !== UNIVERSAL_MERCHANT_ID && !hasPlace(m) && m.domains.length === 0,
);
for (const merchant of noReach) {
  if (!merchantsWithBenefits.has(merchant.id)) {
    fail(`merchant ${merchant.id}: no domains, no place and no benefits — nothing can reach it`);
  }
}
const listOnly = noReach.filter((m) => merchantsWithBenefits.has(m.id));

// Every merchant that has benefits but no place can never fire a geofence.
// Worth stating separately: it is the gap between "we know about this shop" and
// "we can remind you when you walk into it".
const noVenue = merchants.filter(
  (m) => m.id !== UNIVERSAL_MERCHANT_ID && !hasPlace(m) && merchantsWithBenefits.has(m.id),
);

// A branch outside Israel is a bad name match, not a real shop — same bounds the
// venues are held to, applied to the 2048 coordinates that now drive matching.
for (const merchant of merchants) {
  for (const branch of merchant.branches ?? []) {
    if (branch.lat < 29.4 || branch.lat > 33.4 || branch.lng < 34.2 || branch.lng > 35.9) {
      fail(`merchant ${merchant.id}: branch ${branch.lat},${branch.lng} is outside Israel`);
    }
  }
}

if (errors.length > 0) {
  console.error(`data validation failed (${errors.length}):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(
  `data ok: ${programs.length} programs, ${merchants.length} merchants, ` +
    `${venues.length} venues, ${benefits.length} shipped benefits ` +
    `(+${sample.length} in the sample seed)`,
);
if (unmapped > 0) {
  console.log(
    `note: ${unmapped} benefits point at an unmapped merchant — they list, but ` +
      'cannot fire a geofence or match a share until added to merchants.json',
  );
}
if (listOnly.length > 0) {
  console.log(
    `note: ${listOnly.length} merchants have no domain and no venue — their benefits ` +
      `list but are never surfaced proactively: ${listOnly.map((m) => m.id).join(', ')}`,
  );
}
if (noVenue.length > 0) {
  console.log(`note: ${noVenue.length} merchants with benefits have no venue — no geofence reminder`);
}
