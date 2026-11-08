#!/usr/bin/env node
/**
 * Add real branch coordinates for chains from OpenStreetMap.
 *
 * Geography is what lets a reminder fire on a high street and not only in ten
 * malls, and a chain's branch list came from one aggregator. OSM is an
 * independent, openly licensed (ODbL) source of the same fact: where the shops are.
 *
 * Deliberately narrow, because a wrong branch fires a reminder at a shop that is
 * not there (see data/README.md, "never guess a venue"):
 *   - only chains already known to have >= MIN_BRANCHES branches (a single local
 *     shop's name is too ambiguous to match across sources);
 *   - the OSM object's `brand` / `name` (Hebrew or English) must equal the
 *     merchant's name or its configured alias after normalisation — no fuzzy match;
 *   - a coordinate within DEDUPE_M of one we already hold is the same branch;
 *   - existing branches are never edited or removed.
 *
 *   node scripts/osm-branches.mjs [--write] [--only super_pharm,castro]
 *
 * Dry run unless --write. Attribution: © OpenStreetMap contributors (ODbL).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const OVERPASS = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';
const MIN_BRANCHES = 5;
const DEDUPE_M = 75;
const UA = 'LessMoneyMoreFun-branches/1.0 (+https://github.com/YardenEz13/LESS-MONEY-MORE-FUN)';

export const norm = (s) =>
  String(s ?? '')
    .normalize('NFKC')
    .replace(/[\u0591-\u05c7"'’״׳.\-–]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const distM = (a, b) => {
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};

/** Which of an OSM element's name tags equal one of the wanted names. */
export function elementMatches(tags, wanted) {
  const set = new Set(wanted.map(norm));
  return ['brand', 'brand:he', 'brand:en', 'name', 'name:he', 'name:en'].some((k) => tags?.[k] && set.has(norm(tags[k])));
}

/** New branches from Overpass elements: exact-name matches, not already held. */
export function newBranches(elements, wanted, existing) {
  const out = [];
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    if (!elementMatches(el.tags, wanted)) continue;
    const point = { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 };
    if ([...existing, ...out].some((b) => distM(b, point) < DEDUPE_M)) continue;
    out.push({ ...point, city: el.tags['addr:city'] ?? null });
  }
  return out;
}

export function overpassQuery(names) {
  const alts = names.map((n) => n.replace(/(["\\])/g, '\\$1'));
  const filters = alts.flatMap((n) => ['brand', 'brand:he', 'name', 'name:he'].map((k) => `nwr["${k}"="${n}"](area.il);`));
  return `[out:json][timeout:60];area["ISO3166-1"="IL"]->.il;(${filters.join('')});out center 400;`;
}

async function fetchElements(names) {
  const res = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(overpassQuery(names))}`,
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`overpass HTTP ${res.status}`);
  return (await res.json()).elements ?? [];
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null;
  const merchants = JSON.parse(await readFile('data/merchants.json', 'utf8'));
  const aliases = JSON.parse(await readFile('scripts/seeds/osm-aliases.json', 'utf8').catch(() => '{}'));
  let added = 0;
  for (const m of merchants) {
    if (only && !only.has(m.id)) continue;
    if ((m.branches?.length ?? 0) < MIN_BRANCHES) continue;
    const names = [m.name, ...(aliases[m.id] ?? [])];
    try {
      const fresh = newBranches(await fetchElements(names), names, m.branches);
      if (fresh.length) {
        console.log(`${m.id}: +${fresh.length} (${m.branches.length} -> ${m.branches.length + fresh.length})`);
        m.branches.push(...fresh);
        added += fresh.length;
      }
    } catch (error) {
      console.warn(`${m.id}: skipped (${error.message})`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (args.includes('--write') && added) {
    await writeFile('data/merchants.json', `${JSON.stringify(merchants, null, 1)}\n`, 'utf8');
  }
  console.log(`${added} branches ${args.includes('--write') ? 'written' : 'found (dry run: pass --write)'} · © OpenStreetMap contributors`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
