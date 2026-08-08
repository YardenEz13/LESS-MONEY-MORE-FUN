import { z } from 'zod';

/**
 * The strict JSON Schema handed to the model.
 *
 * Written out by hand rather than generated from Zod so that what the model
 * sees and what we validate against stay reviewable side by side. Every object
 * sets `additionalProperties: false` and lists every key in `required` —
 * structured outputs require both, and it forces the model to say `null`
 * explicitly instead of dropping a field it could not find.
 */
export const BENEFIT_EXTRACTION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['benefits', 'page_summary'],
  properties: {
    page_summary: {
      type: 'string',
      description: 'משפט אחד בעברית שמתאר מה נמצא בעמוד.',
    },
    benefits: {
      type: 'array',
      description: 'כל ההטבות שמופיעות בעמוד. מערך ריק אם אין הטבות ברורות.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'merchant_name',
          'type',
          'value',
          'conditions',
          'valid_from',
          'valid_until',
          'confidence_score',
          'confidence_reason',
        ],
        properties: {
          merchant_name: {
            type: 'string',
            description: 'שם בית העסק בדיוק כפי שמופיע בעמוד.',
          },
          type: {
            type: 'string',
            enum: ['percent', 'fixed', 'bogo', 'cashback', 'gift_card'],
          },
          value: {
            type: 'number',
            description:
              'עבור percent/cashback — מספר האחוזים. עבור fixed/gift_card — הסכום בשקלים. עבור bogo — 0.',
          },
          valid_from: {
            type: ['string', 'null'],
            description: 'תאריך תחילת תוקף בפורמט ISO 8601, או null אם לא צוין.',
          },
          valid_until: {
            type: ['string', 'null'],
            description: 'תאריך סיום תוקף בפורמט ISO 8601, או null אם לא צוין.',
          },
          confidence_score: {
            type: 'number',
            description:
              'מ-0 עד 1. עד כמה אתה בטוח שההטבה והתנאים חולצו נכון מהטקסט.',
          },
          confidence_reason: {
            type: 'string',
            description: 'משפט קצר: מה היה ברור ומה לא, ולמה בחרת בציון הזה.',
          },
          conditions: {
            type: 'object',
            additionalProperties: false,
            required: [
              'min_spend',
              'max_discount',
              'valid_days',
              'valid_hours',
              'channel',
              'stacks_with_club',
              'exclusions',
              'usage_limit',
              'requires_voucher',
              'raw_text_summary',
            ],
            properties: {
              min_spend: {
                type: ['number', 'null'],
                description: 'סכום קנייה מינימלי בשקלים, או null אם לא צוין.',
              },
              max_discount: {
                type: ['number', 'null'],
                description: 'תקרת הנחה בשקלים, או null אם לא צוינה.',
              },
              valid_days: {
                type: ['array', 'null'],
                description:
                  'ימי תוקף: 1=ראשון ... 7=שבת. null אם התקנון לא מגביל ימים.',
                items: { type: 'integer' },
              },
              valid_hours: {
                type: ['object', 'null'],
                additionalProperties: false,
                required: ['from', 'to'],
                description: 'שעות תוקף בפורמט HH:MM, או null אם לא צוינו.',
                properties: {
                  from: { type: 'string' },
                  to: { type: 'string' },
                },
              },
              channel: {
                type: ['string', 'null'],
                enum: ['in_store', 'online', 'both', null],
                description: 'ערוץ המימוש, או null אם התקנון לא אומר.',
              },
              stacks_with_club: {
                type: ['boolean', 'null'],
                description:
                  'האם יש כפל מבצעים. null אם התקנון לא מתייחס לזה — אל תנחש.',
              },
              exclusions: {
                type: ['array', 'null'],
                description: 'קטגוריות או מוצרים שההטבה לא חלה עליהם.',
                items: { type: 'string' },
              },
              usage_limit: {
                type: ['string', 'null'],
                description: 'הגבלת שימוש, למשל "פעם אחת בחודש".',
              },
              requires_voucher: {
                type: ['boolean', 'null'],
                description: 'האם צריך להנפיק שובר/קוד מראש.',
              },
              raw_text_summary: {
                type: 'string',
                description:
                  'סיכום התנאים בעברית, קרוב ככל האפשר לניסוח בתקנון עצמו.',
              },
            },
          },
        },
      },
    },
  },
} as const;

/** Client-side validation of whatever comes back. Mirrors the schema above. */
export const ExtractedConditions = z.object({
  min_spend: z.number().nonnegative().nullable(),
  max_discount: z.number().positive().nullable(),
  valid_days: z.array(z.number().int().min(1).max(7)).nullable(),
  valid_hours: z
    .object({
      from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      to: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    })
    .nullable(),
  channel: z.enum(['in_store', 'online', 'both']).nullable(),
  stacks_with_club: z.boolean().nullable(),
  exclusions: z.array(z.string()).nullable(),
  usage_limit: z.string().nullable(),
  requires_voucher: z.boolean().nullable(),
  raw_text_summary: z.string().min(1),
});

export const ExtractedBenefit = z.object({
  merchant_name: z.string().min(1),
  type: z.enum(['percent', 'fixed', 'bogo', 'cashback', 'gift_card']),
  value: z.number().nonnegative(),
  /**
   * The page this specific offer was read from, when the collector knew it.
   *
   * Not part of the model's JSON schema — the model is never asked for a URL, it
   * would only invent one. This carries a *collector-supplied* per-offer URL
   * through, so the detail screen's "open the source" lands on the offer instead
   * of a catalog root. Absent means fall back to the run's source url.
   */
  source_url: z.string().url().optional(),
  valid_from: z.string().nullable(),
  valid_until: z.string().nullable(),
  confidence_score: z.number().min(0).max(1),
  confidence_reason: z.string().min(1),
  conditions: ExtractedConditions,
});
export type ExtractedBenefit = z.infer<typeof ExtractedBenefit>;

export const ExtractionResult = z.object({
  page_summary: z.string(),
  benefits: z.array(ExtractedBenefit),
});
export type ExtractionResult = z.infer<typeof ExtractionResult>;
