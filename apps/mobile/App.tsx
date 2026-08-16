import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { useFonts } from 'expo-font';
import { Karantina_700Bold } from '@expo-google-fonts/karantina';
import { NotoSansHebrew_400Regular } from '@expo-google-fonts/noto-sans-hebrew';
import type { Evaluation, UserProfile } from '@sbr/core';
import { KitProvider } from './src/components/Kit';
import { AdvisorScreen } from './src/screens/AdvisorScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { BenefitDetailScreen } from './src/screens/BenefitDetailScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { ShareResultScreen } from './src/screens/ShareResultScreen';
import { StatsScreen } from './src/screens/StatsScreen';
import {
  refreshFencesIfMoved,
  resumeGeofencing,
  startGeofencing,
} from './src/services/geofencing';
import { requestNotificationPermission } from './src/services/notifications';
import { runtimeLimitation } from './src/services/runtime';
import { resolveShare, subscribeToShares, type ShareResult } from './src/services/shareIntent';
import { loadProfile, saveProfile, toggleMuted } from './src/state/profile';
import { loadKitIntensity, saveKitIntensity } from './src/state/kit';
import { logEvent } from './src/state/events';
import { colors, enforceRtl, type KitIntensity } from './src/theme';

enforceRtl();

/**
 * Why the reminder is off, in the user's terms. Each one names the thing they
 * would have to change — a refused prompt and a switched-off GPS need
 * different actions, and "location unavailable" tells them neither.
 */
const GEOFENCE_FAILURE: Record<string, string> = {
  services_disabled: 'שירותי המיקום כבויים במכשיר — ההטבות ברשימה, בלי תזכורת בקניון',
  foreground_denied: 'אין הרשאת מיקום — ההטבות ברשימה, בלי תזכורת בקניון',
  background_denied: 'ההרשאה ניתנה רק בזמן שימוש — בחר ״תמיד״ בהגדרות כדי לקבל תזכורת בקניון',
  runtime_unsupported: 'צריך development build כדי לקבל תזכורת בקניון',
};

/**
 * Failures the OS will only let the user reverse from its own settings screen,
 * so retrying in-app can never clear them.
 *
 * Both platforms refuse the grant the app asks for, and neither says so in a
 * way the retry button can act on. Android 11+ will not show a dialog for
 * background location at all — the request returns denied the moment it is
 * made, and "Allow all the time" exists only in the app's settings page. iOS
 * never grants "always" on a first ask either: it offers while-in-use, and
 * promotes to always later or not at all. Notifications are the same shape once
 * refused. Left alone, "הפעל מחדש" is a button that cannot work, so anything
 * landing here gets handed the settings page instead.
 *
 * Native only: a browser has no app settings page to open, and
 * react-native-web's Linking implements `openURL` and nothing else — offering
 * the button there would hand the reader a crash instead of a permission. The
 * web build denies location through the same `foreground_denied`, so this has
 * to be checked here rather than inferred from the reason.
 */
const canOpenAppSettings = Platform.OS !== 'web';
const SETTINGS_FIXABLE = new Set(['foreground_denied', 'background_denied']);

type Screen =
  | { name: 'loading' }
  | { name: 'onboarding' }
  | { name: 'home' }
  | { name: 'detail'; evaluation: Evaluation }
  | { name: 'settings' }
  | { name: 'stats' }
  | { name: 'advisor' }
  | { name: 'share'; result: ShareResult };

/**
 * Navigation is a discriminated union rather than a router library: six
 * screens, one back-target each. A router would be more code to configure
 * than the whole flow contains.
 */
export default function App() {
  return (
    <SafeAreaProvider>
      <AppRoot />
    </SafeAreaProvider>
  );
}

function AppRoot() {
  const [screen, setScreen] = useState<Screen>({ name: 'loading' });
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [geofenceStatus, setGeofenceStatus] = useState('תזכורת בקניון כבויה');
  const [geofenceActive, setGeofenceActive] = useState(false);
  /** Whether the current failure is one only the OS settings page can clear. */
  const [geofenceFixable, setGeofenceFixable] = useState(false);
  /**
   * How loud the kit is. Lives beside the profile rather than inside it — see
   * `state/kit.ts` — and starts at `full`, so the first frame after the fonts
   * land is already striped rather than dressing itself a tick later.
   */
  const [kitIntensity, setKitIntensity] = useState<KitIntensity>('full');

  const changeKit = useCallback(async (next: KitIntensity) => {
    setKitIntensity(next);
    await saveKitIntensity(next);
  }, []);

  // The EFT pair carries the Hebrew; the two Google faces carry Latin runs
  // inside it — see the `latinFace` note in theme.ts.
  const [fontsLoaded] = useFonts({
    EFT_OffSet: require('./assets/EFT_OffSet-Bold.ttf'),
    EFT_Artzisraeli: require('./assets/EFT_Artzisraeli.ttf'),
    Karantina_700Bold,
    NotoSansHebrew_400Regular,
  });

  const persist = useCallback(async (next: UserProfile) => {
    setProfile(next);
    await saveProfile(next);
  }, []);

  useEffect(() => {
    void (async () => {
      const loaded = await loadProfile();
      setProfile(loaded);
      setKitIntensity(await loadKitIntensity());
      setScreen(loaded.onboarded_at ? { name: 'home' } : { name: 'onboarding' });
      // Re-arms a fence the OS dropped since last launch, and never prompts —
      // see `resumeGeofencing`. Silent when nothing was granted yet.
      if (await resumeGeofencing()) {
        setGeofenceActive(true);
        setGeofenceStatus('תזכורת בקניון פעילה');
      }
    })();
  }, []);

  // The fence set is chosen around where the user was. Coming back to the app
  // is the cheapest honest moment to notice they have moved — see
  // `refreshFencesIfMoved`, which reads the cached position and never prompts.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshFencesIfMoved();
    });
    return () => subscription.remove();
  }, []);

  // A share can arrive while the app is cold or already open; both land here.
  useEffect(() => {
    return subscribeToShares((shared) => {
      void resolveShare(shared).then((result) => setScreen({ name: 'share', result }));
    });
  }, []);

  // Opening a venue notification is the signal KPI #1 is built on.
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const venueId = response.notification.request.content.data?.venueId;
      void logEvent({
        kind: 'notification_opened',
        venueId: typeof venueId === 'string' ? venueId : undefined,
      });
      setScreen({ name: 'home' });
    });
    return () => subscription.remove();
  }, []);

  const enableGeofencing = useCallback(async () => {
    // Expo Go cannot deliver either half of this, so say so instead of walking
    // the user through two permission dialogs that buy them nothing.
    const limitation = runtimeLimitation();
    if (limitation) {
      setGeofenceActive(false);
      setGeofenceStatus(limitation);
      return;
    }

    const granted = await requestNotificationPermission();
    if (!granted) {
      setGeofenceActive(false);
      setGeofenceFixable(canOpenAppSettings);
      setGeofenceStatus('אין הרשאת התראות — אין דרך להזכיר בכניסה לקניון');
      return;
    }
    const result = await startGeofencing();
    setGeofenceActive(result.ok);
    setGeofenceFixable(canOpenAppSettings && !result.ok && SETTINGS_FIXABLE.has(result.reason));
    setGeofenceStatus(
      result.ok
        ? `תזכורת פעילה · ${result.venueCount} מקומות בקרבתך`
        : GEOFENCE_FAILURE[result.reason],
    );
  }, []);

  if (!fontsLoaded || !profile || screen.name === 'loading') {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator color={colors.surfacePrimary} />
      </SafeAreaView>
    );
  }

  return (
    <KitProvider intensity={kitIntensity}>
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      <View style={styles.body}>
        {screen.name === 'onboarding' && (
          <OnboardingScreen
            profile={profile}
            onChange={persist}
            onDone={async () => {
              await persist({ ...profile, onboarded_at: new Date().toISOString() });
              setScreen({ name: 'home' });
              // Permission dialogs are asked for over the benefit list, not
              // instead of it. Blocking the transition on them leaves the user
              // staring at the form they just finished.
              void enableGeofencing();
            }}
          />
        )}

        {screen.name === 'home' && (
          <HomeScreen
            profile={profile}
            geofenceStatus={geofenceStatus}
            geofenceActive={geofenceActive}
            onSelect={(evaluation) => {
              void logEvent({ kind: 'benefit_viewed', benefitId: evaluation.benefit.id });
              setScreen({ name: 'detail', evaluation });
            }}
            onOpenSettings={() => setScreen({ name: 'settings' })}
            onOpenStats={() => setScreen({ name: 'stats' })}
            onOpenAdvisor={() => setScreen({ name: 'advisor' })}
          />
        )}

        {screen.name === 'advisor' && (
          <AdvisorScreen
            profile={profile}
            onSelect={(evaluation) => {
              void logEvent({ kind: 'benefit_viewed', benefitId: evaluation.benefit.id });
              setScreen({ name: 'detail', evaluation });
            }}
            onBack={() => setScreen({ name: 'home' })}
          />
        )}

        {screen.name === 'detail' && (
          <BenefitDetailScreen
            evaluation={screen.evaluation}
            isMuted={profile.muted_benefit_ids.includes(screen.evaluation.benefit.id)}
            onBack={() => setScreen({ name: 'home' })}
            onRedeemed={async () => {
              await logEvent({
                kind: 'benefit_redeemed',
                benefitId: screen.evaluation.benefit.id,
              });
              setScreen({ name: 'home' });
            }}
            onToggleMute={async () => {
              await persist(toggleMuted(profile, screen.evaluation.benefit.id));
              setScreen({ name: 'home' });
            }}
          />
        )}

        {screen.name === 'share' && (
          <ShareResultScreen
            result={screen.result}
            onSelect={(evaluation) => {
              void logEvent({ kind: 'benefit_viewed', benefitId: evaluation.benefit.id });
              setScreen({ name: 'detail', evaluation });
            }}
            onClose={() => setScreen({ name: 'home' })}
          />
        )}

        {screen.name === 'settings' && (
          <SettingsScreen
            profile={profile}
            geofenceStatus={geofenceStatus}
            geofenceFixable={geofenceFixable}
            kitIntensity={kitIntensity}
            onChange={persist}
            onChangeKit={(next) => void changeKit(next)}
            onEditPrograms={() => setScreen({ name: 'onboarding' })}
            onEnableGeofencing={enableGeofencing}
            onBack={() => setScreen({ name: 'home' })}
          />
        )}

        {screen.name === 'stats' && <StatsScreen onBack={() => setScreen({ name: 'home' })} />}
      </View>
    </SafeAreaView>
    </KitProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfacePage },
  body: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfacePage },
});
