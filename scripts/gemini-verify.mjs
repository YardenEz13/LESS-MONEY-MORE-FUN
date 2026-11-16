#!/usr/bin/env node
/**
 * Let Gemini re-check shipped offers against their own source page.
 *
 * For each stale row: fetch `source_url` over plain HTTP, ask Gemini whether the
 * page still states this offer, and demand a verbatim quote as proof. Gemini is
 * the reader, not the judge — the script accepts a "still offered" verdict only
 * when
 *   1. the quote really occurs in the fetched page text, and
 *   2. for rate/amount offers, the page also contains the row's number.
 * Anything else is "unclear" and the row is left exactly as it was.
 *
 * What it may change, and nothing more:
 *   - `last_verified_at` moves forward to now, only for a verified "still offered".
 *   - A verified "no longer offered" is written to the report, never deleted:
 *     withdrawing an offer is a human decision.
 * What it never does: bypass bot protection (a 403/429 is a refusal, counted and
 * respected: a host that refuses GIVE_UP_AFTER times in a row is skipped for the
 * rest of the run), invent a URL, or touch a row it could not read.
 *
 *   GEMINI_API_KEY=... node scripts/gemini-verify.mjs [--write] [--max 60]
 *        [--min-age-days 14] [--programs max,cal] [--venue azrieli_tlv]
 *
 * Without --write it only prints and writes data/generated/verify-report.json.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.1-flash-lite';
const UA = 'LessMoneyMoreFun-verifier/1.0 (+https://github.com/YardenEz13/LESS-MONEY-MORE-FUN)';
const GIVE_UP_AFTER = 10;
const PAGE_CHARS = 14_000;
export const REPORT = 'data/generated/verify-report.json';

/** Whitespace, punctuation-width and case differences must not defeat a quote check. */
export const normalize = (s) =>
  String(s ?? '')
    .normalize('NFKC')
    .replace(/[‎‏‪-‮]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

export function pageToText(html) {
  return String(html ?? '')
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Accept or downgrade Gemini's verdict. Returns the verdict the script will act on.
 * `page` is the text Gemini was shown (already truncated), so a quote from beyond
 * what it saw can never pass.
 */
export function checkVerdict(row, page, answer) {
  const verdict = answer?.verdict;
  if (verdict !== 'still_offered' && verdict !== 'not_offered') return 'unclear';
  const evidence = normalize(answer?.evidence);
  if (evidence.length < 8 || !normalize(page).includes(evidence)) return 'unclear';
  if (verdict === 'still_offered' && ['percent', 'cashback', 'fixed'].includes(row.type) && row.value > 0) {
    // The row's figure must be on the page, or the offer may have changed under it.
    const figure = String(row.value).replace(/\.0+$/, '');
    if (!new RegExp(`(^|[^\\d.])${figure.replace('.', '\\.')}([^\\d]|$)`).test(normalize(page))) {
      return 'unclear';
    }
  }
  return verdict;
}

/** Dates only move forward; no row is added or removed. Returns how many moved. */
export function applyVerdicts(rows, results, now = new Date()) {
  const verified = new Set(results.filter((r) => r.verdict === 'still_offered').map((r) => r.id));
  let moved = 0;
  for (const row of rows) {
    if (!verified.has(row.id)) continue;
    if (Date.parse(row.last_verified_at) >= now.getTime()) continue;
    row.last_verified_at = now.toISOString();
    moved += 1;
  }
  return moved;
}

export function selectRows(rows, { minAgeDays, programs, ids, max, now = Date.now() }) {
  return rows
    .filter((r) => (now - Date.parse(r.last_verified_at)) / 864e5 >= minAgeDays)
    .filter((r) => !programs || programs.includes(r.program_id))
    .filter((r) => !ids || ids.has(r.id))
    .filter((r) => /^https?:\/\//.test(r.source_url ?? ''))
    // Oldest first: the rows closest to being hidden are the ones worth saving.
    .sort((a, b) => Date.parse(a.last_verified_at) - Date.parse(b.last_verified_at))
    .slice(0, max);
}

export const SYSTEM = `You verify whether a web page still states one specific discount.
You are given the offer (merchant, club, kind, value) and the page text.
Answer JSON {verdict, evidence}.
- "still_offered": the page states this merchant's offer for this club and it is current.
- "not_offered": the page clearly says it ended, expired, or is no longer available.
- "unclear": anything else (page about something else, no mention, ambiguous).
"evidence" MUST be an exact, contiguous quote copied from the page text (8-200 chars).
Never paraphrase and never translate. If you cannot quote it, answer "unclear" with empty evidence.`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    verdict: { type: 'STRING', enum: ['still_offered', 'not_offered', 'unclear'] },
    evidence: { type: 'STRING' },
  },
  required: ['verdict', 'evidence'],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function askGemini(row, page, key, fetchImpl = fetch) {
  const offer = `Merchant: ${row.merchant_name}\nClub id: ${row.program_id}\nKind: ${row.type}\nValue: ${row.value}\nTerms summary: ${row.conditions?.raw_text_summary ?? ''}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetchImpl(`${ENDPOINT}/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: `${offer}\n\n--- PAGE TEXT ---\n${page}` }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: SCHEMA },
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const json = await res.json();
    if (res.status === 429 && attempt < 4) {
      await sleep(20_000 * attempt);
      continue;
    }
    if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
    const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
    return JSON.parse(text);
  }
  throw new Error('gemini: no answer');
}

async function fetchPage(url, fetchImpl = fetch) {
  const res = await fetchImpl(url, {
    headers: { 'user-agent': UA, accept: 'text/html' },
    signal: AbortSignal.timeout(20_000),
    redirect: 'follow',
  });
  if (res.status === 403 || res.status === 429) return { refused: true };
  if (!res.ok) return { gone: res.status === 404 || res.status === 410 };
  return { text: pageToText(await res.text()).slice(0, PAGE_CHARS) };
}

export async function run({ rows, key, opts, fetchImpl = fetch, geminiFetch = fetch, log = console.log }) {
  const todo = selectRows(rows, opts);
  const refusals = new Map();
  const results = [];
  for (const row of todo) {
    const host = new URL(row.source_url).host;
    if ((refusals.get(host) ?? 0) >= GIVE_UP_AFTER) {
      results.push({ id: row.id, verdict: 'unclear', reason: 'host_refusing' });
      continue;
    }
    try {
      const page = await fetchPage(row.source_url, fetchImpl);
      if (page.refused) {
        refusals.set(host, (refusals.get(host) ?? 0) + 1);
        results.push({ id: row.id, verdict: 'unclear', reason: 'refused' });
        continue;
      }
      refusals.set(host, 0);
      if (page.gone) {
        // A dead page is not proof of anything we can quote; report, do not act.
        results.push({ id: row.id, verdict: 'unclear', reason: 'page_gone' });
        continue;
      }
      const answer = await askGemini(row, page.text, key, geminiFetch);
      const verdict = checkVerdict(row, page.text, answer);
      results.push({ id: row.id, verdict, evidence: verdict === 'unclear' ? undefined : answer.evidence, url: row.source_url });
    } catch (error) {
      results.push({ id: row.id, verdict: 'unclear', reason: String(error.message ?? error).slice(0, 120) });
    }
    await sleep(Number(process.env.VERIFY_GAP_MS ?? 700));
  }
  const count = (v) => results.filter((r) => r.verdict === v).length;
  log(`checked ${results.length}: ${count('still_offered')} still offered, ${count('not_offered')} no longer offered, ${count('unclear')} unclear`);
  return results;
}

const haversineM = (a, b) => {
  const R = 6371000, rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/** Ids of rows whose merchant sits in the venue: by branch coordinates, or listed in venue_ids. */
export async function venueBenefitIds(venueId, rows) {
  const venues = JSON.parse(await readFile('data/venues.json', 'utf8'));
  const merchants = JSON.parse(await readFile('data/merchants.json', 'utf8'));
  const venue = venues.find((v) => v.id === venueId);
  if (!venue) throw new Error(`unknown venue ${venueId}`);
  const inside = new Set(
    merchants
      .filter((m) => (m.venue_ids ?? []).includes(venueId) || (m.branches ?? []).some((b) => haversineM(venue, b) <= venue.radius_m))
      .map((m) => m.id),
  );
  return new Set(rows.filter((r) => inside.has(r.merchant_id)).map((r) => r.id));
}

/**
 * The key for local runs: the environment first, then `.env` at the repo root,
 * then `apps/mobile/.env` (where the refresh script already keeps it, as
 * EXPO_PUBLIC_GEMINI_API_KEY). Never printed, never written anywhere.
 */
export async function findKey(env = process.env, read = (p) => readFile(p, 'utf8')) {
  if (env.GEMINI_API_KEY) return env.GEMINI_API_KEY;
  for (const file of ['.env', 'apps/mobile/.env']) {
    const text = await read(file).catch(() => '');
    const hit = text.match(/^(?:EXPO_PUBLIC_)?GEMINI_API_KEY\s*=\s*["']?([^"'\r\n]+)/m);
    if (hit) return hit[1].trim();
  }
  return undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (n) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
  const key = await findKey();
  if (!key) {
    console.error(
      'No Gemini key. Create one at https://aistudio.google.com/apikey, then put\n' +
        'GEMINI_API_KEY=... in a file named .env at the repo root (it is git-ignored).',
    );
    process.exit(2);
  }
  const rows = JSON.parse(await readFile('data/benefits.json', 'utf8'));
  let ids;
  if (opt('venue')) {
    // Same geography the app uses: merchants whose branches fall inside the venue.
    ids = await venueBenefitIds(opt('venue'), rows);
  }
  const opts = {
    minAgeDays: Number(opt('min-age-days') ?? 14),
    max: Number(opt('max') ?? 60),
    programs: opt('programs')?.split(','),
    ids,
  };
  const results = await run({ rows, key, opts });
  const moved = args.includes('--write') ? applyVerdicts(rows, results) : 0;
  if (moved) await writeFile('data/benefits.json', `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
  await mkdir(dirname(REPORT), { recursive: true });
  await writeFile(
    REPORT,
    JSON.stringify({ at: new Date().toISOString(), model: MODEL, moved, withdrawCandidates: results.filter((r) => r.verdict === 'not_offered'), results }, null, 1),
    'utf8',
  );
  console.log(`${moved} rows moved forward${args.includes('--write') ? '' : ' (dry run: pass --write)'}; report -> ${REPORT}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
