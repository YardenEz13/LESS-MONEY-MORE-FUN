import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatHeadline, formatSaving, type Evaluation } from '@sbr/core';
import { programNames } from '../services/catalog';
import { colors, font, radius, spacing } from '../theme';

interface Props {
  evaluation: Evaluation;
  onPress: () => void;
}

export function BenefitCard({ evaluation, onPress }: Props) {
  const { benefit, status, requirements } = evaluation;
  const conditional = status === 'conditional';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${formatHeadline(benefit)} ב${benefit.merchant_name}`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.headerRow}>
        <Text style={font.heading}>{benefit.merchant_name}</Text>
        <View style={[styles.badge, conditional ? styles.badgeConditional : styles.badgeEligible]}>
          <Text style={conditional ? styles.badgeTextConditional : styles.badgeTextEligible}>
            {conditional ? 'בתנאים' : 'זמין עכשיו'}
          </Text>
        </View>
      </View>

      <Text style={styles.headline}>{formatHeadline(benefit)}</Text>
      <Text style={font.small}>
        {programNames[benefit.program_id] ?? benefit.program_id} · {formatSaving(evaluation)}
      </Text>

      {requirements.length > 0 && (
        <Text style={styles.requirements} numberOfLines={2}>
          {requirements.map((r) => r.message).join(' · ')}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  pressed: { opacity: 0.7 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  headline: { fontSize: 22, fontWeight: '700', color: colors.accent },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  badgeEligible: { backgroundColor: colors.accentSoft },
  badgeConditional: { backgroundColor: colors.warningSoft },
  badgeTextEligible: { fontSize: 12, fontWeight: '600', color: colors.accent },
  badgeTextConditional: { fontSize: 12, fontWeight: '600', color: colors.warning },
  requirements: { ...font.small, marginTop: spacing.xs },
});
