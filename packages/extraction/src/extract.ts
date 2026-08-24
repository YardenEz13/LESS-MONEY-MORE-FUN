import { BENEFIT_EXTRACTION_JSON_SCHEMA, ExtractionResult } from './schema';
import { EXTRACTION_SYSTEM_PROMPT, buildExtractionUserMessage } from './prompt';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Overridable because the flash/pro trade-off is a real one here and it is not
 * ours to make: extraction reads Hebrew T&C text and scores its own confidence,
 * which is the kind of work a bigger model does better, but every page costs.
 * The default matches the model the app's advisor already uses.
 */
export const EXTRACTION_MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.5-flash';

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

/** Finish reasons that mean the model declined rather than answered. */
const REFUSALS = new Set(['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII']);

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

  const response = await fetch(`${ENDPOINT}/${EXTRACTION_MODEL}:generateContent`, {
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
  });

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
