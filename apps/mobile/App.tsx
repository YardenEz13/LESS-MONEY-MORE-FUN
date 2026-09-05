import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { useFonts } from 'expo-font';
import { Karantina_700Bold } from '@expo-google-fonts/karantina';
import { NotoSansHebrew_400Regular } from '@expo-google-fonts/noto-sans-hebrew';
import type { Evaluation, UserProfile } from '@sbr/core';
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
  stopGeofencing,
} from './src/services/geofencing';
import { requestNotificationPermission } from './src/services/notifications';
import { runtimeLimitation } from './src/services/runtime';
import { resolveShare, subscribeToShares, type ShareResult } from './src/services/shareIntent';
import { clearRejections, loadProfile, rejectBenefit, saveProfile, toggleMuted } from './src/state/profile';
import { logEvent } from './src/state/events';
import { colors, enforceRtl } from './src/theme';

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

type RootStackParamList = {
  onboarding: undefined;
  home: undefined;
  detail: { evaluation: Evaluation };
  settings: undefined;
  stats: undefined;
  advisor: undefined;
  share: { result: ShareResult };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Navigation was a discriminated union, and for six screens with one back
 * target each that really was less code than configuring a router. What it
 * could not produce is the edge swipe: on iOS every screen is expected to
 * come back with a drag from the edge, and a state machine has no gesture and
 * no transition to interrupt. `native-stack` is a real UINavigationController,
 * so the swipe, the interactive cancel and the parallax come from the platform
 * rather than from us imitating them.
 *
 * The header stays hidden. Screens draw their own `ScreenHeader`, which is part
 * of the type system this app is built on, and a native title bar above it
 * would be a second, conflicting one.
 *
 * `enforceRtl` forces RTL, so the gesture lives on the right edge — UIKit
 * mirrors it from the layout direction, which is the reason to let it own this
 * rather than hand-rolling a PanResponder that would have to know.
 */

/**
 * Lets the effects outside the navigator drive it — a share intent and a
 * notification tap both arrive from the OS, not from a button on screen.
 */
const navigationRef = createNavigationContainerRef<RootStackParamList>();
export default function App() {
  return (
    <SafeAreaProvider>
      <AppRoot />
    </SafeAreaProvider>
  );
}

function AppRoot() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [geofenceStatus, setGeofenceStatus] = useState('תזכורת בקניון כבויה');
  const [geofenceActive, setGeofenceActive] = useState(false);
  /** Whether the current failure is one only the OS settings page can clear. */
  const [geofenceFixable, setGeofenceFixable] = useState(false);
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
      void resolveShare(shared).then((result) => {
        if (navigationRef.isReady()) navigationRef.navigate('share', { result });
      });
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
      // Back to the list rather than onto it: the tap came from outside the
      // app, so whatever stack was left over belongs to a previous session.
      if (navigationRef.isReady()) navigationRef.navigate('home');
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

  /**
   * The settings switch, which owns the fences as well as the flag.
   *
   * Switching it off used to write `notifications_enabled: false` and stop
   * there. The fences stayed armed — `handleVenueEnter` returned early, so no
   * push arrived and it looked obeyed — while the OS went on waking the app at
   * every doorway it had been given. For an app whose settings screen promises
   * it is not following you around, leaving the monitoring running after being
   * told to stop is the wrong half to get right.
   */
  const setNotificationsEnabled = useCallback(
    async (next: UserProfile) => {
      const changed = next.notifications_enabled !== profile?.notifications_enabled;
      await persist(next);
      if (!changed) return;
      if (next.notifications_enabled) {
        await enableGeofencing();
        return;
      }
      await stopGeofencing();
      setGeofenceActive(false);
      setGeofenceFixable(false);
      setGeofenceStatus('תזכורת כבויה — אין מעקב אחרי מיקום');
    },
    [enableGeofencing, persist, profile?.notifications_enabled],
  );

  if (!fontsLoaded || !profile) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator color={colors.surfacePrimary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      <NavigationContainer ref={navigationRef}>
        <Stack.Navigator
          initialRouteName={profile.onboarded_at ? 'home' : 'onboarding'}
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.surfacePage },
          }}
        >
          <Stack.Screen name="onboarding">
            {({ navigation }) => (
              <OnboardingScreen
                profile={profile}
                onChange={persist}
                onDone={async () => {
                  await persist({ ...profile, onboarded_at: new Date().toISOString() });
                  // First run has nothing behind it; reached from settings it
                  // does, and resetting there would strand the user at home.
                  if (navigation.canGoBack()) navigation.goBack();
                  else navigation.reset({ index: 0, routes: [{ name: 'home' }] });
                  // Permission dialogs are asked for over the benefit list, not
                  // instead of it. Blocking the transition on them leaves the user
                  // staring at the form they just finished.
                  void enableGeofencing();
                }}
              />
            )}
          </Stack.Screen>

          <Stack.Screen name="home">
            {({ navigation }) => (
              <HomeScreen
                profile={profile}
                geofenceStatus={geofenceStatus}
                geofenceActive={geofenceActive}
                onSelect={(evaluation) => {
                  void logEvent({ kind: 'benefit_viewed', benefitId: evaluation.benefit.id });
                  navigation.navigate('detail', { evaluation });
                }}
                onOpenSettings={() => navigation.navigate('settings')}
                onOpenStats={() => navigation.navigate('stats')}
                onOpenAdvisor={() => navigation.navigate('advisor')}
              />
            )}
          </Stack.Screen>

          <Stack.Screen name="advisor">
            {({ navigation }) => (
              <AdvisorScreen
                profile={profile}
                onSelect={(evaluation) => {
                  void logEvent({ kind: 'benefit_viewed', benefitId: evaluation.benefit.id });
                  navigation.navigate('detail', { evaluation });
                }}
                onBack={() => navigation.goBack()}
              />
            )}
          </Stack.Screen>

          <Stack.Screen name="detail">
            {({ navigation, route }) => {
              const { evaluation } = route.params;
              // These three change what the list contains, so they return to it
              // rather than to whichever screen opened the card — `navigate`
              // pops back to the existing `home` instead of stacking a second.
              const backToList = () => navigation.navigate('home');
              return (
                <BenefitDetailScreen
                  evaluation={evaluation}
                  isMuted={profile.muted_benefit_ids.includes(evaluation.benefit.id)}
                  isRejected={profile.rejected_benefit_ids.includes(evaluation.benefit.id)}
                  onBack={() => navigation.goBack()}
                  onRedeemed={async () => {
                    await logEvent({ kind: 'benefit_redeemed', benefitId: evaluation.benefit.id });
                    backToList();
                  }}
                  onToggleMute={async () => {
                    await persist(toggleMuted(profile, evaluation.benefit.id));
                    backToList();
                  }}
                  onReport={async () => {
                    await persist(rejectBenefit(profile, evaluation.benefit.id));
                    backToList();
                  }}
                />
              );
            }}
          </Stack.Screen>

          <Stack.Screen name="share">
            {({ navigation, route }) => (
              <ShareResultScreen
                result={route.params.result}
                onSelect={(evaluation) => {
                  void logEvent({ kind: 'benefit_viewed', benefitId: evaluation.benefit.id });
                  navigation.navigate('detail', { evaluation });
                }}
                onClose={() => navigation.navigate('home')}
              />
            )}
          </Stack.Screen>

          <Stack.Screen name="settings">
            {({ navigation }) => (
              <SettingsScreen
                profile={profile}
                geofenceStatus={geofenceStatus}
                geofenceFixable={geofenceFixable}
                onClearRejections={() => void persist(clearRejections(profile))}
                onChange={setNotificationsEnabled}
                onEditPrograms={() => navigation.navigate('onboarding')}
                onEnableGeofencing={enableGeofencing}
                onBack={() => navigation.goBack()}
              />
            )}
          </Stack.Screen>

          <Stack.Screen name="stats">
            {({ navigation }) => <StatsScreen onBack={() => navigation.goBack()} />}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfacePage },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfacePage },
});
