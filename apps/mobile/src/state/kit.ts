import AsyncStorage from '@react-native-async-storage/async-storage';
import type { KitIntensity } from '../theme';

const STORAGE_KEY = 'sbr.kit.v1';

/**
 * How loud the kit is, kept deliberately out of `UserProfile`.
 *
 * The profile is the zero-auth user model — the clubs you hold and the benefits
 * you muted — and it is the thing `services/advisor.ts` is allowed to send. A
 * display preference has no business travelling with it, and adding a field to
 * the shared schema in `@sbr/core` to store "stripes on/off" would put a
 * rendering decision inside the one type the privacy promise is written about.
 * Its own key, its own file.
 */
export async function loadKitIntensity(): Promise<KitIntensity> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw === 'quiet' ? 'quiet' : 'full';
  } catch {
    return 'full';
  }
}

export async function saveKitIntensity(intensity: KitIntensity): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, intensity);
}
