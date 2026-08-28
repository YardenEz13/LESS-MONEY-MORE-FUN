import { describe, expect, it } from 'vitest';
import { matchesQuery, normalizeForSearch } from '../src/search';

describe('normalizeForSearch', () => {
  it('drops the separators Hebrew names are written with inconsistently', () => {
    // The shop writes it with a hyphen; nobody types the hyphen.
    expect(normalizeForSearch('סופר-פארם')).toBe(normalizeForSearch('סופר פארם'));
    expect(normalizeForSearch("מקדונלד'ס")).toBe(normalizeForSearch('מקדונלדס'));
    expect(normalizeForSearch('מקדונלד׳ס')).toBe(normalizeForSearch('מקדונלדס'));
  });

  it('is case-insensitive for the Latin names in the catalog', () => {
    expect(normalizeForSearch('Fox Home')).toBe(normalizeForSearch('foxhome'));
  });
});

describe('matchesQuery', () => {
  it('matches on a middle word, not just a prefix', () => {
    // 1199 merchants, most unfamiliar — the memorable word is often not first.
    expect(matchesQuery(['אצה סושי בר חולון'], 'סושי')).toBe(true);
  });

  it('matches across any of the supplied fields', () => {
    expect(matchesQuery(['מינימרקט קרן', 'מכולת', 'גבעתיים'], 'מכולת')).toBe(true);
    expect(matchesQuery(['מינימרקט קרן', 'מכולת', 'גבעתיים'], 'גבעתיים')).toBe(true);
  });

  it('ignores null and undefined fields rather than throwing', () => {
    expect(matchesQuery(['KSP', null, undefined], 'ksp')).toBe(true);
    expect(matchesQuery([null, undefined], 'ksp')).toBe(false);
  });

  it('treats an empty or whitespace query as "show everything"', () => {
    expect(matchesQuery(['anything'], '')).toBe(true);
    expect(matchesQuery(['anything'], '   ')).toBe(true);
  });

  it('does not match when nothing contains the needle', () => {
    expect(matchesQuery(['סופר-פארם', 'pharmacy'], 'דלק')).toBe(false);
  });
});
