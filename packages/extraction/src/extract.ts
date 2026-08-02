import Anthropic from '@anthropic-ai/sdk';
import { BENEFIT_EXTRACTION_JSON_SCHEMA, ExtractionResult } from './schema';
import { EXTRACTION_SYSTEM_PROMPT, buildExtractionUserMessage } from './prompt';

export const EXTRACTION_MODEL = 'claude-opus-5';

export interface ExtractInput {
  programName: string;
  sourceUrl: string;
  pageText: string;
}

export interface ExtractOutput {
  result: ExtractionResult;
  usage: { inputTokens: number; outputTokens: number };
}

let cachedClient: Anthropic | null = null;

function client(): Anthropic {
  // The SDK resolves ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / an `ant auth
  // login` profile on its own — don't second-guess it by reading env here.
  cachedClient ??= new Anthropic();
  return cachedClient;
}

/**
 * Run one page through the model.
 *
 * `output_config.format` constrains the response to the strict schema, so the
 * shape is guaranteed; the Zod parse afterwards is there to catch the things a
 * JSON Schema cannot express (an HH:MM that isn't a time, a percentage above
 * 100) before anything reaches the store.
 */
export async function extractBenefits(input: ExtractInput): Promise<ExtractOutput> {
  const response = await client().messages.create({
    model: EXTRACTION_MODEL,
    max_tokens: 16000,
    system: EXTRACTION_SYSTEM_PROMPT,
    output_config: {
      effort: 'high',
      format: {
        type: 'json_schema',
        schema: BENEFIT_EXTRACTION_JSON_SCHEMA,
      },
    },
    messages: [{ role: 'user', content: buildExtractionUserMessage(input) }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error(`extraction refused for ${input.sourceUrl}`);
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error(
      `extraction truncated for ${input.sourceUrl} — split the page or raise max_tokens`,
    );
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`model returned non-JSON for ${input.sourceUrl}: ${text.slice(0, 200)}`);
  }

  return {
    result: ExtractionResult.parse(parsed),
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}
