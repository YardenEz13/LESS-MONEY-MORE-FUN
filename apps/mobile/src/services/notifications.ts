import * as Notifications from 'expo-notifications';
import type { Evaluation } from '@sbr/core';
import { formatVenueNotification } from '@sbr/core';
import { programNames } from './catalog';
import { logEvent } from '../state/events';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
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
}): Promise<boolean> {
  const content = formatVenueNotification(input.venueName, input.evaluations, programNames);
  if (!content) return false;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: content.title,
      body: content.body,
      data: { venueId: input.venueId },
    },
    trigger: null,
  });
  await logEvent({ kind: 'notification_sent', venueId: input.venueId });
  return true;
}
