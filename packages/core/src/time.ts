export const DEFAULT_TIME_ZONE = 'Asia/Jerusalem';

export interface LocalMoment {
  /** 1 = Sunday ... 7 = Saturday. */
  day: number;
  /** Minutes since local midnight. */
  minutes: number;
}

const WEEKDAY_TO_INDEX: Record<string, number> = {
  Sun: 1,
  Mon: 2,
  Tue: 3,
  Wed: 4,
  Thu: 5,
  Fri: 6,
  Sat: 7,
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * Resolve a UTC instant into the local weekday/time used by benefit conditions.
 * Conditions in Israeli T&C are always written in local wall-clock terms, so
 * every day/hour comparison has to go through here rather than through
 * Date#getDay, which would use the device's timezone.
 */
export function toLocalMoment(date: Date, timeZone: string = DEFAULT_TIME_ZONE): LocalMoment {
  const parts = formatterFor(timeZone).formatToParts(date);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return {
    day: WEEKDAY_TO_INDEX[weekday] ?? 1,
    // Intl can emit "24" for midnight in some ICU versions.
    minutes: (hour % 24) * 60 + minute,
  };
}

export function parseTimeOfDay(value: string): number {
  const [hours, minutes] = value.split(':');
  return Number(hours) * 60 + Number(minutes);
}

/** Handles windows that wrap past midnight (e.g. 22:00 -> 02:00). */
export function isWithinHours(nowMinutes: number, from: string, to: string): boolean {
  const start = parseTimeOfDay(from);
  const end = parseTimeOfDay(to);
  if (start === end) return true;
  if (start < end) return nowMinutes >= start && nowMinutes <= end;
  return nowMinutes >= start || nowMinutes <= end;
}

export function daysSince(isoDate: string, now: Date): number {
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - then) / 86_400_000;
}
