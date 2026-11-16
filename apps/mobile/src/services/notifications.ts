import * as Notifications from 'expo-notifications';
import type { Evaluation } from '@sbr/core';
import { formatVenueNotification } from '@sbr/core';
import { programNames } from './catalog';
import { logEvent } from '../state/events';
import { canNotify } from './runtime';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function requestNotificationPermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

/**
 * Fire the venue push. Returns false when there was nothing worth saying —
 * the caller has already applied the dwell/cooldown/quiet-hours gate in
 * `shouldNotifyForVenue`, this is the last check that we aren't sending an
 * empty notification.
 */
export async function notifyVenue(input: {
  venueId: string;
  venueName: string;
  evaluations: readonly Evaluation[];
  /** Hold the reminder this long before delivering. Omitted or 0 fires now. */
  delayMs?: number;
}): Promise<string | null> {
  const content = formatVenueNotification(input.venueName, input.evaluations, programNames);
  if (!content) return null;

  const seconds = Math.round((input.delayMs ?? 0) / 1000);
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: content.title,
      body: content.body,
      data: { venueId: input.venueId },
    },
    // Letting the OS hold the reminder is what makes the dwell threshold real.
    // Nothing in this app is running three minutes after a geofence enter
    // event, so an immediate send could only ever fire at zero dwell — the
    // gate could not wait, it could only refuse.
    trigger:
      seconds > 0
        ? {
            type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            seconds,
            repeats: false,
          }
        : null,
  });
  // ponytail: counted when armed, not when delivered, so a cancelled
  // drive-through still logs one. A scheduled local notification has no fire
  // callback; route it through the received listener if the KPI needs to be exact.
  await logEvent({ kind: 'notification_sent', venueId: input.venueId });
  return id;
}

/** Withdraw a reminder that was armed but never earned — see `handleVenueExit`. */
export async function cancelVenueNotification(id: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // Already delivered, or already gone: the same outcome either way.
  }
}

/**
 * Fire a watch alert now. Returns false when it could not be delivered, so the
 * caller does not record an alert that never reached the lock screen — the
 * next check then tries again instead of the drop being silently spent.
 *
 * Permission is only checked, never asked for here: this runs from a periodic
 * check, and a permission dialog nobody expected is worse than a missed alert.
 * The geofence switch in onboarding is where the dialog lives.
 */
export async function notifyWatch(input: {
  watchId: string;
  title: string;
  body: string;
}): Promise<boolean> {
  if (!canNotify) return false;
  try {
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) return false;
    await Notifications.scheduleNotificationAsync({
      content: { title: input.title, body: input.body, data: { watchId: input.watchId } },
      trigger: null,
    });
    return true;
  } catch {
    return false;
  }
}
