import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'sbr.events.v1';
const MAX_EVENTS = 500;

export type InteractionKind =
  | 'notification_sent'
  | 'notification_opened'
  | 'benefit_viewed'
  | 'benefit_redeemed'
  | 'share_resolved'
  | 'share_unmatched';

export interface InteractionEvent {
  kind: InteractionKind;
  at: string;
  benefitId?: string;
  venueId?: string;
  hostname?: string;
}

/**
 * A local-only log, kept because the MVP's KPIs are unmeasurable without it:
 * "30% of notifications led to a detail view or a redeem tap" is a ratio over
 * these rows. It never leaves the device — during the 30-day validation run
 * you read it off the stats screen.
 */
export async function logEvent(event: Omit<InteractionEvent, 'at'>): Promise<void> {
  try {
    const events = await loadEvents();
    const next = [...events, { ...event, at: new Date().toISOString() }].slice(-MAX_EVENTS);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Telemetry must never be the reason a benefit fails to show.
  }
}

export async function loadEvents(): Promise<InteractionEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as InteractionEvent[]) : [];
  } catch {
    return [];
  }
}

export interface Kpis {
  notificationsSent: number;
  notificationsOpened: number;
  redeemed: number;
  shareResolved: number;
  shareUnmatched: number;
  /** KPI #1: share of notifications that led to a detail view or a redeem tap. */
  decisionImpactRatio: number | null;
}

export function computeKpis(events: readonly InteractionEvent[]): Kpis {
  const count = (kind: InteractionKind) => events.filter((e) => e.kind === kind).length;
  const notificationsSent = count('notification_sent');
  const acted = count('notification_opened') + count('benefit_redeemed');
  return {
    notificationsSent,
    notificationsOpened: count('notification_opened'),
    redeemed: count('benefit_redeemed'),
    shareResolved: count('share_resolved'),
    shareUnmatched: count('share_unmatched'),
    decisionImpactRatio: notificationsSent === 0 ? null : acted / notificationsSent,
  };
}

export async function clearEvents(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
