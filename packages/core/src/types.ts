import { z } from 'zod';

/**
 * Day-of-week convention used across the whole system:
 *   1 = Sunday ... 7 = Saturday (Israeli week starts on Sunday).
 * `valid_days: [1,2,3,4,5]` therefore means "Sunday through Thursday".
 */
export const DayOfWeek = z.number().int().min(1).max(7);

/** "HH:MM" in 24h local (Asia/Jerusalem) time. */
export const TimeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');

export const BenefitChannel = z.enum(['in_store', 'online', 'both']);
export type BenefitChannel = z.infer<typeof BenefitChannel>;

export const BenefitType = z.enum(['percent', 'fixed', 'bogo', 'cashback', 'gift_card']);
export type BenefitType = z.infer<typeof BenefitType>;

/**
 * Structured conditions. Every field is optional on purpose: the extraction
 * engine must be allowed to say "the source does not state this" instead of
 * inventing a value. `null`/absent is rendered to the user as "not stated",
 * never as "no limit".
 */
export const BenefitConditions = z
  .object({
    min_spend: z.number().nonnegative().nullish(),
    max_discount: z.number().positive().nullish(),
    valid_days: z.array(DayOfWeek).min(1).max(7).nullish(),
    valid_hours: z
      .object({ from: TimeOfDay, to: TimeOfDay })
      .nullish(),
    channel: BenefitChannel.nullish(),
    stacks_with_club: z.boolean().nullish(),
    /** Categories/SKUs explicitly excluded, e.g. ["תרופות מרשם", "טבק"]. */
    exclusions: z.array(z.string()).nullish(),
    /** Free-text one-liner in Hebrew, verbatim-ish from the T&C. Always required. */
    raw_text_summary: z.string().min(1),
    /** Usage cap, e.g. "once per month". */
    usage_limit: z.string().nullish(),
    /** Redemption needs a coupon code / voucher pulled from the club site first. */
    requires_voucher: z.boolean().nullish(),
  })
  .strict();
export type BenefitConditions = z.infer<typeof BenefitConditions>;

export const Benefit = z
  .object({
    id: z.string().min(1),
    program_id: z.string().min(1),
    merchant_id: z.string().min(1),
    merchant_name: z.string().min(1),
    google_place_id: z.string().nullish(),
    type: BenefitType,
    /** percent -> 10 means 10%; fixed/cashback/gift_card -> currency amount in ILS. */
    value: z.number().nonnegative(),
    conditions: BenefitConditions,
    valid_from: z.string().datetime().nullish(),
    valid_until: z.string().datetime().nullish(),
    source_url: z.string().url(),
    last_verified_at: z.string().datetime(),
    confidence_score: z.number().min(0).max(1),
    /** Set once a human has approved a low-confidence extraction. */
    reviewed_by_human: z.boolean().default(false),
  })
  .strict();
export type Benefit = z.infer<typeof Benefit>;

export const Program = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    category: z.enum(['credit_card', 'employer_club', 'retail_club']),
    /** Public catalog entry point, used by the scraper. */
    catalog_url: z.string().url().nullish(),
    /** Shown during onboarding so the user recognises what they hold. */
    hint: z.string().nullish(),
    /**
     * The issuer this is a specific card of — `cal_cash_pro`'s parent is `cal`.
     *
     * A card carries its own terms (1% cashback on everything) *and* everything
     * the issuer offers, so holding the card means holding both. Ticking one box
     * in onboarding therefore has to grant two program ids — see
     * `expandOwnedPrograms`.
     */
    parent_id: z.string().min(1).nullish(),
  })
  .strict();
export type Program = z.infer<typeof Program>;

/**
 * What a merchant sells, coarse enough to stay stable.
 *
 * This exists so an errand ("I need to fill up") can be turned into a filter
 * without guessing from the merchant's name. Deliberately a closed list: the
 * advisor maps free text onto these, and an open vocabulary would let it invent
 * a category that matches nothing.
 */
export const MerchantCategory = z.enum([
  'fuel',
  'grocery',
  'pharmacy',
  'fashion',
  'electronics',
  'dining',
  'home',
  'leisure',
]);
export type MerchantCategory = z.infer<typeof MerchantCategory>;

export const Merchant = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    /** Hostnames (no scheme, no www) used by the Share Extension resolver. */
    domains: z.array(z.string()).default([]),
    /** Venue ids where this merchant has a branch (MVP: mall-level only). */
    venue_ids: z.array(z.string()).default([]),
    /** A merchant can be more than one — a supermarket that sells fuel. */
    categories: z.array(MerchantCategory).default([]),
  })
  .strict();
export type Merchant = z.infer<typeof Merchant>;

/**
 * A geofenced shopping complex. MVP deliberately geofences malls, not
 * individual street-level stores, to keep notification volume sane.
 */
export const Venue = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    city: z.string().min(1),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    /** Geofence radius in meters. */
    radius_m: z.number().int().positive(),
  })
  .strict();
export type Venue = z.infer<typeof Venue>;

/** Zero-auth profile: nothing but a list of declared program ids, stored on-device. */
export const UserProfile = z
  .object({
    program_ids: z.array(z.string()),
    /** Merchants/benefits the user muted. */
    muted_benefit_ids: z.array(z.string()).default([]),
    notifications_enabled: z.boolean().default(true),
    onboarded_at: z.string().datetime().nullish(),
  })
  .strict();
export type UserProfile = z.infer<typeof UserProfile>;
