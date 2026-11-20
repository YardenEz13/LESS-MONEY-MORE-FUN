import { useMemo, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { localDateKey } from '@sbr/core';

const STORAGE_KEY = 'sbr.punches.v1';

/** `${benefitId}:${gateCode}` → the Israel calendar day ("YYYY-MM-DD") it was punched. */
type Punches = Record<string, string>;

/** Build the stable punch key shared across the roll, detail, and till screens. */
export function punchKey(benefitId: string, gateCode: string): string {
  return `${benefitId}:${gateCode}`;
}

/**
 * Current Israel calendar day ("YYYY-MM-DD").
 *
 * Explicitly uses `Asia/Jerusalem` via `@sbr/core` rather than UTC or the
 * device's local offset, so a voucher punched yesterday expires cleanly at
 * Israel midnight.
 */
function today(): string {
  return localDateKey(new Date());
}

/**
 * One store for every screen, so a punch on the detail screen shows on the
 * roll and till screen too. Module state, because it is a single small map the
 * whole app shares.
 */
let punches: Punches = {};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function dropExpired(all: Punches, day: string): { kept: Punches; changed: boolean } {
  const kept: Punches = {};
  let changed = false;
  for (const [key, at] of Object.entries(all)) {
    if (at === day) kept[key] = at;
    else changed = true;
  }
  return { kept, changed };
}

void AsyncStorage.getItem(STORAGE_KEY)
  .then((raw) => {
    const all = raw ? (JSON.parse(raw) as Punches) : {};
    // Old days are dropped on the way in, so the store never outgrows one day.
    const { kept, changed } = dropExpired(all, today());
    punches = kept;
    if (changed) void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(kept)).catch(() => {});
    emit();
  })
  .catch(() => {});

/**
 * Expire any punches from a previous Israel calendar day.
 * Called when the app returns to the foreground so a session kept alive past
 * midnight does not treat yesterday's voucher as ready today.
 */
export function pruneExpiredPunches(): void {
  const { kept, changed } = dropExpired(punches, today());
  if (!changed) return;
  punches = kept;
  emit();
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(kept)).catch(() => {});
}

/** A second punch on the same hole takes it back. */
function punch(key: string): void {
  const day = today();
  const { kept } = dropExpired(punches, day);
  if (kept[key] === day) delete kept[key];
  else kept[key] = day;
  punches = kept;
  emit();
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(kept)).catch(() => {});
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Steps punched today. A punch holds for the Israel calendar day it was made:
 * yesterday's voucher proves nothing now.
 */
export function usePunches(): { doneSteps: string[]; punched: ReadonlySet<string>; punch: (key: string) => void } {
  const current = useSyncExternalStore(subscribe, () => punches);
  return useMemo(() => {
    const day = today();
    const doneSteps = Object.keys(current).filter((key) => current[key] === day);
    return { doneSteps, punched: new Set(doneSteps), punch };
  }, [current]);
}
