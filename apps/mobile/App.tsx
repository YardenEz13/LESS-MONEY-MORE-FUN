import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import type { Evaluation, UserProfile } from '@sbr/core';
import { HomeScreen } from './src/screens/HomeScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { BenefitDetailScreen } from './src/screens/BenefitDetailScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { ShareResultScreen } from './src/screens/ShareResultScreen';
import { StatsScreen } from './src/screens/StatsScreen';
import { isGeofencingActive, startGeofencing } from './src/services/geofencing';
import { requestNotificationPermission } from './src/services/notifications';
import { resolveShare, subscribeToShares, type ShareResult } from './src/services/shareIntent';
import { loadProfile, saveProfile, toggleMuted } from './src/state/profile';
import { logEvent } from './src/state/events';
import { colors, enforceRtl } from './src/theme';

enforceRtl();

type Screen =
  | { name: 'loading' }
  | { name: 'onboarding' }
  | { name: 'home' }
  | { name: 'detail'; evaluation: Evaluation }
  | { name: 'settings' }
  | { name: 'stats' }
  | { name: 'share'; result: ShareResult };

/**
 * Navigation is a discriminated union rather than a router library: six
 * screens, one back-target each. A router would be more code to configure
 * than the whole flow contains.
 */
export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'loading' });
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [geofenceStatus, setGeofenceStatus] = useState('התראות מיקום לא הופעלו');

  const persist = useCallback(async (next: UserProfile) => {
    setProfile(next);
    await saveProfile(next);
  }, []);

  useEffect(() => {
    void (async () => {
      const loaded = await loadProfile();
      setProfile(loaded);
      setScreen(loaded.onboarded_at ? { name: 'home' } : { name: 'onboarding' });
      if (await isGeofencingActive()) {
        setGeofenceStatus('התראות מיקום פעילות');
      }
    })();
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
    const granted = await requestNotificationPermission();
    if (!granted) {
      setGeofenceStatus('אין הרשאת התראות — אי אפשר להזכיר בכניסה לקניון');
      return;
    }
    const result = await startGeofencing();
    setGeofenceStatus(
      result.ok
        ? `התראות מיקום פעילות · ${result.venueCount} מתחמים`
        : result.reason === 'foreground_denied'
          ? 'אין הרשאת מיקום — ההטבות עדיין ברשימה, בלי תזכורת בקניון'
          : 'הרשאת רקע חסרה — התזכורת תעבוד רק כשהאפליקציה פתוחה',
    );
  }, []);

  if (!profile || screen.name === 'loading') {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      <View style={styles.body}>
        {screen.name === 'onboarding' && (
          <OnboardingScreen
            profile={profile}
            onChange={persist}
            onDone={async () => {
              await persist({ ...profile, onboarded_at: new Date().toISOString() });
              await enableGeofencing();
              setScreen({ name: 'home' });
            }}
          />
        )}

        {screen.name === 'home' && (
          <HomeScreen
            profile={profile}
            geofenceStatus={geofenceStatus}
            onSelect={(evaluation) => {
              void logEvent({ kind: 'benefit_viewed', benefitId: evaluation.benefit.id });
              setScreen({ name: 'detail', evaluation });
            }}
            onOpenSettings={() => setScreen({ name: 'settings' })}
            onOpenStats={() => setScreen({ name: 'stats' })}
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
            onChange={persist}
            onEditPrograms={() => setScreen({ name: 'onboarding' })}
            onEnableGeofencing={enableGeofencing}
            onBack={() => setScreen({ name: 'home' })}
          />
        )}

        {screen.name === 'stats' && <StatsScreen onBack={() => setScreen({ name: 'home' })} />}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
});
