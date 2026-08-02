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

const [programs, merchants, venues, benefits] = await Promise.all([
  read('programs.json'),
  read('merchants.json'),
  read('venues.json'),
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

for (const benefit of benefits) {
  if (!programIds.has(benefit.program_id)) {
    fail(`benefit ${benefit.id}: unknown program ${benefit.program_id}`);
  }
  if (!merchantIds.has(benefit.merchant_id)) {
    fail(`benefit ${benefit.id}: unknown merchant ${benefit.merchant_id}`);
  }
  if (benefit.type === 'percent' && benefit.value > 100) {
    fail(`benefit ${benefit.id}: ${benefit.value}% discount`);
  }
  if (!/^https?:\/\//.test(benefit.source_url)) {
    fail(`benefit ${benefit.id}: source_url must be a URL a user can open`);
  }
  if (Number.isNaN(Date.parse(benefit.last_verified_at))) {
    fail(`benefit ${benefit.id}: last_verified_at is not a date`);
  }
}

const unreachable = merchants.filter((m) => m.venue_ids.length === 0 && m.domains.length === 0);
for (const merchant of unreachable) {
  fail(`merchant ${merchant.id}: no domains and no venues — it can never be surfaced`);
}

if (errors.length > 0) {
  console.error(`data validation failed (${errors.length}):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(
  `data ok: ${programs.length} programs, ${merchants.length} merchants, ` +
    `${venues.length} venues, ${benefits.length} sample benefits`,
);
