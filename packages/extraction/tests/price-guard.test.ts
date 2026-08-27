import { describe, expect, it } from 'vitest';
import { Benefit } from '@sbr/core';
import { partitionByConfidence, statesAPriceNotASaving } from '../src/store';

const make = (type: string, value: number, raw: string) =>
  Benefit.parse({
    id: 'b1',
    program_id: 'cal',
    merchant_id: 'm1',
    merchant_name: 'עסק',
    type,
    value,
    conditions: { raw_text_summary: raw },
    source_url: 'https://easy.co.il/page/1',
    last_verified_at: '2026-08-27T10:00:00Z',
    confidence_score: 0.95,
    reviewed_by_human: false,
  });

describe('statesAPriceNotASaving', () => {
  it('catches a face value copied as the saving', () => {
    // ₪200 of credit costing ₪144. The saving is ₪56; 200 is the face value.
    expect(statesAPriceNotASaving(make('gift_card', 200, 'תו קנייה בשווי 200₪ החל מ-144₪'))).toBe(true);
  });

  it('catches the price copied as the saving', () => {
    expect(statesAPriceNotASaving(make('gift_card', 144, 'תו קנייה בשווי 200₪ החל מ-144₪'))).toBe(true);
  });

  it('accepts the computed difference', () => {
    expect(statesAPriceNotASaving(make('gift_card', 56, 'תו קנייה בשווי 200₪ החל מ-144₪'))).toBe(false);
  });

  it('leaves a plain discount alone', () => {
    expect(statesAPriceNotASaving(make('fixed', 50, '50 ש"ח הנחה לכרטיס יחיד'))).toBe(false);
  });

  it('ignores percent and cashback, where value is a rate', () => {
    expect(statesAPriceNotASaving(make('percent', 200, 'בשווי 200₪ החל מ-144₪'))).toBe(false);
    expect(statesAPriceNotASaving(make('cashback', 3, '3% קאשבק מעל 200₪ עד 144₪'))).toBe(false);
  });

  it('needs two DIFFERENT amounts, not the same one repeated', () => {
    expect(statesAPriceNotASaving(make('fixed', 50, 'הנחה 50₪, מקסימום 50 ש"ח'))).toBe(false);
  });

  it('sends a mis-valued benefit to review even at high confidence', () => {
    // The whole point: these all arrived at 0.85-0.95 and passed the old gate.
    const bad = make('gift_card', 200, 'תו קנייה בשווי 200₪ החל מ-144₪');
    const { publish, review } = partitionByConfidence([{ benefit: bad, reason: 'ברור' }]);
    expect(publish).toHaveLength(0);
    expect(review).toHaveLength(1);
    expect(review[0]!.reason).toContain('לא החיסכון');
  });
});
