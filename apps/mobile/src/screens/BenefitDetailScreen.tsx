import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  formatHeadline,
  formatLastVerified,
  formatSaving,
  type Evaluation,
} from '@sbr/core';
import { ConditionList } from '../components/ConditionList';
import { programNames } from '../services/catalog';
import { colors, font, radius, spacing } from '../theme';

interface Props {
  evaluation: Evaluation;
  isMuted: boolean;
  onBack: () => void;
  onRedeemed: () => void;
  onToggleMute: () => void;
}

export function BenefitDetailScreen({
  evaluation,
  isMuted,
  onBack,
  onRedeemed,
  onToggleMute,
}: Props) {
  const { benefit } = evaluation;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={onBack} accessibilityRole="button">
          <Text style={styles.back}>← חזרה</Text>
        </Pressable>

        <View style={styles.hero}>
          <Text style={font.heading}>{benefit.merchant_name}</Text>
          <Text style={styles.headline}>{formatHeadline(benefit)}</Text>
          <Text style={font.small}>
            {programNames[benefit.program_id] ?? benefit.program_id} · {formatSaving(evaluation)}
          </Text>
        </View>

        <Text style={styles.sectionTitle}>התנאים</Text>
        <ConditionList evaluation={evaluation} />

        <Text style={styles.sectionTitle}>מה כתוב בתקנון</Text>
        <View style={styles.quote}>
          <Text style={font.body}>{benefit.conditions.raw_text_summary}</Text>
        </View>

        <View style={styles.trustRow}>
          <Text style={font.small}>{formatLastVerified(benefit)}</Text>
          <Pressable
            accessibilityRole="link"
            onPress={() => void Linking.openURL(benefit.source_url)}
          >
            <Text style={styles.link}>פתח את המקור</Text>
          </Pressable>
        </View>
        <Text style={font.mono}>
          confidence {benefit.confidence_score.toFixed(2)}
          {benefit.reviewed_by_human ? ' · אושר ידנית' : ''}
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          onPress={onRedeemed}
          style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
        >
          <Text style={styles.ctaText}>מימשתי את ההטבה</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onToggleMute}
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
        >
          <Text style={styles.secondaryText}>{isMuted ? 'בטל השתקה' : 'השתק'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, gap: spacing.md, paddingBottom: spacing.xxl },
  back: { ...font.small, color: colors.accent },
  hero: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  headline: { fontSize: 30, fontWeight: '700', color: colors.accent },
  sectionTitle: { ...font.heading, fontSize: 16, marginTop: spacing.md },
  quote: {
    backgroundColor: colors.surface,
    borderRightWidth: 3,
    borderRightColor: colors.accent,
    borderRadius: radius.sm,
    padding: spacing.lg,
  },
  trustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  link: { ...font.small, color: colors.accent, textDecorationLine: 'underline' },
  footer: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  cta: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: 'center',
  },
  ctaText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  secondary: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  },
  secondaryText: font.body,
  pressed: { opacity: 0.7 },
});
