import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

/**
 * What this build is actually allowed to do.
 *
 * Expo Go dropped Android push with SDK 53 and never had Android background
 * location, so on Expo Go the geofence reminder is not "off", it is
 * unavailable — a different fact, and the one the user needs told. Without
 * this the app asks for permissions it cannot use and reports success it
 * cannot deliver.
 *
 * The fix for a user seeing `unavailable` is a development build, not a
 * setting: `npx expo run:android` / `run:ios`, or `eas build --profile
 * development`.
 */
export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/** Remote/scheduled notifications: gone from Expo Go on Android since SDK 53. */
export const canNotify = !(isExpoGo && Platform.OS === 'android');

/**
 * Background geofencing. Android in Expo Go has no background location at all;
 * iOS in Expo Go only works in the Simulator, which is not a promise worth
 * making to someone holding a phone.
 */
export const canGeofenceInBackground = !isExpoGo;

/** One line for the UI explaining why, or null when everything is available. */
export function runtimeLimitation(): string | null {
  if (!isExpoGo) return null;
  return Platform.OS === 'android'
    ? 'ב-Expo Go אין מיקום ברקע ואין התראות באנדרואיד — צריך development build'
    : 'ב-Expo Go מיקום ברקע עובד רק בסימולטור — צריך development build';
}
