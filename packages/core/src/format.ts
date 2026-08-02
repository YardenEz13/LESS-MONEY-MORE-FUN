import type { Evaluation } from './matching';
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
      return { figure: `${benefit.value}%`, unit: 'הנחה' };
    case 'cashback':
      return { figure: `${benefit.value}%`, unit: 'זיכוי' };
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

export function formatSaving(evaluation: Evaluation): string {
  const amount = `₪${Math.round(evaluation.estimatedSavingIls)}`;
  return evaluation.isEstimate ? `חיסכון משוער ${amount}` : `חיסכון ${amount}`;
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
  if (evaluations.length === 0) return null;
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

export function formatLastVerified(benefit: Benefit, now: Date = new Date()): string {
  const days = Math.floor((now.getTime() - new Date(benefit.last_verified_at).getTime()) / 86_400_000);
  if (days <= 0) return 'אומת היום';
  if (days === 1) return 'אומת אתמול';
  return `אומת לפני ${days} ימים`;
}
