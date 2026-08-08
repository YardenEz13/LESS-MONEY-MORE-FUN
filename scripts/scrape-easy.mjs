#!/usr/bin/env node
/**
 * Scrape easy.co.il discount lists into the extraction pipeline's JSONL format.
 *
 * easy.co.il is a Nuxt app; each /list/<slug> page embeds a catid, and the real
 * data comes from /n/jsons/bizlist. The first response returns ~28 rendered rows
 * plus `allbizim` (every biz id in the list); further rows are fetched by
 * re-posting id batches via the `allbizim` query param — that is how the site's
 * own infinite scroll works.
 *
 * Output: collected/easy/<slug>.jsonl, one CollectedRecord per line, ready for
 *   npm run extract -- --collected collected/easy/MAX.jsonl --program max
 *
 * ponytail: results are geo-ranked around easy's default location (no lat/lng
 * sent). Pass --lat/--lng/--rad if coverage outside Gush Dan matters.
 */
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import vm from 'node:vm';

const execFileP = promisify(execFile);

// easy list slug -> program id in data/programs.json.
// Lists with no matching program (Leumi-Goodies, Fly-Card, Diners-Club,
// CampusCard-Members...) are deliberately absent — add the program first.
const LISTS = {
  MAX: 'max',
  'Cal-Discount': 'cal',
  'Isracard-Discounts': 'isracard',
  'Isracard-Chever': 'hever',
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const BASE = 'https://easy.co.il';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// node's TLS fingerprint trips Cloudflare; curl's does not. So: curl.
// Cloudflare also throws intermittent 403/503 at a steady crawl — back off and retry.
async function get(url, referer, attempt = 0) {
  try {
    return await getOnce(url, referer);
  } catch (err) {
    if (attempt >= 2) throw err;
    const wait = 15000 * (attempt + 1);
    console.warn(`  ${err.message.trim()} — retrying in ${wait / 1000}s`);
    await sleep(wait);
    return get(url, referer, attempt + 1);
  }
}

async function getOnce(url, referer) {
  const args = ['-s', '-w', '\n%{http_code}', '-A', UA];
  if (referer) args.push('-H', `Referer: ${referer}`);
  args.push(url);
  const { stdout } = await execFileP('curl', args, { maxBuffer: 20 * 1024 * 1024 });
  const nl = stdout.lastIndexOf('\n');
  const status = stdout.slice(nl + 1).trim();
  const body = stdout.slice(0, nl);
  if (status !== '200' || body.includes('<title>Just a moment')) {
    throw new Error(`${status} ${body.includes('Just a moment') ? '(cloudflare challenge)' : ''} for ${url}`);
  }
  return body;
}

/** Decode the serialized window.__NUXT__ IIFE. It is pure data construction. */
function decodeNuxt(html) {
  const start = html.indexOf('window.__NUXT__=');
  if (start === -1) throw new Error('no __NUXT__ state in page');
  const end = html.indexOf('</script>', start);
  let code = html.slice(start + 'window.__NUXT__='.length, end).trim();
  if (code.endsWith(';')) code = code.slice(0, -1);
  return vm.runInNewContext(`(${code})`, {}, { timeout: 5000 });
}

/** Does the row's subtitle actually state a deal? Skip plain directory rows. */
const DEAL = /הנחה|%|מבצע|1\s*\+\s*1|הטבה|מתנה|קופון/;

function toRecord(slug, biz) {
  const headline = biz.bestsubcat ?? '';
  const text = [
    `בית העסק: ${biz.bizname}`,
    `קטגוריה: ${biz.category ?? ''}`,
    `ההטבה כפי שמופיעה באיזי: ${headline}`,
    biz.address ? `כתובת: ${biz.address}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return {
    site: 'easy.co.il',
    category: slug,
    offer_url: `${BASE}/page/${biz.id}`,
    merchant_name: biz.bizname,
    listing_headline: headline,
    terms_text: text,
    content_hash: createHash('sha256').update(text).digest('hex'),
  };
}

async function scrapeList(slug, extraParams) {
  const listUrl = `${BASE}/list/${slug}`;
  const nuxt = decodeNuxt(await get(listUrl));
  const cat = nuxt.state?.listpage?.cat;
  if (!cat?.jsonlistparams) throw new Error(`no jsonlistparams for ${slug}`);

  // No version param on purpose: the versionless response embeds the deal text
  // in `bestsubcat` ("בית דפוס • 3.5% הנחה במעמד החיוב"); version=2.3 strips it.
  const api = (params) =>
    get(`${BASE}/n/jsons/bizlist?${cat.jsonlistparams}${params ? `&${params}` : ''}`, listUrl).then(JSON.parse);

  const first = (await api(extraParams)).bizlist;
  const allIds = (first.allbizim ?? '').split('|').filter(Boolean);
  const rows = new Map(first.list.filter((b) => b.id).map((b) => [b.id, b]));

  const missing = allIds.filter((id) => !rows.has(id));
  let complete = true;
  for (let i = 0; i < missing.length; i += 25) {
    await sleep(2000); // be polite; Cloudflare challenges bursts
    const batch = missing.slice(i, i + 25);
    const params = `allbizim=${batch.join('|')}`; // raw pipes — encoded %7C trips Cloudflare
    try {
      const page = (await api(extraParams ? `${extraParams}&${params}` : params)).bizlist;
      for (const b of page.list ?? []) if (b.id) rows.set(b.id, b);
    } catch (err) {
      console.warn(`  batch ${i / 25 + 1} of ${Math.ceil(missing.length / 25)} failed: ${err.message}`);
      complete = false;
      break;
    }
  }

  const all = [...rows.values()];
  const withDeal = all.filter((b) => DEAL.test(b.bestsubcat ?? ''));
  console.log(
    `${slug}: ${allIds.length} listed, ${all.length} fetched, ${withDeal.length} carry a deal in the subtitle (${all.length - withDeal.length} skipped)`,
  );
  return {
    records: withDeal.map((b) => toRecord(slug, b)),
    // Merchant identity is worth keeping for every business on a discount list,
    // deal text or not — coordinates are what the geofence needs, and the
    // extraction JSONL throws them away.
    merchants: all.map((b) => ({
      easy_id: b.id,
      name: b.bizname,
      easy_category: b.category ?? null,
      address: b.address ?? null,
      city: b.city ?? null,
      lat: b.lat ?? null,
      lng: b.lng ?? null,
      lists: [slug],
    })),
    complete,
  };
}

/** Merge candidates into the sidecar, keyed by easy id so a re-run updates. */
async function mergeMerchants(found) {
  const path = 'collected/easy/merchants-raw.json';
  let existing = [];
  try {
    existing = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    // First run.
  }
  const byId = new Map(existing.map((m) => [m.easy_id, m]));
  for (const m of found) {
    const prior = byId.get(m.easy_id);
    byId.set(m.easy_id, prior ? { ...m, lists: [...new Set([...prior.lists, ...m.lists])] } : m);
  }
  const merged = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'he'));
  await writeFile(path, JSON.stringify(merged, null, 1), 'utf8');
  console.log(`\n${merged.length} merchant candidates -> ${path}`);
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 ? args[i + 1] : undefined;
  };
  const only = opt('list');
  const geo = new URLSearchParams();
  for (const k of ['lat', 'lng', 'rad']) if (opt(k)) geo.set(k, opt(k));

  await mkdir('collected/easy', { recursive: true });
  const candidates = [];
  for (const [slug, program] of Object.entries(LISTS)) {
    if (only && only !== slug) continue;
    try {
      const { records, merchants, complete } = await scrapeList(slug, geo.toString());
      // Kept even from an incomplete crawl: merchant identity is additive, so a
      // short list under-reports rather than falsely retracting anything.
      candidates.push(...merchants);
      const path = `collected/easy/${slug}.jsonl`;
      // A crawl cut short mid-way is not a smaller catalog — overwriting here
      // would read downstream as "these deals were removed" and delete real rows.
      if (complete) {
        await writeFile(path, records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
        console.log(`  wrote ${path} -> npm run extract -- --collected ${path} --program ${program}`);
      } else {
        console.error(`  ${path} NOT written: crawl incomplete, keeping the previous file`);
        process.exitCode = 1;
      }
    } catch (err) {
      console.error(`${slug}: FAILED — ${err.message}`);
      process.exitCode = 1;
    }
    await sleep(3000);
  }
  if (candidates.length > 0) await mergeMerchants(candidates);
}

main();
