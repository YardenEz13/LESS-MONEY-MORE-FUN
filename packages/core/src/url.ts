import type { Merchant } from './types';

/**
 * Extract a comparable hostname from arbitrary shared text. The Share sheet on
 * both platforms hands us anything from a bare URL to "Check this out <url>",
 * so the resolver has to dig the URL out first.
 */
export function extractHostname(shared: string): string | null {
  const candidate = shared.match(/https?:\/\/[^\s"'<>]+/i)?.[0] ?? shared.trim();
  try {
    const url = new URL(candidate.includes('://') ? candidate : `https://${candidate}`);
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function hostMatches(host: string, domain: string): boolean {
  const normalized = domain.toLowerCase().replace(/^www\./, '');
  return host === normalized || host.endsWith(`.${normalized}`);
}

/**
 * Resolve shared content to a known merchant. Returns the most specific match
 * so that `shop.example.co.il` wins over a generic `example.co.il` entry.
 */
export function resolveMerchantFromShare(
  shared: string,
  merchants: readonly Merchant[],
): { merchant: Merchant; hostname: string } | null {
  const hostname = extractHostname(shared);
  if (!hostname) return null;

  let best: { merchant: Merchant; length: number } | null = null;
  for (const merchant of merchants) {
    for (const domain of merchant.domains) {
      if (!hostMatches(hostname, domain)) continue;
      if (!best || domain.length > best.length) {
        best = { merchant, length: domain.length };
      }
    }
  }
  return best ? { merchant: best.merchant, hostname } : null;
}
