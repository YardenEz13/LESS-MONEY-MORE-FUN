import { describe, expect, it } from 'vitest';
import { Benefit, type VerificationCheck } from '../src/types';
import { evaluateBenefit, expectedRate, rankBenefits, type EvalContext } from '../src/matching';
import { formatVenueNotification, ticketFace } from '../src/format';
import {
  changeGuard,
  decideVerification,
  merchantOnPage,
  offerOnPage,
  secondSource,
  termsContradiction,
  valueOnPage,
} from '../src/verification';

const NOW = new Date('2026-08-02T10:00:00Z');

function makeBenefit(overrides: Partial<Benefit> = {}): Benefit {
  return Benefit.parse({
    id: 'b1',
    program_id: 'hever',
    merchant_id: 'adidas',
    merchant_name: 'אדידס',
    type: 'percent',
    value: 15,
    conditions: { raw_text_summary: '15% הנחה לחברי המועדון', stacks_with_club: true },
    source_url: 'https://club.example.org/adidas',
    last_verified_at: '2026-08-01T10:00:00Z',
    confidence_score: 0.95,
    ...overrides,
  });
}

const check = (
  code: VerificationCheck['code'],
  outcome: VerificationCheck['outcome'],
  detail?: string,
): VerificationCheck => ({ code, outcome, detail });

const ctx: EvalContext = { now: NOW, ownedProgramIds: ['hever'] };

describe('decideVerification', () => {
  it('confirms an offer the live page states', () => {
    const decision = decideVerification([
      check('source_reachable', 'pass'),
      check('page_names_merchant', 'pass'),
      check('page_states_value', 'pass'),
      check('terms_consistent', 'pass'),
    ]);
    expect(decision.state).toBe('confirmed');
    expect(decision.score).toBeGreaterThanOrEqual(0.6);
  });

  it('confirms from a dated snapshot when the live page would not answer', () => {
    const decision = decideVerification([
      check('source_reachable', 'unknown', 'blocked'),
      check('seen_in_recrawl', 'pass'),
      check('terms_consistent', 'pass'),
    ]);
    expect(decision.state).toBe('confirmed');
  });

  it('never confirms on reachability alone: an open link is not a discount', () => {
    const decision = decideVerification([
      check('source_reachable', 'pass'),
      check('page_names_merchant', 'pass'),
      check('second_source', 'pass'),
      check('terms_consistent', 'pass'),
    ]);
    expect(decision.state).toBe('unverified');
    expect(decision.conclusive).toBe(false);
  });

  it('leaves a blocked source unverified, and says the verdict is not conclusive', () => {
    const decision = decideVerification([
      check('source_reachable', 'unknown', 'HTTP 403'),
      check('terms_consistent', 'pass'),
    ]);
    expect(decision).toMatchObject({ state: 'unverified', conclusive: false });
  });

  it('demotes when the page now states a different value', () => {
    const decision = decideVerification([
      check('source_reachable', 'pass'),
      check('page_names_merchant', 'pass'),
      check('page_states_value', 'fail'),
      check('terms_consistent', 'pass'),
    ]);
    expect(decision).toMatchObject({ state: 'unverified', conclusive: true });
  });

  it('rejects when the page is gone', () => {
    const decision = decideVerification([
      check('source_reachable', 'fail', 'HTTP 404'),
      check('terms_consistent', 'pass'),
    ]);
    expect(decision.state).toBe('rejected');
  });

  it('does not confirm while two sources disagree, even with page evidence', () => {
    const decision = decideVerification([
      check('source_reachable', 'pass'),
      check('page_states_value', 'pass'),
      check('second_source', 'fail', 'other.example says 10, this says 15'),
      check('terms_consistent', 'pass'),
    ]);
    expect(decision.state).toBe('unverified');
    expect(decision.reasons.join(' ')).toMatch(/disagree/);
  });

  it('one till report holds back confirmation that rests on a snapshot', () => {
    const decision = decideVerification([
      check('seen_in_recrawl', 'pass'),
      check('terms_consistent', 'pass'),
      check('user_reports', 'fail', '1'),
    ]);
    expect(decision.state).toBe('unverified');
  });

  it('fresh page evidence outweighs a single report', () => {
    const decision = decideVerification([
      check('source_reachable', 'pass'),
      check('page_names_merchant', 'pass'),
      check('page_states_value', 'pass'),
      check('terms_consistent', 'pass'),
      check('user_reports', 'fail', '1'),
    ]);
    expect(decision.state).toBe('confirmed');
  });

  it('rejects after repeated reports with nothing fresh against them', () => {
    const decision = decideVerification([
      check('source_reachable', 'unknown', 'blocked'),
      check('terms_consistent', 'pass'),
      check('user_reports', 'fail', '3'),
    ]);
    expect(decision.state).toBe('rejected');
  });
});

describe('valueOnPage', () => {
  it('finds a percentage in either order and as a word', () => {
    expect(valueOnPage('הנחה של 15% על כל החנות', { type: 'percent', value: 15 })).toBe('pass');
    expect(valueOnPage('הנחה %15 לחברים', { type: 'percent', value: 15 })).toBe('pass');
    expect(valueOnPage('15 אחוז הנחה', { type: 'percent', value: 15 })).toBe('pass');
  });

  it('does not read 15% out of 115% or 1.15%', () => {
    expect(valueOnPage('תשואה של 115% בשנה', { type: 'percent', value: 15 })).toBe('fail');
    expect(valueOnPage('ריבית 1.15% בלבד', { type: 'percent', value: 15 })).toBe('fail');
  });

  it('reads "16.00%" and "19.90 ₪" as the catalog\'s 16 and 19.9', () => {
    expect(valueOnPage('16.00% החזר בכרטיס הנטען', { type: 'cashback', value: 16 })).toBe('pass');
    expect(valueOnPage('דמי כרטיס בסך 19.90 ₪', { type: 'fixed', value: 19.9 })).toBe('pass');
    expect(valueOnPage('2.50% הנחה', { type: 'percent', value: 2.5 })).toBe('pass');
    expect(valueOnPage('100% הנחה', { type: 'percent', value: 10 })).toBe('fail');
  });

  it('fails when the page states a different percentage', () => {
    expect(valueOnPage('10% הנחה לחברי המועדון', { type: 'percent', value: 15 })).toBe('fail');
  });

  it('is unknown, not a failure, when the page states no figure at all', () => {
    expect(valueOnPage('טוען…', { type: 'percent', value: 15 })).toBe('unknown');
  });

  it('reads shekel amounts with thousands separators and Hebrew units', () => {
    expect(valueOnPage('שובר בשווי ₪1,000', { type: 'gift_card', value: 1000 })).toBe('pass');
    expect(valueOnPage('50 ש"ח הנחה', { type: 'fixed', value: 50 })).toBe('pass');
    expect(valueOnPage('₪500 הנחה', { type: 'fixed', value: 50 })).toBe('fail');
  });

  it('can only see a 1+1, never contradict it', () => {
    expect(valueOnPage('מבצע 1+1 על כל המשקפיים', { type: 'bogo', value: 1 })).toBe('pass');
    expect(valueOnPage('20% הנחה', { type: 'bogo', value: 1 })).toBe('unknown');
  });
});

describe('merchantOnPage', () => {
  const page = `${'הטבות לחברי המועדון. '.repeat(15)} אדידס — 15% הנחה`;
  it('passes when the name is on the page and fails when it is not', () => {
    expect(merchantOnPage(page, 'אדידס')).toBe('pass');
    expect(merchantOnPage(page, 'נייקי')).toBe('fail');
  });
  it('matches the display name of a "name - LATIN" merchant', () => {
    expect(merchantOnPage(page, 'אדידס - ADIDAS')).toBe('pass');
  });
  it('says unknown for an app shell', () => {
    expect(merchantOnPage('Loading', 'אדידס')).toBe('unknown');
  });
});

describe('offerOnPage', () => {
  const fixed = (value: number, summary: string) => ({
    type: 'fixed' as const,
    value,
    merchant_name: 'פעלטון',
    conditions: { raw_text_summary: summary },
  });
  it('cannot contradict a saving the extractor worked out', () => {
    const derived = fixed(60, 'שובר בשווי 200 ש"ח ב-140 ש"ח');
    expect(offerOnPage('BUYME בשווי 200 ₪ ב-140 ₪ בלבד', derived, { shared: false })).toBe('unknown');
  });
  it('still contradicts a figure the summary printed', () => {
    const stated = fixed(50, '50 ש"ח הנחה על כרטיס');
    expect(offerOnPage('30 ש"ח הנחה על כרטיס', stated, { shared: false })).toBe('fail');
  });
  it('confirms a computed saving by its own price pair', () => {
    const pair = fixed(9, 'כרטיס ב-30 ש״ח (במקום 39 ש״ח)');
    expect(offerOnPage('מחיר לאחר הנחה 39 ₪ 30 ₪', pair, { shared: false })).toBe('pass');
    expect(offerOnPage('רק 30 ₪ במקום 39 ₪', pair, { shared: false })).toBe('pass');
    // The pair gone from the page is not proof the offer changed.
    expect(offerOnPage('כרטיס ב-45 ₪', pair, { shared: false })).toBe('unknown');
  });
});

describe('termsContradiction', () => {
  it('accepts ordinary terms', () => {
    expect(termsContradiction(makeBenefit())).toBeNull();
  });
  it('flags a discount bigger than the basket that unlocks it', () => {
    const benefit = makeBenefit({
      type: 'fixed',
      value: 150,
      conditions: { raw_text_summary: 'x', min_spend: 100 },
    });
    expect(termsContradiction(benefit)).toMatch(/₪150 off a ₪100 minimum/);
  });
  it('flags an offer that ends before it starts', () => {
    const benefit = makeBenefit({
      valid_from: '2026-09-01T00:00:00Z',
      valid_until: '2026-08-01T00:00:00Z',
    });
    expect(termsContradiction(benefit)).toBe('ends before it starts');
  });
});

describe('secondSource', () => {
  const mine = makeBenefit();
  it('is unknown with nobody to compare against', () => {
    expect(secondSource(mine, [mine]).outcome).toBe('unknown');
  });
  it('passes when another host agrees and fails when it does not', () => {
    const agrees = makeBenefit({ id: 'b2', source_url: 'https://aggregator.example.net/x' });
    const differs = makeBenefit({ id: 'b3', value: 10, source_url: 'https://aggregator.example.net/y' });
    expect(secondSource(mine, [mine, agrees]).outcome).toBe('pass');
    expect(secondSource(mine, [mine, differs])).toMatchObject({ outcome: 'fail' });
  });
  it('does not treat another program at the same shop as a contradiction', () => {
    const otherClub = makeBenefit({
      id: 'b4',
      program_id: 'max',
      value: 5,
      source_url: 'https://max.example.net/x',
    });
    expect(secondSource(mine, [mine, otherClub]).outcome).toBe('unknown');
  });
});

describe('changeGuard', () => {
  it('lets a normal run through', () => {
    expect(changeGuard({ checked: 100, takenDown: 12 })).toEqual({ ok: true });
  });
  it('stops a run that would take down a third of what it checked', () => {
    const verdict = changeGuard({ checked: 100, takenDown: 45 });
    expect(verdict.ok).toBe(false);
  });
  it('does not compute a share off a handful of rows', () => {
    expect(changeGuard({ checked: 5, takenDown: 5 })).toEqual({ ok: true });
  });
});

describe('the engine reads the verdict', () => {
  const verified = (state: 'confirmed' | 'unverified' | 'rejected') => ({
    state,
    checked_at: '2026-08-01T10:00:00Z',
    score: 0.8,
    checks: [],
  });

  it('a confirmed verdict clears the confidence gate without a human', () => {
    const lowConfidence = makeBenefit({ confidence_score: 0.6 });
    expect(evaluateBenefit(lowConfidence, ctx).status).toBe('blocked');
    const confirmed = makeBenefit({ confidence_score: 0.6, verification: verified('confirmed') });
    expect(evaluateBenefit(confirmed, ctx).status).not.toBe('blocked');
  });

  it('an unverified offer is shown, and labelled as such', () => {
    const evaluation = evaluateBenefit(makeBenefit({ verification: verified('unverified') }), ctx);
    expect(evaluation.status).toBe('conditional');
    expect(evaluation.requirements.map((r) => r.code)).toContain('unverified');
    expect(evaluation.gates.find((g) => g.code === 'verification')?.label).toBe('לא מאומת');
  });

  it('an unverified low-confidence offer stays blocked: no verdict is not a yes', () => {
    const benefit = makeBenefit({ confidence_score: 0.6, verification: verified('unverified') });
    expect(evaluateBenefit(benefit, ctx).status).toBe('blocked');
  });

  it('a rejected offer is never shown', () => {
    const benefit = makeBenefit({ verification: verified('rejected') });
    expect(evaluateBenefit(benefit, ctx).blockers.map((b) => b.code)).toContain('rejected');
    expect(rankBenefits([benefit], ctx)).toHaveLength(0);
  });

  it('an unverified 40% never ranks above a confirmed 10%', () => {
    const proven = makeBenefit({ id: 'proven', value: 10, verification: verified('confirmed') });
    const unproven = makeBenefit({
      id: 'unproven',
      value: 40,
      merchant_id: 'other',
      conditions: { raw_text_summary: '40% הנחה', stacks_with_club: true },
      verification: verified('unverified'),
    });
    expect(rankBenefits([unproven, proven], ctx).map((e) => e.benefit.id)).toEqual([
      'proven',
      'unproven',
    ]);
  });
});

/**
 * The ranking fixtures. Each is a situation someone can actually stand in, and
 * asserts the first card — a ranking change that cannot name the situation it
 * improves is a feeling, not an improvement.
 */
describe('ranking by expected rate', () => {
  const official = makeBenefit({
    id: 'official_15',
    value: 15,
    confidence_score: 0.95,
    last_verified_at: '2026-08-01T10:00:00Z',
  });
  const aggregator = makeBenefit({
    id: 'aggregator_17',
    value: 17,
    merchant_id: 'nike',
    merchant_name: 'נייקי',
    conditions: { raw_text_summary: '17% הנחה', stacks_with_club: true },
    source_url: 'https://aggregator.example.net/nike',
    confidence_score: 0.6,
    reviewed_by_human: true,
    last_verified_at: '2026-06-25T10:00:00Z', // 38 days: ageing, not yet stale
  });

  it('a fresh, fully read 15% beats an ageing, half-read 17%', () => {
    expect(rankBenefits([aggregator, official], ctx)[0]!.benefit.id).toBe('official_15');
  });

  it('but a clearly bigger offer still wins: the discount is not a veto', () => {
    const big = { ...aggregator, id: 'aggregator_30', value: 30 };
    expect(rankBenefits([official, big], ctx)[0]!.benefit.id).toBe('aggregator_30');
  });

  it('two equally sure offers still sort by headline rate', () => {
    const ten = makeBenefit({ id: 'ten', value: 10, merchant_id: 'm1' });
    const twelve = makeBenefit({ id: 'twelve', value: 12, merchant_id: 'm2' });
    expect(rankBenefits([ten, twelve], ctx).map((e) => e.benefit.id)).toEqual(['twelve', 'ten']);
  });

  it('a street shop with one stale offer stays silent', () => {
    const stale = makeBenefit({ last_verified_at: '2026-05-01T10:00:00Z' });
    expect(rankBenefits([stale], ctx)).toHaveLength(0);
  });

  it('an online-only coupon is not offered at the till', () => {
    const online = makeBenefit({
      conditions: { raw_text_summary: '15% באתר', channel: 'online', stacks_with_club: true },
    });
    expect(rankBenefits([online], { ...ctx, channel: 'in_store' })).toHaveLength(0);
  });

  it('leaves an offer with no stated rate unrankable rather than inventing one', () => {
    const noRate = makeBenefit({
      type: 'fixed',
      value: 50,
      conditions: { raw_text_summary: '₪50 הנחה' },
    });
    expect(expectedRate({ benefit: noRate, ageDays: 0 })).toBeNull();
  });
});

describe('an unverified offer says so on the ticket and stays out of the push', () => {
  const unverified = makeBenefit({
    conditions: { raw_text_summary: '15% הנחה', stacks_with_club: true },
    verification: { state: 'unverified', checked_at: '2026-08-01T10:00:00Z', score: 0.2, checks: [] },
  });

  it('never reads "pay now"', () => {
    const face = ticketFace(evaluateBenefit(unverified, ctx));
    expect(face.verdict).not.toBe('אפשר לשלם');
    expect(face.holes.map((h) => h.label)).toContain('לא מאומת');
  });

  it('is not what a venue reminder announces', () => {
    const confirmed = makeBenefit({ id: 'ok', merchant_id: 'm2', merchant_name: 'נייקי' });
    const ranked = rankBenefits([unverified, confirmed], ctx);
    expect(formatVenueNotification('קניון', ranked, {})?.body).not.toContain('אדידס');
  });
});
