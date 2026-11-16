import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';
import { DEFAULT_WATCH_POLICY, PricePoint, WatchItem, productKey } from '@sbr/core';

const STORAGE_KEY = 'sbr.watch.v1';
/** Enough for months of one reading per 6 hours, and still a few dozen KB. */
const MAX_POINTS_PER_ITEM = 120;
const DAY_MS = 86_400_000;

const Stored = z.object({
  items: z.array(WatchItem).default([]),
  /** Keyed by watch id. */
  history: z.record(z.string(), z.array(PricePoint)).default({}),
  /** Epoch ms of each watch alert sent — only the last day matters, see `recordAlert`. */
  alerts: z.array(z.number()).default([]),
  /** Epoch ms of the last page read per watch id, kept even when the page said nothing. */
  checked: z.record(z.string(), z.number()).default({}),
  /** Why the last page read of a watch gave no price, so the list can say which. */
  unreadable: z.record(z.string(), z.enum(['fetch_failed', 'no_price'])).default({}),
});
export type WatchStore = z.infer<typeof Stored>;

const empty = (): WatchStore => ({ items: [], history: {}, alerts: [], checked: {}, unreadable: {} });

/**
 * The watchlist, entirely on the device: the items, the prices this phone read
 * for them, and when it last alerted. Nothing here is ever sent anywhere — see
 * the privacy note in `profile.ts`.
 *
 * Unreadable storage returns an empty list, like the profile does: a watchlist
 * we cannot parse is not worth a crash on launch, and adding items back takes
 * a paste.
 */
export async function loadWatchStore(): Promise<WatchStore> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return empty();
    return Stored.parse(JSON.parse(raw));
  } catch {
    return empty();
  }
}

/**
 * Every write is read-modify-write through one queue. The foreground check, a
 * background task and a tap on "pause" can all land within the same second, and
 * two interleaved read-modify-writes would silently drop one of them.
 */
let queue: Promise<unknown> = Promise.resolve();
function mutate<T>(change: (store: WatchStore) => T): Promise<T> {
  const run = queue.then(async () => {
    const store = await loadWatchStore();
    const result = change(store);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

export interface NewWatch {
  title: string;
  url?: string | null;
  merchantId?: string | null;
  size?: string | null;
  color?: string | null;
  targetPrice?: number | null;
  /** The merchant's offers right now, so only later ones count as news. */
  seenBenefitIds?: string[];
}

/**
 * Add an item, or return the one already watching the same product page.
 * `existing` tells the caller which happened.
 */
export function addWatch(
  input: NewWatch,
  now: Date = new Date(),
): Promise<{ item: WatchItem; existing: boolean }> {
  return mutate((store) => {
    const key = input.url ? productKey(input.url) : null;
    const dupe = key ? store.items.find((i) => i.url && productKey(i.url) === key) : undefined;
    if (dupe) return { item: dupe, existing: true };
    const item: WatchItem = WatchItem.parse({
      id: `w_${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      title: input.title.trim() || 'מוצר ללא שם',
      url: input.url ?? null,
      merchant_id: input.merchantId ?? null,
      size: input.size?.trim() || null,
      color: input.color?.trim() || null,
      target_price: input.targetPrice ?? null,
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + DEFAULT_WATCH_POLICY.expiryDays * DAY_MS).toISOString(),
      paused: false,
      seen_benefit_ids: input.seenBenefitIds ?? [],
    });
    store.items.unshift(item);
    return { item, existing: false };
  });
}

/** Change fields of one item. `change` receives the current item, so it can build on it. */
export function updateWatch(id: string, change: (item: WatchItem) => WatchItem): Promise<void> {
  return mutate((store) => {
    store.items = store.items.map((item) => (item.id === id ? WatchItem.parse(change(item)) : item));
  });
}

export function removeWatch(id: string): Promise<void> {
  return mutate((store) => {
    store.items = store.items.filter((item) => item.id !== id);
    delete store.history[id];
    delete store.checked[id];
    delete store.unreadable[id];
  });
}

/** Record a successful page read. */
export function appendPricePoint(id: string, point: PricePoint, at: number): Promise<void> {
  return mutate((store) => {
    store.history[id] = [...(store.history[id] ?? []), point].slice(-MAX_POINTS_PER_ITEM);
    store.checked[id] = at;
    delete store.unreadable[id];
  });
}

/** Record that the page was fetched but said no price (or could not be fetched). */
export function markUnreadable(
  id: string,
  at: number,
  reason: 'fetch_failed' | 'no_price',
): Promise<void> {
  return mutate((store) => {
    store.checked[id] = at;
    store.unreadable[id] = reason;
  });
}

/** An alert was sent: log it for the daily cap and remember it on the item. */
export function recordAlert(id: string | null, at: number, price?: number | null): Promise<void> {
  return mutate((store) => {
    // Older than a day is useless to the cap, so the list never grows.
    store.alerts = [...store.alerts.filter((t) => at - t < DAY_MS), at];
    if (id && price !== undefined) {
      store.items = store.items.map((item) =>
        item.id === id ? { ...item, last_alert: { at: new Date(at).toISOString(), price } } : item,
      );
    }
  });
}

/** Add offer ids an item has now shown, so each offer alerts once. */
export function markOffersSeen(id: string, benefitIds: readonly string[]): Promise<void> {
  return mutate((store) => {
    store.items = store.items.map((item) =>
      item.id === id
        ? { ...item, seen_benefit_ids: [...new Set([...item.seen_benefit_ids, ...benefitIds])] }
        : item,
    );
  });
}
