import type { Benefit } from './types';
import type { Evaluation } from './matching';
import { isUpperBound, offerKey, REFERENCE_BASKET_ILS } from './matching';

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

/** One-tap basket amounts offered at the till and on the roll. */
export const BASKET_PRESETS_ILS = [50, 100, 200, 350] as const;

export interface BasketSaving {
  cartAmount: number;
  /** ILS saved at this basket size (0 when below `min_spend`). */
  savingIls: number;
  /** Net ILS left to pay at the till after this single benefit. */
  netPayIls: number;
  /** Positive when the cart is short of `conditions.min_spend`. */
  missingForMinSpend: number;
  /** True when `conditions.max_discount` capped the saving. */
  capped: boolean;
  /** True when the saving is an estimate (upper-bound "עד X%" or 1+1). */
  isEstimate: boolean;
  /** True specifically when the T&C states an upper bound ("עד X%"). */
  isUpperBound: boolean;
}

export interface TillBasketPlan {
  single: BasketSaving;
  /** Best 2-club combo pairing this benefit at `cartAmount` that beats `single`, or null. */
  bestCombo: Combo | null;
}

function roundIls(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Exact shekel saving for one benefit against a known basket amount.
 *
 * Honest by design: below `min_spend` yields ₪0 with the exact shortfall,
 * fixed/gift-card amounts never exceed the basket, caps are respected, and
 * "עד X%" / 1+1 stay flagged as estimates rather than promises.
 */
export function calculateBasketSaving(benefit: Benefit, cartAmount: number): BasketSaving {
  const basket = Number.isFinite(cartAmount) && cartAmount > 0 ? cartAmount : 0;
  const minSpend = benefit.conditions.min_spend ?? 0;
  const upperBound = isUpperBound(benefit);

  if (basket <= 0) {
    return {
      cartAmount: 0,
      savingIls: 0,
      netPayIls: 0,
      missingForMinSpend: minSpend > 0 ? roundIls(minSpend) : 0,
      capped: false,
      isEstimate: upperBound || benefit.type === 'bogo',
      isUpperBound: upperBound,
    };
  }

  if (minSpend > 0 && basket < minSpend) {
    return {
      cartAmount: roundIls(basket),
      savingIls: 0,
      netPayIls: roundIls(basket),
      missingForMinSpend: roundIls(minSpend - basket),
      capped: false,
      isEstimate: upperBound || benefit.type === 'bogo',
      isUpperBound: upperBound,
    };
  }

  let raw = 0;
  let capped = false;
  let isEstimate = upperBound;

  switch (benefit.type) {
    case 'percent':
    case 'cashback': {
      raw = (basket * benefit.value) / 100;
      const cap = benefit.conditions.max_discount;
      if (cap != null && raw > cap) {
        raw = cap;
        capped = true;
      }
      break;
    }
    case 'fixed':
    case 'gift_card':
      raw = Math.min(benefit.value, basket);
      break;
    case 'bogo':
      raw = basket / 2;
      isEstimate = true;
      break;
    default:
      raw = 0;
  }

  const savingIls = roundIls(Math.min(Math.max(0, raw), basket));
  const netPayIls = roundIls(Math.max(0, basket - savingIls));
  return {
    cartAmount: roundIls(basket),
    savingIls,
    netPayIls,
    missingForMinSpend: 0,
    capped,
    isEstimate,
    isUpperBound: upperBound,
  };
}

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
      evaluation.benefit.conditions.stacks_with_club !== false &&
      // When the real basket is known, never pair an offer whose min spend is unmet.
      (cartAmount === undefined || (evaluation.benefit.conditions.min_spend ?? 0) <= cartAmount),
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
      // One offer listed under two programs does not stack with itself, and a
      // ceiling has no saving to add. Both reached the top of the list as
      // "confirmed", which is the most expensive thing a combo can get wrong.
      if (offerKey(a.benefit) === offerKey(b.benefit)) continue;
      if (isUpperBound(a.benefit) || isUpperBound(b.benefit)) continue;

      const saving = Math.min(
        applyInOrder([a.benefit, b.benefit], basket),
        applyInOrder([b.benefit, a.benefit], basket),
      );
      if (saving <= 0) continue;
      // Saving the whole sample basket says the basket does not fit the deal (a
      // ₪1600 appliance offer), not that the purchase comes out free.
      if (isEstimate && saving >= basket) continue;

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

/**
 * Live till calculation for a chosen benefit and basket size: exact single-card
 * saving plus the best 2-club stack that includes this benefit and saves more.
 */
export function optimizeTillBasket(
  evaluation: Evaluation,
  allEvaluations: readonly Evaluation[],
  cartAmount: number,
): TillBasketPlan {
  const single = calculateBasketSaving(evaluation.benefit, cartAmount);
  if (cartAmount <= 0 || single.missingForMinSpend > 0 || evaluation.status === 'blocked') {
    return { single, bestCombo: null };
  }

  const seen = new Set<string>([evaluation.benefit.id]);
  const pool: Evaluation[] = [evaluation];
  for (const candidate of allEvaluations) {
    if (seen.has(candidate.benefit.id)) continue;
    seen.add(candidate.benefit.id);
    pool.push(candidate);
  }

  const combos = findCombos(pool, { cartAmount }).filter(
    (combo) =>
      combo.parts.some((p) => p.benefit.id === evaluation.benefit.id) &&
      combo.estimatedSavingIls > single.savingIls,
  );
  return { single, bestCombo: combos[0] ?? null };
}
