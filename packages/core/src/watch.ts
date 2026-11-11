import { z } from 'zod';
import { inQuietHours } from './geo';
import { rankBenefits, type EvalContext, type Evaluation } from './matching';
import type { Benefit } from './types';

/**
 * "Tell me when this goes on sale."
 *
 * The rest of the engine answers "what can I use here"; this answers "when is
 * the thing I want cheaper". It needs two facts the catalog never held — a
 * product and a price — so both live here, apart from `Benefit`, and neither
 * leaves the phone: the list is the user's, and the prices are read by the
 * phone from the shop's own public page.
 *
 * The rule carried over from the condition engine: a saving is only claimed
 * against something we saw ourselves. A crossed-out "was ₪499" on a product
 * page is the shop's word; the price this phone recorded last month is ours.
 */

/** One thing the user wants to buy. */
export const WatchItem = z
  .object({
    id: z.string().min(1),
    /** What the person calls it — the page's own title, or what they typed. */
    title: z.string().min(1),
    /**
     * The product page. Absent for a typed watch ("white shirt at Zara"), which
     * has no price to read and can only follow the merchant's offers.
     */
    url: z.string().url().nullish(),
    merchant_id: z.string().min(1).nullish(),
    /** Free text on purpose: "42", "42 2/3", "M", "one size". */
    size: z.string().nullish(),
    color: z.string().nullish(),
    /** "Tell me when it is at or under this." Optional. */
    target_price: z.number().positive().nullish(),
    created_at: z.string().datetime(),
    /** A watch ends rather than running for ever — see `isWatchExpired`. */
    expires_at: z.string().datetime(),
    paused: z.boolean().default(false),
    /** The last alert sent, so one drop is one notification. */
    last_alert: z
      .object({ at: z.string().datetime(), price: z.number().positive().nullish() })
      .strict()
      .nullish(),
    /** Offers at this merchant already shown, so only a new one alerts. */
    seen_benefit_ids: z.array(z.string()).default([]),
  })
  .strict();
export type WatchItem = z.infer<typeof WatchItem>;

/** One price, read from one page at one moment. */
export const PricePoint = z
  .object({
    price: z.number().positive(),
    /** ISO 4217. Almost always ILS; kept so a euro price is never read as shekels. */
    currency: z.string().length(3),
    /** The page's own "was" price. Recorded, never used as the baseline. */
    list_price: z.number().positive().nullish(),
    /** Null: the page did not say. Never assumed true. */
    in_stock: z.boolean().nullish(),
    observed_at: z.string().datetime(),
    source_url: z.string().url(),
  })
  .strict();
export type PricePoint = z.infer<typeof PricePoint>;

export interface WatchPolicy {
  /** How far back a price counts as "recent". */
  windowDays: number;
  /** A drop alerts at this many percent off the baseline, or… */
  minDropPct: number;
  /** …this many shekels, whichever comes first. */
  minDropIls: number;
  /** After an alert, a further drop of this many percent earns another. */
  realertDropPct: number;
  /** No more than this many watch alerts in one day, across all items. */
  maxAlertsPerDay: number;
  quietHours?: { fromMinutes: number; toMinutes: number };
  /** A new watch lasts this long. */
  expiryDays: number;
  /** Do not re-read one product page more often than this. */
  minCheckIntervalMs: number;
}

export const DEFAULT_WATCH_POLICY: WatchPolicy = {
  windowDays: 90,
  minDropPct: 10,
  minDropIls: 30,
  realertDropPct: 5,
  maxAlertsPerDay: 3,
  quietHours: { fromMinutes: 22 * 60, toMinutes: 8 * 60 },
  expiryDays: 90,
  minCheckIntervalMs: 6 * 60 * 60_000,
};

const DAY_MS = 86_400_000;
const TRACKING_PARAM = /^(utm_|gclid$|fbclid$|srsltid$|gad_|mc_|ref$|_ga$|msclkid$)/i;

/**
 * A stable key for a product page, so the same shoe shared twice — once from
 * an ad, once from the site — is one watch and not two.
 *
 * The query is kept apart from tracking noise, because plenty of shops still
 * name the product there (`?pid=1234`) and dropping it would merge a whole
 * catalog into one key.
 */
export function productKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    const params = [...parsed.searchParams.entries()]
      .filter(([name]) => !TRACKING_PARAM.test(name))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => `${name}=${value}`)
      .join('&');
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.hostname.toLowerCase().replace(/^www\./, '')}${path}${params ? `?${params}` : ''}`;
  } catch {
    return null;
  }
}

/** The first http(s) URL in arbitrary shared or typed text. */
export function firstUrl(text: string): string | null {
  return text.match(/https?:\/\/[^\s"'<>]+/i)?.[0] ?? null;
}

export interface ProductSnapshot {
  title: string | null;
  price: number;
  currency: string;
  listPrice: number | null;
  inStock: boolean | null;
}

/** "1,299.00", "₪ 349.90", 349.9 → a number, or null. */
function parsePrice(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null;
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[^\d.,]/g, '');
  if (!cleaned) return null;
  // "1.299,00" is European; "1,299.00" is everything else. The last separator
  // followed by exactly two digits is the decimal point either way.
  const decimal = /[.,](\d{1,2})$/.exec(cleaned);
  const whole = (decimal ? cleaned.slice(0, decimal.index) : cleaned).replace(/[.,]/g, '');
  const value = Number(decimal ? `${whole}.${decimal[1]}` : whole);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function availability(raw: unknown): boolean | null {
  if (typeof raw !== 'string') return null;
  if (/InStock|LimitedAvailability|OnlineOnly|InStoreOnly/i.test(raw)) return true;
  if (/OutOfStock|SoldOut|Discontinued/i.test(raw)) return false;
  return null;
}

const isType = (node: Record<string, unknown>, name: string) => {
  const type = node['@type'];
  return Array.isArray(type) ? type.includes(name) : type === name;
};

/** Every object in a JSON-LD tree, however deeply `@graph` nested it. */
function* walkJsonLd(node: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(node)) {
    for (const child of node) yield* walkJsonLd(child);
  } else if (node && typeof node === 'object') {
    const object = node as Record<string, unknown>;
    yield object;
    for (const value of Object.values(object)) yield* walkJsonLd(value);
  }
}

function offersOf(product: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const add = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(add);
    else if (value && typeof value === 'object') out.push(value as Record<string, unknown>);
  };
  add(product.offers);
  // A ProductGroup carries its prices on the variants.
  for (const variant of Array.isArray(product.hasVariant) ? product.hasVariant : []) {
    if (variant && typeof variant === 'object') add((variant as Record<string, unknown>).offers);
  }
  return out;
}

function fromJsonLd(html: string): ProductSnapshot | null {
  const blocks = html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const [, body] of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body!.trim());
    } catch {
      continue; // one malformed block is not a reason to lose the page
    }
    for (const node of walkJsonLd(parsed)) {
      if (!isType(node, 'Product') && !isType(node, 'ProductGroup')) continue;
      const priced = offersOf(node)
        .map((offer) => {
          const spec = offer.priceSpecification as Record<string, unknown> | undefined;
          return {
            price: parsePrice(offer.price ?? offer.lowPrice ?? spec?.price),
            currency: offer.priceCurrency ?? spec?.priceCurrency,
            inStock: availability(offer.availability),
          };
        })
        .filter((offer) => offer.price != null);
      if (priced.length === 0) continue;
      // Several offers are sizes or sellers. The lowest is what "from ₪X" on
      // the page means, and whether *any* is in stock is all the page can say
      // about a size we cannot see.
      const cheapest = priced.reduce((a, b) => (b.price! < a.price! ? b : a));
      const stock = priced.map((offer) => offer.inStock);
      return {
        title: typeof node.name === 'string' ? node.name.trim() || null : null,
        price: cheapest.price!,
        currency: typeof cheapest.currency === 'string' ? cheapest.currency.toUpperCase() : 'ILS',
        listPrice: null,
        inStock: stock.includes(true) ? true : stock.every((s) => s === false) ? false : null,
      };
    }
  }
  return null;
}

/** `<meta property|name|itemprop="key" content="…">`, attributes in any order. */
function metaContent(html: string, keys: readonly string[]): string | null {
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attr = (name: string) =>
      new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1] ?? null;
    const key = attr('property') ?? attr('name') ?? attr('itemprop');
    if (key && keys.includes(key.toLowerCase())) {
      const content = attr('content');
      if (content) return content;
    }
  }
  return null;
}

/**
 * Read a product and its price out of a shop page.
 *
 * Only structured data: schema.org JSON-LD, then the Open Graph product tags.
 * Both exist so that machines can read the price, and nearly every shop
 * platform emits one of them for search engines. There is deliberately no
 * guessing from the page's visible text — "₪349" on a product page is as
 * likely to be the shipping threshold or a related item, and a wrong price
 * here becomes a false "it dropped" on someone's lock screen.
 *
 * Null means "this page does not say", which the caller shows as exactly that.
 */
export function extractProduct(html: string): ProductSnapshot | null {
  const title =
    metaContent(html, ['og:title']) ?? /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? null;
  const structured = fromJsonLd(html);
  if (structured) return { ...structured, title: structured.title ?? title };

  const price = parsePrice(
    metaContent(html, ['product:price:amount', 'og:price:amount', 'product:sale_price:amount', 'price']),
  );
  if (price == null) return null;
  const currency = metaContent(html, [
    'product:price:currency',
    'og:price:currency',
    'product:sale_price:currency',
    'pricecurrency',
  ]);
  return {
    title,
    price,
    currency: (currency ?? 'ILS').toUpperCase(),
    listPrice: parsePrice(metaContent(html, ['product:original_price:amount'])),
    inStock: availability(metaContent(html, ['product:availability', 'og:availability', 'availability'])),
  };
}

export type PriceVerdict =
  /** Never read a price for this item. */
  | { kind: 'no_price' }
  /** One reading: a price, and nothing of ours to compare it with. */
  | { kind: 'no_history'; current: number }
  | {
      kind: 'drop' | 'same' | 'rise';
      current: number;
      /** The median of what we recorded before, inside the window. */
      baseline: number;
      /** Positive when cheaper than the baseline. */
      dropIls: number;
      dropPct: number;
      /** Strictly under every earlier reading in the window. */
      lowestInWindow: boolean;
      /** How many days of our own readings the comparison rests on. */
      historyDays: number;
    };

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/**
 * Where the latest price stands against this item's own recorded history.
 *
 * The baseline is a median, not the first or the highest reading: one day at a
 * silly "list" price must not make every ordinary day afterwards look like a
 * sale, which is precisely the trick a raised-then-cut price plays.
 */
export function priceVerdict(
  history: readonly PricePoint[],
  now: Date,
  policy: WatchPolicy = DEFAULT_WATCH_POLICY,
): PriceVerdict {
  const points = [...history].sort((a, b) => a.observed_at.localeCompare(b.observed_at));
  const latest = points[points.length - 1];
  if (!latest) return { kind: 'no_price' };
  const since = now.getTime() - policy.windowDays * DAY_MS;
  const earlier = points
    .slice(0, -1)
    .filter((p) => Date.parse(p.observed_at) >= since && p.currency === latest.currency);
  if (earlier.length === 0) return { kind: 'no_history', current: latest.price };

  const baseline = median(earlier.map((p) => p.price));
  const dropIls = Math.round((baseline - latest.price) * 100) / 100;
  const dropPct = Math.round((dropIls / baseline) * 1000) / 10;
  return {
    // Under one percent either way is rounding and currency noise, not news.
    kind: Math.abs(dropPct) < 1 ? 'same' : dropIls > 0 ? 'drop' : 'rise',
    current: latest.price,
    baseline,
    dropIls,
    dropPct,
    lowestInWindow: earlier.every((p) => latest.price < p.price),
    historyDays: Math.floor(
      (Date.parse(latest.observed_at) - Date.parse(earlier[0]!.observed_at)) / DAY_MS,
    ),
  };
}

const money = (amount: number) =>
  `₪${Number.isInteger(amount) ? amount : amount.toFixed(2).replace(/\.?0+$/, '')}`;

/**
 * The verdict in words. States only what the readings support: "lowest in the
 * 12 days we have tracked", never "lowest in 90 days" off a 12-day history.
 */
export function formatPriceVerdict(verdict: PriceVerdict): string {
  switch (verdict.kind) {
    case 'no_price':
      return 'עוד לא קראנו מחיר';
    case 'no_history':
      return `${money(verdict.current)} · אין עדיין היסטוריה, עוקבים מהיום`;
    case 'same':
      return `${money(verdict.current)} · אותו מחיר כמו קודם`;
    case 'rise':
      return `${money(verdict.current)} · התייקר ב-${money(-verdict.dropIls)}`;
    case 'drop': {
      const span =
        verdict.historyDays >= 1 ? `ב-${verdict.historyDays} הימים שעקבנו` : 'מאז שהתחלנו לעקוב';
      return verdict.lowestInWindow
        ? `${money(verdict.current)} · הכי נמוך ${span} (היה ${money(verdict.baseline)})`
        : `${money(verdict.current)} · ירד ב-${money(verdict.dropIls)} (היה ${money(verdict.baseline)})`;
    }
  }
}

export function isWatchExpired(item: Pick<WatchItem, 'expires_at'>, now: Date): boolean {
  return Date.parse(item.expires_at) <= now.getTime();
}

/** Push the expiry a full period out from now — the answer to "still want this?". */
export function extendWatch(
  item: WatchItem,
  now: Date,
  policy: WatchPolicy = DEFAULT_WATCH_POLICY,
): WatchItem {
  return { ...item, expires_at: new Date(now.getTime() + policy.expiryDays * DAY_MS).toISOString() };
}

export type WatchDecision =
  | { alert: true; reason: 'drop' | 'target'; verdict: PriceVerdict; price: number }
  | {
      alert: false;
      why:
        | 'paused'
        | 'expired'
        | 'no_price'
        | 'no_history'
        | 'out_of_stock'
        | 'below_threshold'
        | 'already_alerted';
      verdict: PriceVerdict;
    };

/**
 * Is this item's latest price worth a notification?
 *
 * Every "no" is named, because the list screen shows the reason: an item that
 * never alerts and never says why reads as a feature that does not work.
 */
export function evaluateWatch(
  item: WatchItem,
  history: readonly PricePoint[],
  now: Date,
  policy: WatchPolicy = DEFAULT_WATCH_POLICY,
): WatchDecision {
  const verdict = priceVerdict(history, now, policy);
  if (item.paused) return { alert: false, why: 'paused', verdict };
  if (isWatchExpired(item, now)) return { alert: false, why: 'expired', verdict };
  if (verdict.kind === 'no_price') return { alert: false, why: 'no_price', verdict };

  const points = [...history].sort((a, b) => a.observed_at.localeCompare(b.observed_at));
  const latest = points[points.length - 1]!;
  // Stated out of stock is a reason to stay quiet. Unstated is not: most pages
  // do not say, and silence on those would silence the feature.
  if (latest.in_stock === false) return { alert: false, why: 'out_of_stock', verdict };

  const price = latest.price;
  const hitTarget = item.target_price != null && price <= item.target_price;
  const dropped =
    verdict.kind === 'drop' &&
    (verdict.dropPct >= policy.minDropPct || verdict.dropIls >= policy.minDropIls);
  if (!hitTarget && !dropped) {
    return { alert: false, why: verdict.kind === 'no_history' ? 'no_history' : 'below_threshold', verdict };
  }

  // One drop, one notification. Another is earned by the price going further
  // down, or by it going back up and coming down again — a new drop.
  const last = item.last_alert;
  if (last?.price != null) {
    const further = price <= last.price * (1 - policy.realertDropPct / 100);
    const wentBackUp = points.some(
      (p) => p.observed_at > last.at && p.price >= last.price! * (1 + policy.realertDropPct / 100),
    );
    if (!further && !wentBackUp) return { alert: false, why: 'already_alerted', verdict };
  }
  return { alert: true, reason: hitTarget && !dropped ? 'target' : 'drop', verdict, price };
}

/**
 * The gate every watch alert passes after it has been earned: quiet hours and a
 * daily cap, shared across all items so ten watched shoes on a sale day are
 * three notifications and not ten.
 */
export function watchAlertGate(input: {
  now: number;
  localMinutes: number;
  /** Timestamps (ms) of watch alerts already sent. */
  sentAt: readonly number[];
  policy?: WatchPolicy;
}): { send: true } | { send: false; reason: 'quiet_hours' | 'daily_cap' } {
  const policy = input.policy ?? DEFAULT_WATCH_POLICY;
  if (policy.quietHours && inQuietHours(input.localMinutes, policy.quietHours)) {
    return { send: false, reason: 'quiet_hours' };
  }
  const today = input.sentAt.filter((at) => input.now - at < DAY_MS).length;
  if (today >= policy.maxAlertsPerDay) return { send: false, reason: 'daily_cap' };
  return { send: true };
}

export interface StackedPrice {
  evaluation: Evaluation;
  /** The price after this benefit, by the stated terms. */
  finalPrice: number;
  savingIls: number;
}

/**
 * The best club benefit this person holds for a known price at this merchant.
 *
 * "₪399, and your card takes it to ₪359" is the sentence the two halves of the
 * app exist to say together. Ranked with the real price as the basket, so a
 * minimum spend the item does not reach is a block rather than a hope, and a
 * capped discount is capped. Skips anything the engine would not put a figure
 * on — a ceiling ("up to 30%"), a 1+1 — and anything not confirmed.
 */
export function bestBenefitAtPrice(
  benefits: readonly Benefit[],
  ctx: Omit<EvalContext, 'cartAmount'>,
  price: number,
): StackedPrice | null {
  let best: StackedPrice | null = null;
  for (const evaluation of rankBenefits(benefits, { ...ctx, cartAmount: price })) {
    if (evaluation.isEstimate || evaluation.estimatedSavingIls <= 0) continue;
    if (evaluation.benefit.verification?.state === 'unverified') continue;
    const savingIls = Math.min(evaluation.estimatedSavingIls, price);
    if (!best || savingIls > best.savingIls) {
      best = { evaluation, savingIls, finalPrice: Math.round((price - savingIls) * 100) / 100 };
    }
  }
  return best;
}

/** Offers at the watched merchant that this watch has not shown yet. */
export function newOffersForWatch(
  item: Pick<WatchItem, 'seen_benefit_ids'>,
  ranked: readonly Evaluation[],
): Evaluation[] {
  const seen = new Set(item.seen_benefit_ids);
  return ranked.filter((evaluation) => !seen.has(evaluation.benefit.id));
}

/**
 * Copy for a price alert.
 *
 * Stock is said as what it is. A product page states stock for the product,
 * rarely for one size and never for one branch, so the honest sentence for a
 * nearby shop is "stock unknown" and the notification does not pretend more.
 */
export function formatWatchNotification(input: {
  item: Pick<WatchItem, 'title' | 'size' | 'target_price'>;
  decision: Extract<WatchDecision, { alert: true }>;
  stacked?: StackedPrice | null;
  programName?: string | null;
  /** Metres to the merchant's nearest branch, when a position is known. */
  nearestBranchM?: number | null;
}): { title: string; body: string } {
  const { item, decision, stacked } = input;
  const verdict = decision.verdict;
  const parts: string[] = [];
  if (verdict.kind === 'drop') {
    parts.push(`${money(decision.price)} במקום ${money(verdict.baseline)} (‎-${Math.round(verdict.dropPct)}%)`);
  } else {
    parts.push(`${money(decision.price)} — מתחת ליעד שלך (${money(item.target_price ?? decision.price)})`);
  }
  if (stacked && input.programName) {
    parts.push(`עם ${input.programName}: ${money(stacked.finalPrice)}`);
  }
  if (item.size) parts.push(`מידה ${item.size}: מלאי לא ידוע`);
  if (input.nearestBranchM != null) {
    const distance =
      input.nearestBranchM < 1000
        ? `${Math.round(input.nearestBranchM / 10) * 10} מ׳`
        : `${(input.nearestBranchM / 1000).toFixed(1)} ק״מ`;
    parts.push(`סניף ${distance} ממך, המחיר נקרא מהאתר`);
  }
  return {
    title: decision.reason === 'target' ? `הגיע ליעד: ${item.title}` : `ירד מחיר: ${item.title}`,
    body: parts.join(' · '),
  };
}

/** Copy for "a new offer you can use appeared at a shop you are watching". */
export function formatWatchOfferNotification(
  item: Pick<WatchItem, 'title'>,
  headline: string,
  merchantName: string,
  programName: string,
): { title: string; body: string } {
  return {
    title: `הטבה חדשה: ${item.title}`,
    body: `${headline} ב${merchantName} (${programName})`,
  };
}
