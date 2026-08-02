import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import {
  DEFAULT_NOTIFICATION_POLICY,
  rankBenefits,
  shouldNotifyForVenue,
  toLocalMoment,
  type DwellState,
} from '@sbr/core';
import { benefitsAtVenue, venuesById, venues } from './catalog';
import { notifyVenue } from './notifications';
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
    ownedProgramIds: profile.program_ids,
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
  | { ok: false; reason: 'foreground_denied' | 'background_denied' };

/**
 * Register every venue as a native geofence. The OS does the watching — we
 * never poll location ourselves, which is what keeps this from being a
 * battery problem.
 */
export async function startGeofencing(): Promise<GeofenceStartResult> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) return { ok: false, reason: 'foreground_denied' };

  const background = await Location.requestBackgroundPermissionsAsync();
  if (!background.granted) return { ok: false, reason: 'background_denied' };

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

export async function stopGeofencing(): Promise<void> {
  if (await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK)) {
    await Location.stopGeofencingAsync(GEOFENCE_TASK);
  }
}

export async function isGeofencingActive(): Promise<boolean> {
  return Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
}
