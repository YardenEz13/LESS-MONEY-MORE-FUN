import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import {
  DEFAULT_NOTIFICATION_POLICY,
  rankBenefits,
  shouldNotifyForVenue,
  toLocalMoment,
  venuesContaining,
  type DwellState,
  type Venue,
} from '@sbr/core';
import { benefitsAtVenue, ownedProgramIds, venuesById, venues } from './catalog';
import { notifyVenue } from './notifications';
import { canGeofenceInBackground } from './runtime';
import { loadProfile } from '../state/profile';

export const GEOFENCE_TASK = 'sbr-venue-geofence';
const DWELL_KEY = 'sbr.dwell.v1';

type DwellMap = Record<string, DwellState>;

async function readDwell(): Promise<DwellMap> {
  try {
    const raw = await AsyncStorage.getItem(DWELL_KEY);
    return raw ? (JSON.parse(raw) as DwellMap) : {};
  } catch {
    return {};
  }
}

async function writeDwell(map: DwellMap): Promise<void> {
  await AsyncStorage.setItem(DWELL_KEY, JSON.stringify(map));
}

/**
 * Decide whether entering a venue is worth a push, and send it if so.
 *
 * Exported separately from the task registration so the decision path can be
 * driven from the debug screen without waiting to physically walk into a mall.
 */
export async function handleVenueEnter(venueId: string, now: number = Date.now()): Promise<void> {
  const venue = venuesById.get(venueId);
  if (!venue) return;

  const profile = await loadProfile();
  if (!profile.notifications_enabled || profile.program_ids.length === 0) return;

  const dwell = await readDwell();
  // Re-entering a fence we're already inside (GPS drift) must not restart the
  // dwell clock, or the timer never matures.
  const state: DwellState = dwell[venueId] ?? { venueId, enteredAt: now };
  const nowDate = new Date(now);

  // Channel is deliberately left unset: standing in a mall says nothing about
  // whether the user will buy in-store or on their phone, and guessing would
  // promote an online-only benefit to "eligible".
  const evaluations = rankBenefits(benefitsAtVenue(venueId), {
    now: nowDate,
    ownedProgramIds: ownedProgramIds(profile.program_ids),
    mutedBenefitIds: profile.muted_benefit_ids,
  });

  const decision = shouldNotifyForVenue({
    state,
    now,
    localMinutes: toLocalMoment(nowDate).minutes,
    matchCount: evaluations.length,
    policy: DEFAULT_NOTIFICATION_POLICY,
  });

  if (decision.notify) {
    const sent = await notifyVenue({
      venueId,
      venueName: venue.name,
      evaluations: evaluations.slice(0, 5),
    });
    if (sent) state.notifiedAt = now;
  }

  dwell[venueId] = state;
  await writeDwell(dwell);
}

/**
 * Minutes since the geofence saw you enter this venue, or null if it never did.
 *
 * The match clock on the home screen reads from here rather than from when the
 * user tapped a venue in the picker: "6’" has to mean six minutes standing in
 * the mall, which is the thing the notification policy is counting too. A
 * manually pinned venue has no entry event and so gets no minute, which is the
 * honest answer rather than a zero.
 */
export async function dwellMinutes(
  venueId: string,
  now: number = Date.now(),
): Promise<number | null> {
  const dwell = await readDwell();
  const enteredAt = dwell[venueId]?.enteredAt;
  // `enteredAt: 0` is the exit marker written above, not the epoch.
  if (!enteredAt) return null;
  return Math.max(0, Math.floor((now - enteredAt) / 60_000));
}

export async function handleVenueExit(venueId: string): Promise<void> {
  const dwell = await readDwell();
  // Keep `notifiedAt` so the cooldown survives leaving and coming back;
  // clear the dwell clock so the next visit has to earn its own timer.
  const previous = dwell[venueId];
  if (previous) {
    dwell[venueId] = { venueId, enteredAt: 0, notifiedAt: previous.notifiedAt };
    await writeDwell(dwell);
  }
}

TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[geofence] task error', error.message);
    return;
  }
  const { eventType, region } = data as {
    eventType: Location.GeofencingEventType;
    region: Location.LocationRegion;
  };
  if (!region.identifier) return;

  if (eventType === Location.GeofencingEventType.Enter) {
    await handleVenueEnter(region.identifier);
  } else {
    await handleVenueExit(region.identifier);
  }
});

export type GeofenceStartResult =
  | { ok: true; venueCount: number }
  | {
      ok: false;
      reason:
        | 'services_disabled'
        | 'foreground_denied'
        | 'background_denied'
        | 'runtime_unsupported';
    };

/**
 * Register every venue as a native geofence. The OS does the watching — we
 * never poll location ourselves, which is what keeps this from being a
 * battery problem.
 *
 * Order matters on Android: the background prompt is only allowed to appear
 * after foreground has been granted, and asking in the other order silently
 * returns denied.
 */
export async function startGeofencing(): Promise<GeofenceStartResult> {
  // Expo Go has no Android background location at all and only Simulator
  // support on iOS. Asking for permissions we cannot honour trains the user to
  // grant something that then does nothing.
  if (!canGeofenceInBackground) return { ok: false, reason: 'runtime_unsupported' };

  if (!(await Location.hasServicesEnabledAsync())) {
    return { ok: false, reason: 'services_disabled' };
  }

  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) return { ok: false, reason: 'foreground_denied' };

  const background = await Location.requestBackgroundPermissionsAsync();
  if (!background.granted) return { ok: false, reason: 'background_denied' };

  // Re-registering an already-running task throws on Android.
  await stopGeofencing();

  // ponytail: iOS monitors at most 20 regions and silently ignores the rest;
  // Android's ceiling is 100. Ten venues fits both. If the venue list ever
  // outgrows this, register only the nearest 20 to the user instead of the
  // whole catalog — the failure mode otherwise is a fence that never fires and
  // no error anywhere.
  if (venues.length > 20) {
    console.warn(`[geofence] ${venues.length} venues — iOS will only monitor 20`);
  }

  await Location.startGeofencingAsync(
    GEOFENCE_TASK,
    venues.map((venue) => ({
      identifier: venue.id,
      latitude: venue.lat,
      longitude: venue.lng,
      radius: venue.radius_m,
      notifyOnEnter: true,
      notifyOnExit: true,
    })),
  );
  return { ok: true, venueCount: venues.length };
}

export type WhereAmI =
  | { ok: true; venue: Venue | null }
  | { ok: false; reason: 'services_disabled' | 'foreground_denied' | 'unavailable' };

/**
 * One-shot "which mall am I standing in", using only foreground permission.
 *
 * This is the half of location that works everywhere — Expo Go included, and
 * on a phone whose owner refused background access. Background geofencing can
 * wake the app when it is closed; this cannot, but it needs far less from the
 * user, so the home screen can still say something true about where they are.
 */
export async function currentVenue(): Promise<WhereAmI> {
  try {
    if (!(await Location.hasServicesEnabledAsync())) {
      return { ok: false, reason: 'services_disabled' };
    }
    const foreground = await Location.requestForegroundPermissionsAsync();
    if (!foreground.granted) return { ok: false, reason: 'foreground_denied' };

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const here = { lat: position.coords.latitude, lng: position.coords.longitude };
    return { ok: true, venue: venuesContaining(here, venues)[0] ?? null };
  } catch {
    // A GPS fix can simply fail — indoors, airplane mode, emulator with no
    // location set. That is not the same as a refusal, and the caller offers a
    // manual picker either way.
    return { ok: false, reason: 'unavailable' };
  }
}

export async function stopGeofencing(): Promise<void> {
  try {
    if (await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK)) {
      await Location.stopGeofencingAsync(GEOFENCE_TASK);
    }
  } catch {
    // Nothing to stop is the same outcome as stopping it.
  }
}

/**
 * Is a fence currently armed?
 *
 * Never throws. expo-location has no geofencing on web at all — the native
 * module simply lacks the method — so an unguarded call rejected on every web
 * load and aborted the caller's startup sequence partway through. "Cannot ask"
 * and "not running" lead to the same UI either way.
 */
export async function isGeofencingActive(): Promise<boolean> {
  try {
    return await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
  } catch {
    return false;
  }
}
