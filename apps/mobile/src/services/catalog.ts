import { Benefit, Merchant, Program, Venue, expandOwnedPrograms } from '@sbr/core';
import benefitsJson from '@sbr/data/benefits.sample.json';
import merchantsJson from '@sbr/data/merchants.json';
import programsJson from '@sbr/data/programs.json';
import venuesJson from '@sbr/data/venues.json';

/**
 * The MVP ships the catalog in the bundle. There is no server yet: the
 * extraction pipeline writes JSON, the JSON is committed, the app is rebuilt.
 * A `last_verified_at` older than the freshness policy is what stops a stale
 * bundle from quietly showing expired benefits — see `evaluateBenefit`.
 *
 * Parsing at load is intentional: a malformed catalog should fail loudly on a
 * dogfood build rather than surface a half-formed benefit at a till.
 */
export const programs: Program[] = Program.array().parse(programsJson);
export const merchants: Merchant[] = Merchant.array().parse(merchantsJson);
export const venues: Venue[] = Venue.array().parse(venuesJson);
export const benefits: Benefit[] = Benefit.array().parse(benefitsJson);

export const programsById = new Map(programs.map((p) => [p.id, p]));
export const merchantsById = new Map(merchants.map((m) => [m.id, m]));
export const venuesById = new Map(venues.map((v) => [v.id, v]));

export const programNames: Record<string, string> = Object.fromEntries(
  programs.map((p) => [p.id, p.name]),
);

/**
 * The program ids a profile actually matches against.
 *
 * Always use this instead of `profile.program_ids` when building an
 * `EvalContext`: a card like Cash כאל Pro has to contribute its issuer's id too,
 * and putting that in one place is what stops the next call site from silently
 * hiding every כאל benefit from someone who ticked only the card.
 */
export function ownedProgramIds(profileProgramIds: readonly string[]): string[] {
  return expandOwnedPrograms(profileProgramIds, programs);
}

/** Benefits redeemable at merchants that have a branch in the given venue. */
export function benefitsAtVenue(venueId: string): Benefit[] {
  const merchantIds = new Set(
    merchants.filter((m) => m.venue_ids.includes(venueId)).map((m) => m.id),
  );
  return benefits.filter((b) => merchantIds.has(b.merchant_id));
}

export function benefitsForMerchant(merchantId: string): Benefit[] {
  return benefits.filter((b) => b.merchant_id === merchantId);
}
