import { AppState, Platform } from 'react-native';
import type * as BackgroundTaskModule from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import {
  DEFAULT_WATCH_POLICY,
  PricePoint,
  bestBenefitAtPrice,
  evaluateWatch,
  extractProduct,
  formatHeadline,
  formatWatchNotification,
  formatWatchOfferNotification,
  hiddenBenefitIds,
  isWatchExpired,
  newOffersForWatch,
  rankBenefits,
  resolveMerchantFromShare,
  toLocalMoment,
  watchAlertGate,
  type ProductSnapshot,
  type WatchItem,
} from '@sbr/core';
import { benefitsForMerchant, merchants, merchantsById, ownedProgramIds, programNames } from './catalog';
import { notifyWatch } from './notifications';
import { canGeofenceInBackground } from './runtime';
import { loadProfile } from '../state/profile';
import { logEvent } from '../state/events';
import {
  addWatch,
  appendPricePoint,
  loadWatchStore,
  markOffersSeen,
  markUnreadable,
  recordAlert,
} from '../state/watchlist';

/**
 * The second network path in the app, and the narrowest one: the phone fetches
 * the product page the person pasted, from the shop's own site, the way their
 * browser would. The request carries nothing about them — no profile, no
 * watchlist, no identifier — and the response is parsed on the device. See the
 * note in `state/profile.ts`.
 */
const FETCH_TIMEOUT_MS = 15_000;
/** A product page is tens of KB of markup; a multi-MB body is not one. */
const MAX_PAGE_CHARS = 3_000_000;
/** A manual refresh may skip the 6h wait, but not hammer a shop's server. */
const MANUAL_MIN_INTERVAL_MS = 60_000;

export type PageRead =
  | { ok: true; snapshot: ProductSnapshot; point: PricePoint }
  | { ok: false; reason: 'fetch_failed' | 'no_price' };

/**
 * Read a product page from the phone.
 *
 * Never throws. On web this fails on CORS for nearly every shop — that is the
 * browser refusing, not a bug, and it lands as `fetch_failed` like a network
 * error does. The honest user-agent names the app rather than posing as a
 * browser; some shops will refuse it, and that too is `fetch_failed`.
 */
export async function readProductPage(url: string, now: Date = new Date()): Promise<PageRead> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'less-money-more-fun/1.0 (price watch; on-device)', Accept: 'text/html' },
    });
    if (!response.ok) return { ok: false, reason: 'fetch_failed' };
    const html = (await response.text()).slice(0, MAX_PAGE_CHARS);
    const snapshot = extractProduct(html);
    // Alerts are written in shekels; a euro price read as ₪ would be a false
    // drop on a lock screen, so a non-shekel page counts as unreadable.
    if (!snapshot || snapshot.currency !== 'ILS') return { ok: false, reason: 'no_price' };
    const point = PricePoint.parse({
      price: snapshot.price,
      currency: snapshot.currency,
      list_price: snapshot.listPrice,
      in_stock: snapshot.inStock,
      observed_at: now.toISOString(),
      source_url: response.url || url,
    });
    return { ok: true, snapshot, point };
  } catch {
    return { ok: false, reason: 'fetch_failed' };
  } finally {
    clearTimeout(timer);
  }
}

/** The offers a merchant has for this person right now — the baseline a new watch is seeded with. */
export async function currentOfferIds(merchantId: string | null | undefined): Promise<string[]> {
  if (!merchantId) return [];
  const profile = await loadProfile();
  return rankBenefits(benefitsForMerchant(merchantId), {
    now: new Date(),
    ownedProgramIds: ownedProgramIds(profile.program_ids),
    mutedBenefitIds: hiddenBenefitIds(profile),
    channel: 'online',
  }).map((evaluation) => evaluation.benefit.id);
}

/**
 * Start watching a product page: resolve the shop, read the page once for its
 * title and first price, and save. The page read failing does not stop the add —
 * the item is saved and the list says "could not read", which the person can
 * act on; refusing to save would lose the link they just pasted.
 */
export async function addWatchFromUrl(
  url: string,
  extra: { size?: string | null; color?: string | null; targetPrice?: number | null } = {},
): Promise<{ item: WatchItem; existing: boolean; read: PageRead | null }> {
  const resolved = resolveMerchantFromShare(url, merchants);
  const now = new Date();
  const read = await readProductPage(url, now);
  const hostname = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  })();
  const { item, existing } = await addWatch(
    {
      title: (read.ok && read.snapshot.title) || resolved?.merchant.name || hostname,
      url,
      merchantId: resolved?.merchant.id ?? null,
      seenBenefitIds: await currentOfferIds(resolved?.merchant.id),
      ...extra,
    },
    now,
  );
  if (!existing) {
    if (read.ok) await appendPricePoint(item.id, read.point, now.getTime());
    else await markUnreadable(item.id, now.getTime(), read.reason);
    await logEvent({ kind: 'watch_added' });
  }
  return { item, existing, read };
}

let inFlight: Promise<void> | null = null;

/**
 * Check every live watch: read due prices, then send what was earned.
 *
 * Callers share one run — the app coming to the foreground and the watch
 * screen opening fire within the same second, and two runs would both see the
 * same drop as unalerted.
 */
export function checkWatches(now: Date = new Date(), options: { manual?: boolean } = {}): Promise<void> {
  inFlight ??= runChecks(now, options.manual === true)
    .catch(() => undefined) // a failed check must never surface as a crashed app
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

async function runChecks(now: Date, manual: boolean): Promise<void> {
  const interval = manual ? MANUAL_MIN_INTERVAL_MS : DEFAULT_WATCH_POLICY.minCheckIntervalMs;
  const initial = await loadWatchStore();

  for (const { id } of initial.items) {
    const store = await loadWatchStore();
    const item = store.items.find((i) => i.id === id);
    if (!item || item.paused || isWatchExpired(item, now)) continue;

    if (item.url) {
      const last = store.checked[id];
      if (last == null || now.getTime() - last >= interval) {
        const read = await readProductPage(item.url, new Date());
        if (read.ok) await appendPricePoint(id, read.point, now.getTime());
        else await markUnreadable(id, now.getTime(), read.reason);
      }
      await alertForPrice(id, now);
    }
    if (item.merchant_id) await alertForOffers(id, now);
  }
}

/** The gate every watch alert passes: quiet hours and the daily cap, shared across items. */
async function mayAlert(now: Date, sentAt: readonly number[]): Promise<boolean> {
  return watchAlertGate({
    now: now.getTime(),
    localMinutes: toLocalMoment(now).minutes,
    sentAt,
  }).send;
}

async function alertForPrice(id: string, now: Date): Promise<void> {
  const store = await loadWatchStore();
  const item = store.items.find((i) => i.id === id);
  if (!item) return;
  const decision = evaluateWatch(item, store.history[id] ?? [], now);
  if (!decision.alert) return;
  if (!(await mayAlert(now, store.alerts))) return;

  const profile = await loadProfile();
  const stacked = item.merchant_id
    ? bestBenefitAtPrice(
        benefitsForMerchant(item.merchant_id),
        {
          now,
          ownedProgramIds: ownedProgramIds(profile.program_ids),
          mutedBenefitIds: hiddenBenefitIds(profile),
          channel: 'online',
        },
        decision.price,
      )
    : null;
  const content = formatWatchNotification({
    item,
    decision,
    stacked,
    programName: stacked ? (programNames[stacked.evaluation.benefit.program_id] ?? null) : null,
  });
  if (!(await notifyWatch({ watchId: id, ...content }))) return;
  await recordAlert(id, now.getTime(), decision.price);
  await logEvent({ kind: 'watch_alert_sent' });
}

/** One notification per new offer at a watched merchant, through the same gate. */
async function alertForOffers(id: string, now: Date): Promise<void> {
  const store = await loadWatchStore();
  const item = store.items.find((i) => i.id === id);
  if (!item?.merchant_id) return;
  const merchant = merchantsById.get(item.merchant_id);
  if (!merchant) return;

  const profile = await loadProfile();
  const ranked = rankBenefits(benefitsForMerchant(item.merchant_id), {
    now,
    ownedProgramIds: ownedProgramIds(profile.program_ids),
    mutedBenefitIds: hiddenBenefitIds(profile),
    channel: 'online',
  });
  const fresh = newOffersForWatch(item, ranked);
  let sentAt = store.alerts;
  for (const evaluation of fresh) {
    if (!(await mayAlert(now, sentAt))) return; // unsent offers stay unseen, so they alert later
    const content = formatWatchOfferNotification(
      item,
      formatHeadline(evaluation.benefit),
      merchant.name,
      programNames[evaluation.benefit.program_id] ?? evaluation.benefit.program_id,
    );
    if (await notifyWatch({ watchId: id, ...content })) {
      await markOffersSeen(id, [evaluation.benefit.id]);
      await recordAlert(null, now.getTime());
      sentAt = [...sentAt, now.getTime()];
      await logEvent({ kind: 'watch_alert_sent' });
    }
  }
}

/** Run a check whenever the app comes to the foreground. Returns the unsubscribe. */
export function checkWatchesOnForeground(): () => void {
  void checkWatches();
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') void checkWatches();
  });
  return () => subscription.remove();
}

export const WATCH_TASK = 'sbr-watch-check';

/**
 * Periodic check while the app is closed.
 *
 * Needs a native rebuild: `expo-background-task` is a native module and its
 * config plugin is in app.json, so an existing development build has neither.
 * Until then — and on web, and in Expo Go — this does nothing and the foreground
 * checks carry the feature. The OS decides when the task really runs (WorkManager
 * on Android, BGTaskScheduler on iOS, both no more often than every ~15 minutes
 * and usually far less), so the 6-hour page interval is a floor, not a schedule.
 *
 * `TaskManager.defineTask` has to run at module load for the OS to find the task
 * when it wakes the app headless, so it is at the bottom of this file and this
 * module is imported by App.tsx at the top level.
 */
/**
 * The native module, or null on a build that does not contain it.
 *
 * Loaded lazily, never by a top-level import: `expo-background-task` calls
 * `requireNativeModule` at import time, which *throws* when the native side is
 * missing. Catalog refreshes ship as over-the-air updates to builds made before
 * this module existed, and a top-level import would crash every one of them on
 * launch. Here it fails into "foreground checks only" instead.
 */
function backgroundTask(): typeof BackgroundTaskModule | null {
  if (Platform.OS === 'web') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-background-task') as typeof BackgroundTaskModule;
  } catch {
    return null;
  }
}

export async function registerWatchBackgroundTask(): Promise<boolean> {
  if (Platform.OS === 'web' || !canGeofenceInBackground) return false;
  const BackgroundTask = backgroundTask();
  if (!BackgroundTask) return false;
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return false;
    await BackgroundTask.registerTaskAsync(WATCH_TASK, { minimumInterval: 60 });
    return true;
  } catch {
    return false;
  }
}

try {
  const BackgroundTask = backgroundTask();
  if (BackgroundTask) {
    TaskManager.defineTask(WATCH_TASK, async () => {
      try {
        await checkWatches();
        return BackgroundTask.BackgroundTaskResult.Success;
      } catch {
        return BackgroundTask.BackgroundTaskResult.Failed;
      }
    });
  }
} catch {
  // Native module missing (a build from before this was added): foreground only.
}
