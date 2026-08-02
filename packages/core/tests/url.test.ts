import { describe, expect, it } from 'vitest';
import { Merchant } from '../src/types.js';
import { extractHostname, resolveMerchantFromShare } from '../src/url.js';

const merchants = [
  Merchant.parse({ id: 'ksp', name: 'KSP', domains: ['ksp.co.il'], venue_ids: [] }),
  Merchant.parse({
    id: 'terminalx',
    name: 'Terminal X',
    domains: ['terminalx.com'],
    venue_ids: [],
  }),
  Merchant.parse({
    id: 'azrieli_shop',
    name: 'Azrieli Online',
    domains: ['shop.azrieli.com'],
    venue_ids: [],
  }),
  Merchant.parse({
    id: 'azrieli_group',
    name: 'Azrieli',
    domains: ['azrieli.com'],
    venue_ids: [],
  }),
];

describe('extractHostname', () => {
  it('pulls a URL out of shared text', () => {
    expect(extractHostname('תראה מה מצאתי https://www.KSP.co.il/web/item/1234?x=1')).toBe('ksp.co.il');
  });

  it('accepts a bare hostname', () => {
    expect(extractHostname('terminalx.com')).toBe('terminalx.com');
  });

  it('returns null for text without a URL', () => {
    expect(extractHostname('שלום עולם')).toBeNull();
  });
});

describe('resolveMerchantFromShare', () => {
  it('matches subdomains of a known merchant', () => {
    expect(resolveMerchantFromShare('https://m.ksp.co.il/item/9', merchants)?.merchant.id).toBe('ksp');
  });

  it('prefers the most specific domain', () => {
    expect(
      resolveMerchantFromShare('https://shop.azrieli.com/cart', merchants)?.merchant.id,
    ).toBe('azrieli_shop');
    expect(resolveMerchantFromShare('https://azrieli.com/about', merchants)?.merchant.id).toBe(
      'azrieli_group',
    );
  });

  it('does not match a lookalike domain', () => {
    expect(resolveMerchantFromShare('https://notksp.co.il', merchants)).toBeNull();
  });

  it('returns null for unknown merchants', () => {
    expect(resolveMerchantFromShare('https://example.com', merchants)).toBeNull();
  });
});
