import type { Venue } from './types.js';

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

export interface DwellState {
  venueId: string;
  enteredAt: number;
  notifiedAt?: number;
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
