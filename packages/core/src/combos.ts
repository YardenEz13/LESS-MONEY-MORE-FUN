import type { Benefit } from './types';
import type { Evaluation } from './matching';
import { REFERENCE_BASKET_ILS } from './matching';

/**
 * Stacking two benefits on one purchase — "₪150 gift card *and* 1% cashback",
 * "30% off *then* the voucher".
 *
 * Two rules keep this honest, and they are the whole reason this file is more
 * than a sum:
 *
 * 1. **Silence is not permission.** A combo is `confirmed` only when both
 *    benefits explicitly say stacking is allowed. If either T&C is silent, the
 *    pair is still shown — people do ask at the till — but it is marked
 *    unconfirmed and its saving is labelled as a possibility, never a promise.
 *    If either explicitly forbids stacking, the pair is not offered at all.
 *
 * 2. **Order changes the answer, and we do not know the order.** 30% off ₪500
 *    then a ₪150 voucher saves ₪300; the voucher first then 30% saves ₪255.
 *    Shops differ and the T&C rarely says. So we compute both orderings and
 *    report the *worse* one — the same rule the condition engine uses, where an
 *    unknown is never resolved in the benefit's favour.
 */

/**
 * Merchant id for a benefit that applies everywhere — a flat cashback card
 * rather than an offer at one shop. It combines with any merchant's offer.
 */
export const UNIVERSAL_MERCHANT_ID = 'any_merchant';

export interface Combo {
  /** Ordered as displayed: the larger contributor first. */
  parts: [Evaluation, Evaluation];
  merchantName: string;
  /** Conservative estimate — the worse of the two application orders. */
  estimatedSavingIls: number;
  /** True when the cart was unknown and `estimatedSavingIls` used the reference basket. */
  isEstimate: boolean;
  /** True only when both T&Cs explicitly permit stacking. */
  confirmed: boolean;
  /** Why it might not hold. Never empty when `confirmed` is false. */
  caveats: string[];
}

export interface ComboOptions {
  cartAmount?: number;
  limit?: number;
}

/** What one benefit takes off a running amount. */
function savingOn(benefit: Benefit, amount: number): number {
  if (amount <= 0) return 0;
  switch (benefit.type) {
    case 'percent':
    case 'cashback': {
      const raw = (amount * benefit.value) / 100;
      const cap = benefit.conditions.max_discount;
      return cap != null ? Math.min(raw, cap) : raw;
    }
    case 'fixed':
    case 'gift_card':
      // A ₪150 voucher against a ₪100 basket saves ₪100, not ₪150.
      return Math.min(benefit.value, amount);
    default:
      // bogo has no defined interaction with a second offer — excluded upstream.
      return 0;
  }
}

function applyInOrder(order: readonly Benefit[], basket: number): number {
  let remaining = basket;
  let total = 0;
  for (const benefit of order) {
    const saved = savingOn(benefit, remaining);
    total += saved;
    remaining = Math.max(0, remaining - saved);
  }
  return total;
}

/** Combinable at all: same shop, or one of them applies everywhere. */
function sameCounter(a: Benefit, b: Benefit): boolean {
  return (
    a.merchant_id === b.merchant_id ||
    a.merchant_id === UNIVERSAL_MERCHANT_ID ||
    b.merchant_id === UNIVERSAL_MERCHANT_ID
  );
}

/**
 * Find pairs worth stacking, best first.
 *
 * Input is evaluations rather than benefits so that everything already ruled
 * out — muted, expired, wrong day, not owned — is excluded before we start
 * multiplying pairs together.
 */
export function findCombos(
  evaluations: readonly Evaluation[],
  options: ComboOptions = {},
): Combo[] {
  const { cartAmount, limit } = options;
  const isEstimate = cartAmount === undefined;
  const basket = cartAmount ?? REFERENCE_BASKET_ILS;

  const usable = evaluations.filter(
    (evaluation) =>
      evaluation.status !== 'blocked' &&
      evaluation.benefit.type !== 'bogo' &&
      // An explicit "no stacking" is a dead end for every pair it appears in.
      evaluation.benefit.conditions.stacks_with_club !== false,
  );

  const combos: Combo[] = [];
  for (let i = 0; i < usable.length; i += 1) {
    for (let j = i + 1; j < usable.length; j += 1) {
      const a = usable[i]!;
      const b = usable[j]!;
      if (!sameCounter(a.benefit, b.benefit)) continue;
      // Two offers from the same club on one purchase is the case the T&C word
      // "כפל מבצעים" exists to forbid; don't invent it.
      if (a.benefit.program_id === b.benefit.program_id) continue;

      const saving = Math.min(
        applyInOrder([a.benefit, b.benefit], basket),
        applyInOrder([b.benefit, a.benefit], basket),
      );
      if (saving <= 0) continue;

      const caveats: string[] = [];
      for (const part of [a, b]) {
        if (part.benefit.conditions.stacks_with_club == null) {
          caveats.push(`התקנון של ${part.benefit.merchant_name} לא אומר אם מותר כפל`);
        }
      }
      const [first, second] =
        a.estimatedSavingIls >= b.estimatedSavingIls ? [a, b] : [b, a];

      combos.push({
        parts: [first, second],
        // The universal card is not the shop — name the shop.
        merchantName:
          a.benefit.merchant_id === UNIVERSAL_MERCHANT_ID
            ? b.benefit.merchant_name
            : a.benefit.merchant_name,
        estimatedSavingIls: saving,
        isEstimate,
        confirmed: caveats.length === 0,
        caveats,
      });
    }
  }

  combos.sort((x, y) => {
    // A combo you can rely on outranks a bigger one you cannot.
    if (x.confirmed !== y.confirmed) return x.confirmed ? -1 : 1;
    return y.estimatedSavingIls - x.estimatedSavingIls;
  });
  return limit != null ? combos.slice(0, limit) : combos;
}
