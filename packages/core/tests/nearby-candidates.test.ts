import { describe, expect, it } from 'vitest';
import { Benefit, Merchant } from '../src/types';
import { nearbyCandidates, rankBenefits, type EvalContext } from '../src/matching';

/** 2026-08-02 is a Sunday; 13:00 Asia/Jerusalem == 10:00Z (IDT, UTC+3). */
const SUNDAY_NOON = new Date('2026-08-02T10:00:00Z');

const HAIFA = { lat: 32.794, lng: 34.9896 };

function makeBenefit(id: string, merchantId: string, value: number): Benefit {
  return Benefit.parse({
    id,
    program_id: 'hever',
    merchant_id: merchantId,
    merchant_name: merchantId,
    type: 'percent',
    value,
    conditions: { raw_text_summary: 'לחברי מועדון בלבד', stacks_with_club: true },
    source_url: 'https://example.com/benefit',
    last_verified_at: '2026-08-01T10:00:00Z',
    confidence_score: 0.95,
    reviewed_by_human: false,
  });
}

function makeMerchant(id: string, branches: Array<{ lat: number; lng: number; city?: string }>) {
  return Merchant.parse({ id, name: id, branches });
}

const ctx: EvalContext = { now: SUNDAY_NOON, ownedProgramIds: ['hever'] };

// A better offer in Tel Aviv and a worse one in Haifa: the exact shape that
// made the advisor useless outside Gush Dan.
const benefits = [
  makeBenefit('tlv_15', 'delek_tlv', 15),
  makeBenefit('haifa_6', 'paz_haifa', 6),
  makeBenefit('nowhere_9', 'online_only', 9),
];

const merchantsById = new Map([
  ['delek_tlv', makeMerchant('delek_tlv', [{ lat: 32.0741, lng: 34.7922, city: 'תל אביב' }])],
  ['paz_haifa', makeMerchant('paz_haifa', [{ lat: 32.7955, lng: 34.99, city: 'חיפה' }])],
  ['online_only', makeMerchant('online_only', [])],
]);

describe('nearbyCandidates', () => {
  const ranked = rankBenefits(benefits, ctx);

  it('ranks nationally when there is no position — the old behaviour, unchanged', () => {
    const candidates = nearbyCandidates({
      ranked,
      merchantsById,
      position: null,
      radiusM: 15_000,
      limit: 25,
    });
    expect(candidates.map((c) => c.evaluation.benefit.id)).toEqual(['tlv_15', 'nowhere_9', 'haifa_6']);
    expect(candidates.every((c) => c.distanceM === null)).toBe(true);
  });

  it('puts the reachable offer first even though the engine ranks it last', () => {
    const candidates = nearbyCandidates({
      ranked,
      merchantsById,
      position: HAIFA,
      radiusM: 15_000,
      limit: 25,
    });
    expect(candidates[0]!.evaluation.benefit.id).toBe('haifa_6');
    expect(candidates[0]!.city).toBe('חיפה');
    expect(candidates[0]!.distanceM).toBeLessThan(1_000);
  });

  it('keeps engine order inside each group, so the far list is still ranked', () => {
    const far = nearbyCandidates({
      ranked,
      merchantsById,
      position: HAIFA,
      radiusM: 15_000,
      limit: 25,
    }).slice(1);
    expect(far.map((c) => c.evaluation.benefit.id)).toEqual(['tlv_15', 'nowhere_9']);
  });

  it('keeps a merchant with no coordinates rather than treating unplaced as far away', () => {
    const unplaced = nearbyCandidates({
      ranked,
      merchantsById,
      position: HAIFA,
      radiusM: 15_000,
      limit: 25,
    }).find((c) => c.evaluation.benefit.id === 'nowhere_9');
    expect(unplaced).toBeDefined();
    expect(unplaced!.distanceM).toBeNull();
  });

  it('honours the limit after the near group is put in front', () => {
    const candidates = nearbyCandidates({
      ranked,
      merchantsById,
      position: HAIFA,
      radiusM: 15_000,
      limit: 1,
    });
    expect(candidates.map((c) => c.evaluation.benefit.id)).toEqual(['haifa_6']);
  });
});
