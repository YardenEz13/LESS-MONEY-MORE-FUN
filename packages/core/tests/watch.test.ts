import { describe, expect, it } from 'vitest';
import { Benefit } from '../src/types';
import {
  DEFAULT_WATCH_POLICY,
  PricePoint,
  WatchItem,
  bestBenefitAtPrice,
  evaluateWatch,
  extendWatch,
  extractProduct,
  firstUrl,
  formatPriceVerdict,
  formatWatchNotification,
  newOffersForWatch,
  priceVerdict,
  productKey,
  watchAlertGate,
} from '../src/watch';
import { rankBenefits } from '../src/matching';

const NOW = new Date('2026-08-02T10:00:00Z');
const URL_ = 'https://shop.example.co.il/p/samba-og';

const day = (offset: number) => new Date(NOW.getTime() + offset * 86_400_000).toISOString();

const point = (price: number, offsetDays: number, extra: Partial<PricePoint> = {}): PricePoint =>
  PricePoint.parse({
    price,
    currency: 'ILS',
    observed_at: day(offsetDays),
    source_url: URL_,
    ...extra,
  });

const item = (overrides: Partial<WatchItem> = {}): WatchItem =>
  WatchItem.parse({
    id: 'w1',
    title: 'Adidas Samba OG',
    url: URL_,
    merchant_id: 'adidas',
    size: '42',
    created_at: day(-30),
    expires_at: day(60),
    ...overrides,
  });

describe('extractProduct', () => {
  it('reads a schema.org Product, however deep in @graph', () => {
    const html = `<html><head><title>x</title>
      <script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'BreadcrumbList' },
          {
            '@type': 'Product',
            name: 'Samba OG Shoes',
            offers: {
              '@type': 'Offer',
              price: '449.90',
              priceCurrency: 'ILS',
              availability: 'https://schema.org/InStock',
            },
          },
        ],
      })}</script></head></html>`;
    expect(extractProduct(html)).toEqual({
      title: 'Samba OG Shoes',
      price: 449.9,
      currency: 'ILS',
      listPrice: null,
      inStock: true,
    });
  });

  it('takes the lowest of several offers and reports stock only as the page states it', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@type': 'Product',
      name: 'Shirt',
      offers: [
        { price: 199, priceCurrency: 'ILS', availability: 'https://schema.org/OutOfStock' },
        { price: 149, priceCurrency: 'ILS', availability: 'https://schema.org/OutOfStock' },
      ],
    })}</script>`;
    expect(extractProduct(html)).toMatchObject({ price: 149, inStock: false });
  });

  it('reads an AggregateOffer low price', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@type': 'Product',
      name: 'Shoe',
      offers: { '@type': 'AggregateOffer', lowPrice: '1,299.00', priceCurrency: 'ILS' },
    })}</script>`;
    expect(extractProduct(html)).toMatchObject({ price: 1299, inStock: null });
  });

  it('falls back to Open Graph product tags, attributes in any order', () => {
    const html = `<head>
      <meta content="Samba OG" property="og:title">
      <meta property="product:price:amount" content="399.00">
      <meta property="product:price:currency" content="ILS">
      <meta property="product:availability" content="in stock"></head>`;
    expect(extractProduct(html)).toMatchObject({ title: 'Samba OG', price: 399, currency: 'ILS' });
  });

  it('refuses to guess a price from visible text', () => {
    expect(extractProduct('<html><body><h1>Samba</h1><span>₪449.90</span></body></html>')).toBeNull();
  });

  it('survives a malformed JSON-LD block', () => {
    const html = `<script type="application/ld+json">{ not json</script>
      <meta property="og:price:amount" content="120">`;
    expect(extractProduct(html)).toMatchObject({ price: 120 });
  });
});

describe('productKey', () => {
  it('ignores tracking noise, www and a trailing slash', () => {
    expect(productKey('https://www.shop.example.co.il/p/samba-og/?utm_source=ig&fbclid=abc')).toBe(
      productKey(URL_),
    );
  });
  it('keeps a query that names the product', () => {
    expect(productKey('https://shop.example.co.il/item?pid=1')).not.toBe(
      productKey('https://shop.example.co.il/item?pid=2'),
    );
  });
  it('returns null for something that is not a URL', () => {
    expect(productKey('חולצה לבנה')).toBeNull();
    expect(firstUrl('תראה את זה https://a.example.com/x?y=1 מגניב')).toBe('https://a.example.com/x?y=1');
  });
});

describe('priceVerdict', () => {
  it('says there is no history after a single reading', () => {
    const verdict = priceVerdict([point(449, 0)], NOW);
    expect(verdict.kind).toBe('no_history');
    expect(formatPriceVerdict(verdict)).toMatch(/אין עדיין היסטוריה/);
  });

  it('measures a drop against the median of our own readings', () => {
    const verdict = priceVerdict([point(449, -20), point(449, -10), point(359, 0)], NOW);
    expect(verdict).toMatchObject({ kind: 'drop', baseline: 449, dropIls: 90, lowestInWindow: true });
    expect(formatPriceVerdict(verdict)).toBe('₪359 · הכי נמוך ב-20 הימים שעקבנו (היה ₪449)');
  });

  it('is not fooled by a price raised just before the "sale"', () => {
    // 400 for weeks, 600 for a day, then "33% off" back to 400.
    const history = [point(400, -30), point(400, -20), point(400, -10), point(600, -1), point(400, 0)];
    expect(priceVerdict(history, NOW).kind).toBe('same');
  });

  it('ignores readings older than the window', () => {
    const verdict = priceVerdict([point(900, -200), point(449, 0)], NOW);
    expect(verdict.kind).toBe('no_history');
  });
});

describe('evaluateWatch', () => {
  const dropped = [point(449, -20), point(449, -10), point(359, 0)];

  it('alerts on a real drop', () => {
    expect(evaluateWatch(item(), dropped, NOW)).toMatchObject({ alert: true, reason: 'drop', price: 359 });
  });

  it('stays quiet on a small move', () => {
    const history = [point(449, -10), point(439, 0)];
    expect(evaluateWatch(item(), history, NOW)).toMatchObject({ alert: false, why: 'below_threshold' });
  });

  it('stays quiet when the page says out of stock, but not when it says nothing', () => {
    const out = [point(449, -10), point(359, 0, { in_stock: false })];
    expect(evaluateWatch(item(), out, NOW)).toMatchObject({ alert: false, why: 'out_of_stock' });
    expect(evaluateWatch(item(), dropped, NOW).alert).toBe(true);
  });

  it('alerts when the target is reached, even with no history', () => {
    const decision = evaluateWatch(item({ target_price: 400 }), [point(389, 0)], NOW);
    expect(decision).toMatchObject({ alert: true, reason: 'target' });
  });

  it('sends one alert per drop', () => {
    const alerted = item({ last_alert: { at: day(0), price: 359 } });
    const later = [...dropped, point(359, 1)];
    expect(evaluateWatch(alerted, later, new Date(day(1)))).toMatchObject({
      alert: false,
      why: 'already_alerted',
    });
  });

  it('alerts again when the price falls further', () => {
    const alerted = item({ last_alert: { at: day(0), price: 359 } });
    const later = [...dropped, point(299, 2)];
    expect(evaluateWatch(alerted, later, new Date(day(2))).alert).toBe(true);
  });

  it('alerts again after the price went back up and dropped a second time', () => {
    const alerted = item({ last_alert: { at: day(0), price: 359 } });
    const later = [...dropped, point(449, 5), point(449, 8), point(449, 9), point(359, 10)];
    expect(evaluateWatch(alerted, later, new Date(day(10))).alert).toBe(true);
  });

  it('never alerts for a paused or expired watch', () => {
    expect(evaluateWatch(item({ paused: true }), dropped, NOW)).toMatchObject({ why: 'paused' });
    expect(evaluateWatch(item({ expires_at: day(-1) }), dropped, NOW)).toMatchObject({ why: 'expired' });
  });

  it('extending a watch moves the expiry a full period from now', () => {
    const extended = extendWatch(item({ expires_at: day(-1) }), NOW);
    expect(extended.expires_at).toBe(day(DEFAULT_WATCH_POLICY.expiryDays));
  });
});

describe('watchAlertGate', () => {
  const noon = { now: NOW.getTime(), localMinutes: 13 * 60 };
  it('sends at noon with nothing sent today', () => {
    expect(watchAlertGate({ ...noon, sentAt: [] })).toEqual({ send: true });
  });
  it('holds during quiet hours', () => {
    expect(watchAlertGate({ ...noon, localMinutes: 23 * 60, sentAt: [] })).toEqual({
      send: false,
      reason: 'quiet_hours',
    });
  });
  it('caps the day across all items', () => {
    const sentAt = [1, 2, 3].map((h) => NOW.getTime() - h * 3_600_000);
    expect(watchAlertGate({ ...noon, sentAt })).toEqual({ send: false, reason: 'daily_cap' });
  });
  it('does not count yesterday against today', () => {
    const sentAt = [30, 31, 32].map((h) => NOW.getTime() - h * 3_600_000);
    expect(watchAlertGate({ ...noon, sentAt })).toEqual({ send: true });
  });
});

describe('stacking a club benefit on a watched price', () => {
  const benefit = (overrides: Partial<Benefit> = {}): Benefit =>
    Benefit.parse({
      id: 'b1',
      program_id: 'max',
      merchant_id: 'adidas',
      merchant_name: 'אדידס',
      type: 'percent',
      value: 10,
      conditions: { raw_text_summary: '10% הנחה', stacks_with_club: true },
      source_url: 'https://club.example.org/adidas',
      last_verified_at: '2026-08-01T10:00:00Z',
      confidence_score: 0.95,
      ...overrides,
    });
  const ctx = { now: NOW, ownedProgramIds: ['max'] };

  it('applies the percentage to the real price', () => {
    expect(bestBenefitAtPrice([benefit()], ctx, 359)).toMatchObject({
      savingIls: 35.9,
      finalPrice: 323.1,
    });
  });

  it('respects a minimum spend the item does not reach', () => {
    const needs500 = benefit({ conditions: { raw_text_summary: 'מעל 500', min_spend: 500 } });
    expect(bestBenefitAtPrice([needs500], ctx, 359)).toBeNull();
  });

  it('respects a discount cap', () => {
    const capped = benefit({ conditions: { raw_text_summary: 'עד 20', max_discount: 20 } });
    expect(bestBenefitAtPrice([capped], ctx, 359)?.savingIls).toBe(20);
  });

  it('puts no figure on a ceiling, a club not held, or an unverified offer', () => {
    const ceiling = benefit({ value: 30, conditions: { raw_text_summary: 'עד 30% הנחה' } });
    expect(bestBenefitAtPrice([ceiling], ctx, 359)).toBeNull();
    expect(bestBenefitAtPrice([benefit({ program_id: 'hever' })], ctx, 359)).toBeNull();
    const unverified = benefit({
      verification: { state: 'unverified', checked_at: day(0), score: 0.2, checks: [] },
    });
    expect(bestBenefitAtPrice([unverified], ctx, 359)).toBeNull();
  });

  it('writes the notification with stock said as unknown', () => {
    const decision = evaluateWatch(item(), [point(449, -20), point(449, -10), point(359, 0)], NOW);
    if (!decision.alert) throw new Error('expected an alert');
    const copy = formatWatchNotification({
      item: item(),
      decision,
      stacked: bestBenefitAtPrice([benefit()], ctx, 359),
      programName: 'max',
      nearestBranchM: 412,
    });
    expect(copy.title).toBe('ירד מחיר: Adidas Samba OG');
    expect(copy.body).toContain('₪359 במקום ₪449');
    expect(copy.body).toContain('עם max: ₪323.1');
    expect(copy.body).toContain('מידה 42: מלאי לא ידוע');
    expect(copy.body).toContain('סניף 410 מ׳ ממך');
  });

  it('only a new offer at a watched merchant counts as news', () => {
    const ranked = rankBenefits([benefit(), benefit({ id: 'b2', value: 20 })], ctx);
    const fresh = newOffersForWatch({ seen_benefit_ids: ['b1'] }, ranked);
    expect(fresh.map((e) => e.benefit.id)).toEqual(['b2']);
  });
});
