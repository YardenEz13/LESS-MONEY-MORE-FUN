import AsyncStorage from '@react-native-async-storage/async-storage';
import { UserProfile } from '@sbr/core';

const STORAGE_KEY = 'sbr.profile.v1';

export const emptyProfile: UserProfile = {
  program_ids: [],
  muted_benefit_ids: [],
  rejected_benefit_ids: [],
  notifications_enabled: true,
  onboarded_at: null,
};

/**
 * The entire user model: a list of club ids on the device.
 *
 * No account, no ID number, no card number. That's the Zero-Auth promise in
 * the PRD.
 *
 * It used to be enforced by there being no network write path at all. There are
 * now exactly two, and they are worth stating plainly rather than letting a
 * reader discover them:
 *
 * 1. `services/advisor.ts` sends the question, this program list and the
 *    matching benefits to Gemini when the user asks the advisor something.
 *    Nothing is sent otherwise, and the settings screen says so in Hebrew.
 * 2. `services/watch.ts` fetches the product page the user chose to watch, from
 *    the shop's own site, so the phone can read its price. That is a plain GET
 *    to a URL the person supplied: it carries no profile, no club list and no
 *    watchlist, and the response is parsed on the device. The watchlist and
 *    the price history never leave it. The shop sees what it sees from any
 *    visitor opening the page (an IP address and a user-agent naming this app),
 *    and the settings and watch screens say that in Hebrew.
 *
 * Those are the only sanctioned exceptions, and the second is sanctioned
 * because it moves nothing about the person — only the page they asked about.
 * If you are about to add a third, or to send anything personal along with the
 * second, this comment is still the thing you have to argue with first.
 */
export async function loadProfile(): Promise<UserProfile> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyProfile;
    return UserProfile.parse(JSON.parse(raw));
  } catch {
    // A profile we can't read is a profile worth rebuilding — onboarding is
    // under a minute, and a crash loop on launch is not.
    return emptyProfile;
  }
}

export async function saveProfile(profile: UserProfile): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

export function toggleProgram(profile: UserProfile, programId: string): UserProfile {
  const has = profile.program_ids.includes(programId);
  return {
    ...profile,
    program_ids: has
      ? profile.program_ids.filter((id) => id !== programId)
      : [...profile.program_ids, programId],
  };
}

export function toggleMuted(profile: UserProfile, benefitId: string): UserProfile {
  const has = profile.muted_benefit_ids.includes(benefitId);
  return {
    ...profile,
    muted_benefit_ids: has
      ? profile.muted_benefit_ids.filter((id) => id !== benefitId)
      : [...profile.muted_benefit_ids, benefitId],
  };
}

/**
 * Mark a benefit as wrong. One way only: un-rejecting from the app would let
 * someone quietly withdraw a report they no longer remember making, and the
 * catalog fix belongs in the review queue rather than on the device. Clearing
 * happens in settings, after the ids have been handed to `npm run unpublish`.
 */
export function rejectBenefit(profile: UserProfile, benefitId: string): UserProfile {
  if (profile.rejected_benefit_ids.includes(benefitId)) return profile;
  return { ...profile, rejected_benefit_ids: [...profile.rejected_benefit_ids, benefitId] };
}

export function clearRejections(profile: UserProfile): UserProfile {
  return { ...profile, rejected_benefit_ids: [] };
}
