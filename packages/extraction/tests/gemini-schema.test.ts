import { describe, expect, it } from 'vitest';
import { retryAfterMs, toGeminiSchema } from '../src/extract';
import { BENEFIT_EXTRACTION_JSON_SCHEMA } from '../src/schema';

/**
 * Gemini's `responseSchema` is an OpenAPI 3.0 subset, not JSON Schema. The two
 * differences that matter here fail in opposite ways: an unsupported keyword is
 * a 400 from the API, while a mistranslated nullable would quietly stop the
 * model saying "the source does not state this" — which is the one thing this
 * whole pipeline exists to preserve.
 */
describe('toGeminiSchema', () => {
  it('turns a nullable union into type + nullable', () => {
    expect(toGeminiSchema({ type: ['string', 'null'], description: 'd' })).toEqual({
      type: 'string',
      nullable: true,
      description: 'd',
    });
  });

  it('leaves a plain type alone and does not mark it nullable', () => {
    expect(toGeminiSchema({ type: 'string' })).toEqual({ type: 'string' });
  });

  it('drops additionalProperties at every depth', () => {
    const converted = JSON.stringify(toGeminiSchema(BENEFIT_EXTRACTION_JSON_SCHEMA));
    expect(converted).not.toContain('additionalProperties');
  });

  it('preserves enums, required lists and descriptions', () => {
    const converted = toGeminiSchema(BENEFIT_EXTRACTION_JSON_SCHEMA) as any;
    expect(converted.required).toEqual(['benefits', 'page_summary']);
    expect(converted.properties.benefits.items.properties.type.enum).toEqual([
      'percent',
      'fixed',
      'bogo',
      'cashback',
      'gift_card',
    ]);
    expect(converted.properties.page_summary.description).toBeTruthy();
  });

  it('leaves no union types anywhere in the real schema', () => {
    const seen: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`));
      if (node === null || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === 'type' && Array.isArray(value)) seen.push(path);
        else walk(value, `${path}.${key}`);
      }
    };
    walk(toGeminiSchema(BENEFIT_EXTRACTION_JSON_SCHEMA), '$');
    expect(seen).toEqual([]);
  });

  it('still marks the eleven "not stated" fields nullable', () => {
    let nullables = 0;
    const walk = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node === null || typeof node !== 'object') return;
      const record = node as Record<string, unknown>;
      if (record.nullable === true) nullables += 1;
      Object.values(record).forEach(walk);
    };
    walk(toGeminiSchema(BENEFIT_EXTRACTION_JSON_SCHEMA));
    expect(nullables).toBe(11);
  });
});

/**
 * Verbatim from a real 429 on gemini-3.5-flash-lite. Google states how long the
 * quota window has left, and that is better than any backoff we would invent —
 * but only if it is actually read out of the body.
 */
const REAL_429 = JSON.stringify({
  error: {
    code: 429,
    status: 'RESOURCE_EXHAUSTED',
    message: 'You exceeded your current quota',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
        violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier', quotaValue: '15' }],
      },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '59s' },
    ],
  },
});

describe('retryAfterMs', () => {
  it('reads the delay Google states, plus a second of slack', () => {
    expect(retryAfterMs(REAL_429)).toBe(60000);
  });

  it('rounds a fractional delay up rather than waking early', () => {
    expect(retryAfterMs('{"retryDelay":"12.4s"}')).toBe(13400);
  });

  it('falls back to the quota window when no delay is stated', () => {
    expect(retryAfterMs('{"error":{"code":429}}')).toBe(60000);
    expect(retryAfterMs('not json at all')).toBe(60000);
  });
});
