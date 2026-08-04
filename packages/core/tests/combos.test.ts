import { describe, expect, it } from 'vitest';
import { findCombos, UNIVERSAL_MERCHANT_ID } from '../src/combos';
import { evaluateBenefit, expandOwnedPrograms } from '../src/matching';
import type { Benefit, Program } from '../src/types';

const NOW = new Date('2026-08-04T10:00:00.000Z');

function benefit(over: Partial<Benefit> & Pick<Benefit, 'id' | 'program_id'>): Benefit {
  return {
    merchant_id: 'castro',
    merchant_name: 'קסטרו',
    google_place_id: null,
    type: 'percent',
    value: 30,
    conditions: {
      min_spend: null,
      max_discount: null,
      valid_days: null,
      valid_hours: null,
      channel: null,
      stacks_with_club: true,
      exclusions: null,
      usage_limit: null,
      requires_voucher: null,
      raw_text_summary: 'תנאים לבדיקה',
    },
    valid_from: null,
    valid_until: null,
    source_url: 'https://example.invalid/x',
    last_verified_at: NOW.toISOString(),
    confidence_score: 0.95,
    reviewed_by_human: true,
    ...over,
  } as Benefit;
}

const evaluate = (benefits: Benefit[], cartAmount?: number) =>
  benefits.map((b) =>
    evaluateBenefit(b, {
      now: NOW,
      ownedProgramIds: benefits.map((x) => x.program_id),
      cartAmount,
    }),
  );

describe('expandOwnedPrograms', () => {
  const programs: Program[] = [
    { id: 'cal', name: 'כאל', category: 'credit_card', parent_id: null },
    { id: 'cal_cash_pro', name: 'Cash כאל Pro', category: 'credit_card', parent_id: 'cal' },
  ] as Program[];

  it('grants the issuer when the user only ticked the card', () => {
    expect(expandOwnedPrograms(['cal_cash_pro'], programs).sort()).toEqual(['cal', 'cal_cash_pro']);
  });

  it('leaves an unrelated program alone', () => {
    expect(expandOwnedPrograms(['hever'], programs)).toEqual(['hever']);
  });

  it('does not hang on a cycle in hand-edited data', () => {
    const cyclic = [
      { id: 'a', name: 'a', category: 'credit_card', parent_id: 'b' },
      { id: 'b', name: 'b', category: 'credit_card', parent_id: 'a' },
    ] as Program[];
    expect(expandOwnedPrograms(['a'], cyclic).sort()).toEqual(['a', 'b']);
  });
});

describe('findCombos', () => {
  const thirtyPercent = benefit({ id: 'p30', program_id: 'max', type: 'percent', value: 30 });
  const giftCard = benefit({ id: 'g150', program_id: 'hever', type: 'gift_card', value: 150 });

  it('reports the worse of the two application orders, never the better one', () => {
    // On ₪500: 30% first then the voucher saves 150+150=300.
    // Voucher first then 30% saves 150+105=255. We must report 255.
    const combos = findCombos(evaluate([thirtyPercent, giftCard], 500), { cartAmount: 500 });
    expect(combos).toHaveLength(1);
    expect(combos[0]!.estimatedSavingIls).toBeCloseTo(255);
  });

  it('never lets a voucher save more than the basket holds', () => {
    const combos = findCombos(evaluate([giftCard], 100), { cartAmount: 100 });
    expect(combos).toHaveLength(0); // nothing to pair with
    const withPercent = findCombos(evaluate([thirtyPercent, giftCard], 100), { cartAmount: 100 });
    expect(withPercent[0]!.estimatedSavingIls).toBeLessThanOrEqual(100);
  });

  it('marks a pair unconfirmed when either T&C is silent on stacking', () => {
    const silent = benefit({
      id: 'silent',
      program_id: 'hever',
      type: 'gift_card',
      value: 150,
      conditions: { ...giftCard.conditions, stacks_with_club: null },
    });
    const [combo] = findCombos(evaluate([thirtyPercent, silent], 500), { cartAmount: 500 });
    expect(combo!.confirmed).toBe(false);
    expect(combo!.caveats).not.toHaveLength(0);
  });

  it('refuses a pair when either side forbids stacking outright', () => {
    const forbids = benefit({
      id: 'no',
      program_id: 'hever',
      type: 'gift_card',
      value: 150,
      conditions: { ...giftCard.conditions, stacks_with_club: false },
    });
    expect(findCombos(evaluate([thirtyPercent, forbids], 500), { cartAmount: 500 })).toHaveLength(0);
  });

  it('pairs a universal cashback card with any shop offer, and names the shop', () => {
    const cashback = benefit({
      id: 'cb',
      program_id: 'cal_cash_pro',
      merchant_id: UNIVERSAL_MERCHANT_ID,
      merchant_name: 'כל בית עסק',
      type: 'cashback',
      value: 1,
    });
    const [combo] = findCombos(evaluate([thirtyPercent, cashback], 500), { cartAmount: 500 });
    expect(combo!.merchantName).toBe('קסטרו');
  });

  it('does not pair two offers from the same club', () => {
    const sameClub = benefit({ id: 'other', program_id: 'max', type: 'gift_card', value: 150 });
    expect(findCombos(evaluate([thirtyPercent, sameClub], 500), { cartAmount: 500 })).toHaveLength(0);
  });

  it('does not pair offers at different shops', () => {
    const elsewhere = benefit({
      id: 'elsewhere',
      program_id: 'hever',
      merchant_id: 'fox',
      merchant_name: 'FOX',
      type: 'gift_card',
      value: 150,
    });
    expect(findCombos(evaluate([thirtyPercent, elsewhere], 500), { cartAmount: 500 })).toHaveLength(0);
  });

  it('ranks a confirmed combo above a larger unconfirmed one', () => {
    const bigSilent = benefit({
      id: 'big',
      program_id: 'isracard',
      merchant_id: 'fox',
      merchant_name: 'FOX',
      type: 'gift_card',
      value: 400,
      conditions: { ...giftCard.conditions, stacks_with_club: null },
    });
    const foxPercent = benefit({
      id: 'foxp',
      program_id: 'hever',
      merchant_id: 'fox',
      merchant_name: 'FOX',
      type: 'percent',
      value: 30,
      conditions: { ...thirtyPercent.conditions, stacks_with_club: null },
    });
    const combos = findCombos(
      evaluate([thirtyPercent, giftCard, bigSilent, foxPercent], 1000),
      { cartAmount: 1000 },
    );
    expect(combos[0]!.confirmed).toBe(true);
  });
});
