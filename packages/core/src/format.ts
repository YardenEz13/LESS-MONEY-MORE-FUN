import { isUpperBound, type Evaluation, type GateCode } from './matching';
import type { Benefit } from './types';

/**
 * The figure and its unit, split.
 *
 * On a card the size difference between "20%" and "הנחה" is doing the work;
 * setting them as one string makes the number compete with the merchant name
 * for the same space and forces an ugly wrap on the longer types.
 */
export function formatValue(benefit: Benefit): { figure: string; unit: string } {
  switch (benefit.type) {
    case 'percent':
      return { figure: `${isUpperBound(benefit) ? 'עד ' : ''}${benefit.value}%`, unit: 'הנחה' };
    case 'cashback':
      return { figure: `${isUpperBound(benefit) ? 'עד ' : ''}${benefit.value}%`, unit: 'זיכוי' };
    case 'fixed':
      return { figure: `₪${benefit.value}`, unit: 'הנחה' };
    case 'gift_card':
      return { figure: `₪${benefit.value}`, unit: 'מתנה' };
    case 'bogo':
      return { figure: '1+1', unit: 'על הזול' };
    default:
      return { figure: '—', unit: 'הטבה' };
  }
}

/** "15% הנחה" / "₪50 מתנה" / "1+1" — one-line form, for notifications. */
export function formatHeadline(benefit: Benefit): string {
  switch (benefit.type) {
    case 'percent':
      return `${benefit.value}% הנחה`;
    case 'cashback':
      return `${benefit.value}% זיכוי`;
    case 'fixed':
      return `₪${benefit.value} הנחה`;
    case 'gift_card':
      return `₪${benefit.value} מתנה`;
    case 'bogo':
      return '1+1';
    default:
      return 'הטבה';
  }
}

/**
 * The saved figure, or null when there isn't one to state.
 *
 * `estimatedSavingIls` falls back to a reference basket when the cart is
 * unknown — see `estimateSaving`, which exists to rank benefits against each
 * other, not to be read. Rendering that fallback put a number the user never
 * spent on the same plate as the ones they did, under "חיסכון משוער": four
 * different merchants at 10% all read ₪25, which is the assumption talking,
 * not the benefit. A percentage the reader can apply to their own basket beats
 * a shekel figure applied to someone else's, so an estimate returns null and
 * the card falls back to the figure it already shows.
 */
export function formatSaving(evaluation: Evaluation): string | null {
  if (evaluation.isEstimate) return null;
  return `חיסכון ₪${Math.round(evaluation.estimatedSavingIls)}`;
}

/**
 * Copy for a venue push. Keeps it to the two best benefits: the notification
 * is a recall trigger, the detail lives in the app.
 */
export function formatVenueNotification(
  venueName: string,
  evaluations: readonly Evaluation[],
  programNames: Readonly<Record<string, string>>,
): { title: string; body: string } | null {
  // A push is a promise made without the conditions beside it, so it carries
  // only what the verifier could confirm. An unverified offer stays in the
  // list, labelled; it does not get to interrupt someone.
  const shown = evaluations.filter((e) => e.benefit.verification?.state !== 'unverified');
  if (shown.length === 0) return null;
  evaluations = shown;
  const top = evaluations.slice(0, 2).map((evaluation) => {
    const program = programNames[evaluation.benefit.program_id] ?? evaluation.benefit.program_id;
    return `${formatHeadline(evaluation.benefit)} ב${evaluation.benefit.merchant_name} (${program})`;
  });
  const rest = evaluations.length - top.length;
  return {
    title: `אתה ב${venueName}?`,
    body: rest > 0 ? `${top.join(' • ')} ועוד ${rest}` : top.join(' • '),
  };
}

/** Ordered condition lines for the detail view. Blockers first — they matter most. */
export function conditionLines(evaluation: Evaluation): Array<{ tone: 'blocked' | 'note'; text: string }> {
  return [
    ...evaluation.blockers.map((b) => ({ tone: 'blocked' as const, text: b.message })),
    ...evaluation.requirements.map((r) => ({ tone: 'note' as const, text: r.message })),
  ];
}

/**
 * A Latin run: letters, plus the punctuation that lives inside a name — the
 * ampersand in "Golf & Co", the dot in "co.il", the hyphen in "Terminal-X" —
 * and the single spaces between them, so a multi-word name stays one run.
 *
 * Digits are deliberately excluded. A figure belongs to the display face and
 * its tabular figures, so "40%" and "₪119.90" keep the Hebrew face's numerals;
 * only the letters beside them move.
 */
const LATIN_RUN = /[A-Za-z][A-Za-z'’&.\-]*(?: [A-Za-z'’&.\-]+)*/g;

/**
 * Split a label into Latin and non-Latin runs.
 *
 * The catalogue is full of mixed strings — "Cash כאל Pro", "שופרסל LIFE",
 * "סניפי Terminal X" — and the Hebrew face draws Latin in a serif that belongs
 * to no part of this system. Splitting here lets the renderer hand each run the
 * face that suits it; see `Text` in the mobile app's ui.tsx.
 *
 * Returns a single non-Latin run for a string with no Latin in it, so the
 * caller can skip the work when `runs.length === 1 && !runs[0].latin`.
 */
export function latinRuns(text: string): Array<{ text: string; latin: boolean }> {
  const runs: Array<{ text: string; latin: boolean }> = [];
  let last = 0;
  for (const match of text.matchAll(LATIN_RUN)) {
    const at = match.index ?? 0;
    if (at > last) runs.push({ text: text.slice(last, at), latin: false });
    runs.push({ text: match[0], latin: true });
    last = at + match[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), latin: false });
  return runs;
}

export function formatLastVerified(benefit: Benefit, now: Date = new Date()): string {
  const days = Math.floor((now.getTime() - new Date(benefit.last_verified_at).getTime()) / 86_400_000);
  if (days <= 0) return 'אומת היום';
  if (days === 1) return 'אומת אתמול';
  return `אומת לפני ${days} ימים`;
}

/**
 * The name to print on a ticket: "הוט סינמה - HOT CINEMA" and
 * "ספא אקויה | SPA AKOYA" carry the source's separator, which reads as a typo at
 * display size. The full name stays in the catalog and in search.
 */
export function displayMerchantName(name: string): string {
  return name.replace(/\s+[-–—|]\s+.*$/, '') || name;
}

export type HoleState = 'punched' | 'open' | 'bad';

export interface TicketHole {
  code: GateCode;
  label: string;
  state: HoleState;
}

export interface TicketFace {
  state: 'ready' | 'open' | 'blocked';
  /** The answer in words: pay, what is left, or why not. */
  verdict: string;
  /** One or two words for a blocked ticket, null otherwise. */
  stamp: string | null;
  holes: TicketHole[];
}

/**
 * Only conditions with a yes or a no get a hole. Caveats ("no stacking", "excludes
 * tobacco") have nothing to punch, and a hole for each would make every ticket
 * look unfinished; they stay on the detail screen.
 */
const HOLE_CODES: ReadonlySet<GateCode> = new Set<GateCode>([
  'validity',
  'day',
  'hours',
  'channel',
  'min_spend',
  'voucher',
  'eligibility',
  'rate',
  'freshness',
  'verification',
]);

/** The engine's label for `rate` is a bare "עד", which says nothing under a hole. */
const HOLE_LABEL: Partial<Record<GateCode, string>> = { rate: 'תלוי בפריט' };

const STAMP: Partial<Record<GateCode, string>> = {
  freshness: 'לא אומת',
  hours: 'לא עכשיו',
  day: 'לא היום',
  validity: 'פג תוקף',
  channel: 'לא כאן',
  min_spend: 'חסר בסל',
};

/**
 * What a ticket prints, judged by the engine and nothing else. Gates arrive
 * blocked, then pending, then met, so capping the rail drops satisfied conditions
 * first and never hides what stands in the way.
 */
export function ticketFace(
  evaluation: Pick<Evaluation, 'status' | 'gates' | 'blockers' | 'actionsRequired'>,
  maxHoles = 4,
): TicketFace {
  const holes = evaluation.gates
    // Unverified is not an errand, but it is the one caveat the ticket must
    // show without a tap — see the verdict below.
    .filter(
      (g) =>
        HOLE_CODES.has(g.code) &&
        (g.state !== 'pending' || g.actionable || g.code === 'verification'),
    )
    .slice(0, maxHoles)
    .map((g): TicketHole => ({
      code: g.code,
      label: HOLE_LABEL[g.code] ?? g.label,
      state: g.state === 'met' ? 'punched' : g.state === 'pending' ? 'open' : 'bad',
    }));

  if (evaluation.status === 'blocked') {
    const gate = evaluation.gates.find((g) => g.state === 'blocked');
    return {
      state: 'blocked',
      verdict: (gate?.detail ?? evaluation.blockers[0]?.message ?? '').replace(/\s*[—–]\s*/g, ', '),
      stamp: (gate && STAMP[gate.code]) ?? 'לא חל',
      holes,
    };
  }
  const steps = evaluation.actionsRequired;
  // "Pay now" is a claim the verifier could not back. The step left is asking.
  const unproven = evaluation.gates.some((g) => g.code === 'verification' && g.state === 'pending');
  if (steps.length === 0 && unproven) {
    return { state: 'open', verdict: 'לא מאומת — לשאול בקופה', stamp: null, holes };
  }
  if (steps.length === 0) return { state: 'ready', verdict: 'אפשר לשלם', stamp: null, holes };
  return {
    state: 'open',
    verdict: steps.length === 1 ? `עוד צעד: ${steps[0]!.label}` : `עוד ${steps.length} צעדים`,
    stamp: null,
    holes,
  };
}
