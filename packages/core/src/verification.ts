import { normalizeForSearch } from './search';
import { displayMerchantName } from './format';
import type {
  Benefit,
  Verification,
  VerificationCheck,
  VerificationCheckCode,
  VerificationState,
} from './types';

/**
 * Automatic confirmation: the rules that replace a person reading the queue.
 *
 * Everything here is a pure function of evidence someone else gathered, so the
 * rules can be tested without a network and the runner (`@sbr/extraction`
 * `verify.ts`) stays a thin loop around them.
 *
 * The one design rule, same as the condition engine's: an unknown is never
 * resolved in the offer's favour. A page that would not load, a site that
 * refused us, a shell with no prose — all of those are "could not check", and
 * "could not check" is `unverified`, never `confirmed`.
 */

export interface VerificationPolicy {
  /** Summed weight of passed checks needed to confirm. */
  confirmThreshold: number;
  weights: Record<VerificationCheckCode, number>;
  /** This many till reports, with no fresh page evidence against them, reject. */
  rejectAfterReports: number;
}

/**
 * The weights say what counts as evidence, not how much we like a source.
 *
 * `page_states_value` and `seen_in_recrawl` are the only two that look at the
 * offer itself, so one of them is mandatory (see `decideVerification`) and they
 * carry most of the weight. The rest are support: a page that answers proves
 * the business exists, not that the discount does — which is why reachability
 * alone can never confirm, however the weights are tuned.
 */
export const DEFAULT_VERIFICATION_POLICY: VerificationPolicy = {
  confirmThreshold: 0.6,
  weights: {
    source_reachable: 0.15,
    page_names_merchant: 0.15,
    page_states_value: 0.4,
    seen_in_recrawl: 0.5,
    second_source: 0.15,
    terms_consistent: 0.1,
    user_reports: 0,
  },
  rejectAfterReports: 3,
};

export interface VerificationDecision {
  state: VerificationState;
  score: number;
  /**
   * False when the verdict is `unverified` only because checks could not run.
   * The runner uses it to leave an earlier `confirmed` alone — and ageing —
   * rather than demote an offer because a site was down for an hour.
   */
  conclusive: boolean;
  /** Why, in the order the rules fired. For the audit log. */
  reasons: string[];
}

const outcomeOf = (checks: readonly VerificationCheck[], code: VerificationCheckCode) =>
  checks.find((c) => c.code === code)?.outcome ?? 'unknown';

/** Reports recorded on the `user_reports` check, as a number. */
function reportCount(checks: readonly VerificationCheck[]): number {
  const detail = checks.find((c) => c.code === 'user_reports')?.detail;
  const count = Number(detail);
  return Number.isFinite(count) ? count : 0;
}

export function decideVerification(
  checks: readonly VerificationCheck[],
  policy: VerificationPolicy = DEFAULT_VERIFICATION_POLICY,
): VerificationDecision {
  const reasons: string[] = [];
  const is = (code: VerificationCheckCode, outcome: VerificationCheck['outcome']) =>
    outcomeOf(checks, code) === outcome;

  const score = Math.min(
    1,
    Math.round(
      checks
        .filter((c) => c.outcome === 'pass')
        .reduce((sum, c) => sum + (policy.weights[c.code] ?? 0), 0) * 100,
    ) / 100,
  );

  // Evidence that looks at the offer itself. Without one of these, nothing
  // below can confirm.
  const pageEvidence = is('page_states_value', 'pass');
  const snapshotEvidence = is('seen_in_recrawl', 'pass');
  const reports = reportCount(checks);

  if (is('source_reachable', 'fail')) reasons.push('source page is gone');
  if (is('terms_consistent', 'fail')) reasons.push('terms contradict themselves');
  if (reports >= policy.rejectAfterReports && !pageEvidence) {
    reasons.push(`${reports} reports from the till and no fresh page evidence against them`);
  }
  if (reasons.length > 0) return { state: 'rejected', score, conclusive: true, reasons };

  if (is('page_states_value', 'fail')) reasons.push('page states a different value');
  if (is('page_names_merchant', 'fail')) reasons.push('page does not name the merchant');
  if (is('second_source', 'fail')) reasons.push('two sources disagree on the value');
  if (is('seen_in_recrawl', 'fail')) reasons.push('latest snapshot states a different value');
  if (reports > 0 && !pageEvidence) reasons.push(`${reports} report(s) from the till, not yet disproved`);
  if (reasons.length > 0) return { state: 'unverified', score, conclusive: true, reasons };

  if (!pageEvidence && !snapshotEvidence) {
    return {
      state: 'unverified',
      score,
      conclusive: false,
      reasons: ['no check could read the offer itself'],
    };
  }
  if (score < policy.confirmThreshold) {
    return {
      state: 'unverified',
      score,
      conclusive: false,
      reasons: [`score ${score} is under the ${policy.confirmThreshold} threshold`],
    };
  }
  return {
    state: 'confirmed',
    score,
    conclusive: true,
    reasons: [pageEvidence ? 'page states the offer' : 'dated snapshot states the offer'],
  };
}

/** Thousands separators and the look-alike percent signs a Hebrew page uses. */
function normalizeFigures(text: string): string {
  return text.replace(/(\d)[,٬](?=\d{3}\b)/g, '$1').replace(/[٪﹪％]/g, '%');
}

const number = (value: number) => String(value).replace('.', '\\.');

/**
 * Does this text state the benefit's value?
 *
 *   pass     the figure is there, written as this kind of offer
 *   fail     the text states figures of this kind, and none of them is ours
 *   unknown  the text states no figure of this kind at all — an app shell, a
 *            login wall, an image-only banner. Not evidence either way.
 *
 * `fail` matters as much as `pass`: a page that used to say 15% and now says
 * 10% is the case a link check can never catch, because the link still opens.
 */
export function valueOnPage(
  text: string,
  benefit: Pick<Benefit, 'type' | 'value'>,
): VerificationCheck['outcome'] {
  const body = normalizeFigures(text);
  const v = number(benefit.value);
  switch (benefit.type) {
    case 'percent':
    case 'cashback': {
      // "10%", "% 10" (RTL pages emit both orders), "10 אחוז".
      const ours = new RegExp(`(?<![\\d.])${v}\\s?%|%\\s?${v}(?![\\d.])|(?<![\\d.])${v}\\s?אחוז`);
      if (ours.test(body)) return 'pass';
      return /\d\s?%|%\s?\d|\d\s?אחוז/.test(body) ? 'fail' : 'unknown';
    }
    case 'fixed':
    case 'gift_card': {
      const ours = new RegExp(
        `₪\\s?${v}(?![\\d.])|(?<![\\d.])${v}\\s?(?:₪|ש"ח|ש״ח|שח|שקל)`,
      );
      if (ours.test(body)) return 'pass';
      return /₪\s?\d|\d\s?(?:₪|ש"ח|ש״ח|שח\b|שקל)/.test(body) ? 'fail' : 'unknown';
    }
    case 'bogo':
      // A 1+1 has no figure to contradict, so it can only be seen or not seen.
      return /1\s?\+\s?1|השני(?:ה)? (?:ב)?חינם|אחד פלוס אחד/.test(body) ? 'pass' : 'unknown';
    default:
      return 'unknown';
  }
}

/**
 * Does this text name the merchant?
 *
 * `unknown` under 200 characters: that is an app shell or an error page, and
 * "the name is missing from nothing" says nothing about the offer.
 */
export function merchantOnPage(text: string, merchantName: string): VerificationCheck['outcome'] {
  if (text.trim().length < 200) return 'unknown';
  const haystack = normalizeForSearch(text);
  const names = [merchantName, displayMerchantName(merchantName)]
    .map(normalizeForSearch)
    .filter((n) => n.length >= 2);
  return names.some((n) => haystack.includes(n)) ? 'pass' : 'fail';
}

/**
 * Do the structured terms hold together? Returns the contradiction, or null.
 *
 * These are extraction errors, not expired offers — an offer past its
 * `valid_until` is consistent and merely over, and the condition engine already
 * blocks it by date.
 */
export function termsContradiction(benefit: Benefit): string | null {
  const { conditions: c, type, value } = benefit;
  if ((type === 'percent' || type === 'cashback') && (value <= 0 || value > 100)) {
    return `${value}% is not a discount`;
  }
  if ((type === 'fixed' || type === 'gift_card') && value <= 0) return `₪${value} is not a discount`;
  if (type === 'fixed' && c.min_spend != null && c.min_spend > 0 && value >= c.min_spend) {
    return `₪${value} off a ₪${c.min_spend} minimum`;
  }
  if (c.max_discount != null && type === 'fixed' && c.max_discount < value) {
    return `cap ₪${c.max_discount} is under the ₪${value} discount`;
  }
  if (benefit.valid_from && benefit.valid_until && benefit.valid_until < benefit.valid_from) {
    return 'ends before it starts';
  }
  if (c.valid_hours && c.valid_hours.from === c.valid_hours.to) return 'empty hours window';
  return null;
}

/**
 * Does another source agree? Compares against rows for the same merchant and
 * program that come from a different host.
 *
 * Deliberately narrow. Two programs giving different rates at one shop is not a
 * disagreement, it is two offers; only the same program at the same shop,
 * described twice, can contradict itself.
 */
export function secondSource(benefit: Benefit, catalog: readonly Benefit[]): VerificationCheck {
  const host = (url: string) => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  };
  const mine = host(benefit.source_url);
  const others = catalog.filter(
    (other) =>
      other.id !== benefit.id &&
      other.merchant_id === benefit.merchant_id &&
      other.program_id === benefit.program_id &&
      other.type === benefit.type &&
      host(other.source_url) !== mine,
  );
  if (others.length === 0) return { code: 'second_source', outcome: 'unknown' };
  const agree = others.find((other) => other.value === benefit.value);
  if (agree) return { code: 'second_source', outcome: 'pass', detail: host(agree.source_url) };
  const other = others[0]!;
  return {
    code: 'second_source',
    outcome: 'fail',
    detail: `${host(other.source_url)} says ${other.value}, this says ${benefit.value}`,
  };
}

/** The `Verification` to store on a row, from a decision and its evidence. */
export function toVerification(
  decision: VerificationDecision,
  checks: readonly VerificationCheck[],
  checkedAt: string,
): Verification {
  return { state: decision.state, checked_at: checkedAt, score: decision.score, checks: [...checks] };
}

export interface RunTally {
  /** Rows the run reached a verdict on. */
  checked: number;
  /** Previously shown rows the run would take down: demoted or rejected. */
  takenDown: number;
}

export interface ChangeGuardPolicy {
  /** Below this many rows there is no share worth computing. */
  minSample: number;
  /** A run that would take down more than this share of what it checked stops. */
  maxTakenDownShare: number;
}

export const DEFAULT_CHANGE_GUARD: ChangeGuardPolicy = { minSample: 20, maxTakenDownShare: 0.3 };

/**
 * The stand-in for the person who used to read the diff.
 *
 * One bad run — a site redesign that hides every price, a parser bug — looks
 * exactly like "a third of the catalog just went wrong at once". Real offers do
 * not end in bulk on the same afternoon, so a run that says they did is far
 * more likely to be broken than right, and it must not be allowed to write.
 */
export function changeGuard(
  tally: RunTally,
  policy: ChangeGuardPolicy = DEFAULT_CHANGE_GUARD,
): { ok: true } | { ok: false; reason: string } {
  if (tally.checked < policy.minSample) return { ok: true };
  const share = tally.takenDown / tally.checked;
  if (share <= policy.maxTakenDownShare) return { ok: true };
  return {
    ok: false,
    reason:
      `this run would take down ${tally.takenDown} of ${tally.checked} checked offers ` +
      `(${Math.round(share * 100)}%), over the ${Math.round(policy.maxTakenDownShare * 100)}% cap — ` +
      'more likely a broken check than that many offers ending at once',
  };
}
