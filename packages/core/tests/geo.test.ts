import { describe, expect, it } from 'vitest';
import { Venue } from '../src/types.js';
import {
  DEFAULT_NOTIFICATION_POLICY,
  distanceMeters,
  shouldNotifyForVenue,
  venuesContaining,
} from '../src/geo.js';

const azrieli = Venue.parse({
  id: 'azrieli_tlv',
  name: 'קניון עזריאלי תל אביב',
  city: 'תל אביב',
  lat: 32.0741,
  lng: 34.7922,
  radius_m: 250,
});

const dizengoff = Venue.parse({
  id: 'dizengoff_center',
  name: 'דיזנגוף סנטר',
  city: 'תל אביב',
  lat: 32.0757,
  lng: 34.7748,
  radius_m: 200,
});

describe('geo', () => {
  it('measures distance between two Tel Aviv malls', () => {
    const meters = distanceMeters(azrieli, dizengoff);
    expect(meters).toBeGreaterThan(1500);
    expect(meters).toBeLessThan(1800);
  });

  it('matches only the venue the user is standing in', () => {
    expect(venuesContaining({ lat: 32.0742, lng: 34.7923 }, [azrieli, dizengoff])).toEqual([azrieli]);
    expect(venuesContaining({ lat: 31.7683, lng: 35.2137 }, [azrieli, dizengoff])).toEqual([]);
  });
});

describe('shouldNotifyForVenue', () => {
  const enteredAt = 1_000_000;
  const base = {
    state: { venueId: 'azrieli_tlv', enteredAt },
    localMinutes: 12 * 60,
    matchCount: 3,
  };

  it('notifies after the dwell threshold', () => {
    expect(shouldNotifyForVenue({ ...base, now: enteredAt + 4 * 60_000 })).toEqual({ notify: true });
  });

  it('suppresses drive-throughs', () => {
    expect(shouldNotifyForVenue({ ...base, now: enteredAt + 30_000 })).toEqual({
      notify: false,
      reason: 'dwell_too_short',
    });
  });

  it('respects the per-venue cooldown', () => {
    const now = enteredAt + 10 * 60_000;
    expect(
      shouldNotifyForVenue({
        ...base,
        now,
        state: { ...base.state, notifiedAt: now - 60_000 },
      }),
    ).toEqual({ notify: false, reason: 'cooldown' });
  });

  it('stays quiet at night', () => {
    expect(
      shouldNotifyForVenue({ ...base, now: enteredAt + 10 * 60_000, localMinutes: 23 * 60 }),
    ).toEqual({ notify: false, reason: 'quiet_hours' });
    expect(
      shouldNotifyForVenue({ ...base, now: enteredAt + 10 * 60_000, localMinutes: 7 * 60 }),
    ).toEqual({ notify: false, reason: 'quiet_hours' });
  });

  it('never fires an empty notification', () => {
    expect(
      shouldNotifyForVenue({
        ...base,
        now: enteredAt + 10 * 60_000,
        matchCount: 0,
        policy: DEFAULT_NOTIFICATION_POLICY,
      }),
    ).toEqual({ notify: false, reason: 'nothing_to_show' });
  });
});
