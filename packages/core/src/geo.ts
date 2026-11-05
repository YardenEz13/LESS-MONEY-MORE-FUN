import type { Merchant, Venue } from './types';

export interface Coordinates {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_000;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

export function distanceMeters(a: Coordinates, b: Coordinates): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isInsideVenue(position: Coordinates, venue: Venue): boolean {
  return distanceMeters(position, venue) <= venue.radius_m;
}

/** All venues containing the position, nearest first (malls can overlap). */
export function venuesContaining(position: Coordinates, venues: readonly Venue[]): Venue[] {
  return venues
    .filter((venue) => isInsideVenue(position, venue))
    .sort((a, b) => distanceMeters(position, a) - distanceMeters(position, b));
}

/**
 * Merchants with a branch within `radiusM` of a point, nearest branch first.
 *
 * This replaces the `venue_ids` join everywhere it mattered. That join asked
 * "did a human type this mall's id onto this merchant", which for 92% of the
 * catalog was no, so standing inside a correctly-firing geofence produced an
 * empty list. This asks where the shop actually is.
 *
 * ponytail: linear scan over every branch. ~4k coordinates, called on a
 * location fix, not per frame — a spatial index earns its keep somewhere north
 * of 100k.
 */
export function merchantsNear(
  position: Coordinates,
  merchants: readonly Merchant[],
  radiusM: number,
): Merchant[] {
  const hits: { merchant: Merchant; distance: number }[] = [];
  for (const merchant of merchants) {
    const nearest = nearestBranch(position, merchant);
    if (nearest && nearest.distanceM <= radiusM) {
      hits.push({ merchant, distance: nearest.distanceM });
    }
  }
  return hits.sort((a, b) => a.distance - b.distance).map((h) => h.merchant);
}

/** One of a merchant's physical locations. */
export type Branch = Merchant['branches'][number];

/**
 * The branch of this merchant closest to a point, or null when it has none.
 *
 * Null is a real answer, not a failure: 19 of 1057 merchants arrived without a
 * single coordinate, and they can be listed but never located. Every caller
 * that asks "how far is this shop" has to be able to say "we do not know"
 * rather than fall back to zero, which would read as "you are standing in it".
 */
export function nearestBranch(
  position: Coordinates,
  merchant: Merchant,
): { branch: Branch; distanceM: number } | null {
  let best: { branch: Branch; distanceM: number } | null = null;
  for (const branch of merchant.branches) {
    const distanceM = distanceMeters(position, branch);
    if (!best || distanceM < best.distanceM) best = { branch, distanceM };
  }
  return best;
}

/** Prefix marking a fence around a single shop rather than a whole complex. */
export const SHOP_FENCE_PREFIX = 'shop:';

/** A region to hand the OS. `id` is a venue id, or `shop:<merchantId>`. */
export interface Fence {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius_m: number;
}

/**
 * The regions worth monitoring from where the user is standing, nearest first.
 *
 * Both platforms cap how many regions an app may monitor — iOS at 20, and it
 * silently ignores the rest rather than failing, which is the worst way to
 * learn about a limit. So the set has to be chosen rather than dumped: the ten
 * malls alone contain 6% of catalogued branches, and monitoring only those is
 * why walking into a shop on a high street never reminded anyone of anything.
 *
 * One fence per merchant, at its nearest branch. A second branch of the same
 * chain further away would spend a slot on a place the user is demonstrably not
 * at, and the whole point of the cap is that slots are scarce.
 *
 * Position-relative, so this has to be recomputed when the user has moved — see
 * the caller. A merchant with no branch coordinates simply cannot be fenced.
 */
export function nearestFences(input: {
  position: Coordinates;
  venues: readonly Venue[];
  merchants: readonly Merchant[];
  limit: number;
  /** Radius for a single shop. A mall carries its own. */
  shopRadiusM: number;
}): Fence[] {
  const candidates: { fence: Fence; distance: number }[] = [];

  for (const venue of input.venues) {
    candidates.push({
      fence: {
        id: venue.id,
        name: venue.name,
        lat: venue.lat,
        lng: venue.lng,
        radius_m: venue.radius_m,
      },
      distance: distanceMeters(input.position, venue),
    });
  }

  for (const merchant of input.merchants) {
    const nearest = nearestBranch(input.position, merchant);
    if (!nearest) continue;
    candidates.push({
      fence: {
        id: `${SHOP_FENCE_PREFIX}${merchant.id}`,
        name: merchant.name,
        lat: nearest.branch.lat,
        lng: nearest.branch.lng,
        radius_m: input.shopRadiusM,
      },
      distance: nearest.distanceM,
    });
  }

  return candidates
    .sort((a, b) => a.distance - b.distance)
    .slice(0, input.limit)
    .map((c) => c.fence);
}

export interface DwellState {
  venueId: string;
  /** When this visit began, or 0 — the marker `dwellOnExit` writes for "not inside". */
  enteredAt: number;
  /**
   * When the reminder for this venue lands. A timestamp in the future means one
   * is armed and pending, which is what stops a second one being stacked.
   */
  notifiedAt?: number;
  /** OS handle for a reminder armed but not yet delivered. */
  scheduledId?: string;
}

/**
 * The dwell record a fresh enter event should work from.
 *
 * `enteredAt: 0` is the exit marker, not a timestamp, and reading it back as a
 * live entry is what broke the gate: `now - 0` is about fifty years, so it
 * cleared a three-minute threshold instantly and every visit after the first
 * exit notified on the doorstep. `dwellMinutes` already treated 0 as absent;
 * the enter path did not, and one reader honouring a sentinel the other ignores
 * is the whole bug.
 *
 * A returning visitor starts a fresh clock but keeps the cooldown the previous
 * visit earned, so leaving and walking back in cannot buy a second reminder.
 */
export function dwellOnEnter(
  previous: DwellState | undefined,
  venueId: string,
  now: number,
): DwellState {
  if (previous?.enteredAt) return previous;
  return { venueId, enteredAt: now, notifiedAt: previous?.notifiedAt };
}

/**
 * The dwell record after leaving, plus any reminder that has to be withdrawn.
 *
 * A reminder still in the future never happened — the user left before the
 * dwell matured — so it is cancelled and the cooldown handed back. Without that
 * a drive-past would arm a reminder, cancel it, and still silence the venue for
 * twelve hours having shown nothing. A reminder already delivered keeps its
 * cooldown, which is what makes leaving and returning quiet.
 */
export function dwellOnExit(
  previous: DwellState,
  now: number,
): { next: DwellState; cancelId?: string } {
  const pending =
    previous.scheduledId != null && previous.notifiedAt != null && now < previous.notifiedAt;
  return {
    next: {
      venueId: previous.venueId,
      enteredAt: 0,
      notifiedAt: pending ? undefined : previous.notifiedAt,
    },
    cancelId: pending ? previous.scheduledId : undefined,
  };
}

export interface NotificationPolicy {
  /** Ignore drive-throughs: only notify after the user has stayed this long. */
  minDwellMs: number;
  /** Never notify about the same venue more than once inside this window. */
  cooldownMs: number;
  /** Quiet hours in local minutes-from-midnight; notifications are suppressed inside. */
  quietHours?: { fromMinutes: number; toMinutes: number };
}

export const DEFAULT_NOTIFICATION_POLICY: NotificationPolicy = {
  minDwellMs: 3 * 60_000,
  cooldownMs: 12 * 60 * 60_000,
  quietHours: { fromMinutes: 22 * 60, toMinutes: 8 * 60 },
};

export type NotificationDecision =
  | { notify: true }
  | { notify: false; reason: 'dwell_too_short' | 'cooldown' | 'quiet_hours' | 'nothing_to_show' };

/**
 * Gate for venue notifications. Geofence callbacks are noisy -- GPS drift alone
 * can re-fire an enter event repeatedly -- so entering a mall is necessary but
 * not sufficient for a push.
 */
export function shouldNotifyForVenue(input: {
  state: DwellState;
  now: number;
  localMinutes: number;
  matchCount: number;
  policy?: NotificationPolicy;
}): NotificationDecision {
  const policy = input.policy ?? DEFAULT_NOTIFICATION_POLICY;
  if (input.matchCount <= 0) return { notify: false, reason: 'nothing_to_show' };
  if (input.now - input.state.enteredAt < policy.minDwellMs) {
    return { notify: false, reason: 'dwell_too_short' };
  }
  if (input.state.notifiedAt != null && input.now - input.state.notifiedAt < policy.cooldownMs) {
    return { notify: false, reason: 'cooldown' };
  }
  const quiet = policy.quietHours;
  if (quiet) {
    const { fromMinutes, toMinutes } = quiet;
    const inQuiet =
      fromMinutes < toMinutes
        ? input.localMinutes >= fromMinutes && input.localMinutes < toMinutes
        : input.localMinutes >= fromMinutes || input.localMinutes < toMinutes;
    if (inQuiet) return { notify: false, reason: 'quiet_hours' };
  }
  return { notify: true };
}
