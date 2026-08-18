import { describe, expect, it } from 'vitest';
import { Merchant, Venue } from '../src/types';
import {
  DEFAULT_NOTIFICATION_POLICY,
  distanceMeters,
  merchantsNear,
  nearestFences,
  shouldNotifyForVenue,
  venuesContaining,
} from '../src/geo';

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

describe('merchantsNear', () => {
  // Dizengoff Center, and a shop ~350m up the street from it.
  const here = { lat: 32.0757, lng: 34.7748 };

  const merchant = (id: string, branches: { lat: number; lng: number }[]) =>
    Merchant.parse({ id, name: id, branches });

  const onSite = merchant('on_site', [{ lat: 32.0757, lng: 34.7748 }]);
  const upTheStreet = merchant('up_the_street', [{ lat: 32.0789, lng: 34.7748 }]);
  const haifa = merchant('haifa', [{ lat: 32.7866, lng: 35.0209 }]);

  it('finds branches inside the radius, nearest first', () => {
    expect(merchantsNear(here, [haifa, upTheStreet, onSite], 500).map((m) => m.id)).toEqual([
      'on_site',
      'up_the_street',
    ]);
  });

  it('excludes a merchant whose only branch is out of range', () => {
    expect(merchantsNear(here, [onSite, upTheStreet], 100).map((m) => m.id)).toEqual(['on_site']);
  });

  it('ranks a chain by its nearest branch, not its first', () => {
    const chain = merchant('chain', [
      { lat: 32.7866, lng: 35.0209 },
      { lat: 32.0757, lng: 34.7748 },
    ]);
    expect(merchantsNear(here, [upTheStreet, chain], 500).map((m) => m.id)).toEqual([
      'chain',
      'up_the_street',
    ]);
  });

  it('ignores a merchant with no branches rather than throwing', () => {
    expect(merchantsNear(here, [merchant('nowhere', [])], 500)).toEqual([]);
  });
});

describe('nearestFences', () => {
  const here = { lat: 32.0757, lng: 34.7748 };

  const shop = (id: string, branches: { lat: number; lng: number }[]) =>
    Merchant.parse({ id, name: id, branches });

  const base = { venues: [azrieli], limit: 20, shopRadiusM: 150 };

  it('prefixes shop fences and leaves venue ids bare', () => {
    const fences = nearestFences({
      ...base,
      position: here,
      merchants: [shop('super_pharm', [here])],
    });
    expect(fences.map((f) => f.id)).toEqual(['shop:super_pharm', 'azrieli_tlv']);
  });

  it('gives a mall its own radius and a shop the shop radius', () => {
    const fences = nearestFences({
      ...base,
      position: here,
      merchants: [shop('super_pharm', [here])],
    });
    expect(fences.find((f) => f.id === 'shop:super_pharm')?.radius_m).toBe(150);
    expect(fences.find((f) => f.id === 'azrieli_tlv')?.radius_m).toBe(azrieli.radius_m);
  });

  it('spends one slot per merchant, on its nearest branch', () => {
    const far = { lat: 32.7866, lng: 35.0209 };
    const fences = nearestFences({
      ...base,
      position: here,
      merchants: [shop('chain', [far, here])],
    });
    const chain = fences.filter((f) => f.id === 'shop:chain');
    expect(chain).toHaveLength(1);
    expect(chain[0]).toMatchObject({ lat: here.lat, lng: here.lng });
  });

  // iOS drops regions past 20 silently, so the cap has to bite here rather than
  // in the OS, and it has to drop the furthest rather than an arbitrary 20.
  it('keeps the nearest when more places exist than slots', () => {
    const merchants = Array.from({ length: 30 }, (_, i) =>
      shop(`m${i}`, [{ lat: here.lat + i * 0.001, lng: here.lng }]),
    );
    const fences = nearestFences({ ...base, position: here, merchants, limit: 5 });
    expect(fences).toHaveLength(5);
    expect(fences.map((f) => f.id)).toEqual([
      'shop:m0',
      'shop:m1',
      'shop:m2',
      'shop:m3',
      'shop:m4',
    ]);
  });

  it('cannot fence a merchant with no branch coordinates', () => {
    const fences = nearestFences({ ...base, position: here, merchants: [shop('nowhere', [])] });
    expect(fences.map((f) => f.id)).toEqual(['azrieli_tlv']);
  });
});
