import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import type { UserProfile } from '@sbr/core';
import { GhostButton, ScreenHeader, Section } from '../components/ui';
import { programsById, venues } from '../services/catalog';
import { handleVenueEnter } from '../services/geofencing';
import { border, colors, radius, space, type } from '../theme';

interface Props {
  profile: UserProfile;
  geofenceStatus: string;
  onChange: (profile: UserProfile) => void;
  onEditPrograms: () => void;
  onEnableGeofencing: () => void;
  onBack: () => void;
}

export function SettingsScreen({
  profile,
  geofenceStatus,
  onChange,
  onEditPrograms,
  onEnableGeofencing,
  onBack,
}: Props) {
  const [simulated, setSimulated] = useState<string | null>(null);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <ScreenHeader title="הגדרות" onBack={onBack} />

      <Section eyebrow="המועדונים שלי">
        <View style={styles.card}>
          <Text style={type.body}>
            {profile.program_ids.length === 0
              ? 'לא סומן אף מועדון.'
              : profile.program_ids.map((id) => programsById.get(id)?.name ?? id).join(' · ')}
          </Text>
          <GhostButton label="ערוך רשימה" onPress={onEditPrograms} />
        </View>
      </Section>

      <Section eyebrow="תזכורת בקניון">
        <View style={styles.card}>
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={type.bodyStrong}>התראות מיקום</Text>
              <Text style={type.caption}>{geofenceStatus}</Text>
            </View>
            <Switch
              value={profile.notifications_enabled}
              trackColor={{ true: colors.surfacePrimary, false: colors.borderHairline }}
              onValueChange={(value) => onChange({ ...profile, notifications_enabled: value })}
            />
          </View>
          <Text style={type.small}>
            {venues.length} מתחמים במעקב. מערכת ההפעלה מודיעה לנו רק על כניסה לאחד מהם — אנחנו לא
            עוקבים אחרי המיקום שלך, ושום דבר לא נשלח החוצה.
          </Text>
          <GhostButton label="הפעל מחדש" onPress={onEnableGeofencing} />
        </View>
      </Section>

      <Section eyebrow="בדיקה ידנית">
        <View style={styles.card}>
          <Text style={type.small}>
            הרצת זרימת ההתראה בלי לנסוע לקניון. עוברת דרך אותו קוד החלטה — שהייה, צינון, שעות שקט.
          </Text>
        </View>
        <View style={styles.venues}>
          {venues.map((venue) => (
            <Pressable
              key={venue.id}
              accessibilityRole="button"
              onPress={async () => {
                await handleVenueEnter(venue.id);
                setSimulated(venue.name);
              }}
              style={styles.venueRow}
            >
              <Text style={type.body}>{venue.name}</Text>
              <Text style={type.caption}>{venue.city}</Text>
            </Pressable>
          ))}
        </View>
        {simulated && (
          <View style={styles.hint}>
            <View style={styles.hintBar} />
            <Text style={styles.hintText}>
              הופעלה כניסה ל{simulated}. אם לא הגיעה התראה — סף השהייה של 3 דקות או הצינון של 12
              שעות חסם אותה, וזו התנהגות תקינה.
            </Text>
          </View>
        )}
      </Section>

      <Section eyebrow="פרטיות">
        <View style={styles.card}>
          <Text style={type.small}>
            אין חשבון, אין שרת, אין ת״ז. הפרופיל, יומן האינטראקציות והקטלוג יושבים על המכשיר.
            מחיקת האפליקציה מוחקת הכול.
          </Text>
          <Text style={type.bodyStrong}>חריג אחד: העוזר החכם</Text>
          <Text style={type.small}>
            כששואלים שאלה במסך ״שאל״, השאלה יחד עם רשימת המועדונים שסימנת וההטבות התואמות
            נשלחות ל-Gemini של Google כדי לנסח תשובה. רשימת המועדונים מעידה על דברים אישיים —
            ״חבר״ מעיד על שירות קבע, ״הייטקזון״ על מקום העבודה. שום דבר לא נשלח עד שתשאלו,
            ואפשר להשתמש באפליקציה כרגיל בלי המסך הזה.
          </Text>
        </View>
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfacePage },
  content: { paddingBottom: space.s6, gap: space.s4 },
  card: {
    marginHorizontal: space.s4,
    borderRadius: radius.sharp,
    borderWidth: border.hairline,
    borderColor: colors.borderHairline,
    padding: space.s3,
    gap: space.s3 - 4,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.s3 - 4,
  },
  switchText: { flex: 1, gap: 2 },
  venues: {
    marginHorizontal: space.s4,
    borderRadius: radius.sharp,
    borderWidth: border.hairline,
    borderColor: colors.borderHairline,
  },
  venueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.s3,
    paddingVertical: space.s3 - 4,
    paddingHorizontal: space.s3,
    borderBottomWidth: border.hairline,
    borderBottomColor: colors.borderHairlineSoft,
  },
  /* A note, not an alarm: the marker bar carries it, no coloured field. */
  hint: {
    marginHorizontal: space.s4,
    flexDirection: 'row',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sharp,
  },
  hintBar: { width: border.marker, backgroundColor: colors.accentUrgent },
  hintText: { ...type.small, flex: 1, padding: space.s3 },
});
