#!/usr/bin/env node
/**
 * Give the 276 benefits that point at a merchant nobody ever added somewhere to
 * point at — and say honestly which of them could ever have had a coordinate.
 *
 * `validate:data` has reported the count for a while: "276 benefits point at an
 * unmapped merchant — they list, but cannot fire a geofence or match a share".
 * What it cannot say is *why*, and the why splits three ways once you read the
 * names. Some are ordinary shops that the easy.co.il sidecar already knows the
 * location of. Some are shops nobody has collected. And a large share are not
 * places at all — AliExpress, Booking.com, a loadable gift card, a children's
 * play, a concert at Menora, and the card programme referring to itself. A
 * single number implies 276 missing coordinates and there is no such thing.
 *
 * `mine-merchants.mjs` cannot answer this: it runs from the sidecar inwards and
 * only proposes businesses that sit inside one of the ten tracked malls. This
 * runs from the benefits outwards, which is the direction the gap is in.
 *
 * Writes a PROPOSAL. `data/merchants.json` stays hand-maintained, for the
 * reason the other two scripts already give: a wrong coordinate fires a
 * reminder at a shop that is not there. That risk is not hypothetical here —
 * "סינמה סיטי" matches exactly one collected branch in Be'er Sheva, and Cinema
 * City has branches in half the country. Promoting that unread would fence one
 * city and silently miss the rest, which is worse than the honest nothing it
 * does today. So every match is emitted with the evidence a human needs to
 * reject it.
 *
 * `--write` promotes only the entries with no `review` flag — a chain the
 * sidecar knows several branches of. Anything flagged stays in the proposal for
 * a person to judge, which is the whole point of the flag.
 *
 * Run: node scripts/map-unmapped.mjs [--write]
 */
import { readFile, writeFile } from 'node:fs/promises';

const OUT = 'collected/easy/unmapped-proposal.json';

/** Byte-for-byte the app's rule (packages/extraction/src/store.ts). Drift here
 *  silently un-matches a merchant from its own benefits. */
export const normalizeMerchantName = (name) =>
  name.trim().toLowerCase().replace(/[\s'"׳״־-]+/g, '');

/**
 * A hint at why a name has no coordinate, never a verdict.
 *
 * Only ever narrows what a human reads first — nothing downstream branches on
 * it, because "Delta" is a clothing chain with real branches and also an
 * airline, and no keyword list is going to settle that.
 */
const HINTS = [
  [/gift ?card|גיפט ?קארד|שובר|נטען/i, 'gift_card'],
  [/\bmax\b|מקס בק|maxtravel|max travel|max back/i, 'programme_self_reference'],
  [/הצגה|מופע|פסטיבל|קרקס|היכל|תערוכ|שעת סיפור|קונצרט/i, 'event'],
  [/aliexpress|booking\.com|shein|esimo|online|אונליין|isic/i, 'online_only'],
];

const hintFor = (name) => HINTS.find(([re]) => re.test(name))?.[1] ?? null;

const [benefits, merchants, sidecar, venues] = await Promise.all(
  [
    'data/benefits.json',
    'data/merchants.json',
    'collected/easy/merchants-raw.json',
    'data/venues.json',
  ].map((p) => readFile(p, 'utf8').then(JSON.parse)),
);

const known = new Set(merchants.map((m) => m.id));

/** Sidecar rows that actually carry a position, indexed by the shared rule. */
const byName = new Map();
for (const row of sidecar) {
  if (row.lat == null || row.lng == null) continue;
  const key = normalizeMerchantName(row.name);
  if (!byName.has(key)) byName.set(key, []);
  byName.get(key).push(row);
}

// One entry per missing merchant id, not per benefit: the id is what the
// benefit hash is keyed on, so a proposal has to reuse it rather than mint a
// new one, or every affected benefit changes identity on promotion.
const missing = new Map();
for (const benefit of benefits) {
  if (known.has(benefit.merchant_id)) continue;
  const entry = missing.get(benefit.merchant_id) ?? {
    id: benefit.merchant_id,
    name: benefit.merchant_name,
    benefit_count: 0,
    programs: new Set(),
  };
  entry.benefit_count += 1;
  entry.programs.add(benefit.program_id);
  missing.set(benefit.merchant_id, entry);
}

const distance = (a, b) => {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(rad(a.lat)) * Math.cos(rad(b.lat));
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};

const located = [];
const unlocatable = [];

for (const entry of missing.values()) {
  const rows = byName.get(normalizeMerchantName(entry.name));
  const base = {
    id: entry.id,
    name: entry.name,
    benefit_count: entry.benefit_count,
    programs: [...entry.programs],
  };

  if (!rows) {
    unlocatable.push({ ...base, hint: hintFor(entry.name) });
    continue;
    }

  const branches = rows.map((r) => ({ lat: r.lat, lng: r.lng, city: r.city ?? null }));
  const cities = [...new Set(branches.map((b) => b.city).filter(Boolean))];
  located.push({
    ...base,
    // Shaped as a Merchant so a reviewer can paste it straight in.
    merchant: {
      id: entry.id,
      name: entry.name,
      domains: [], // never guessed — a wrong domain mis-matches the share sheet
      venue_ids: venues
        .filter((v) => branches.some((b) => distance(b, v) <= v.radius_m))
        .map((v) => v.id),
      branches,
      categories: [],
      label: rows[0].easy_category ?? null,
    },
    evidence: rows.slice(0, 5).map((r) => `${r.address ?? '?'}, ${r.city ?? '?'}`),
    // The one thing a reviewer must judge. A national chain represented by one
    // or two collected branches will fence those and quietly miss every other,
    // which reads to a user as the reminder being broken rather than partial.
    review: branches.length <= 2 ? 'few_branches_verify_chain_size' : null,
    cities,
  });
}

located.sort((a, b) => b.benefit_count - a.benefit_count);
unlocatable.sort((a, b) => b.benefit_count - a.benefit_count);

const affected = (list) => list.reduce((n, e) => n + e.benefit_count, 0);

console.log(`benefits pointing at an unmapped merchant: ${affected(located) + affected(unlocatable)}`);
console.log(`missing merchant ids:                     ${missing.size}`);
console.log();
console.log(`locatable from the easy sidecar: ${located.length} merchants / ${affected(located)} benefits`);
for (const e of located) {
  const flag = e.review ? `  [${e.review}]` : '';
  console.log(`  ${e.name} — ${e.merchant.branches.length} branch(es) ${e.cities.join(', ')} · ${e.benefit_count} benefit(s)${flag}`);
}
console.log();
console.log(`no coordinate anywhere: ${unlocatable.length} merchants / ${affected(unlocatable)} benefits`);
const byHint = new Map();
for (const e of unlocatable) byHint.set(e.hint ?? 'uncollected_shop', (byHint.get(e.hint ?? 'uncollected_shop') ?? 0) + e.benefit_count);
for (const [hint, n] of [...byHint].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${hint}: ${n} benefit(s)`);
}

await writeFile(OUT, JSON.stringify({ located, unlocatable }, null, 1), 'utf8');
console.log(`\nproposal -> ${OUT}`);

const clean = located.filter((e) => e.review == null);

if (!process.argv.includes('--write')) {
  console.log(`nothing in data/ was modified — pass --write to promote the ${clean.length} unflagged merchant(s)`);
} else {
  // Never touch an id that already resolves: promotion has to be re-runnable
  // without duplicating a merchant or clobbering a hand-edited one.
  const added = clean.filter((e) => !known.has(e.id));
  if (added.length === 0) {
    console.log('nothing to promote — every unflagged merchant already exists');
  } else {
    // Indent 1 matches the file as it stands. backfill-merchants.mjs writes 2,
    // so whichever runs last reformats the whole file; not worth a diff here.
    await writeFile(
      'data/merchants.json',
      `${JSON.stringify([...merchants, ...added.map((e) => e.merchant)], null, 1)}
`,
      'utf8',
    );
    console.log(`
promoted ${added.length} merchant(s) into data/merchants.json:`);
    for (const e of added) {
      console.log(`  ${e.id} — ${e.name} (${e.merchant.branches.length} branches, ${e.benefit_count} benefit(s))`);
    }
    console.log('run `npm run validate:data` to confirm the unmapped count dropped');
  }
}
