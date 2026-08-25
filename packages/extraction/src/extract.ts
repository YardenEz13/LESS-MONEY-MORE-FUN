import { BENEFIT_EXTRACTION_JSON_SCHEMA, ExtractionResult } from './schema';
import { EXTRACTION_SYSTEM_PROMPT, buildExtractionUserMessage } from './prompt';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * The models a run spreads itself across, in rotation.
 *
 * The free-tier quota is `GenerateRequestsPerMinutePerProjectPerModel` — 15 a
 * minute, counted per model — so five models is five buckets and roughly 75
 * requests a minute rather than 15. That is the difference between the 1580-page
 * backlog taking two hours and taking most of a day.
 *
 * `GEMINI_MODEL` overrides it and takes a comma-separated list, so a single
 * value still behaves exactly as it did.
 *
 * Caveat worth carrying: `confidence_score` is not calibrated the same way
 * across models. A 25-page trial on gemini-3.5-flash-lite returned 0.95 for
 * every page including two it got wrong, where the previous model spread its
 * scores and queued 23 benefits for review. Rotating models therefore makes the
 * publish gate mean slightly different things for different rows of the same
 * catalog — worth a fixed model if the gate is load-bearing for you.
 */
const DEFAULT_MODELS = [
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  // 3 Flash is only published as a preview id.
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite',
];

export const EXTRACTION_MODELS = (process.env.GEMINI_MODEL ?? DEFAULT_MODELS.join(','))
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);

/**
 * Where the next page starts its rotation. Module-level so concurrent pages
 * begin on different models instead of all hammering the first one.
 */
let rotation = 0;

export interface ExtractInput {
  programName: string;
  sourceUrl: string;
  pageText: string;
}

export interface ExtractOutput {
  result: ExtractionResult;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * JSON Schema -> Gemini's `responseSchema`, which is an OpenAPI 3.0 subset and
 * not the same dialect.
 *
 * Two differences bite this schema. It has no `additionalProperties` (harmless
 * to drop: responseSchema only ever emits declared properties, so the object is
 * closed regardless), and it has no union types — `type: ['string', 'null']`
 * has to become `type: 'string'` plus `nullable: true`, which this schema uses
 * eleven times for "the source does not state this".
 *
 * Converting rather than hand-writing a second schema on purpose: the Zod parse
 * downstream and this constraint have to describe the same shape, and two
 * hand-maintained copies of a 188-line schema drift the first time a field is
 * added. There is no `$ref`, `oneOf` or `anyOf` here — a plain recursive walk
 * is enough, and anything fancier would fail loudly at the API rather than
 * silently.
 */
export function toGeminiSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  if (node === null || typeof node !== 'object') return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'additionalProperties') continue;
    if (key === 'type' && Array.isArray(value)) {
      const concrete = value.filter((t) => t !== 'null');
      out.type = concrete[0];
      if (concrete.length !== value.length) out.nullable = true;
      continue;
    }
    out[key] = toGeminiSchema(value);
  }
  return out;
}

const RESPONSE_SCHEMA = toGeminiSchema(BENEFIT_EXTRACTION_JSON_SCHEMA);

/**
 * How many times a page waits out a rate limit before giving up.
 *
 * The free tier is 15 requests per minute per model, so a run of any size hits
 * it — a 25-page run extracted 9 and lost 16 to 429s that were nothing but
 * "ask again in a minute". Failing the page there wastes the scrape and the
 * cache lookup for a condition the API itself says is temporary, and tells you
 * to retry in 59 seconds.
 */
const RATE_LIMIT_RETRIES = 4;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Seconds Google asks us to wait, from its own `RetryInfo` detail.
 *
 * Preferred over a backoff schedule of our own because it is the authority on
 * when the window resets, and it is usually shorter than anything we would
 * guess. Falls back to a minute — the length of the quota window — when the
 * detail is missing or unparseable.
 */
export function retryAfterMs(body: string): number {
  const stated = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body)?.[1];
  const seconds = stated ? Number(stated) : NaN;
  return Number.isFinite(seconds) ? Math.ceil(seconds * 1000) + 1000 : 60000;
}

/** Finish reasons that mean the model declined rather than answered. */
const REFUSALS = new Set(['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII']);

/**
 * Statuses that mean "this model cannot serve you right now", as opposed to
 * "this request is wrong".
 *
 * 429 is the quota window being full. The 5xx entries are the model being
 * overloaded or briefly down — gemini-3.7-flash answered 503 "currently
 * experiencing high traffic" on the first probe of the pool, which under a
 * 429-only rule would have failed one page in five outright while four healthy
 * models sat idle. Both cases have the same right answer: ask a different
 * model. A 400 stays fatal, because a malformed schema will be malformed for
 * every model in the pool and rotating would just multiply the same error.
 */
const TRY_ANOTHER_MODEL = new Set([429, 500, 502, 503, 504]);

/**
 * One page's request, rotated across the model pool until one of them answers.
 *
 * A busy model means "not here, not now", not "this page failed", so the next
 * model is tried immediately rather than sleeping — that is the whole point of
 * holding more than one. Only when every model in the pool has refused does the
 * page wait, and then for the shortest window any of them reported, since that
 * is the first one to reopen.
 */
async function fetchRotating(request: RequestInit, sourceUrl: string): Promise<Response> {
  const start = rotation;
  rotation += 1;

  for (let round = 0; round <= RATE_LIMIT_RETRIES; round += 1) {
    let shortestWait = 60000;
    for (let i = 0; i < EXTRACTION_MODELS.length; i += 1) {
      const model = EXTRACTION_MODELS[(start + i) % EXTRACTION_MODELS.length]!;
      const response = await fetch(`${ENDPOINT}/${model}:generateContent`, request);
      if (!TRY_ANOTHER_MODEL.has(response.status)) return response;
      // A 5xx carries no RetryInfo, so it falls back to the quota window. That
      // is the right order of magnitude for an overloaded model too, and it
      // only applies once every model in the pool is refusing.
      shortestWait = Math.min(shortestWait, retryAfterMs(await response.text()));
    }
    console.warn(
      `  all ${EXTRACTION_MODELS.length} models busy — waiting ${Math.round(shortestWait / 1000)}s (${sourceUrl})`,
    );
    await sleep(shortestWait);
  }

  // Every model, every round. Hand back a real response so the caller reports
  // the API's own words rather than a message invented here.
  return fetch(`${ENDPOINT}/${EXTRACTION_MODELS[start % EXTRACTION_MODELS.length]!}:generateContent`, request);
}

/**
 * Run one page through the model.
 *
 * `responseSchema` constrains the response to the strict schema, so the shape
 * is guaranteed; the Zod parse afterwards is there to catch the things a JSON
 * Schema cannot express (an HH:MM that isn't a time, a percentage above 100)
 * before anything reaches the store.
 */
export async function extractBenefits(input: ExtractInput): Promise<ExtractOutput> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  const request = {
    method: 'POST',
    // The key goes in a header, never the query string — a URL lands in logs
    // and proxies in a way a header does not.
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: EXTRACTION_SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: buildExtractionUserMessage(input) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        maxOutputTokens: 16000,
        // Extraction is a reading task, not a writing one: the same page should
        // give the same benefits, and the confidence gate downstream only means
        // something if the score is not partly a dice roll.
        temperature: 0,
      },
    }),
  };

  const response = await fetchRotating(request, input.sourceUrl);

  if (!response.ok) {
    throw new Error(
      `Gemini returned ${response.status} for ${input.sourceUrl}: ${(await response.text()).slice(0, 300)}`,
    );
  }

  const body = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
    promptFeedback?: { blockReason?: string };
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };

  const blocked = body.promptFeedback?.blockReason;
  if (blocked) throw new Error(`extraction blocked (${blocked}) for ${input.sourceUrl}`);

  const candidate = body.candidates?.[0];
  if (candidate?.finishReason && REFUSALS.has(candidate.finishReason)) {
    throw new Error(`extraction refused (${candidate.finishReason}) for ${input.sourceUrl}`);
  }
  if (candidate?.finishReason === 'MAX_TOKENS') {
    throw new Error(
      `extraction truncated for ${input.sourceUrl} — split the page or raise maxOutputTokens`,
    );
  }

  const text = (candidate?.content?.parts ?? []).map((part) => part.text ?? '').join('');
  if (!text) throw new Error(`model returned no text for ${input.sourceUrl}`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`model returned non-JSON for ${input.sourceUrl}: ${text.slice(0, 200)}`);
  }

  return {
    result: ExtractionResult.parse(parsed),
    usage: {
      inputTokens: body.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0,
    },
  };
}
