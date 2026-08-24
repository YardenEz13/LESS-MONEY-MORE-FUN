#!/usr/bin/env node
/**
 * "Stand in a shopping complex anywhere in the country — is there anything for
 * me?" Answers it for every complex the catalog knows about.
 *
 * Complexes are found rather than listed. `data/venues.json` holds ten
 * hand-typed malls, all but two in Gush Dan, and the app stopped needing that
 * list when `benefitsNear` started matching on branch coordinates. So this
 * asks the same question the app asks — what is within WALKING_RADIUS_M of this
 * point — at the densest points in the data, and a cluster of forty shops with
 * a mall's name at the centre *is* the mall, with coordinates from the source
 * instead of from someone's guess.
 *
 * Run: npm run coverage:report [-- --clubs max,hever] [--min 3]
 */
import { readFile } from 'node:fs/promises';

/** The app's own radius — apps/mobile/src/screens/HomeScreen.tsx. */
const WALKING_RADIUS_M = 500;

function distance(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat));
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
};

const [merchants, benefits] = await Promise.all(
  ['data/merchants.json', 'data/benefits.json'].map((p) => readFile(p, 'utf8').then(JSON.parse)),
);

const clubs = arg('clubs')?.split(',').map((c) => c.trim());
const minMerchants = Number(arg('min') ?? 3);
const wanted = clubs ? benefits.filter((b) => clubs.includes(b.program_id)) : benefits;

const benefitsByMerchant = new Map();
for (const b of wanted) {
  const list = benefitsByMerchant.get(b.merchant_id) ?? [];
  list.push(b);
  benefitsByMerchant.set(b.merchant_id, list);
}

// One point per merchant branch that actually has an offer to show.
const points = [];
for (const m of merchants) {
  if (!benefitsByMerchant.has(m.id)) continue;
  for (const branch of m.branches ?? []) {
    points.push({ ...branch, id: m.id, name: m.name });
  }
}

/**
 * Greedy densest-point clustering: whichever point has the most neighbours
 * within walking distance becomes a complex, its members are consumed, repeat.
 *
 * ponytail: O(n²) over ~2k points, run by hand after a crawl. Grid the points
 * first if this ever runs per request or the catalog reaches six figures.
 */
const remaining = new Set(points.keys());
const complexes = [];
while (remaining.size > 0) {
  let best = null;
  for (const i of remaining) {
    const members = [...remaining].filter((j) => distance(points[i], points[j]) <= WALKING_RADIUS_M);
    if (!best || members.length > best.members.length) best = { i, members };
  }
  for (const j of best.members) remaining.delete(j);
  const members = best.members.map((j) => points[j]);
  const merchantIds = new Set(members.map((m) => m.id));
  const offers = [...merchantIds].flatMap((id) => benefitsByMerchant.get(id) ?? []);
  complexes.push({
    city: members.map((m) => m.city).find(Boolean) ?? '?',
    anchor: points[best.i].name,
    merchants: merchantIds.size,
    offers: offers.length,
    programs: new Set(offers.map((o) => o.program_id)).size,
    best: Math.max(...offers.map((o) => (o.type === 'percent' || o.type === 'cashback' ? o.value : 0))),
  });
}

const viable = complexes.filter((c) => c.merchants >= minMerchants);
const byCity = new Map();
for (const c of viable) byCity.set(c.city, (byCity.get(c.city) ?? 0) + 1);

console.log(
  `\n${clubs ? `clubs: ${clubs.join(', ')}` : 'all clubs'} — ${wanted.length} offers, ` +
    `${viable.length} complexes of ${minMerchants}+ shops in ${byCity.size} cities\n`,
);
console.log('city              anchor                          shops  offers  clubs   best');
for (const c of viable.slice(0, 30)) {
  console.log(
    `${c.city.padEnd(17)} ${c.anchor.slice(0, 30).padEnd(31)} ${String(c.merchants).padStart(5)} ` +
      `${String(c.offers).padStart(7)} ${String(c.programs).padStart(6)} ${String(c.best).padStart(5)}%`,
  );
}

console.log('\ncities with at least one viable complex, by count:');
const ranked = [...byCity.entries()].sort((a, b) => b[1] - a[1]);
console.log(ranked.map(([city, n]) => `${city} (${n})`).join(', ') || '  none');
// The number that matters: one city with everything is not national coverage.
const outside = ranked.filter(([city]) => city !== 'תל אביב יפו').reduce((n, [, c]) => n + c, 0);
console.log(`\n${viable.length - outside} of ${viable.length} viable complexes are in Tel Aviv.`);
