import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFICATION_POLICY,
  dwellOnEnter,
  dwellOnExit,
  shouldNotifyForVenue,
  type DwellState,
} from '../src/geo';

const VENUE = 'azrieli_tlv';
const T0 = 1_800_000_000_000;
const DWELL = DEFAULT_NOTIFICATION_POLICY.minDwellMs;
const NOON = 12 * 60;

/** What the enter handler asks: would a reminder armed now be right to send? */
const wouldNotify = (state: DwellState, now: number, matchCount = 3) =>
  shouldNotifyForVenue({
    state,
    now: now + DWELL,
    localMinutes: NOON,
    matchCount,
    policy: DEFAULT_NOTIFICATION_POLICY,
  }).notify;

describe('dwellOnEnter', () => {
  it('starts a clock on a venue never visited', () => {
    expect(dwellOnEnter(undefined, VENUE, T0)).toEqual({ venueId: VENUE, enteredAt: T0 });
  });

  it('keeps the original clock when GPS drift re-fires while still inside', () => {
    const inside = dwellOnEnter(undefined, VENUE, T0);
    expect(dwellOnEnter(inside, VENUE, T0 + 60_000).enteredAt).toBe(T0);
  });

  // The bug: exit wrote `enteredAt: 0` and enter read it back with `??`, which
  // does not fall through for a non-null object. `now - 0` is ~fifty years.
  it('treats the exit marker as absent instead of as an entry in 1970', () => {
    const afterExit: DwellState = { venueId: VENUE, enteredAt: 0 };
    const next = dwellOnEnter(afterExit, VENUE, T0);
    expect(next.enteredAt).toBe(T0);
    expect(wouldNotify(next, T0)).toBe(true);
    // The old behaviour, asserted directly so a regression is unmistakable:
    // reusing the record verbatim clears a three-minute gate by decades.
    expect(wouldNotify(afterExit, T0)).toBe(true);
    expect(T0 - afterExit.enteredAt).toBeGreaterThan(DWELL);
  });

  it('does not notify on the doorstep of a first visit', () => {
    const arrived = dwellOnEnter(undefined, VENUE, T0);
    expect(
      shouldNotifyForVenue({
        state: arrived,
        now: T0,
        localMinutes: NOON,
        matchCount: 3,
        policy: DEFAULT_NOTIFICATION_POLICY,
      }).notify,
    ).toBe(false);
    // ...but it is armed for the moment the dwell matures, which is the fix.
    expect(wouldNotify(arrived, T0)).toBe(true);
  });

  it('carries the cooldown across a leave-and-return so re-entry cannot buy a reminder', () => {
    const returning = dwellOnEnter(
      { venueId: VENUE, enteredAt: 0, notifiedAt: T0 },
      VENUE,
      T0 + 60_000,
    );
    expect(returning.notifiedAt).toBe(T0);
    expect(wouldNotify(returning, T0 + 60_000)).toBe(false);
  });
});

describe('dwellOnExit', () => {
  it('withdraws a reminder that had not landed yet, and hands the cooldown back', () => {
    const armed: DwellState = {
      venueId: VENUE,
      enteredAt: T0,
      notifiedAt: T0 + DWELL,
      scheduledId: 'notif-1',
    };
    const { next, cancelId } = dwellOnExit(armed, T0 + 60_000);
    expect(cancelId).toBe('notif-1');
    expect(next.notifiedAt).toBeUndefined();
    // A drive-past must not silence the venue for the next twelve hours.
    expect(wouldNotify(dwellOnEnter(next, VENUE, T0 + 120_000), T0 + 120_000)).toBe(true);
  });

  it('keeps the cooldown of a reminder that already landed', () => {
    const delivered: DwellState = {
      venueId: VENUE,
      enteredAt: T0,
      notifiedAt: T0 + DWELL,
      scheduledId: 'notif-1',
    };
    const { next, cancelId } = dwellOnExit(delivered, T0 + DWELL + 60_000);
    expect(cancelId).toBeUndefined();
    expect(next.notifiedAt).toBe(T0 + DWELL);
    expect(wouldNotify(dwellOnEnter(next, VENUE, T0 + 600_000), T0 + 600_000)).toBe(false);
  });

  it('clears the dwell clock so the next visit earns its own timer', () => {
    const { next } = dwellOnExit({ venueId: VENUE, enteredAt: T0 }, T0 + 60_000);
    expect(next.enteredAt).toBe(0);
  });

  it('has nothing to cancel when no reminder was ever armed', () => {
    const { cancelId } = dwellOnExit({ venueId: VENUE, enteredAt: T0 }, T0 + 60_000);
    expect(cancelId).toBeUndefined();
  });
});
