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
 * Results are geo-ranked around whatever point you query from, and the API
 * returns at most 100 businesses per query however wide the radius. One query
 * per list is therefore one *city's* worth of that list — which is why the
 * first 3925 businesses collected were 2258 Tel Aviv ones, 18 Jerusalem and 16
 * Haifa: nothing was wrong with the crawl, it was simply run from one point.
 *
 * `--cities` re-runs every list from each point in CITIES, which is how the
 * catalog stops being a Tel Aviv catalog. Pass --lat/--lng/--rad for a single
 * point of your own.
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
  // Open to anyone: a mall sale, a happy hour, an end-of-day deal. easy files
  // these as lists like any club, but nobody holds them, so they all map to the
  // one `public` program and reach every user without a box being ticked.
  //
  // Checked rather than assumed: across these nine lists, not one of 298 offers
  // mentions a club, a card or residency. Metzer looks similar and is not here —
  // 72 of its 85 offers name a club card. Ramat-Gan-buy-Local and the Menashe
  // council list are also absent: both are addressed to residents of a place,
  // which is an eligibility, and a benefit shown to someone who does not have it
  // is the same broken promise as a club they do not hold.
  'All-you-can-eat': 'public',
  Brunch: 'public',
  'Business-Menu': 'public',
  'End-Of-Day-Deals': 'public',
  'Happy-Gift': 'public',
  'Happy-Hour': 'public',
  'Late-Night-Deal': 'public',
  'Special-Offers': 'public',
  'Wishing-Well': 'public',
};

/**
 * Where to crawl from.
 *
 * easy caps a list query at 100 businesses ranked by distance from the point
 * you ask from, so coverage is bounded by how many points you ask from, not by
 * radius. These are population centres rather than a uniform grid because
 * that is where the shops are — a grid spends half its queries on farmland and
 * still misses Nazareth.
 *
 * ponytail: hand-typed, roughly city-hall coordinates, deliberately unweighted
 * — every point gets the same 100-result budget whether it is Tel Aviv or Arad.
 * Split the dense ones into several points if a city's results all come back
 * from one neighbourhood.
 */
const CITIES = [
  ['ירושלים', 31.7683, 35.2137],
  ['תל אביב יפו', 32.0853, 34.7818],
  ['חיפה', 32.794, 34.9896],
  ['ראשון לציון', 31.973, 34.7925],
  ['פתח תקווה', 32.084, 34.8878],
  ['אשדוד', 31.8014, 34.6435],
  ['נתניה', 32.3215, 34.8532],
  ['באר שבע', 31.253, 34.7915],
  ['בני ברק', 32.0807, 34.8338],
  ['חולון', 32.0117, 34.7725],
  ['רמת גן', 32.07, 34.8241],
  ['אשקלון', 31.6688, 34.5742],
  ['רחובות', 31.8928, 34.8113],
  ['בת ים', 32.0171, 34.7457],
  ['בית שמש', 31.7497, 34.9887],
  ['כפר סבא', 32.175, 34.907],
  ['הרצליה', 32.1624, 34.8447],
  ['חדרה', 32.434, 34.9196],
  ['מודיעין', 31.8928, 35.0104],
  ['נצרת', 32.7021, 35.2978],
  ['לוד', 31.9515, 34.8951],
  ['רמלה', 31.9288, 34.8667],
  ['רעננה', 32.1848, 34.8713],
  ['ראש העין', 32.0956, 34.9568],
  ['אילת', 29.5577, 34.9519],
  ['טבריה', 32.7959, 35.5308],
  ['עכו', 32.9281, 35.0818],
  ['נהריה', 33.0058, 35.0948],
  ['כרמיאל', 32.9186, 35.2951],
  ['עפולה', 32.6078, 35.2897],
  ['קרית גת', 31.61, 34.7642],
  ['דימונה', 31.0686, 35.0325],
  ['אריאל', 32.1056, 35.1872],
  ['צפת', 32.9646, 35.496],
  ['קרית שמונה', 33.2072, 35.5695],
  ['יבנה', 31.8783, 34.7395],
  ['אום אל פחם', 32.5197, 35.1522],
  ['רהט', 31.3925, 34.7544],
  ['בית שאן', 32.4967, 35.4996],
  ['נתיבות', 31.4222, 34.5889],
  ['יקנעם', 32.6597, 35.1103],
  ['זכרון יעקב', 32.5736, 34.9536],
];

/**
 * Wide enough to reach a city's retail edge, narrow enough that a dense city
 * does not spend its 100 results on the next town. The cap, not this, is what
 * actually bounds a query — see CITIES.
 */
const CITY_RADIUS_M = 15000;

/** The hub every discount list hangs off. */
const HUB = '/list/Discounts';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const BASE = 'https://easy.co.il';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Backoff schedule. Was 15s then 30s, which is the right shape for the odd
 * dropped request and useless against a rate limit: a 42-city run is 40x the
 * requests the original crawl made, easy starts 403ing the JSON endpoint (the
 * HTML pages keep serving), and 45 seconds of patience never outlasts it.
 */
const RETRY_WAITS_MS = [60000, 180000, 420000];

/**
 * Consecutive list failures before the run gives up.
 *
 * The first 42-city run failed at list 2 of 90 and then kept going for four
 * hours, failing every remaining list against a limiter it had already tripped
 * — 268 failed requests that could not have succeeded, and a log that looked
 * like a working crawl. Once easy is saying no, the only useful move is to
 * stop asking.
 */
const GIVE_UP_AFTER = 3;

// node's TLS fingerprint trips Cloudflare; curl's does not. So: curl.
// Cloudflare also throws intermittent 403/503 at a steady crawl — back off and retry.
async function get(url, referer, attempt = 0) {
  try {
    return await getOnce(url, referer);
  } catch (err) {
    if (attempt >= RETRY_WAITS_MS.length) throw err;
    const wait = RETRY_WAITS_MS[attempt];
    console.warn(`  ${err.message.trim()} — retrying in ${wait / 1000}s`);
    await sleep(wait);
    return get(url, referer, attempt + 1);
  }
}

/**
 * Route every request through a proxy when `EASY_PROXY` is set.
 *
 * easy blocks the JSON endpoint per IP — the HTML pages keep serving 200, so a
 * blocked crawl looks alive right up until every list fails. The block is on
 * the address, not the account or the client, so any different egress clears
 * it: a VPN, a phone hotspot, or a paid pool like Bright Data. Deliberately a
 * plain curl proxy string rather than a vendor integration, because that is the
 * whole of what the vendors need and it costs one line.
 *
 *   EASY_PROXY=http://user:pass@host:port npm run scrape:easy -- --cities חיפה
 */
async function getOnce(url, referer) {
  const args = ['-s', '-w', '\n%{http_code}', '-A', UA];
  if (referer) args.push('-H', `Referer: ${referer}`);
  if (process.env.EASY_PROXY) args.push('--proxy', process.env.EASY_PROXY);
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
/** Records already on disk, as [offer_url, record] pairs. Empty on first run. */
async function previousRecords(path) {
  try {
    return (await readFile(path, 'utf8'))
      .split(String.fromCharCode(10))
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line))
      .map((record) => [record.offer_url, record]);
  } catch {
    return [];
  }
}

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

  /**
   * The points to crawl each list from. One unnamed point by default, which is
   * whatever easy ranks around when sent no coordinates — historically Tel
   * Aviv. `--cities` walks CITIES; `--cities חיפה,אילת` walks a named subset,
   * which is how a 42-point run gets done in sittings rather than in one
   * sleepless night.
   */
  let points = [{ name: null, params: '' }];
  if (args.includes('--cities')) {
    const value = opt('cities');
    const names = value && !value.startsWith('--') ? value.split(',').map((n) => n.trim()) : null;
    const missing = names?.filter((n) => !CITIES.some((c) => c[0] === n)) ?? [];
    if (missing.length > 0) {
      console.error(`unknown city: ${missing.join(', ')}`);
      console.error(`known: ${CITIES.map((c) => c[0]).join(', ')}`);
      process.exit(1);
    }
    points = CITIES.filter(([name]) => !names || names.includes(name)).map(([name, lat, lng]) => ({
      name,
      params: `lat=${lat}&lng=${lng}&rad=${CITY_RADIUS_M}`,
    }));
  } else if (opt('lat')) {
    const geo = new URLSearchParams();
    for (const k of ['lat', 'lng', 'rad']) if (opt(k)) geo.set(k, opt(k));
    points = [{ name: 'custom point', params: geo.toString() }];
  }

  await mkdir('collected/easy', { recursive: true });

  const slugs = only ? [only] : await discoverLists();
  console.log(`${slugs.length} discount lists x ${points.length} point(s) to crawl\n`);

  let done = 0;
  let consecutiveFailures = 0;
  for (const slug of slugs) {
    const program = PROGRAMS[slug];
    done += 1;
    try {
      // Every point's results for one list, unioned with what is already on
      // disk and keyed by offer_url, so the same shop found from two cities is
      // one record.
      //
      // Unioning rather than replacing is what makes `--cities` chunkable: a
      // 42-point crawl is hours, so it gets run a few cities at a time, and a
      // replacing write would mean each sitting deleted the last one's cities.
      // Retraction is not lost, it just does not happen here — `verify:catalog`
      // removes an offer whose page 404s, and an offer that simply stops being
      // re-found keeps its old `last_verified_at`, so the freshness policy
      // flags it at 14 days and stops surfacing it at 45.
      const path = `collected/easy/${slug}.jsonl`;
      const byUrl = new Map(await previousRecords(path));
      const candidates = [];
      let complete = true;
      for (const point of points) {
        process.stdout.write(`[${done}/${slugs.length}] ${point.name ? point.name + ' ' : ''}`);
        const pass = await scrapeList(slug, point.params);
        // Kept even from an incomplete crawl: merchant identity is additive, so
        // a short list under-reports rather than falsely retracting anything.
        candidates.push(...pass.merchants);
        for (const record of pass.records) byUrl.set(record.offer_url, record);
        if (!pass.complete) complete = false;
        if (points.length > 1) await sleep(8000);
      }

      const records = [...byUrl.values()];
      // A crawl cut short mid-way is not a smaller catalog — overwriting here
      // would read downstream as "these deals were removed" and delete real rows.
      if (complete) {
        if (records.length > 0) {
          const merged = await keepVerification(path, records);
          await writeFile(path, merged.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
          console.log(
            `  wrote ${path} (${records.length} offers)${program ? ` -> --program ${program}` : '  (no program mapped yet)'}`,
          );
        } else {
          console.log('  no deals in this list, nothing written');
        }
      } else {
        console.error(`  ${path} NOT written: crawl incomplete, keeping the previous file`);
        process.exitCode = 1;
      }
      // Merged per list, not once at the end: a 42-city run is hours long, and
      // losing every merchant found so far to one Cloudflare block at list 60
      // is the difference between resuming and starting over.
      if (candidates.length > 0) await mergeMerchants(candidates);
      consecutiveFailures = 0;
    } catch (err) {
      console.error(`${slug}: FAILED — ${err.message}`);
      process.exitCode = 1;
      consecutiveFailures += 1;
      if (consecutiveFailures >= GIVE_UP_AFTER) {
        console.error(
          `\n${consecutiveFailures} lists failed in a row — easy is refusing us. Stopping.`,
        );
        console.error(
          'Everything written so far is kept, and offers union on the next run, so re-running',
        );
        console.error('resumes rather than restarts. Try one city at a time: --cities <name>');
        break;
      }
    }
    await sleep(3000);
  }
}

main();
