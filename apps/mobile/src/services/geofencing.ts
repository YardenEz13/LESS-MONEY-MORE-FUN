import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import {
  DEFAULT_NOTIFICATION_POLICY,
  distanceMeters,
  dwellOnEnter,
  dwellOnExit,
  hiddenBenefitIds,
  nearestFences,
  rankBenefits,
  shouldNotifyForVenue,
  toLocalMoment,
  venuesContaining,
  type Coordinates,
  type DwellState,
  type Fence,
  type Venue,
} from '@sbr/core';
import { benefits, merchants, ownedProgramIds, placeAt, venues } from './catalog';
import { cancelVenueNotification, notifyVenue } from './notifications';
import { canGeofenceInBackground } from './runtime';
import { loadProfile } from '../state/profile';

export const GEOFENCE_TASK = 'sbr-venue-geofence';
const DWELL_KEY = 'sbr.dwell.v1';

type DwellMap = Record<string, DwellState>;

const LAST_KEY = 'sbr.lastGeoEvent.v1';

export interface LastGeoEvent {
  at: number;
  venueId: string;
  /** What the decision path did with this fence event. */
  outcome:
    | 'armed'
    | 'already_armed'
    | 'unknown_place'
    | 'notifications_off'
    | 'no_clubs'
    | 'nothing_to_show'
    | 'cooldown'
    | 'quiet_hours'
    | 'dwell_too_short'
    | 'empty_message';
}

/**
 * The last fence event and what became of it. Kept so "it did not notify me
 * today" can be answered from the phone: no event at all means the OS never
 * woke the app (fence set, permissions, battery); an outcome means it did and
 * this is the rule that held it back.
 */
async function recordEvent(venueId: string, outcome: LastGeoEvent['outcome']): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_KEY, JSON.stringify({ at: Date.now(), venueId, outcome }));
  } catch {
    // A diagnostic must never break the path it describes.
  }
}

export async function lastGeoEvent(): Promise<LastGeoEvent | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_KEY);
    return raw ? (JSON.parse(raw) as LastGeoEvent) : null;
  } catch {
    return null;
  }
}

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
 * Decide whether entering a fenced place is worth a push, and send it if so.
 *
 * `venueId` is any fence identifier — a mall id, or `shop:<merchantId>` since
 * the fence set stopped being malls-only. The name is kept because the dwell
 * records, the notification payload and the KPI events all key on `venueId`,
 * and renaming the parameter alone would leave the code half-telling the truth.
 *
 * Exported separately from the task registration so the decision path can be
 * driven from the debug screen without waiting to physically walk into a mall.
 */
export async function handleVenueEnter(venueId: string, now: number = Date.now()): Promise<void> {
  const place = placeAt(venueId);
  if (!place) return void (await recordEvent(venueId, 'unknown_place'));

  const profile = await loadProfile();
  if (!profile.notifications_enabled) return void (await recordEvent(venueId, 'notifications_off'));
  if (profile.program_ids.length === 0) return void (await recordEvent(venueId, 'no_clubs'));

  const dwell = await readDwell();
  // Re-entering a fence we're already inside (GPS drift) must not restart the
  // dwell clock, or the timer never matures.
  const state: DwellState = dwellOnEnter(dwell[venueId], venueId, now);

  // Already armed for this visit: a drift re-entry must not stack a second
  // reminder for the same doorway.
  if (state.scheduledId && state.notifiedAt != null && now < state.notifiedAt) {
    return void (await recordEvent(venueId, 'already_armed'));
  }

  const policy = DEFAULT_NOTIFICATION_POLICY;
  // The reminder is judged at the moment it would land, not the moment the
  // fence fired, and the OS holds it until then. Before this, the dwell gate
  // could only mature if a *second* enter event happened to arrive three
  // minutes later — which Android supplies by GPS drift and iOS never does,
  // because Core Location reports a boundary crossing once. An iPhone that
  // walked into a mall and stayed was silent forever.
  const fireAt = now + policy.minDwellMs;
  const fireDate = new Date(fireAt);

  // Channel is deliberately left unset: standing in a mall says nothing about
  // whether the user will buy in-store or on their phone, and guessing would
  // promote an online-only benefit to "eligible".
  const evaluations = rankBenefits(place.benefits, {
    now: fireDate,
    ownedProgramIds: ownedProgramIds(profile.program_ids),
    mutedBenefitIds: hiddenBenefitIds(profile),
  });

  const decision = shouldNotifyForVenue({
    state,
    now: fireAt,
    localMinutes: toLocalMoment(fireDate).minutes,
    matchCount: evaluations.length,
    policy,
  });

  if (decision.notify) {
    const scheduledId = await notifyVenue({
      venueId,
      venueName: place.name,
      evaluations: evaluations.slice(0, 5),
      delayMs: policy.minDwellMs,
    });
    if (scheduledId) {
      state.scheduledId = scheduledId;
      // Cooldown runs from when the reminder lands. A future timestamp here is
      // also what marks this visit as already armed, above.
      state.notifiedAt = fireAt;
      await recordEvent(venueId, 'armed');
    } else {
      await recordEvent(venueId, 'empty_message');
    }
  } else {
    await recordEvent(venueId, decision.reason);
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

export async function handleVenueExit(venueId: string, now: number = Date.now()): Promise<void> {
  const dwell = await readDwell();
  const previous = dwell[venueId];
  if (!previous) return;

  // Keep `notifiedAt` so a delivered reminder's cooldown survives leaving and
  // coming back; clear the dwell clock so the next visit earns its own timer.
  // A reminder still pending is withdrawn instead, and gives the cooldown back.
  const { next, cancelId } = dwellOnExit(previous, now);
  if (cancelId) await cancelVenueNotification(cancelId);
  dwell[venueId] = next;
  await writeDwell(dwell);
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

  const fences = await fencesToMonitor();
  await Location.startGeofencingAsync(
    GEOFENCE_TASK,
    fences.map((fence) => ({
      identifier: fence.id,
      latitude: fence.lat,
      longitude: fence.lng,
      radius: fence.radius_m,
      notifyOnEnter: true,
      notifyOnExit: true,
    })),
  );
  return { ok: true, venueCount: fences.length };
}

/**
 * iOS monitors at most 20 regions and silently drops the rest — no error, no
 * callback, just fences that never fire. Android allows 100. Twenty is the
 * number that is true on both.
 */
const MAX_FENCES = 20;

/** A single shop is a doorway, not a complex; a mall carries its own radius. */
const SHOP_FENCE_RADIUS_M = 150;

/**
 * Which regions to arm, from wherever the user last was.
 *
 * Uses the cached position when there is one, since a fence set only has to be
 * right for the neighbourhood. A first run usually has none, and falling straight
 * to the ten malls left a new install watching no shop at all, so that one case
 * waits briefly for a real fix. Still nothing falls back to the malls.
 *
 * Only merchants with something usable for this profile. The nearest twenty of
 * any kind were mostly shops whose rows had aged out or belong to clubs the user
 * does not hold: each fired into nothing, while their actual Super-Pharm, a few
 * streets past the twentieth, was never watched.
 */
async function fencesToMonitor(): Promise<Fence[]> {
  const mallsOnly = venues.map((venue) => ({
    id: venue.id,
    name: venue.name,
    lat: venue.lat,
    lng: venue.lng,
    radius_m: venue.radius_m,
  }));
  try {
    const last = (await Location.getLastKnownPositionAsync()) ?? (await positionWithin(FIX_TIMEOUT_MS));
    if (!last) {
      await AsyncStorage.removeItem(FENCE_ORIGIN_KEY);
      return mallsOnly;
    }
    const position = { lat: last.coords.latitude, lng: last.coords.longitude };
    // Remembered so `refreshFencesIfMoved` can tell whether this set still
    // describes where the user is.
    await AsyncStorage.setItem(FENCE_ORIGIN_KEY, JSON.stringify(position));
    const profile = await loadProfile();
    const usable = new Set(
      rankBenefits(benefits, {
        now: new Date(),
        ownedProgramIds: ownedProgramIds(profile.program_ids),
        mutedBenefitIds: hiddenBenefitIds(profile),
      }).map((e) => e.benefit.merchant_id),
    );
    return nearestFences({
      position,
      venues,
      merchants: merchants.filter((m) => usable.has(m.id)),
      limit: MAX_FENCES,
      shopRadiusM: SHOP_FENCE_RADIUS_M,
    });
  } catch {
    return mallsOnly;
  }
}

const FENCE_ORIGIN_KEY = 'sbr.fenceOrigin.v1';

/**
 * Far enough from where the fences were chosen that they describe someone
 * else's neighbourhood. The twenty nearest shops in Tel Aviv all sit inside a
 * kilometre, so five is comfortably past "the set is now wrong" without
 * re-registering every time someone crosses town for lunch.
 */
const FENCE_REFRESH_DISTANCE_M = 5_000;

/**
 * Re-pick the fences if the user has moved away from where they were chosen.
 *
 * The fence set is position-relative, and nothing else recomputes it while the
 * app is alive — a phone can sit backgrounded for weeks. Without this, someone
 * who moves city keeps twenty fences around their old one and the reminder goes
 * quiet with every permission still granted, which is the exact failure
 * `resumeGeofencing` exists to prevent, one level up.
 *
 * Reads only the cached position, so this is free to call on every foreground
 * and can never raise a dialog or spin up the GPS.
 */
export async function refreshFencesIfMoved(): Promise<boolean> {
  if (!canGeofenceInBackground) return false;
  if (!(await isGeofencingActive())) return false;
  try {
    const [raw, last] = await Promise.all([
      AsyncStorage.getItem(FENCE_ORIGIN_KEY),
      Location.getLastKnownPositionAsync(),
    ]);
    if (!last) return false;
    const here = { lat: last.coords.latitude, lng: last.coords.longitude };
    // No stored origin means the fences are the mall fallback, registered
    // before any fix existed. A position now is strictly better than that.
    const origin = raw ? (JSON.parse(raw) as Coordinates) : null;
    if (origin && distanceMeters(origin, here) < FENCE_REFRESH_DISTANCE_M) return false;
    const result = await startGeofencing();
    return result.ok;
  } catch {
    return false;
  }
}

/**
 * How long to wait for a fresh GPS fix before falling back to the cached one.
 *
 * `getCurrentPositionAsync` has no timeout of its own and does not give up:
 * indoors — which is exactly where a mall is — it can hang for minutes or never
 * resolve at all, and the caller is sitting on a spinner the whole time. Six
 * seconds is about as long as someone will hold a phone up waiting.
 */
const FIX_TIMEOUT_MS = 6_000;

/**
 * A position, or null if the device could not produce one in time.
 *
 * The cached fix is a real answer, not a consolation: a mall is 250m across and
 * a fix from a few minutes ago still names it correctly. Returning nothing
 * because the fresh fix was slow throws away a coordinate we already had.
 */
async function positionWithin(timeoutMs: number): Promise<Location.LocationObject | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  const fresh = await Promise.race([
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null),
    deadline,
  ]);
  clearTimeout(timer);
  if (fresh) return fresh;
  return Location.getLastKnownPositionAsync().catch(() => null);
}

export type WhereAmI =
  | { ok: true; venue: Venue | null; here: Coordinates }
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

    const position = await positionWithin(FIX_TIMEOUT_MS);
    if (!position) return { ok: false, reason: 'unavailable' };
    const here = { lat: position.coords.latitude, lng: position.coords.longitude };
    // The coordinate is returned alongside the venue because being in no mall
    // is the common case — 94% of catalogued branches are on a street — and the
    // caller can still answer "what is near me" from the point itself.
    return { ok: true, venue: venuesContaining(here, venues)[0] ?? null, here };
  } catch {
    // A GPS fix can simply fail — indoors, airplane mode, emulator with no
    // location set. That is not the same as a refusal, and the caller offers a
    // manual picker either way.
    return { ok: false, reason: 'unavailable' };
  }
}

/**
 * Re-arm the fence on launch if the user already granted everything it needs.
 *
 * A registered geofence does not survive forever: a reboot, an app update or
 * the OS reclaiming background work all drop the task, and nothing re-registers
 * it because `startGeofencing` only ever ran from onboarding and the settings
 * button. The user granted "always" weeks ago, sees no prompt and no error, and
 * the reminder has simply stopped — the worst shape of broken, because it looks
 * identical to working.
 *
 * Uses the `get` permission calls, never the `request` ones: this runs on every
 * cold start, and a launch that opens a permission dialog out of nowhere is its
 * own bug. No grant yet means do nothing and leave the asking to the button.
 */
export async function resumeGeofencing(): Promise<boolean> {
  if (!canGeofenceInBackground) return false;
  if (await isGeofencingActive()) return true;
  try {
    const [foreground, background] = await Promise.all([
      Location.getForegroundPermissionsAsync(),
      Location.getBackgroundPermissionsAsync(),
    ]);
    if (!foreground.granted || !background.granted) return false;
    const result = await startGeofencing();
    return result.ok;
  } catch {
    return false;
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
