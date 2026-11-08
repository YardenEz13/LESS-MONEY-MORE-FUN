import AsyncStorage from '@react-native-async-storage/async-storage';
import { pruneExpired, type Punches } from '@sbr/core';

const STORAGE_KEY = 'sbr.punches.v1';

/**
 * Steps the user marked done today, per benefit. Device-only, like the profile.
 * Entries expire at local midnight (see `@sbr/core` punches): expired ones are
 * dropped on load and whenever the app returns to the foreground.
 */
export async function loadPunches(now = new Date()): Promise<Punches> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const clean: Punches = {};
    for (const [id, entry] of Object.entries(parsed as Record<string, unknown>)) {
      const e = entry as { day?: unknown; codes?: unknown };
      if (typeof e?.day === 'string' && Array.isArray(e.codes)) {
        clean[id] = { day: e.day, codes: e.codes.filter((c): c is string => typeof c === 'string') };
      }
    }
    return pruneExpired(clean, now);
  } catch {
    // Unreadable punches are cheap to lose: they were going to expire tonight.
    return {};
  }
}

export async function savePunches(punches: Punches): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(punches));
}
