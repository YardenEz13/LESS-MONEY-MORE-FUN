import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { rankBenefits, type Evaluation, type UserProfile } from '@sbr/core';
import { BenefitCard } from '../components/BenefitCard';
import { benefits } from '../services/catalog';
import { colors, font, radius, spacing } from '../theme';

interface Props {
  profile: UserProfile;
  geofenceStatus: string;
  onSelect: (evaluation: Evaluation) => void;
  onOpenSettings: () => void;
  onOpenStats: () => void;
}

export function HomeScreen({
  profile,
  geofenceStatus,
  onSelect,
  onOpenSettings,
  onOpenStats,
}: Props) {
  // Channel is left unset on the home list: the user isn't at a till or in a
  // checkout yet, so an in-store-only benefit is a note, not a blocker.
  const evaluations = useMemo(
    () =>
      rankBenefits(benefits, {
        now: new Date(),
        ownedProgramIds: profile.program_ids,
        mutedBenefitIds: profile.muted_benefit_ids,
      }),
    [profile.program_ids, profile.muted_benefit_ids],
  );

  const eligible = evaluations.filter((e) => e.status === 'eligible').length;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={font.title}>ההטבות שלך</Text>
          <Text style={font.small}>
            {evaluations.length} רלוונטיות · {eligible} זמינות עכשיו
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable onPress={onOpenStats} accessibilityRole="button" style={styles.iconButton}>
            <Text style={styles.iconText}>סטטיסטיקה</Text>
          </Pressable>
          <Pressable onPress={onOpenSettings} accessibilityRole="button" style={styles.iconButton}>
            <Text style={styles.iconText}>הגדרות</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.geofenceBar}>
        <Text style={font.small}>{geofenceStatus}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {evaluations.length === 0 ? (
          <View style={styles.empty}>
            <Text style={font.heading}>אין הטבות להצגה</Text>
            <Text style={font.small}>
              או שאף מועדון לא מסומן, או שכל ההטבות בקטלוג חסומות כרגע (יום, שעה, תוקף או אימות
              ישן). זה תקין — עדיף רשימה ריקה מהטבה שלא באמת תקפה.
            </Text>
          </View>
        ) : (
          evaluations.map((evaluation) => (
            <BenefitCard
              key={evaluation.benefit.id}
              evaluation={evaluation}
              onPress={() => onSelect(evaluation)}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    padding: spacing.xl,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  headerText: { flex: 1, gap: 2 },
  headerActions: { flexDirection: 'row', gap: spacing.sm },
  iconButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconText: { ...font.small, color: colors.text },
  geofenceBar: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  list: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  empty: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.sm,
  },
});
