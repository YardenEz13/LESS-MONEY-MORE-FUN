import { describe, expect, it } from 'vitest';
import { displayMerchantName, formatSaving, latinRuns, ticketFace } from '../src/format';
import type { Evaluation, Gate } from '../src/matching';

const gate = (code: Gate['code'], state: Gate['state'], label: string, actionable = false): Gate => ({
  code,
  state,
  label,
  detail: `${label} — פירוט`,
  actionable,
});

describe('ticketFace', () => {
  const face = (status: Evaluation['status'], gates: Gate[], maxHoles?: number) =>
    ticketFace(
      { status, gates, blockers: [], actionsRequired: gates.filter((g) => g.state === 'pending' && g.actionable) },
      maxHoles,
    );

  it('says pay when nothing is left, and gives a caveat no hole', () => {
    const result = face('conditional', [gate('stacking', 'pending', 'כפל?'), gate('freshness', 'met', 'מאומת')]);
    expect(result.state).toBe('ready');
    expect(result.verdict).toBe('אפשר לשלם');
    expect(result.holes).toEqual([{ code: 'freshness', label: 'מאומת', state: 'punched' }]);
  });

  it('names the one step left, and counts several', () => {
    const voucher = gate('voucher', 'pending', 'שובר מראש', true);
    const spend = gate('min_spend', 'pending', '₪300+', true);
    expect(face('conditional', [voucher]).verdict).toBe('עוד צעד: שובר מראש');
    expect(face('conditional', [voucher]).holes[0]!.state).toBe('open');
    expect(face('conditional', [voucher, spend]).verdict).toBe('עוד 2 צעדים');
  });

  it('stamps a blocked ticket with the condition that failed', () => {
    const result = face('blocked', [gate('hours', 'blocked', '13:30-14:45'), gate('day', 'met', 'א׳-ה׳')]);
    expect(result.state).toBe('blocked');
    expect(result.stamp).toBe('לא עכשיו');
    expect(result.verdict).toBe('13:30-14:45, פירוט');
    expect(result.holes.map((h) => h.state)).toEqual(['bad', 'punched']);
  });

  it('drops satisfied holes first when the rail is full', () => {
    const result = face(
      'conditional',
      [gate('voucher', 'pending', 'שובר', true), gate('day', 'met', 'יום'), gate('hours', 'met', 'שעה')],
      2,
    );
    expect(result.holes.map((h) => h.code)).toEqual(['voucher', 'day']);
  });
});

describe('displayMerchantName', () => {
  it('drops what follows the source separator', () => {
    expect(displayMerchantName('הוט סינמה - HOT CINEMA')).toBe('הוט סינמה');
    expect(displayMerchantName('ספא אקויה אילת | SPA AKOYA')).toBe('ספא אקויה אילת');
  });

  it('leaves a hyphen inside a name alone', () => {
    expect(displayMerchantName('סופר-פארם')).toBe('סופר-פארם');
    expect(displayMerchantName('Terminal-X')).toBe('Terminal-X');
  });
});

/** Shorthand: "Hebrew|LATIN|Hebrew" so the expectations stay readable. */
const shape = (text: string) =>
  latinRuns(text)
    .map((run) => (run.latin ? `[${run.text}]` : run.text))
    .join('');

describe('latinRuns', () => {
  it('leaves a Hebrew-only label in one non-Latin run', () => {
    const runs = latinRuns('חולצות קיץ לנשים ולגברים');
    expect(runs).toEqual([{ text: 'חולצות קיץ לנשים ולגברים', latin: false }]);
  });

  it('keeps a multi-word Latin name together, ampersand included', () => {
    // The whole point of the ampersand case: EFT maps & to a shekel glyph, so
    // "Golf & Co" must cross into the Latin face as one run, not three.
    expect(shape('סניפי Golf & Co')).toBe('סניפי [Golf & Co]');
    expect(shape('KSP & Ivory')).toBe('[KSP & Ivory]');
  });

  it('splits a name that has Hebrew inside it', () => {
    expect(shape('Cash כאל Pro')).toBe('[Cash] כאל [Pro]');
    expect(shape('שופרסל LIFE')).toBe('שופרסל [LIFE]');
  });

  it('leaves figures to the Hebrew face', () => {
    expect(shape('40%')).toBe('40%');
    expect(shape('₪119.90')).toBe('₪119.90');
    expect(shape('עד 31.8')).toBe('עד 31.8');
    // Letters move, the number beside them does not.
    expect(shape('Terminal X 40%')).toBe('[Terminal X] 40%');
  });

  it('does not swallow the space before Hebrew resumes', () => {
    expect(shape('ב FOX ו')).toBe('ב [FOX] ו');
    expect(shape('FOX ')).toBe('[FOX] ');
  });

  it('handles the maqaf-joined form the catalogue actually uses', () => {
    expect(shape('הנחה ב־FOX ו־Castro')).toBe('הנחה ב־[FOX] ו־[Castro]');
  });

  it('keeps interior punctuation inside the run', () => {
    expect(shape('ksp.co.il')).toBe('[ksp.co.il]');
    expect(shape('Terminal-X')).toBe('[Terminal-X]');
  });

  it('reassembles losslessly', () => {
    for (const label of [
      'סניפי Golf & Co · עד 31.8',
      'Cash כאל Pro',
      '₪119.90 חיסכון',
      'ADIKA',
      '',
    ]) {
      expect(latinRuns(label).map((r) => r.text).join('')).toBe(label);
    }
  });
});

describe('formatSaving', () => {
  const evaluation = (estimatedSavingIls: number, isEstimate: boolean) =>
    ({ estimatedSavingIls, isEstimate }) as Evaluation;

  it('states a figure only when it came from a real cart', () => {
    expect(formatSaving(evaluation(25, false))).toBe('חיסכון ₪25');
  });

  /**
   * The reference basket exists to rank benefits, not to be read. Rendering it
   * put the same ₪25 on every 10% benefit in the catalogue — the assumption
   * talking, dressed as the benefit.
   */
  it('says nothing when the cart was assumed', () => {
    expect(formatSaving(evaluation(25, true))).toBeNull();
  });
});
