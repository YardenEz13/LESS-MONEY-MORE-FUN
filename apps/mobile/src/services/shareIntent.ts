import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import { rankBenefits, resolveMerchantFromShare, type Evaluation } from '@sbr/core';
import { benefitsForMerchant, merchants, ownedProgramIds } from './catalog';
import { loadProfile } from '../state/profile';
import { logEvent } from '../state/events';

export interface ShareMatch {
  hostname: string;
  merchantName: string;
  merchantId: string;
  evaluations: Evaluation[];
}

export type ShareResult =
  | { kind: 'match'; match: ShareMatch }
  | { kind: 'no_merchant'; hostname: string | null }
  | { kind: 'no_benefits'; hostname: string; merchantName: string };

/**
 * Resolve a shared URL to the best benefit the user actually holds.
 *
 * The channel is pinned to `online` here — the user is standing in a mobile
 * checkout, so an in-store-only benefit is genuinely blocked rather than
 * merely unverified, and the engine will filter it out instead of teasing it.
 */
export async function resolveShare(shared: string): Promise<ShareResult> {
  const profile = await loadProfile();
  const resolved = resolveMerchantFromShare(shared, merchants);

  if (!resolved) {
    const hostname = shared.match(/https?:\/\/([^/\s]+)/i)?.[1] ?? null;
    await logEvent({ kind: 'share_unmatched', hostname: hostname ?? undefined });
    return { kind: 'no_merchant', hostname };
  }

  const evaluations = rankBenefits(benefitsForMerchant(resolved.merchant.id), {
    now: new Date(),
    ownedProgramIds: ownedProgramIds(profile.program_ids),
    mutedBenefitIds: profile.muted_benefit_ids,
    channel: 'online',
  });

  if (evaluations.length === 0) {
    await logEvent({ kind: 'share_unmatched', hostname: resolved.hostname });
    return {
      kind: 'no_benefits',
      hostname: resolved.hostname,
      merchantName: resolved.merchant.name,
    };
  }

  await logEvent({ kind: 'share_resolved', hostname: resolved.hostname });
  return {
    kind: 'match',
    match: {
      hostname: resolved.hostname,
      merchantName: resolved.merchant.name,
      merchantId: resolved.merchant.id,
      evaluations,
    },
  };
}

/**
 * Watch for content arriving from the OS share sheet.
 *
 * On Android the SEND intent surfaces through the deep link; on iOS a real
 * Share Extension is a separate native target (see docs/SHARE_EXTENSION.md) —
 * until that exists, the `sbr://share?url=...` scheme is what the shortcut
 * hits, and it exercises the same resolver.
 */
export function subscribeToShares(onShare: (shared: string) => void): () => void {
  const extract = (url: string): string | null => {
    const parsed = Linking.parse(url);
    const shared = parsed.queryParams?.url ?? parsed.queryParams?.text;
    if (typeof shared === 'string') return shared;
    // An `sbr://` link that isn't the share route is ordinary navigation.
    if (url.startsWith('sbr://')) return null;
    // Android delivers a SEND intent as a bare http(s) URL. On web the same
    // API hands back the app's own address on every load, which is not a
    // share — without this the app would open the share screen at launch.
    if (Platform.OS === 'web') return null;
    return url;
  };

  void Linking.getInitialURL().then((url) => {
    if (!url) return;
    const shared = extract(url);
    if (shared) onShare(shared);
  });

  const subscription = Linking.addEventListener('url', ({ url }) => {
    const shared = extract(url);
    if (shared) onShare(shared);
  });

  return () => subscription.remove();
}
