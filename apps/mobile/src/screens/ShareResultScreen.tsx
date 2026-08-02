import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Evaluation } from '@sbr/core';
import { BenefitCard } from '../components/BenefitCard';
import type { ShareResult } from '../services/shareIntent';
import { colors, font, radius, spacing } from '../theme';

interface Props {
  result: ShareResult;
  onSelect: (evaluation: Evaluation) => void;
  onClose: () => void;
}

/**
 * What the user sees a second after hitting Share on a shopping site: the
 * single most valuable thing they hold for this merchant, with the catch
 * spelled out.
 */
export function ShareResultScreen({ result, onSelect, onClose }: Props) {
  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        {result.kind === 'match' ? (
          <>
            <Text style={font.title}>{result.match.merchantName}</Text>
            <Text style={font.small}>
              {result.match.hostname} · {result.match.evaluations.length} הטבות רלוונטיות לקנייה
              אונליין
            </Text>
            <View style={styles.list}>
              {result.match.evaluations.map((evaluation) => (
                <BenefitCard
                  key={evaluation.benefit.id}
                  evaluation={evaluation}
                  onPress={() => onSelect(evaluation)}
                />
              ))}
            </View>
          </>
        ) : result.kind === 'no_benefits' ? (
          <View style={styles.notice}>
            <Text style={font.heading}>אין הטבה ב{result.merchantName}</Text>
            <Text style={font.small}>
              מזהים את {result.hostname}, אבל אף אחד מהמועדונים שסימנת לא נותן שם הטבה תקפה לקנייה
              אונליין כרגע.
            </Text>
          </View>
        ) : (
          <View style={styles.notice}>
            <Text style={font.heading}>האתר לא מוכר לנו</Text>
            <Text style={font.small}>
              {result.hostname
                ? `${result.hostname} לא נמצא בקטלוג בתי העסק.`
                : 'לא זוהתה כתובת בתוכן ששותף.'}
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
        >
          <Text style={styles.ctaText}>סגור</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, gap: spacing.sm },
  list: { marginTop: spacing.lg },
  notice: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  cta: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: 'center',
  },
  ctaText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  pressed: { opacity: 0.7 },
});
