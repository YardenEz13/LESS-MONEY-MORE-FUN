import { describe, expect, it } from 'vitest';
import { formatSaving, latinRuns } from '../src/format';
import type { Evaluation } from '../src/matching';

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
