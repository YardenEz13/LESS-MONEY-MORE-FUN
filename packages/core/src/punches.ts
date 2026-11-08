import type { Evaluation } from './matching';
import { DEFAULT_TIME_ZONE } from './time';

/**
 * Manual punching: the user marks a pending step ("I have the voucher") as done.
 *
 * A punch is a claim about today, not a fact about the benefit: a voucher
 * issued yesterday may be spent, a basket topped up yesterday is gone. So every
 * punch carries the local calendar day it was made and stops counting at
 * midnight (Israel time, the same clock the opening-hours gates use).
 */
export interface PunchEntry {
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string;
  /** Gate codes the user marked done. */
  codes: string[];
}

/** benefit id → that day's punches. */
export type Punches = Record<string, PunchEntry>;

/** `YYYY-MM-DD` of `now` on the local calendar. */
export function localDayKey(now: Date, timeZone = DEFAULT_TIME_ZONE): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Drop every punch made before today. Returns the same object when nothing expired. */
export function pruneExpired(punches: Punches, now: Date, timeZone = DEFAULT_TIME_ZONE): Punches {
  const today = localDayKey(now, timeZone);
  const keys = Object.keys(punches);
  const live = keys.filter((id) => punches[id]!.day === today && punches[id]!.codes.length > 0);
  if (live.length === keys.length) return punches;
  return Object.fromEntries(live.map((id) => [id, punches[id]!]));
}

/** Codes punched today for one benefit. */
export function punchedCodes(
  punches: Punches,
  benefitId: string,
  now: Date,
  timeZone = DEFAULT_TIME_ZONE,
): ReadonlySet<string> {
  const entry = punches[benefitId];
  if (!entry || entry.day !== localDayKey(now, timeZone)) return new Set();
  return new Set(entry.codes);
}

/** Punch or un-punch one gate. */
export function togglePunch(
  punches: Punches,
  benefitId: string,
  code: string,
  now: Date,
  timeZone = DEFAULT_TIME_ZONE,
): Punches {
  const today = localDayKey(now, timeZone);
  const current = punches[benefitId]?.day === today ? punches[benefitId]!.codes : [];
  const codes = current.includes(code) ? current.filter((c) => c !== code) : [...current, code];
  const next = { ...punches };
  if (codes.length === 0) delete next[benefitId];
  else next[benefitId] = { day: today, codes };
  return next;
}

/**
 * Re-read an evaluation with some steps done. Only a pending, actionable gate
 * can be punched: a blocker is not the user's to clear, and a caveat is not a step.
 * Status and blockers are untouched; only the user's own outstanding work shrinks.
 */
export function applyPunches(evaluation: Evaluation, codes: ReadonlySet<string>): Evaluation {
  if (codes.size === 0) return evaluation;
  const punchable = (g: Evaluation['gates'][number]) =>
    g.state === 'pending' && g.actionable && codes.has(g.code);
  if (!evaluation.gates.some(punchable)) return evaluation;
  const gates = evaluation.gates.map((g) => (punchable(g) ? { ...g, state: 'met' as const } : g));
  const order = { blocked: 0, pending: 1, met: 2 } as const;
  gates.sort((a, b) => order[a.state] - order[b.state]);
  return {
    ...evaluation,
    gates,
    actionsRequired: gates.filter((g) => g.state === 'pending' && g.actionable),
  };
}
