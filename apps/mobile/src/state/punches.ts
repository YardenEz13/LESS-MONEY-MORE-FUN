import { useMemo, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'sbr.punches.v1';

/** `${benefitId}:${gateCode}` → the local day it was punched. */
type Punches = Record<string, string>;

/**
 * The device's own calendar day. Not `toISOString()`: that is UTC, and in Israel
 * it flips at 02:00 or 03:00, so a voucher punched at midnight would last hours.
 */
function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

/**
 * One store for every screen, so a punch on the advisor's ticket shows on the
 * roll too. Module state, because it is a single small map the whole app shares.
 */
let punches: Punches = {};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

void AsyncStorage.getItem(STORAGE_KEY)
  .then((raw) => {
    const all = raw ? (JSON.parse(raw) as Punches) : {};
    // Old days are dropped on the way in, so the store never outgrows one day.
    punches = Object.fromEntries(Object.entries(all).filter(([, at]) => at === today()));
    emit();
  })
  .catch(() => {});

/** A second punch on the same hole takes it back. */
function punch(key: string): void {
  const next = { ...punches };
  if (next[key] === today()) delete next[key];
  else next[key] = today();
  punches = next;
  emit();
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Steps punched today. A punch holds for the day it was made: yesterday's
 * voucher proves nothing now.
 */
export function usePunches(): { doneSteps: string[]; punched: ReadonlySet<string>; punch: (key: string) => void } {
  const current = useSyncExternalStore(subscribe, () => punches);
  return useMemo(() => {
    const day = today();
    const doneSteps = Object.keys(current).filter((key) => current[key] === day);
    return { doneSteps, punched: new Set(doneSteps), punch };
  }, [current]);
}
