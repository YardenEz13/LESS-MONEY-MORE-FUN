import { describe, expect, it } from 'vitest';
import { Benefit } from '../src/types';
import { estimateSaving, evaluateBenefit, rankBenefits, type EvalContext } from '../src/matching';

/** 2026-08-02 is a Sunday; 13:00 Asia/Jerusalem == 10:00Z (IDT, UTC+3). */
const SUNDAY_NOON = new Date('2026-08-02T10:00:00Z');

function makeBenefit(overrides: Partial<Benefit> = {}): Benefit {
  return Benefit.parse({
    id: 'b1',
    program_id: 'hever',
    merchant_id: 'super_pharm',
    merchant_name: 'סופר-פארם',
    type: 'percent',
    value: 10,
    conditions: { raw_text_summary: 'לחברי מועדון בלבד' },
    source_url: 'https://example.com/benefit',
    last_verified_at: '2026-08-01T10:00:00Z',
    confidence_score: 0.95,
    reviewed_by_human: false,
    ...overrides,
  });
}

const baseCtx: EvalContext = {
  now: SUNDAY_NOON,
  ownedProgramIds: ['hever'],
};

describe('evaluateBenefit', () => {
  it('is eligible when nothing is stated beyond ownership', () => {
    // stacks_with_club is unset, which is a stated unknown -> conditional, not eligible.
    const evaluation = evaluateBenefit(makeBenefit(), baseCtx);
    expect(evaluation.status).toBe('conditional');
    expect(evaluation.requirements.map((r) => r.code)).toContain('stacking_unknown');
    expect(evaluation.blockers).toHaveLength(0);
  });

  it('is fully eligible once every condition is stated and satisfied', () => {
    const evaluation = evaluateBenefit(
      makeBenefit({
        conditions: {
          raw_text_summary: 'בכל יום, בכל ערוץ',
          stacks_with_club: true,
          valid_days: [1, 2, 3, 4, 5],
        },
      }),
      baseCtx,
    );
    expect(evaluation.status).toBe('eligible');
  });

  it('blocks a benefit whose program the user did not declare', () => {
    const evaluation = evaluateBenefit(makeBenefit(), { ...baseCtx, ownedProgramIds: ['max'] });
    expect(evaluation.blockers.map((b) => b.code)).toContain('program_not_owned');
    expect(evaluation.status).toBe('blocked');
  });

  it('blocks on the wrong weekday using Israeli day numbering', () => {
    // Saturday-only benefit, evaluated on a Sunday.
    const evaluation = evaluateBenefit(
      makeBenefit({ conditions: { raw_text_summary: 'שבת', valid_days: [7] } }),
      baseCtx,
    );
    expect(evaluation.blockers.map((b) => b.code)).toContain('wrong_day');
  });

  it('uses Jerusalem local time regardless of the host timezone', () => {
    // 21:30Z on a Sunday is already Monday 00:30 in Jerusalem.
    const mondayEarly = new Date('2026-08-02T21:30:00Z');
    const sundayOnly = makeBenefit({ conditions: { raw_text_summary: 'ראשון', valid_days: [1] } });
    expect(evaluateBenefit(sundayOnly, { ...baseCtx, now: mondayEarly }).status).toBe('blocked');
  });

  it('handles opening-hour windows that wrap past midnight', () => {
    const nightOwl = makeBenefit({
      conditions: { raw_text_summary: 'לילה', valid_hours: { from: '22:00', to: '02:00' } },
    });
    const at0030Local = new Date('2026-08-02T21:30:00Z');
    expect(evaluateBenefit(nightOwl, { ...baseCtx, now: at0030Local }).blockers).toHaveLength(0);
    expect(
      evaluateBenefit(nightOwl, baseCtx).blockers.map((b) => b.code),
    ).toContain('wrong_hours');
  });

  it('blocks the wrong channel but only when the channel is known', () => {
    const online = makeBenefit({
      conditions: { raw_text_summary: 'אונליין', channel: 'online' },
    });
    expect(
      evaluateBenefit(online, { ...baseCtx, channel: 'in_store' }).blockers.map((b) => b.code),
    ).toContain('wrong_channel');
    // Geofence context: channel unknown -> surface as a requirement, not a block.
    const unknownChannel = evaluateBenefit(online, baseCtx);
    expect(unknownChannel.blockers).toHaveLength(0);
    expect(unknownChannel.requirements.map((r) => r.code)).toContain('channel_restricted');
  });

  it('never silently passes an unknown minimum spend', () => {
    const withMin = makeBenefit({
      conditions: { raw_text_summary: 'מעל 150', min_spend: 150, stacks_with_club: true },
    });
    const unknownCart = evaluateBenefit(withMin, baseCtx);
    expect(unknownCart.status).toBe('conditional');
    expect(unknownCart.requirements.map((r) => r.code)).toContain('min_spend_unknown');

    const smallCart = evaluateBenefit(withMin, { ...baseCtx, cartAmount: 100 });
    expect(smallCart.status).toBe('blocked');
    expect(smallCart.blockers[0]?.message).toContain('חסרים ₪50');

    expect(evaluateBenefit(withMin, { ...baseCtx, cartAmount: 200 }).status).toBe('eligible');
  });

  it('blocks stale data and warns on aging data', () => {
    const stale = makeBenefit({ last_verified_at: '2026-05-01T10:00:00Z' });
    expect(evaluateBenefit(stale, baseCtx).blockers.map((b) => b.code)).toContain('stale_data');

    const aging = makeBenefit({ last_verified_at: '2026-07-10T10:00:00Z' });
    const agingEval = evaluateBenefit(aging, baseCtx);
    expect(agingEval.blockers).toHaveLength(0);
    expect(agingEval.requirements.map((r) => r.code)).toContain('aging_data');
  });

  it('blocks low-confidence extractions unless a human approved them', () => {
    const shaky = makeBenefit({ confidence_score: 0.6 });
    expect(evaluateBenefit(shaky, baseCtx).blockers.map((b) => b.code)).toContain('low_confidence');

    const reviewed = makeBenefit({ confidence_score: 0.6, reviewed_by_human: true });
    expect(evaluateBenefit(reviewed, baseCtx).blockers).toHaveLength(0);
  });

  it('blocks expired benefits and flags ones ending soon', () => {
    expect(
      evaluateBenefit(makeBenefit({ valid_until: '2026-07-01T00:00:00Z' }), baseCtx).blockers.map(
        (b) => b.code,
      ),
    ).toContain('expired');
    expect(
      evaluateBenefit(makeBenefit({ valid_until: '2026-08-05T00:00:00Z' }), baseCtx).requirements.map(
        (r) => r.code,
      ),
    ).toContain('ends_soon');
  });
});

describe('gates', () => {
  it('reports satisfied conditions, not just failures', () => {
    const evaluation = evaluateBenefit(
      makeBenefit({
        conditions: {
          raw_text_summary: 'א-ה, מעל 100',
          valid_days: [1, 2, 3, 4, 5],
          min_spend: 100,
          stacks_with_club: true,
        },
      }),
      { ...baseCtx, cartAmount: 200 },
    );
    const byCode = Object.fromEntries(evaluation.gates.map((g) => [g.code, g]));
    expect(byCode.day?.state).toBe('met');
    expect(byCode.min_spend?.state).toBe('met');
    expect(byCode.stacking?.state).toBe('met');
    expect(byCode.freshness?.state).toBe('met');
    expect(evaluation.status).toBe('eligible');
  });

  it('collapses a consecutive day range the way a Hebrew T&C writes it', () => {
    const weekdays = evaluateBenefit(
      makeBenefit({ conditions: { raw_text_summary: 'x', valid_days: [1, 2, 3, 4, 5] } }),
      baseCtx,
    );
    expect(weekdays.gates.find((g) => g.code === 'day')?.label).toBe('א׳-ה׳');

    const split = evaluateBenefit(
      makeBenefit({ conditions: { raw_text_summary: 'x', valid_days: [1, 3] } }),
      baseCtx,
    );
    expect(split.gates.find((g) => g.code === 'day')?.label).toBe('א׳, ג׳');
  });

  it('orders blocked before pending before met', () => {
    const evaluation = evaluateBenefit(
      makeBenefit({
        conditions: {
          raw_text_summary: 'שבת בלבד, מעל 100',
          valid_days: [7],
          min_spend: 100,
          stacks_with_club: true,
        },
      }),
      baseCtx,
    );
    expect(evaluation.gates.map((g) => g.state)).toEqual(['blocked', 'pending', 'met', 'met']);
  });

  it('gives every gate a chip label and a full sentence', () => {
    const evaluation = evaluateBenefit(
      makeBenefit({
        conditions: {
          raw_text_summary: 'x',
          max_discount: 50,
          requires_voucher: true,
          exclusions: ['תרופות מרשם'],
          channel: 'online',
        },
      }),
      baseCtx,
    );
    for (const gate of evaluation.gates) {
      expect(gate.label.length).toBeGreaterThan(0);
      expect(gate.label.length).toBeLessThanOrEqual(14);
      expect(gate.detail.length).toBeGreaterThan(gate.label.length);
    }
  });
});

describe('estimateSaving', () => {
  it('caps a percentage discount at max_discount', () => {
    const capped = makeBenefit({
      value: 20,
      conditions: { raw_text_summary: 'עד ₪50', max_discount: 50 },
    });
    expect(estimateSaving(capped, 1000)).toEqual({ value: 50, isEstimate: false });
    expect(estimateSaving(capped, 100)).toEqual({ value: 20, isEstimate: false });
  });

  it('marks values derived from the reference basket as estimates', () => {
    expect(estimateSaving(makeBenefit(), undefined).isEstimate).toBe(true);
    // A fixed-amount gift card is worth the same regardless of basket size.
    expect(
      estimateSaving(makeBenefit({ type: 'gift_card', value: 50 }), undefined),
    ).toEqual({ value: 50, isEstimate: false });
  });
});

describe('rankBenefits', () => {
  it('drops blocked benefits and puts eligible above conditional', () => {
    const benefits = [
      makeBenefit({
        id: 'conditional-big',
        type: 'fixed',
        value: 100,
        conditions: { raw_text_summary: 'מעל 500', min_spend: 500, stacks_with_club: true },
      }),
      makeBenefit({
        id: 'eligible-small',
        type: 'fixed',
        value: 20,
        conditions: { raw_text_summary: 'ללא תנאים', stacks_with_club: true },
      }),
      makeBenefit({ id: 'blocked', program_id: 'not_mine' }),
    ];
    const ranked = rankBenefits(benefits, baseCtx);
    expect(ranked.map((r) => r.benefit.id)).toEqual(['eligible-small', 'conditional-big']);
  });

  it('ranks by rate of spend kept, not by the invented reference basket', () => {
    // The bug this replaces: a ₪233 cinematheque membership topped every list.
    // A fixed amount is absolute, while 2751 of 2763 catalogued benefits are a
    // percentage of a basket nobody stated — so the membership won on units,
    // not on being a better deal.
    const benefits = [
      makeBenefit({
        id: 'annual-membership',
        type: 'fixed',
        value: 233,
        conditions: { raw_text_summary: 'מנוי שנתי', stacks_with_club: true },
      }),
      makeBenefit({
        id: 'fuel-6pct',
        type: 'percent',
        value: 6,
        conditions: { raw_text_summary: '6% בתדלוק', stacks_with_club: true },
      }),
    ];
    // ₪233 against an unstated spend states no rate at all, so it sorts below
    // a stated 6% rather than above it.
    expect(rankBenefits(benefits, baseCtx).map((r) => r.benefit.id)).toEqual([
      'fuel-6pct',
      'annual-membership',
    ]);
  });

  it('derives a rate for a fixed amount when the terms state the spend', () => {
    // A min_spend is an unresolved gate, so both of these are conditional and
    // compete inside that tier — which is where the derived rate has to work.
    const benefits = [
      makeBenefit({
        id: 'gift-150-of-300',
        type: 'gift_card',
        value: 150,
        conditions: {
          raw_text_summary: 'שובר ₪150 בקנייה מעל ₪300',
          min_spend: 300,
          stacks_with_club: true,
        },
      }),
      makeBenefit({
        id: 'gift-100-of-1000',
        type: 'gift_card',
        value: 100,
        conditions: {
          raw_text_summary: 'שובר ₪100 בקנייה מעל ₪1000',
          min_spend: 1000,
          stacks_with_club: true,
        },
      }),
    ];
    // ₪150 off ₪300 is 50%; ₪100 off ₪1000 is 10%. The old sort had these the
    // other way round, on ₪150 vs ₪100 alone.
    expect(rankBenefits(benefits, baseCtx).map((r) => r.benefit.id)).toEqual([
      'gift-150-of-300',
      'gift-100-of-1000',
    ]);
  });

  it('honours the limit', () => {
    const benefits = [makeBenefit({ id: 'a' }), makeBenefit({ id: 'b' })];
    expect(rankBenefits(benefits, baseCtx, { limit: 1 })).toHaveLength(1);
  });
});
