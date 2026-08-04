import AsyncStorage from '@react-native-async-storage/async-storage';
import { UserProfile } from '@sbr/core';

const STORAGE_KEY = 'sbr.profile.v1';

export const emptyProfile: UserProfile = {
  program_ids: [],
  muted_benefit_ids: [],
  notifications_enabled: true,
  onboarded_at: null,
};

/**
 * The entire user model: a list of club ids on the device.
 *
 * No account, no ID number, no card number. That's the Zero-Auth promise in
 * the PRD.
 *
 * It used to be enforced by there being no network write path at all. There is
 * now exactly one, and it is worth stating plainly rather than letting a reader
 * discover it: `services/advisor.ts` sends the question, this program list and
 * the matching benefits to Gemini when the user asks the advisor something.
 * Nothing is sent otherwise, and the settings screen says so in Hebrew.
 *
 * That is the only sanctioned exception. If you are about to add a second one,
 * this comment is still the thing you have to argue with first.
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
