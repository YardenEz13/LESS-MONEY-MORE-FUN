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

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const boundaryFormatterCache = new Map<string, Intl.DateTimeFormat>();

/** How far `timeZone` is from UTC at a given instant, in ms. DST-aware. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  let formatter = boundaryFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    boundaryFormatterCache.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(instant)).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - instant;
}

/** The instant local midnight begins on `dateOnly` ("YYYY-MM-DD"). */
function localDayStart(dateOnly: string, timeZone: string): number {
  const naive = Date.parse(`${dateOnly}T00:00:00Z`);
  // Solve twice: the first correction can land on the other side of a DST
  // switch, and re-solving from there settles it.
  let instant = naive - zoneOffsetMs(naive, timeZone);
  instant = naive - zoneOffsetMs(instant, timeZone);
  return instant;
}

/**
 * Turn a bare calendar date into a real instant at the edge of that local day.
 *
 * Israeli T&C write validity as calendar dates — "בתוקף עד 31/12/26" — and a
 * bare `YYYY-MM-DD` is legitimate ISO 8601, so an extraction model returning one
 * is following instructions. It still has to become an instant before it can be
 * compared to `now`.
 *
 * Which edge is not cosmetic. "Valid until the 31st" means through the *end* of
 * the 31st; resolving it to midnight would retire the benefit before its last
 * day had started, hiding something the user genuinely holds for a full day.
 * Start-of-day is right for `valid_from` for the mirror-image reason.
 *
 * Returns null for input that is not a bare date, so callers can pass a full
 * timestamp straight through.
 */
export function dateOnlyToInstant(
  value: string,
  edge: 'start' | 'end',
  timeZone: string = DEFAULT_TIME_ZONE,
): string | null {
  if (!DATE_ONLY.test(value)) return null;
  if (edge === 'start') return new Date(localDayStart(value, timeZone)).toISOString();
  // End of day is the instant before the next local day begins — computed from
  // the next date rather than by adding 24h, so a DST shift stays exact.
  const nextDay = new Date(Date.parse(`${value}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  return new Date(localDayStart(nextDay, timeZone) - 1).toISOString();
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
