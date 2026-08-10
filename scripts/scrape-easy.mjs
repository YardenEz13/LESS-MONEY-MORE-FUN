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

// easy list slug -> program id in data/programs.json. A slug that is not here
// is still crawled and still validated — it just cannot be handed to `extract`
// until someone adds the program, because benefit ids hash the program id.
const PROGRAMS = {
  MAX: 'max',
  'Cal-Discount': 'cal',
  'Isracard-Discounts': 'isracard',
  'Isracard-Chever': 'hever',
  Behatsdaa: 'behatsdaa',
  'MAX-Behatsdaa': 'behatsdaa',
  'Hitech-Zone-members': 'hitechzone',
  'Kranot-Police': 'shotrim',
  Shufersal4u: 'shufersal_life',
  'max-Kranot': 'max_kranot',
  'Fly-Card': 'fly_card',
  'Leumi-Goodies': 'leumi_goodies',
  'CampusCard-Members': 'campus_card_members',
  'Diners-Club': 'diners_club',
  'Mizrahi-Tefahot-Members': 'mizrahi_tefahot_members',
  'Discounts-American-Express': 'discounts_american_express',
  'Mafteach-Discounts': 'mafteach_discounts',
  iCard: 'i_card',
  TAU: 'tau',
  'Isracard-TOP-Members': 'isracard_top_members',
  'Calextra-Discounts': 'calextra_discounts',
  'max-Tmura': 'max_tmura',
  'mastercard-day': 'mastercard_day',
  'Reut-Buy-It-For-Me': 'reut_buy_it_for_me',
  youngstyle: 'youngstyle',
  Topcash: 'topcash',
  'My-MAX': 'my_max',
  'Tefahot-Card': 'tefahot_card',
  'Amit-Kranot-Benefits-Card': 'amit_kranot_benefits_card',
  'Rami-Levy-Club': 'rami_levy_club',
  'Clalit-Fun': 'clalit_fun',
  'Tov-Plus-Club': 'tov_plus_club',
  'Digitel-Discounts': 'digitel_discounts',
  'Pais-Members': 'pais_members',
  Cuponofesh: 'cuponofesh',
  'Carrefour-Club': 'carrefour_club',
  'Irgoon-Hamorim-Benefits': 'irgoon_hamorim_benefits',
  'Histadrut-For-You': 'histadrut_for_you',
  'Club-Hot-Discounts': 'club_hot_discounts',
  'Vegan-Active-Discounts': 'vegan_active_discounts',
  'Egged-Driver-Memebers': 'egged_driver_memebers',
  'Yours-Club': 'yours_club',
  megalean: 'megalean',
  'Uniq-Club': 'uniq_club',
  'Your-Club-For-Pensioner': 'your_club_for_pensioner',
  'Ashmoret-Membership': 'ashmoret_membership',
  'FRIENDS-Clube': 'friends_clube',
  'Living-Members': 'living_members',
  'Bezeq-Employees-Association': 'bezeq_employees_association',
  'Mystyle-Discounts': 'mystyle_discounts',
  magiayoter: 'magiayoter',
  'Dream-Card-Club': 'dream_card_club',
  'LifeStyle-Members': 'life_style_members',
  yahad: 'yahad',
  'Adif-Members': 'adif_members',
  'P100-Members': 'p100_members',
  'Shachar-Club': 'shachar_club',
  'Student-Group': 'student_group',
  'Living-Plus-Members': 'living_plus_members',
  Meshekard: 'meshekard',
  'Corporate-Members': 'corporate_members',
  'Mevalim-Club': 'mevalim_club',
  'Poalim-Wonder': 'poalim_wonder',
  'Public-Accountants-Institute-Members': 'public_accountants_institute_members',
  PowerCard: 'power_card',
  Yoter: 'yoter',
  'Mercantile-Smile': 'mercantile_smile',
  'Vegan-Bonus': 'vegan_bonus',
  'Insurance-Association-Members': 'insurance_association_members',
  'Security-Forces-Benefit': 'security_forces_benefit',
  'Student-Discounts': 'student_discounts',
  'Discount-For-Senior-Citizens': 'discount_for_senior_citizens',
};

/** The hub every discount list hangs off. */
const HUB = '/list/Discounts';

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

/**
 * Carry `verified_at` across a re-crawl for records that did not change.
 *
 * Without this every weekly crawl silently resets the proof on every list it
 * refreshes, and because easy only allows ~500 link checks a day, coverage
 * would be knocked back faster than it could ever climb — it would never reach
 * 100%. Keyed on `content_hash` as well as url: if the deal text changed the
 * record is genuinely new and has to earn its proof again.
 */
async function keepVerification(path, records) {
  let previous;
  try {
    previous = new Map(
      (await readFile(path, 'utf8'))
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l))
        .filter((r) => r.verified_at)
        .map((r) => [`${r.offer_url}|${r.content_hash}`, r.verified_at]),
    );
  } catch {
    return records; // no previous file
  }
  return records.map((r) => {
    const at = previous.get(`${r.offer_url}|${r.content_hash}`);
    return at ? { ...r, verified_at: at } : r;
  });
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

/**
 * Every discount list the hub links to. Discovered rather than hardcoded: easy
 * adds and retires clubs constantly, and a fixed list silently stops covering
 * the site the first time they do.
 */
async function discoverLists() {
  const nuxt = decodeNuxt(await get(`${BASE}${HUB}`));
  const slugs = [];
  JSON.stringify(nuxt, (_key, value) => {
    if (value && typeof value.link === 'string' && value.link.startsWith('/list/')) {
      slugs.push(value.link.slice('/list/'.length).split('?')[0]);
    }
    return value;
  });
  return [...new Set(slugs)].filter((s) => s && s !== 'Discounts');
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

  const slugs = only ? [only] : await discoverLists();
  console.log(`${slugs.length} discount lists to crawl\n`);

  const candidates = [];
  let done = 0;
  for (const slug of slugs) {
    const program = PROGRAMS[slug];
    done += 1;
    process.stdout.write(`[${done}/${slugs.length}] `);
    try {
      const { records, merchants, complete } = await scrapeList(slug, geo.toString());
      // Kept even from an incomplete crawl: merchant identity is additive, so a
      // short list under-reports rather than falsely retracting anything.
      candidates.push(...merchants);
      const path = `collected/easy/${slug}.jsonl`;
      // A crawl cut short mid-way is not a smaller catalog — overwriting here
      // would read downstream as "these deals were removed" and delete real rows.
      if (complete) {
        if (records.length > 0) {
          const merged = await keepVerification(path, records);
          await writeFile(path, merged.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
          console.log(
            `  wrote ${path}${program ? ` -> --program ${program}` : '  (no program mapped yet)'}`,
          );
        } else {
          console.log('  no deals in this list, nothing written');
        }
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
