import type { Benefit, Program } from './types';
import { DEFAULT_TIME_ZONE, daysSince, isWithinHours, toLocalMoment } from './time';

export type EvalChannel = 'in_store' | 'online';

export interface FreshnessPolicy {
  /** Older than this -> show an "unverified recently" warning. */
  agingDays: number;
  /** Older than this -> never surface proactively. */
  staleDays: number;
}

export const DEFAULT_FRESHNESS: FreshnessPolicy = { agingDays: 14, staleDays: 45 };

/**
 * Has the whole catalog aged out — is the list empty because of the clock
 * rather than because of anything the user chose?
 *
 * The catalog ships inside the app and every benefit carries the date it was
 * verified, so a build that stops receiving updates crosses `staleDays` all at
 * once and `evaluateBenefit` blocks every single row. The screen that results
 * is indistinguishable from "you hold no clubs with offers right now", and the
 * user cannot act on it because the fix is a new catalog, not a new choice.
 *
 * Deliberately "every benefit", not "most": a single fresh row means the app is
 * still working and the empty list has some other cause worth naming instead.
 */
export function catalogIsStale(
  benefits: readonly Benefit[],
  now: Date,
  freshness: FreshnessPolicy = DEFAULT_FRESHNESS,
): boolean {
  if (benefits.length === 0) return false;
  return benefits.every((b) => daysSince(b.last_verified_at, now) > freshness.staleDays);
}

/**
 * Minimum confidence for a benefit to be surfaced without human review.
 * Anything below goes to the review queue in the extraction pipeline; if it
 * still reaches a client, we refuse to show it. KPI #2 (zero condition-level
 * false positives) depends on both gates.
 */
export const DEFAULT_MIN_CONFIDENCE = 0.85;

/** Basket size assumed only for *ranking* when the real cart is unknown. */
export const REFERENCE_BASKET_ILS = 250;

/**
 * Ticking "Cash כאל Pro" also means holding plain כאל.
 *
 * The engine matches a benefit by exact `program_id`, so a card-level program
 * has to contribute its issuer's id too or the user would have to tick both
 * boxes and would silently lose every issuer-wide benefit if they ticked only
 * the card. Done here rather than inside `evaluateBenefit` so the engine keeps
 * taking a flat list of ids and needs no view of the program graph.
 *
 * Walks the chain, so a card under a card under an issuer still resolves, and
 * tolerates a cycle in hand-edited data rather than hanging.
 */
export function expandOwnedPrograms(
  ownedProgramIds: readonly string[],
  programs: readonly Program[],
): string[] {
  const parentOf = new Map(programs.map((p) => [p.id, p.parent_id ?? null]));
  const owned = new Set<string>();
  for (const id of ownedProgramIds) {
    let current: string | null | undefined = id;
    while (current && !owned.has(current)) {
      owned.add(current);
      current = parentOf.get(current);
    }
  }
  return [...owned];
}

export interface EvalContext {
  now: Date;
  ownedProgramIds: readonly string[];
  /** Omit when unknown (e.g. a geofence alert, where we can't know the channel yet). */
  channel?: EvalChannel;
  /** Omit when unknown. Never guess: an unknown cart yields a requirement, not a pass. */
  cartAmount?: number;
  mutedBenefitIds?: readonly string[];
  timeZone?: string;
  freshness?: FreshnessPolicy;
  minConfidence?: number;
}

export type BlockerCode =
  | 'program_not_owned'
  | 'muted'
  | 'not_yet_valid'
  | 'expired'
  | 'wrong_day'
  | 'wrong_hours'
  | 'wrong_channel'
  | 'below_min_spend'
  | 'stale_data'
  | 'low_confidence';

export type RequirementCode =
  | 'min_spend_unknown'
  | 'channel_restricted'
  | 'requires_voucher'
  | 'has_exclusions'
  | 'no_stacking'
  | 'stacking_unknown'
  | 'usage_limited'
  | 'max_discount_cap'
  | 'aging_data'
  | 'ends_soon';

export interface Note<T extends string> {
  code: T;
  /** User-facing Hebrew text. */
  message: string;
}

export type Blocker = Note<BlockerCode>;
export type Requirement = Note<RequirementCode>;

export type EvalStatus =
  /** Every stated condition is known and satisfied right now. */
  | 'eligible'
  /** Nothing is violated, but the user still has to satisfy/verify something. */
  | 'conditional'
  /** A stated condition is violated right now. */
  | 'blocked';

export type GateCode =
  | 'day'
  | 'hours'
  | 'min_spend'
  | 'channel'
  | 'stacking'
  | 'voucher'
  | 'exclusions'
  | 'usage'
  | 'cap'
  | 'freshness'
  | 'validity';

export type GateState =
  /** Stated, checkable, and satisfied right now. */
  | 'met'
  /** Stated, but only the user can settle it (basket size, coupon, exclusions). */
  | 'pending'
  /** Stated and violated right now. */
  | 'blocked';

/**
 * One condition, with the verdict the engine reached on it.
 *
 * `blockers` and `requirements` are what went wrong; a gate is every check
 * that ran, including the ones that passed. The UI needs the passes too — "5
 * conditions, 4 already satisfied, 1 up to you" is a far more useful thing to
 * show at a till than a list of caveats with no denominator.
 */
export interface Gate {
  code: GateCode;
  /** Two or three words — sized for a chip on a card. */
  label: string;
  /** Full sentence — sized for the detail list. */
  detail: string;
  state: GateState;
  /**
   * True when the user can still change the outcome before paying — top up the
   * basket, issue a voucher, switch to the other channel.
   *
   * The rest are caveats: no stacking, excluded categories, a discount cap.
   * They are real and they are shown, but there is nothing to *do* about them,
   * so counting them as outstanding work would make every benefit look
   * conditional and drain the word of meaning.
   */
  actionable: boolean;
}

export interface Evaluation {
  benefit: Benefit;
  status: EvalStatus;
  blockers: Blocker[];
  requirements: Requirement[];
  /** Every stated condition and how it fared. Ordered blocked → pending → met. */
  gates: Gate[];
  /**
   * The subset of gates the user can still act on. Empty means: walk up and
   * pay. This, not `status`, is what the list screen counts — see `Gate`.
   */
  actionsRequired: Gate[];
  /** Estimated ILS saved. `isEstimate` is true when the cart amount was unknown. */
  estimatedSavingIls: number;
  isEstimate: boolean;
  ageDays: number;
}

const DAY_NAMES_HE = ['', 'א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'שבת'];

const dayName = (day: number) => DAY_NAMES_HE[day] ?? String(day);

/**
 * Collapse consecutive days into a range: [1,2,3,4,5] reads "א׳-ה׳", the way a
 * Hebrew T&C writes it, rather than "א׳, ב׳, ג׳, ד׳, ה׳".
 */
function formatDays(days: readonly number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  const groups: string[] = [];
  let start = 0;
  for (let i = 1; i <= sorted.length; i += 1) {
    const isBreak = i === sorted.length || sorted[i]! !== sorted[i - 1]! + 1;
    if (!isBreak) continue;
    const from = sorted[start]!;
    const to = sorted[i - 1]!;
    groups.push(
      to - from >= 2 ? `${dayName(from)}-${dayName(to)}` : sorted.slice(start, i).map(dayName).join(', '),
    );
    start = i;
  }
  return groups.join(', ');
}

function shekels(amount: number): string {
  return `₪${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;
}

/**
 * Estimate the ILS value of a benefit. When the cart amount is unknown we fall
 * back to a reference basket purely so that benefits can be ranked against each
 * other -- the result is flagged with `isEstimate` and the UI must not present
 * it as a promise.
 */
export function estimateSaving(
  benefit: Benefit,
  cartAmount: number | undefined,
): { value: number; isEstimate: boolean } {
  const isEstimate = cartAmount === undefined;
  const basket = cartAmount ?? Math.max(benefit.conditions.min_spend ?? 0, REFERENCE_BASKET_ILS);

  switch (benefit.type) {
    case 'percent':
    case 'cashback': {
      const raw = (basket * benefit.value) / 100;
      const cap = benefit.conditions.max_discount;
      return { value: cap != null ? Math.min(raw, cap) : raw, isEstimate };
    }
    case 'fixed':
    case 'gift_card':
      return { value: benefit.value, isEstimate: false };
    case 'bogo':
      // "1+1" on an unknown basket: assume the cheaper item is half the basket.
      return { value: basket / 2, isEstimate: true };
    default:
      return { value: 0, isEstimate };
  }
}

/**
 * Evaluate one benefit against a context.
 *
 * Design rule: an unknown is never resolved in the benefit's favour. If a
 * condition exists but we cannot check it here (cart size, exclusions, coupon
 * codes), it surfaces as a `requirement` and the status degrades to
 * `conditional` -- so the UI can show the benefit while stating exactly what
 * the user still has to satisfy.
 */
export function evaluateBenefit(benefit: Benefit, ctx: EvalContext): Evaluation {
  const blockers: Blocker[] = [];
  const requirements: Requirement[] = [];
  const gates: Gate[] = [];
  const gate = (
    code: GateCode,
    state: GateState,
    label: string,
    detail: string,
    actionable = false,
  ) => gates.push({ code, state, label, detail, actionable });
  const timeZone = ctx.timeZone ?? DEFAULT_TIME_ZONE;
  const freshness = ctx.freshness ?? DEFAULT_FRESHNESS;
  const minConfidence = ctx.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const { conditions } = benefit;

  if (!ctx.ownedProgramIds.includes(benefit.program_id)) {
    blockers.push({ code: 'program_not_owned', message: 'המועדון לא מסומן בפרופיל שלך' });
  }

  if (ctx.mutedBenefitIds?.includes(benefit.id)) {
    blockers.push({ code: 'muted', message: 'השתקת את ההטבה הזו' });
  }

  if (benefit.confidence_score < minConfidence && !benefit.reviewed_by_human) {
    blockers.push({ code: 'low_confidence', message: 'ההטבה ממתינה לאימות ידני' });
  }

  const ageDays = daysSince(benefit.last_verified_at, ctx.now);
  if (ageDays > freshness.staleDays) {
    blockers.push({
      code: 'stale_data',
      message: `ההטבה לא אומתה מעל ${freshness.staleDays} ימים`,
    });
    gate('freshness', 'blocked', 'לא אומת', `ההטבה לא אומתה מעל ${freshness.staleDays} ימים`);
  } else if (ageDays > freshness.agingDays) {
    requirements.push({
      code: 'aging_data',
      message: `אומת לאחרונה לפני ${Math.floor(ageDays)} ימים — כדאי לוודא בקופה`,
    });
    gate(
      'freshness',
      'pending',
      'אימות ישן',
      `אומת לאחרונה לפני ${Math.floor(ageDays)} ימים — כדאי לוודא בקופה`,
    );
  } else {
    gate('freshness', 'met', 'מאומת', 'אומת בימים האחרונים מול המקור');
  }

  if (benefit.valid_from && new Date(benefit.valid_from) > ctx.now) {
    blockers.push({ code: 'not_yet_valid', message: 'ההטבה עדיין לא נכנסה לתוקף' });
    gate('validity', 'blocked', 'טרם החל', 'ההטבה עדיין לא נכנסה לתוקף');
  }
  if (benefit.valid_until) {
    const until = new Date(benefit.valid_until);
    const daysLeft = (until.getTime() - ctx.now.getTime()) / 86_400_000;
    const untilLabel = until.toLocaleDateString('he-IL', { timeZone });
    if (until < ctx.now) {
      blockers.push({ code: 'expired', message: 'תוקף ההטבה פג' });
      gate('validity', 'blocked', 'פג תוקף', `התוקף פג ב-${untilLabel}`);
    } else if (daysLeft <= 7) {
      requirements.push({ code: 'ends_soon', message: `בתוקף עד ${untilLabel}` });
      gate('validity', 'pending', `עד ${untilLabel}`, `נגמר בקרוב — בתוקף עד ${untilLabel}`);
    } else {
      gate('validity', 'met', 'בתוקף', `בתוקף עד ${untilLabel}`);
    }
  }

  const local = toLocalMoment(ctx.now, timeZone);
  if (conditions.valid_days) {
    const daysLabel = formatDays(conditions.valid_days);
    if (conditions.valid_days.includes(local.day)) {
      gate('day', 'met', daysLabel, `תקף בימים ${daysLabel} — היום נכלל`);
    } else {
      blockers.push({ code: 'wrong_day', message: `תקף בימים ${daysLabel} בלבד` });
      gate('day', 'blocked', daysLabel, `תקף בימים ${daysLabel} בלבד — לא היום`);
    }
  }
  if (conditions.valid_hours) {
    const { from, to } = conditions.valid_hours;
    const hoursLabel = `${from}-${to}`;
    if (isWithinHours(local.minutes, from, to)) {
      gate('hours', 'met', hoursLabel, `תקף בין ${from} ל-${to} — עכשיו בתוך החלון`);
    } else {
      blockers.push({ code: 'wrong_hours', message: `תקף בין ${from} ל-${to} בלבד` });
      gate('hours', 'blocked', hoursLabel, `תקף בין ${from} ל-${to} בלבד — לא עכשיו`);
    }
  }

  if (conditions.channel && conditions.channel !== 'both') {
    const channelLabel = conditions.channel === 'online' ? 'באונליין' : 'בסניפים';
    if (ctx.channel && ctx.channel !== conditions.channel) {
      blockers.push({ code: 'wrong_channel', message: `תקף ${channelLabel} בלבד` });
      gate('channel', 'blocked', channelLabel, `תקף ${channelLabel} בלבד`);
    } else if (!ctx.channel) {
      requirements.push({ code: 'channel_restricted', message: `תקף ${channelLabel} בלבד` });
      // Not actionable: which channel a benefit works in is information, not
      // an errand. It becomes a hard blocker once the channel is known.
      gate('channel', 'pending', channelLabel, `תקף ${channelLabel} בלבד`);
    } else {
      gate('channel', 'met', channelLabel, `תקף ${channelLabel} — זה הערוץ הנוכחי`);
    }
  }

  if (conditions.min_spend != null && conditions.min_spend > 0) {
    const spendLabel = `${shekels(conditions.min_spend)}+`;
    if (ctx.cartAmount == null) {
      requirements.push({
        code: 'min_spend_unknown',
        message: `בקנייה מעל ${shekels(conditions.min_spend)}`,
      });
      gate('min_spend', 'pending', spendLabel, `בקנייה מעל ${shekels(conditions.min_spend)}`, true);
    } else if (ctx.cartAmount < conditions.min_spend) {
      const missing = shekels(conditions.min_spend - ctx.cartAmount);
      blockers.push({
        code: 'below_min_spend',
        message: `דרוש מינימום ${shekels(conditions.min_spend)} (חסרים ${missing})`,
      });
      gate('min_spend', 'blocked', spendLabel, `חסרים ${missing} כדי להגיע למינימום`, true);
    } else {
      gate('min_spend', 'met', spendLabel, `הסל עובר את המינימום של ${shekels(conditions.min_spend)}`);
    }
  }

  if (conditions.max_discount != null) {
    requirements.push({
      code: 'max_discount_cap',
      message: `תקרת הנחה ${shekels(conditions.max_discount)}`,
    });
    gate(
      'cap',
      'pending',
      `עד ${shekels(conditions.max_discount)}`,
      `ההנחה מוגבלת ל-${shekels(conditions.max_discount)}`,
    );
  }
  if (conditions.requires_voucher) {
    requirements.push({ code: 'requires_voucher', message: 'יש להנפיק שובר באתר המועדון מראש' });
    gate('voucher', 'pending', 'שובר מראש', 'יש להנפיק שובר באתר המועדון לפני הרכישה', true);
  }
  if (conditions.exclusions?.length) {
    const detail = `לא כולל: ${conditions.exclusions.join(', ')}`;
    requirements.push({ code: 'has_exclusions', message: detail });
    gate('exclusions', 'pending', 'החרגות', detail);
  }
  if (conditions.stacks_with_club === false) {
    requirements.push({ code: 'no_stacking', message: 'אין כפל מבצעים עם מועדון החנות' });
    gate('stacking', 'pending', 'ללא כפל', 'אין כפל מבצעים עם מועדון החנות');
  } else if (conditions.stacks_with_club == null) {
    requirements.push({ code: 'stacking_unknown', message: 'כפל מבצעים לא מצוין בתקנון' });
    gate('stacking', 'pending', 'כפל?', 'התקנון לא אומר אם יש כפל מבצעים — כדאי לשאול בקופה');
  } else {
    gate('stacking', 'met', 'כפל מותר', 'ניתן לשלב עם מבצעי מועדון החנות');
  }
  if (conditions.usage_limit) {
    requirements.push({ code: 'usage_limited', message: conditions.usage_limit });
    gate('usage', 'pending', 'הגבלת שימוש', conditions.usage_limit);
  }

  const { value, isEstimate } = estimateSaving(benefit, ctx.cartAmount);
  // Blocked first, then what the user still has to do, then the reassurance.
  const gateOrder: Record<GateState, number> = { blocked: 0, pending: 1, met: 2 };

  return {
    benefit,
    status: blockers.length > 0 ? 'blocked' : requirements.length > 0 ? 'conditional' : 'eligible',
    blockers,
    requirements,
    gates: gates.sort((a, b) => gateOrder[a.state] - gateOrder[b.state]),
    actionsRequired: gates.filter((g) => g.state === 'pending' && g.actionable),
    estimatedSavingIls: Math.round(value * 100) / 100,
    isEstimate,
    ageDays: Number.isFinite(ageDays) ? Math.floor(ageDays) : -1,
  };
}

export interface RankOptions {
  /** Drop blocked benefits entirely (default true). */
  hideBlocked?: boolean;
  limit?: number;
}

/**
 * Rank benefits for display. Fully eligible beats conditional at equal value,
 * so a "you definitely have this" card never sits below a "maybe" card.
 */
export function rankBenefits(
  benefits: readonly Benefit[],
  ctx: EvalContext,
  options: RankOptions = {},
): Evaluation[] {
  const { hideBlocked = true, limit } = options;
  const evaluations = benefits
    .map((benefit) => evaluateBenefit(benefit, ctx))
    .filter((evaluation) => (hideBlocked ? evaluation.status !== 'blocked' : true))
    .sort((a, b) => {
      // "Nothing left to do" outranks "one thing to do" at equal value: a
      // card you can act on now should never sit under a card you can't.
      const rank = (e: Evaluation) =>
        e.status === 'blocked' ? 2 : e.actionsRequired.length > 0 ? 1 : 0;
      const byRank = rank(a) - rank(b);
      if (byRank !== 0) return byRank;
      const byValue = b.estimatedSavingIls - a.estimatedSavingIls;
      if (byValue !== 0) return byValue;
      // Tie-break on freshness so the better-verified row wins deterministically.
      return a.ageDays - b.ageDays;
    });
  return limit != null ? evaluations.slice(0, limit) : evaluations;
}
