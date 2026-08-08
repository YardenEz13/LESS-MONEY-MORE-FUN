import { describe, expect, it } from 'vitest';
import { dateOnlyToInstant } from '../src/time';

describe('dateOnlyToInstant', () => {
  it('passes through anything that is not a bare date', () => {
    expect(dateOnlyToInstant('2026-12-31T10:00:00.000Z', 'end')).toBeNull();
    expect(dateOnlyToInstant('', 'end')).toBeNull();
    expect(dateOnlyToInstant('31/12/2026', 'end')).toBeNull();
  });

  it('resolves a start date to local midnight, not UTC midnight', () => {
    // Israel is UTC+2 in December, so local midnight is 22:00Z the day before.
    expect(dateOnlyToInstant('2026-12-31', 'start')).toBe('2026-12-30T22:00:00.000Z');
  });

  it('keeps a benefit alive for the whole of its final day', () => {
    // "בתוקף עד 31/12/26" must not expire at 00:00 on the 31st.
    const end = dateOnlyToInstant('2026-12-31', 'end')!;
    expect(end).toBe('2026-12-31T21:59:59.999Z');
    // Someone shopping at 20:00 local on the last day is still covered.
    expect(new Date('2026-12-31T18:00:00Z').getTime()).toBeLessThan(new Date(end).getTime());
  });

  it('handles summer, when the offset is +3 rather than +2', () => {
    expect(dateOnlyToInstant('2026-07-15', 'start')).toBe('2026-07-14T21:00:00.000Z');
    expect(dateOnlyToInstant('2026-07-15', 'end')).toBe('2026-07-15T20:59:59.999Z');
  });

  it('stays exact across the spring DST switch', () => {
    // Israel springs forward on the last Friday of March; the day is 23h long.
    const start = new Date(dateOnlyToInstant('2026-03-27', 'start')!).getTime();
    const end = new Date(dateOnlyToInstant('2026-03-27', 'end')!).getTime();
    expect(end - start).toBe(23 * 3_600_000 - 1);
  });

  it('end is always after start for the same day', () => {
    for (const day of ['2026-01-01', '2026-06-30', '2026-10-25', '2026-12-31']) {
      expect(new Date(dateOnlyToInstant(day, 'end')!).getTime()).toBeGreaterThan(
        new Date(dateOnlyToInstant(day, 'start')!).getTime(),
      );
    }
  });
});
