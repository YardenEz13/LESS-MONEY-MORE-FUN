#!/usr/bin/env node
/**
 * Mine easy.co.il's merchant sidecar for things merchants.json cannot get
 * anywhere else: which known merchants sit inside a tracked mall, and which
 * unknown businesses are worth adding.
 *
 * Writes a PROPOSAL, never merchants.json itself. That file is hand-maintained
 * and a wrong venue fires a geofence reminder at a shop that isn't there, so a
 * human reads this before anything ships.
 *
 * Deliberately never proposes a `domains` value: easy exposes no website field,
 * and a guessed domain makes the share sheet silently match the wrong shop.
 */
import { readFile, writeFile } from 'node:fs/promises';

const RAW = 'collected/easy/merchants-raw.json';
const OUT = 'collected/easy/merchant-proposal.json';

/** Byte-for-byte the app's rule (packages/extraction/src/store.ts) — if this
 *  drifts, a merchant we "added" silently fails to match its own benefits. */
const normalizeMerchantName = (name) => name.trim().toLowerCase().replace(/[\s'"׳״־-]+/g, '');

/** Metres between two WGS84 points. */
function distance(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

const [raw, merchants, venues] = await Promise.all(
  [RAW, 'data/merchants.json', 'data/venues.json'].map((p) =>
    readFile(p, 'utf8').then(JSON.parse),
  ),
);

const known = new Map(merchants.map((m) => [normalizeMerchantName(m.name), m]));

/** Venues whose circle contains this point. */
const venuesFor = (c) =>
  c.lat == null || c.lng == null
    ? []
    : venues
        .filter((v) => distance(c, v) <= v.radius_m)
        .map((v) => ({ id: v.id, metres: Math.round(distance(c, v)) }));

const enrich = new Map(); // merchant id -> {name, add_venue_ids, evidence}
const unknownInVenue = [];
let inVenueTotal = 0;

for (const c of raw) {
  const hits = venuesFor(c);
  if (hits.length > 0) inVenueTotal += 1;
  const match = known.get(normalizeMerchantName(c.name));

  if (match) {
    const fresh = hits.filter((h) => !(match.venue_ids ?? []).includes(h.id));
    if (fresh.length === 0) continue;
    const entry = enrich.get(match.id) ?? { id: match.id, name: match.name, add_venue_ids: [], evidence: [] };
    for (const h of fresh) {
      if (entry.add_venue_ids.includes(h.id)) continue;
      entry.add_venue_ids.push(h.id);
      entry.evidence.push(`${h.id}: ${c.address ?? '?'} — ${h.metres}m from centroid`);
    }
    enrich.set(match.id, entry);
  } else if (hits.length > 0) {
    unknownInVenue.push({
      proposed_id: null, // a human names it; ids are load-bearing for benefit hashes
      name: c.name,
      venue_ids: hits.map((h) => h.id),
      easy_category: c.easy_category,
      address: c.address,
      domains: [], // never guessed — see header
    });
  }
}

const matched = raw.filter((c) => known.has(normalizeMerchantName(c.name)));
const withCoords = raw.filter((c) => c.lat != null);

console.log(`candidates:            ${raw.length} (${withCoords.length} with coordinates)`);
console.log(`already in merchants:  ${matched.length} rows -> ${new Set(matched.map((c) => normalizeMerchantName(c.name))).size} distinct merchants`);
console.log(`inside a tracked mall: ${inVenueTotal}`);
console.log(`\nexisting merchants that gain a venue: ${enrich.size}`);
for (const e of enrich.values()) {
  console.log(`  ${e.id} (${e.name}) += ${e.add_venue_ids.join(', ')}`);
  for (const ev of e.evidence) console.log(`      ${ev}`);
}
console.log(`\nunknown businesses inside a tracked mall: ${unknownInVenue.length}`);
for (const u of unknownInVenue.slice(0, 15)) {
  console.log(`  ${u.name} @ ${u.venue_ids.join(',')} — ${u.easy_category ?? '?'}`);
}

await writeFile(
  OUT,
  JSON.stringify({ enrich: [...enrich.values()], new_merchants: unknownInVenue }, null, 1),
  'utf8',
);
console.log(`\nproposal -> ${OUT} (nothing in data/ was modified)`);
