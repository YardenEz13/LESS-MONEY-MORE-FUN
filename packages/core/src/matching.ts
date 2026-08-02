import type { Benefit } from './types.js';
import { DEFAULT_TIME_ZONE, daysSince, isWithinHours, toLocalMoment } from './time.js';

export type EvalChannel = 'in_store' | 'online';

export interface FreshnessPolicy {
  /** Older than this -> show an "unverified recently" warning. */
  agingDays: number;
  /** Older than this -> never surface proactively. */
  staleDays: number;
}

export const DEFAULT_FRESHNESS: FreshnessPolicy = { agingDays: 14, staleDays: 45 };

/**
 * Minimum confidence for a benefit to be surfaced without human review.
 * Anything below goes to the review queue in the extraction pipeline; if it
 * still reaches a client, we refuse to show it. KPI #2 (zero condition-level
 * false positives) depends on both gates.
 */
export const DEFAULT_MIN_CONFIDENCE = 0.85;

/** Basket size assumed only for *ranking* when the real cart is unknown. */
export const REFERENCE_BASKET_ILS = 250;

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

export interface Evaluation {
  benefit: Benefit;
  status: EvalStatus;
  blockers: Blocker[];
  requirements: Requirement[];
  /** Estimated ILS saved. `isEstimate` is true when the cart amount was unknown. */
  estimatedSavingIls: number;
  isEstimate: boolean;
  ageDays: number;
}

const DAY_NAMES_HE = ['', 'א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'שבת'];

function formatDays(days: readonly number[]): string {
  return days.map((d) => DAY_NAMES_HE[d] ?? String(d)).join(', ');
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
  } else if (ageDays > freshness.agingDays) {
    requirements.push({
      code: 'aging_data',
      message: `אומת לאחרונה לפני ${Math.floor(ageDays)} ימים — כדאי לוודא בקופה`,
    });
  }

  if (benefit.valid_from && new Date(benefit.valid_from) > ctx.now) {
    blockers.push({ code: 'not_yet_valid', message: 'ההטבה עדיין לא נכנסה לתוקף' });
  }
  if (benefit.valid_until) {
    const until = new Date(benefit.valid_until);
    const daysLeft = (until.getTime() - ctx.now.getTime()) / 86_400_000;
    if (until < ctx.now) {
      blockers.push({ code: 'expired', message: 'תוקף ההטבה פג' });
    } else if (daysLeft <= 7) {
      requirements.push({
        code: 'ends_soon',
        message: `בתוקף עד ${until.toLocaleDateString('he-IL', { timeZone })}`,
      });
    }
  }

  const local = toLocalMoment(ctx.now, timeZone);
  if (conditions.valid_days && !conditions.valid_days.includes(local.day)) {
    blockers.push({
      code: 'wrong_day',
      message: `תקף בימים ${formatDays(conditions.valid_days)} בלבד`,
    });
  }
  if (conditions.valid_hours) {
    const { from, to } = conditions.valid_hours;
    if (!isWithinHours(local.minutes, from, to)) {
      blockers.push({ code: 'wrong_hours', message: `תקף בין ${from} ל-${to} בלבד` });
    }
  }

  if (conditions.channel && conditions.channel !== 'both') {
    const channelLabel = conditions.channel === 'online' ? 'באונליין' : 'בסניפים';
    if (ctx.channel && ctx.channel !== conditions.channel) {
      blockers.push({ code: 'wrong_channel', message: `תקף ${channelLabel} בלבד` });
    } else if (!ctx.channel) {
      requirements.push({ code: 'channel_restricted', message: `תקף ${channelLabel} בלבד` });
    }
  }

  if (conditions.min_spend != null && conditions.min_spend > 0) {
    if (ctx.cartAmount == null) {
      requirements.push({
        code: 'min_spend_unknown',
        message: `בקנייה מעל ${shekels(conditions.min_spend)}`,
      });
    } else if (ctx.cartAmount < conditions.min_spend) {
      blockers.push({
        code: 'below_min_spend',
        message: `דרוש מינימום ${shekels(conditions.min_spend)} (חסרים ${shekels(
          conditions.min_spend - ctx.cartAmount,
        )})`,
      });
    }
  }

  if (conditions.max_discount != null) {
    requirements.push({
      code: 'max_discount_cap',
      message: `תקרת הנחה ${shekels(conditions.max_discount)}`,
    });
  }
  if (conditions.requires_voucher) {
    requirements.push({ code: 'requires_voucher', message: 'יש להנפיק שובר באתר המועדון מראש' });
  }
  if (conditions.exclusions?.length) {
    requirements.push({
      code: 'has_exclusions',
      message: `לא כולל: ${conditions.exclusions.join(', ')}`,
    });
  }
  if (conditions.stacks_with_club === false) {
    requirements.push({ code: 'no_stacking', message: 'אין כפל מבצעים עם מועדון החנות' });
  } else if (conditions.stacks_with_club == null) {
    requirements.push({ code: 'stacking_unknown', message: 'כפל מבצעים לא מצוין בתקנון' });
  }
  if (conditions.usage_limit) {
    requirements.push({ code: 'usage_limited', message: conditions.usage_limit });
  }

  const { value, isEstimate } = estimateSaving(benefit, ctx.cartAmount);

  return {
    benefit,
    status: blockers.length > 0 ? 'blocked' : requirements.length > 0 ? 'conditional' : 'eligible',
    blockers,
    requirements,
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
      const statusRank = (s: EvalStatus) => (s === 'eligible' ? 0 : s === 'conditional' ? 1 : 2);
      const byStatus = statusRank(a.status) - statusRank(b.status);
      if (byStatus !== 0) return byStatus;
      const byValue = b.estimatedSavingIls - a.estimatedSavingIls;
      if (byValue !== 0) return byValue;
      // Tie-break on freshness so the better-verified row wins deterministically.
      return a.ageDays - b.ageDays;
    });
  return limit != null ? evaluations.slice(0, limit) : evaluations;
}
