#!/usr/bin/env node
/**
 * Extract benefits from the Tier-1 catalog pages in `collected/catalogs/`.
 *
 * Fills the SAME cache the model-backed pipeline writes
 * (`data/generated/extraction-cache.json`, keyed by `content_hash`), so
 * afterwards `npm run extract -- --collected <file> --program <id> --all` is a
 * pure cache hit: no API calls, and the confidence gate, id hashing, merchant
 * resolution and review queue all still run. Nothing here bypasses review.
 *
 * WHY A PARSER: the model is the right tool for these pages — unlike easy, they
 * publish real terms — but it needs `ANTHROPIC_API_KEY`, and this exists so the
 * collected pages are not stranded while there is no key. Run
 * `npm run extract` instead the moment there is one: it reads the whole
 * `חשוב לדעת` block and fills conditions this parser deliberately leaves null.
 *
 * The rule from the extraction prompt governs here too: an unstated condition is
 * `null`, never a guess. null means "not written", not "no limit".
 *
 * Usage: node scripts/extract-catalog.mjs [--file collected/catalogs/max.jsonl]
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const CACHE = 'data/generated/extraction-cache.json';
const SKIPPED = 'data/generated/extract-catalog-skipped.json';

/* ---------------------------------------------------------------- *
 * Gemini mode (`--gemini`)
 *
 * The parser below reads a headline; a model reads the whole
 * `חשוב לדעת` block and fills the conditions the parser leaves null.
 * That is the difference between "20% off" and "20% off, min ₪100,
 * weekdays, not on tobacco" — which is the product.
 *
 * It writes the same cache as everything else, so the confidence gate,
 * id hashing, merchant resolution and review queue are unchanged. The
 * prompt is the repo's own EXTRACTION_SYSTEM_PROMPT, imported rather
 * than restated so the two paths cannot drift.
 * ---------------------------------------------------------------- */

/**
 * What this key can actually call, established by trying them:
 *   gemini-2.5-flash    — "no longer available to new users"
 *   gemini-pro-latest   — 429 on this tier
 *   gemini-3-flash-preview — 429 after a handful of calls; a whole pass of it
 *                            surfaced as "aborted due to timeout", because the
 *                            quota backoff outlived the request deadline
 *   gemini-3.1-flash-lite  — ~1s per call and sustains a full run
 * Override with $GEMINI_MODEL.
 */
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.1-flash-lite';

/**
 * Pace, not speed. The quota here is per-minute, and the failure mode is not a
 * clean error — a 429 storm reappears as timeouts once the backoff outlives the
 * request deadline. One request at a time with a gap between them keeps a
 * ~130-page run inside the budget instead of racing it into a wall.
 */
const REQUEST_GAP_MS = Number(process.env.GEMINI_GAP_MS ?? 2500);
const CONCURRENCY = Number(process.env.GEMINI_CONCURRENCY ?? 1);
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/** The response shape, mirroring `ExtractedBenefit` in packages/extraction. */
const NULLABLE_NUMBER = { type: 'NUMBER', nullable: true };
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  required: ['page_summary', 'benefits'],
  properties: {
    page_summary: { type: 'STRING' },
    benefits: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['merchant_name', 'type', 'value', 'confidence_score', 'confidence_reason', 'conditions'],
        properties: {
          merchant_name: { type: 'STRING' },
          type: { type: 'STRING', enum: ['percent', 'fixed', 'bogo', 'cashback', 'gift_card'] },
          value: { type: 'NUMBER' },
          valid_from: { type: 'STRING', nullable: true, description: 'YYYY-MM-DD בלבד, או null אם לא נכתב תאריך מפורש' },
          valid_until: { type: 'STRING', nullable: true, description: 'YYYY-MM-DD בלבד, או null אם לא נכתב תאריך מפורש' },
          confidence_score: { type: 'NUMBER' },
          confidence_reason: { type: 'STRING' },
          conditions: {
            type: 'OBJECT',
            required: ['raw_text_summary'],
            properties: {
              min_spend: NULLABLE_NUMBER,
              max_discount: NULLABLE_NUMBER,
              valid_days: { type: 'ARRAY', nullable: true, items: { type: 'NUMBER' } },
              valid_hours: {
                type: 'OBJECT',
                nullable: true,
                properties: { from: { type: 'STRING' }, to: { type: 'STRING' } },
              },
              channel: { type: 'STRING', nullable: true, enum: ['in_store', 'online', 'both'] },
              stacks_with_club: { type: 'BOOLEAN', nullable: true },
              exclusions: { type: 'ARRAY', nullable: true, items: { type: 'STRING' } },
              usage_limit: { type: 'STRING', nullable: true },
              requires_voucher: { type: 'BOOLEAN', nullable: true },
              raw_text_summary: { type: 'STRING' },
            },
          },
        },
      },
    },
  },
};

/**
 * A Gemini key that actually works.
 *
 * Every candidate is verified with one cheap `models` call before the run
 * commits to it. Preferring `$GEMINI_API_KEY` blindly cost a whole pass to
 * "API key not valid" while a working key sat in the app's `.env` — an
 * environment can hold a stale key, and finding that out 70 pages in is worse
 * than one request up front. `.env` paths cover running from the repo root or
 * from a git worktree, where the app's env file stays in the main checkout.
 */
async function geminiKey() {
  const candidates = [];
  if (process.env.GEMINI_API_KEY) candidates.push(['GEMINI_API_KEY', process.env.GEMINI_API_KEY]);
  for (const path of ['apps/mobile/.env', '../../../apps/mobile/.env', '../../apps/mobile/.env']) {
    const text = await readFile(path, 'utf8').catch(() => null);
    const hit = text?.match(/^EXPO_PUBLIC_GEMINI_API_KEY=(.+)$/m)?.[1]?.trim();
    if (hit) candidates.push([path, hit]);
  }

  for (const [where, key] of candidates) {
    const ok = await fetch(`${GEMINI_ENDPOINT}?pageSize=1`, {
      headers: { 'x-goog-api-key': key },
      signal: AbortSignal.timeout(30_000),
    })
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) {
      console.log(`gemini key: ${where}`);
      return key;
    }
    console.log(`gemini key rejected: ${where}`);
  }
  return null;
}

/**
 * The text handed to the model, binding terms first.
 *
 * Mirrors `buildPageText` in packages/extraction/src/collected.ts on purpose:
 * `חשוב לדעת` carries the minimum spend, the cap and the exclusions, so it
 * leads, ahead of marketing copy that would otherwise dominate a long page.
 */
export function buildPageText(record) {
  const parts = [];
  if (record.merchant_name) parts.push(`בית העסק: ${record.merchant_name}`);
  if (record.listing_headline) parts.push(`כותרת ההטבה: ${record.listing_headline}`);
  const binding = record.sections?.['חשוב לדעת'];
  if (binding) parts.push(`חשוב לדעת:\n${binding}`);
  for (const [heading, body] of Object.entries(record.sections ?? {})) {
    if (heading !== 'חשוב לדעת') parts.push(`${heading}:\n${body}`);
  }
  const text = parts.join('\n\n') || record.terms_text || '';
  return text.slice(0, 30_000);
}

/**
 * A calendar date the store will accept, or null.
 *
 * The model answers in whatever the page used: `31.08.2026`, `31-08`, `29.10`,
 * and prose like `5 שנים מיום הרכישה`. It also returned `2026-09-31`, which is
 * not a day that exists. All of those reach a strict `datetime` parse downstream
 * and abort the whole file, so they are normalised here.
 *
 * Anything ambiguous becomes null rather than a guess — a bare `29.10` has no
 * year, and inventing one would put a wrong expiry in front of someone. The
 * house rule holds: null means "not written", not "no limit".
 */
export function toIsoDate(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const dmy = /^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/.exec(text);
  const parts = iso
    ? { y: +iso[1], m: +iso[2], d: +iso[3] }
    : dmy
      ? { y: +dmy[3], m: +dmy[2], d: +dmy[1] }
      : null;
  if (!parts) return null;

  // Round-trip through Date to reject days the month does not have: `new Date`
  // silently rolls 2026-09-31 forward to October.
  const at = new Date(Date.UTC(parts.y, parts.m - 1, parts.d));
  if (
    at.getUTCFullYear() !== parts.y ||
    at.getUTCMonth() !== parts.m - 1 ||
    at.getUTCDate() !== parts.d
  ) {
    return null;
  }
  return at.toISOString().slice(0, 10);
}

/**
 * Every condition key, present, with null for what the page did not say.
 *
 * `ExtractedConditions` marks these `.nullable()` but not `.optional()`, so a
 * missing key fails the parse and the benefit is dropped without a word — 13
 * youngstyle benefits sat in the cache and reached the catalog as zero. The
 * model only returns the keys it found, so the shape is completed here.
 *
 * Absent stays null, never a default: "not written" and "no limit" are
 * different facts and the whole product depends on keeping them apart.
 */
export function normalizeConditions(conditions) {
  const c = conditions ?? {};
  return {
    min_spend: c.min_spend ?? null,
    max_discount: c.max_discount ?? null,
    valid_days: c.valid_days ?? null,
    valid_hours: c.valid_hours ?? null,
    channel: c.channel ?? null,
    stacks_with_club: c.stacks_with_club ?? null,
    exclusions: c.exclusions ?? null,
    usage_limit: c.usage_limit ?? null,
    requires_voucher: c.requires_voucher ?? null,
    // Required and non-empty downstream; a page with no terms still needs one.
    raw_text_summary: (c.raw_text_summary ?? '').trim() || 'לא נמצא טקסט תנאים בעמוד',
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function extractWithGemini(record, key, systemPrompt) {
  let response;
  let json;
  // A free-tier quota answers 429 partway through a long run. Back off and let
  // it refill rather than losing the rest of the catalog; four tries covers the
  // per-minute window without turning a real outage into a long stall.
  for (let attempt = 1; attempt <= 4; attempt++) {
    response = await fetch(`${GEMINI_ENDPOINT}/${GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: buildPageText(record) }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
      // Short on purpose: the working model answers in seconds, so a long
      // deadline only delays a real failure. It also kept a quota problem
      // disguised as a timeout — the backoff below outlived the request.
      signal: AbortSignal.timeout(90_000),
    });
    json = await response.json();
    if (response.status !== 429 || attempt === 4) break;
    await sleep(20_000 * attempt);
  }
  if (!response.ok) throw new Error(json?.error?.message ?? `HTTP ${response.status}`);
  const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
  if (!text) throw new Error(`empty response (${json?.candidates?.[0]?.finishReason ?? 'no reason'})`);
  const parsed = JSON.parse(text);
  return (parsed.benefits ?? []).map((benefit) => ({
    ...benefit,
    valid_from: toIsoDate(benefit.valid_from),
    valid_until: toIsoDate(benefit.valid_until),
    conditions: normalizeConditions(benefit.conditions),
    // The model is never asked for a URL — it would invent one. The collector
    // knows which page this came from, so the source rides along from there.
    source_url: record.offer_url,
  }));
}

/**
 * A stated discount, and nothing else.
 *
 * The distinction that matters on these pages: `60 ₪ הנחה` is a discount, but
 * `החל מ-270 ₪` and `כרטיס ליחיד ב-19 ₪` are *prices* — the same number, the
 * opposite meaning. Reading a price as a discount would put a confidently wrong
 * value in front of someone at a till, so only explicit discount phrasing is
 * accepted and everything else is skipped and logged.
 */
const PATTERNS = [
  { re: /(\d+(?:\.\d+)?)\s*%\s*הנחה/, type: 'percent' },
  { re: /הנחה\s*של\s*(\d+(?:\.\d+)?)\s*%/, type: 'percent' },
  { re: /(\d+(?:\.\d+)?)\s*(?:₪|ש"ח|שח)\s*הנחה/, type: 'fixed' },
  { re: /הנחה\s*(?:בסך|של)\s*(\d+(?:\.\d+)?)\s*(?:₪|ש"ח|שח)/, type: 'fixed' },
  { re: /(\d+(?:\.\d+)?)\s*%\s*קאשבק/, type: 'cashback' },
  { re: /קאשבק\s*(\d+(?:\.\d+)?)\s*%/, type: 'cashback' },
];

/** `1+1` and friends: a stated bogo carries no numeric value. */
const BOGO = /\b1\s*\+\s*1\b|שניים במחיר אחד|קנה אחד קבל/;

export function parseOffer(record) {
  // Headings first (that is where these catalogs put the offer), then the body.
  const headings = Object.keys(record.sections ?? {}).join('\n');
  const haystack = `${record.listing_headline ?? ''}\n${headings}\n${record.terms_text ?? ''}`;

  for (const { re, type } of PATTERNS) {
    const hit = re.exec(haystack);
    if (!hit) continue;
    const value = Number(hit[1]);
    // A "discount" over 100% is a misread line, not a giveaway.
    if (type !== 'fixed' && value > 100) continue;
    return { type, value };
  }
  if (BOGO.test(haystack)) return { type: 'bogo', value: 0 };
  return null;
}

/**
 * Conditions this parser can state without guessing.
 *
 * Only `usage_limit` is pulled structurally — its phrasing is formulaic across
 * these catalogs. Everything else stays null and lives in `raw_text_summary`,
 * where a human reviewer (or the model, later) reads it properly. Inventing a
 * `min_spend` from prose is exactly the failure the gate exists to prevent.
 */
export function parseConditions(record) {
  const terms = record.sections?.['חשוב לדעת'] ?? '';
  const body = terms || record.terms_text || '';

  // Bounded to the clause itself. These terms blocks run clause after clause
  // with no punctuation between them, so a lazy `[^.\n]{0,40}` swallows the
  // next two rules as well ("עד 2 פריטים ללקוח בחודש מספר המקומות מוגבל הטבה שפג").
  const limit =
    /(עד\s*\d+\s*(?:פריטים|כרטיסים|יחידות|כרטיסים)(?:\s*ל?לקוח)?(?:\s*ב(?:חודש|שנה|יום))?)/.exec(body)?.[1] ??
    /(פעם\s*(?:אחת\s*)?ב(?:חודש|שנה|יום))/.exec(body)?.[1] ??
    null;

  // A summary is required and must never be invented: prefer the binding terms
  // verbatim, and fall back to the headline only when there is no terms block.
  const summary = (terms || record.listing_headline || record.terms_text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 900);

  return {
    min_spend: null,
    max_discount: null,
    valid_days: null,
    valid_hours: null,
    channel: null,
    stacks_with_club: null,
    exclusions: null,
    usage_limit: limit ? limit.trim() : null,
    requires_voucher: null,
    raw_text_summary: summary,
  };
}

export function toExtracted(record) {
  const parsed = parseOffer(record);
  if (!parsed) return null;
  const merchant = (record.merchant_name ?? '').trim();
  if (!merchant) return null;

  const hasTerms = Boolean(record.sections?.['חשוב לדעת']);
  return {
    merchant_name: merchant,
    type: parsed.type,
    value: parsed.value,
    // The page this offer was read from, so the detail screen opens the offer
    // itself rather than a catalog root.
    source_url: record.offer_url,
    valid_from: null,
    valid_until: null,
    // Deliberately below the 0.85 gate. The value is quoted from the page, but
    // the terms block is only summarised, not parsed into conditions — so the
    // record understates what the page actually says, and a human has to read
    // it before anyone is told to rely on it.
    confidence_score: hasTerms ? 0.7 : 0.6,
    confidence_reason: hasTerms
      ? 'ערך ההטבה נקרא מהעמוד; תנאי "חשוב לדעת" צורפו כטקסט בלבד ולא פורקו לשדות — נדרשת בדיקה אנושית'
      : 'ערך ההטבה נקרא מהעמוד; לא נמצא בעמוד בלוק תנאים — נדרשת בדיקה אנושית',
    conditions: parseConditions(record),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.indexOf('--file') !== -1 ? args[args.indexOf('--file') + 1] : null;
  const useGemini = args.includes('--gemini');

  const files = only
    ? [only]
    : (await readdir('collected/catalogs'))
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => `collected/catalogs/${f}`);

  const cache = JSON.parse(await readFile(CACHE, 'utf8').catch(() => '{}'));
  const dropped = [];
  let records = 0;
  let extracted = 0;

  if (useGemini) return runGemini(files, cache);

  for (const file of files) {
    const rows = (await readFile(file, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    let hits = 0;

    for (const row of rows) {
      records += 1;
      const benefit = toExtracted(row);
      if (!benefit) {
        // An empty array is a real cached answer: "this page states no benefit".
        // It stops the pipeline paying for the page again, and is honest.
        cache[row.content_hash] = [];
        dropped.push({
          file: file.split('/').pop(),
          merchant_name: row.merchant_name,
          offer_url: row.offer_url,
          reason: 'no explicitly stated discount value',
        });
        continue;
      }
      cache[row.content_hash] = [benefit];
      hits += 1;
      extracted += 1;
    }
    console.log(`${file.split('/').pop().padEnd(34)} ${String(rows.length).padStart(3)} records, ${String(hits).padStart(3)} with a stated value`);
  }

  await mkdir(dirname(CACHE), { recursive: true });
  await writeFile(CACHE, JSON.stringify(cache, null, 1), 'utf8');
  await writeFile(SKIPPED, JSON.stringify(dropped, null, 1), 'utf8');

  console.log(`\n${records} records — ${extracted} extracted, ${dropped.length} with no stated value`);
  console.log(`cache -> ${CACHE}`);
  console.log(`skipped -> ${SKIPPED}`);
}

/**
 * Model-backed pass. Keyed by `content_hash` like every other writer here, so
 * a re-run after a re-crawl only pays for pages whose text actually changed —
 * and a page already read by the model is never read twice.
 */
async function runGemini(files, cache) {
  const key = await geminiKey();
  if (!key) {
    console.error('no Gemini key: set GEMINI_API_KEY or EXPO_PUBLIC_GEMINI_API_KEY in apps/mobile/.env');
    process.exit(2);
  }
  // Read out of the repo's own prompt file rather than restated here: two
  // copies of these rules would drift, and the rules are the product
  // ("null means not written, not no limit").
  const systemPrompt = await readPromptFromSource();

  let calls = 0;
  let failures = 0;
  let benefits = 0;

  for (const file of files) {
    const rows = (await readFile(file, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    // Skip only what the *model* already answered. Parser output is exactly
    // what this pass exists to replace, so it is not a cache hit here.
    const todo = rows.filter((row) => cache[row.content_hash]?.[0]?.by !== 'gemini');
    let got = 0;
    let cursor = 0;

    const worker = async () => {
      while (cursor < todo.length) {
        const row = todo[cursor++];
        try {
          const found = await extractWithGemini(row, key, systemPrompt);
          // Provenance: which model actually read this page, so a later pass can
          // tell a weak model's answer from a strong one's.
          cache[row.content_hash] = found.map((b) => ({ ...b, by: 'gemini', model: GEMINI_MODEL }));
          got += found.length;
          benefits += found.length;
        } catch (error) {
          failures += 1;
          console.log(`  !! ${row.offer_url} — ${String(error.message).slice(0, 90)}`);
        }
        calls += 1;
        if (cursor < todo.length) await sleep(REQUEST_GAP_MS);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    // Flush per file: a run that dies at page 90 keeps the first 89 answers
    // rather than paying for them again.
    await mkdir(dirname(CACHE), { recursive: true });
    await writeFile(CACHE, JSON.stringify(cache, null, 1), 'utf8');
    console.log(`${file.split('/').pop().padEnd(34)} ${String(rows.length).padStart(3)} pages, ${String(got).padStart(3)} benefits`);
  }

  await mkdir(dirname(CACHE), { recursive: true });
  await writeFile(CACHE, JSON.stringify(cache, null, 1), 'utf8');
  console.log(`\n${calls} pages read by ${GEMINI_MODEL} — ${benefits} benefits, ${failures} failed`);
  console.log(`cache -> ${CACHE}`);
}

/** The prompt file is TypeScript; read the template literal out of it. */
async function readPromptFromSource() {
  const src = await readFile('packages/extraction/src/prompt.ts', 'utf8');
  const hit = /EXTRACTION_SYSTEM_PROMPT = `([\s\S]*?)`;/.exec(src);
  if (!hit) throw new Error('could not read EXTRACTION_SYSTEM_PROMPT');
  return hit[1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
