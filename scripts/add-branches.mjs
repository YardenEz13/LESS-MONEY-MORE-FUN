#!/usr/bin/env node
/**
 * Attach real branch coordinates to merchants.json from the easy.co.il sidecar.
 *
 * This is the missing half of place-matching. `venue_ids` is hand-maintained and
 * only ever got filled for 88 of 1057 merchants, so `benefitsAtVenue` could
 * reach 156 of 2763 benefits and a geofence enter event resolved to
 * `nothing_to_show` — the location feature firing correctly and displaying
 * nothing, with no error anywhere.
 *
 * The sidecar already carries a lat/lng per branch for 3925 businesses. Once a
 * merchant knows where its branches physically are, "what is near me" is a
 * distance query and needs no per-mall curation at all.
 *
 * Matching is exact normalized-name equality, byte-for-byte the rule in
 * `packages/extraction/src/store.ts` and `scripts/mine-merchants.mjs`. No fuzzy
 * matching: a wrong match puts a shop on the wrong street and reminds someone
 * about a discount they cannot walk to.
 *
 * Idempotent — rewrites `branches` from source each run rather than appending.
 */
import { readFile, writeFile } from 'node:fs/promises';

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
const found = new Map(); // merchant id -> branches

for (const branch of raw) {
  if (branch.lat == null || branch.lng == null) continue;
  const merchant = byName.get(normalizeMerchantName(branch.name));
  if (!merchant) continue;

  const list = found.get(merchant.id) ?? [];
  // The sidecar lists a branch once per club it belongs to, so the same shop
  // arrives several times. Deduping on coordinates rather than on easy_id
  // because two ids can still describe one storefront.
  if (list.some((b) => distance(b, branch) < DUPLICATE_M)) continue;
  list.push({ lat: branch.lat, lng: branch.lng });
  found.set(merchant.id, list);
}

let changed = 0;
for (const merchant of merchants) {
  const branches = found.get(merchant.id);
  if (!branches?.length) continue;
  merchant.branches = branches;
  changed += 1;
}

await writeFile(MERCHANTS, `${JSON.stringify(merchants, null, 2)}\n`, 'utf8');

const total = [...found.values()].reduce((n, b) => n + b.length, 0);
console.log(`${changed} merchants now carry ${total} branch coordinates`);
