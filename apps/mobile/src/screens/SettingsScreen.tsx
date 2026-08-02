import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import type { UserProfile } from '@sbr/core';
import { programsById, venues } from '../services/catalog';
import { handleVenueEnter } from '../services/geofencing';
import { colors, font, radius, spacing } from '../theme';

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
      <Pressable onPress={onBack} accessibilityRole="button">
        <Text style={styles.back}>← חזרה</Text>
      </Pressable>
      <Text style={font.title}>הגדרות</Text>

      <View style={styles.card}>
        <Text style={font.heading}>המועדונים שלי</Text>
        <Text style={font.small}>
          {profile.program_ids.length === 0
            ? 'לא סומן אף מועדון'
            : profile.program_ids
                .map((id) => programsById.get(id)?.name ?? id)
                .join(' · ')}
        </Text>
        <Pressable onPress={onEditPrograms} style={styles.secondary} accessibilityRole="button">
          <Text style={styles.secondaryText}>ערוך</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <View style={styles.switchRow}>
          <Text style={font.heading}>התראות מיקום</Text>
          <Switch
            value={profile.notifications_enabled}
            onValueChange={(value) => onChange({ ...profile, notifications_enabled: value })}
          />
        </View>
        <Text style={font.small}>{geofenceStatus}</Text>
        <Text style={font.small}>
          {venues.length} מתחמים במעקב. אנחנו לא עוקבים אחרי המיקום שלך — מערכת ההפעלה מודיעה לנו
          רק כשנכנסת לאחד מהמתחמים האלה, וגם אז שום דבר לא נשלח החוצה.
        </Text>
        <Pressable onPress={onEnableGeofencing} style={styles.secondary} accessibilityRole="button">
          <Text style={styles.secondaryText}>הפעל מחדש</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={font.heading}>בדיקה ידנית</Text>
        <Text style={font.small}>
          הרץ את זרימת ההתראה בלי לנסוע לקניון. עובר דרך אותו קוד החלטה (שהייה, צינון, שעות שקט).
        </Text>
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
            <Text style={font.body}>{venue.name}</Text>
            <Text style={font.small}>{venue.city}</Text>
          </Pressable>
        ))}
        {simulated && (
          <Text style={styles.hint}>
            הופעלה כניסה ל{simulated}. אם לא הגיעה התראה — סביר שסף השהייה של 3 דקות או הצינון של
            12 שעות חסם אותה. זו התנהגות תקינה.
          </Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={font.heading}>פרטיות</Text>
        <Text style={font.small}>
          אין חשבון, אין שרת, אין ת״ז. הפרופיל, יומן האינטראקציות והקטלוג יושבים על המכשיר. מחיקת
          האפליקציה מוחקת הכול.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxl },
  back: { ...font.small, color: colors.accent },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  secondary: {
    alignSelf: 'flex-start',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  secondaryText: { ...font.small, color: colors.text },
  venueRow: {
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  hint: { ...font.small, color: colors.warning },
});
