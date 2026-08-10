#!/usr/bin/env node
/**
 * Extract benefits from easy.co.il's one-line deal text.
 *
 * This fills the SAME cache the model-backed pipeline writes
 * (`data/generated/extraction-cache.json`, keyed by `content_hash`), so
 * afterwards `npm run extract -- --collected <file> --program <id> --all` is a
 * pure cache hit: no API calls, and the confidence gate, id hashing, merchant
 * resolution and review queue all still run exactly as they do for model
 * output. Nothing here bypasses review.
 *
 * WHY NOT THE MODEL: easy does not publish terms. Its deal text is a single
 * structured line — "3.5% הנחה במעמד החיוב" — where the discount is the only
 * fact present and every condition is absent. Asking a model to read that is
 * paying per page to regex a percentage, and it would add variance without
 * adding information. Real terms come from the Tier-1 card catalogs, and those
 * do go through the model.
 *
 * The rule from the extraction prompt still governs: an unstated condition is
 * `null`, never a guess. null means "not written", not "no limit".
 *
 * Usage: node scripts/extract-easy.mjs [--file collected/easy/MAX.jsonl]
 *        (no --file: every list with a program mapped in scrape-easy.mjs)
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const CACHE = 'data/generated/extraction-cache.json';

/** Slugs whose program exists in data/programs.json — mirrors scrape-easy.mjs. */
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

/** "בתוקף עד 31/12/2027" or "עד 5.3.26" — only when a real date is present. */
function validUntil(text) {
  const m = text.match(/עד\s*[-:]?\s*(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  const day = Number(d);
  const month = Number(mo);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // End of the stated day, Israel time (UTC+3 in summer, +2 in winter). Using
  // 20:59Z is the conservative winter boundary — expiring an hour early is a
  // missed deal, expiring an hour late is a wasted trip.
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return `${iso}T20:59:00.000Z`;
}

const CASHBACK = /החזר|קאשבק|צובר|cashback/i;
const VOUCHER = /שובר|תו קנייה|תו קניה|גיפט|gift/i;
const BOGO = /1\s*\+\s*1|אחד\s*\+\s*אחד/;

/**
 * Words that make a number a *benefit* rather than a description.
 * Voucher terms count: "שובר כספי בשווי 200₪" is an offer, not a label.
 */
const DISCOUNT_WORD = /הנחה|החזר|קאשבק|צובר|cashback|מבצע|הטבה|זיכוי|שובר|תו קנייה|תו קניה|גיפט|קופון/i;

/**
 * Descriptions that carry a percentage of their own — "100% טבעוני" (vegan),
 * "כשר 100%". These sit in the same bullet list as the offer and are the reason
 * a naive first-number match invented 100% discounts.
 */
const LABEL = /טבעוני|צמחוני|כשר|חלאל|אורגני/;

/**
 * Pick the segment of a headline that actually states the deal.
 *
 * easy packs descriptive labels into the same bullet list as the offer, and
 * several of them carry percentages: "100% טבעוני" (100% vegan), "100% כשר".
 * Taking the first number in the string read "Chilla • 100% טבעוני • 3% הנחה
 * במעמד החיוב" as a 100% discount instead of 3% — an app promising a free meal.
 * So a number only counts when it shares a segment with a discount word.
 */
function dealSegment(text) {
  const segments = text.split('•').map((s) => s.trim()).filter(Boolean);
  const withValue = (s) => /\d/.test(s);
  return (
    // A number next to a discount word is the offer, wherever it sits.
    segments.find((s) => DISCOUNT_WORD.test(s) && withValue(s)) ??
    // easy also writes the discount as a bare percentage — "אריזות קרטון • 3.5%"
    // — so a lone number counts too, unless the segment is one of the labels
    // that legitimately carries a percentage of its own.
    segments.find((s) => /[%₪]/.test(s) && withValue(s) && !LABEL.test(s)) ??
    (segments.length <= 1 && DISCOUNT_WORD.test(text) ? text : null) ??
    (BOGO.test(text) ? text : null)
  );
}

/**
 * "עד 30% הנחה" is a ceiling, not a rate — the user may get far less.
 *
 * The number must be followed by % or ₪. Without that this also matches
 * "בתוקף עד 31/12/2027", where עד introduces an expiry date and says nothing
 * about the size of the discount. (`\b` is no help here — JS word boundaries
 * do not fire against Hebrew.)
 */
const UP_TO = /עד\s*-?\s*(?:\d+(?:\.\d+)?\s*[%₪]|₪\s*\d)/;

/**
 * Read one deal line into an ExtractedBenefit, or null if nothing legible.
 *
 * Confidence follows the scale in the extraction prompt, and deliberately
 * tops out below the 0.85 publish threshold: easy is an aggregator, so even a
 * perfectly legible "5% הנחה" may omit a minimum spend the merchant does
 * enforce. The deal is clear; the terms are unknown, not absent. That is the
 * 0.7–0.9 band by definition, so these land in the review queue rather than in
 * front of someone standing at a till.
 */
export function extractFromHeadline(headline, merchantName) {
  const text = (headline ?? '').trim();
  if (!text) return null;

  const until = validUntil(text);

  // Numbers are only read from the segment that states the offer — see
  // dealSegment. A headline whose only percentages are labels ("100% טבעוני")
  // yields nothing here, which is the correct answer.
  const deal = dealSegment(text);
  if (!deal) return null;

  // A number inside quotes belongs to a name, not to the offer: the gift card
  // called תו קניה "ויקטורי 100%" is sold at a discount off ₪250 — it is not
  // 100% off anything. Strip quoted spans before reading any value.
  const unquoted = deal.replace(/"[^"]*"/g, ' ').replace(/״[^״]*״/g, ' ');
  const percent = unquoted.match(/(\d+(?:\.\d+)?)\s*%/);
  const shekel = unquoted.match(/(\d+(?:\.\d+)?)\s*₪|₪\s*(\d+(?:\.\d+)?)/);
  const upTo = UP_TO.test(unquoted);

  const base = {
    merchant_name: merchantName,
    valid_from: null,
    valid_until: until,
    conditions: {
      min_spend: null,
      max_discount: null,
      valid_days: null,
      valid_hours: null,
      // Left null even when the line says "במעמד החיוב" (at time of charge):
      // that describes how the discount is applied, not whether the purchase
      // has to happen in a branch or online.
      channel: /אונליין|באתר|online/i.test(text) ? 'online' : null,
      stacks_with_club: null,
      exclusions: null,
      usage_limit: null,
      requires_voucher: VOUCHER.test(text) ? true : null,
      raw_text_summary: text,
    },
  };

  if (BOGO.test(text)) {
    return {
      ...base,
      type: 'bogo',
      value: 0,
      confidence_score: 0.72,
      confidence_reason: 'הטבת 1+1 ברורה מהכותרת, אך התנאים אינם מופיעים באיזי.',
    };
  }

  if (percent) {
    const value = Number(percent[1]);
    if (value <= 0 || value > 100) {
      return {
        ...base,
        type: 'percent',
        value: 0,
        confidence_score: 0.3,
        confidence_reason: `אחוז לא סביר (${percent[1]}%) — צריך בדיקה ידנית.`,
      };
    }
    const cashback = CASHBACK.test(deal);
    // "עד 30% הנחה" promises a ceiling. Treating it as the rate would show the
    // best case as if it were the offer — the one thing a recall app must not
    // do — so it is scored well down and a human decides what to say.
    if (upTo) {
      return {
        ...base,
        type: cashback ? 'cashback' : 'percent',
        value,
        confidence_score: 0.5,
        confidence_reason: `הכותרת אומרת "עד ${percent[1]}%" — זו תקרה ולא שיעור מובטח.`,
      };
    }
    return {
      ...base,
      type: cashback ? 'cashback' : 'percent',
      value,
      confidence_score: 0.8,
      confidence_reason: cashback
        ? 'שיעור ההחזר ברור מהכותרת באיזי; התנאים המלאים אינם מפורסמים שם.'
        : 'שיעור ההנחה ברור מהכותרת באיזי; התנאים המלאים אינם מפורסמים שם.',
    };
  }

  if (shekel) {
    const value = Number(shekel[1] ?? shekel[2]);
    // "שובר בשווי 200₪ ב-159₪" quotes two sums and the saving is the gap, not
    // either number. Too ambiguous to state a value for — score it for review.
    const sums = text.match(/\d+(?:\.\d+)?\s*₪/g) ?? [];
    const ambiguous = sums.length > 1 || /החל מ/.test(text);
    return {
      ...base,
      type: VOUCHER.test(text) ? 'gift_card' : 'fixed',
      value,
      confidence_score: ambiguous ? 0.45 : 0.75,
      confidence_reason: ambiguous
        ? 'הכותרת מציינת יותר מסכום אחד — לא ברור מה שווי ההטבה בפועל.'
        : 'סכום ההטבה ברור מהכותרת באיזי; התנאים המלאים אינם מפורסמים שם.',
    };
  }

  return null; // no legible value — better nothing than a guess
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;

  const files = only
    ? [only]
    : (await readdir('collected/easy'))
        .filter((f) => f.endsWith('.jsonl') && PROGRAMS[f.replace('.jsonl', '')])
        .map((f) => `collected/easy/${f}`);

  let cache = {};
  try {
    cache = JSON.parse(await readFile(CACHE, 'utf8'));
  } catch {
    // First run.
  }

  let records = 0;
  let extracted = 0;
  let skipped = 0;
  /**
   * What was dropped, and from where.
   *
   * These are real offers — "שוברים למסעדת X", "כרטיסים בהנחה" — that simply
   * never state a number, so there is no honest `value` to give them and the
   * app cannot answer its one question, how much you save. Emitting them as
   * `value: 0` would render as "0% off", which is worse than absent. Writing
   * them out keeps the gap auditable instead of silent.
   */
  const dropped = [];
  for (const file of files) {
    const rows = (await readFile(file, 'utf8'))
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
    for (const r of rows) {
      records += 1;
      const benefit = extractFromHeadline(r.listing_headline, r.merchant_name);
      if (!benefit) {
        // An empty array is a real cached answer — "read this, found no legible
        // benefit" — and stops the pipeline paying a model to re-read a line
        // that has no discount in it.
        cache[r.content_hash] = [];
        skipped += 1;
        dropped.push({
          list: file.split('/').pop(),
          merchant_name: r.merchant_name,
          listing_headline: r.listing_headline,
          offer_url: r.offer_url,
          reason: 'no numeric benefit value stated',
        });
        continue;
      }
      // source_url rides along so the detail screen opens this offer, not a
      // catalog root. The pipeline reads it straight off the cached benefit.
      cache[r.content_hash] = [{ ...benefit, source_url: r.offer_url }];
      extracted += 1;
    }
    console.log(`${file.split('/').pop().padEnd(34)} ${rows.length} records`);
  }

  await mkdir(dirname(CACHE), { recursive: true });
  await writeFile(CACHE, JSON.stringify(cache, null, 1), 'utf8');

  const SKIPPED = 'data/generated/extract-skipped.json';
  await writeFile(SKIPPED, JSON.stringify(dropped, null, 1), 'utf8');

  console.log(`\n${records} records — ${extracted} extracted, ${skipped} with no stated value`);
  console.log(`cache   -> ${CACHE}`);
  console.log(`skipped -> ${SKIPPED}  (real offers, but easy states no number for them)`);
  console.log('\nNow run, per file:');
  for (const file of files) {
    const slug = file.split('/').pop().replace('.jsonl', '');
    if (PROGRAMS[slug]) console.log(`  npm run extract -- --collected ${file} --program ${PROGRAMS[slug]} --all`);
  }
}

// pathToFileURL, not a hand-built `file://` string: on Windows the real url has
// three slashes and a drive letter, so the naive form never matched and main()
// silently never ran. argv[1] is undefined under `node -e`, where importing this
// module just for its parser is perfectly reasonable — guard rather than throw.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
