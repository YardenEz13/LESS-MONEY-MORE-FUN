/**
 * Free-text matching for the two lists a person has to find something in: 61
 * clubs at onboarding, and up to 291 benefits over 1199 merchants after it.
 *
 * The normalisation is the same rule `resolveMerchantId` and the merchant
 * scripts already use — trim, lowercase, and drop whitespace along with the
 * quote and hyphen characters Hebrew names are written with inconsistently.
 * Dropping the separators rather than collapsing them is what makes the search
 * usable here: "סופר פארם" and "סופרפארם" both have to find "סופר-פארם", and
 * nobody types ״ or ׳ into a search box the way a shop writes it on its sign.
 *
 * Substring rather than prefix, because a merchant is as often remembered by
 * the second word of its name as the first, and 1199 of them are unfamiliar
 * small businesses.
 */
const SEPARATORS = /[\s'"׳״־-]+/g;

export function normalizeForSearch(value: string): string {
  return value.trim().toLowerCase().replace(SEPARATORS, '');
}

/**
 * True when any of `fields` contains `query`. An empty query matches
 * everything, so a caller can pass the box's value straight through without
 * branching on whether the user has typed yet.
 */
export function matchesQuery(fields: ReadonlyArray<string | null | undefined>, query: string): boolean {
  const needle = normalizeForSearch(query);
  if (needle === '') return true;
  return fields.some((field) => field != null && normalizeForSearch(field).includes(needle));
}
