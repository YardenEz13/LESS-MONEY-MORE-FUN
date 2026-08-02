import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { clearEvents, computeKpis, loadEvents, type Kpis } from '../state/events';
import { colors, font, radius, spacing } from '../theme';

/**
 * The 30-day validation step from the PRD needs numbers, and there is no
 * analytics backend to read them from. This screen is that readout.
 */
export function StatsScreen({ onBack }: { onBack: () => void }) {
  const [kpis, setKpis] = useState<Kpis | null>(null);

  const refresh = useCallback(async () => {
    setKpis(computeKpis(await loadEvents()));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ratio =
    kpis?.decisionImpactRatio == null ? '—' : `${Math.round(kpis.decisionImpactRatio * 100)}%`;
  const meetsTarget = (kpis?.decisionImpactRatio ?? 0) >= 0.3;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Pressable onPress={onBack} accessibilityRole="button">
        <Text style={styles.back}>← חזרה</Text>
      </Pressable>
      <Text style={font.title}>איך זה עובד בפועל</Text>

      <View style={[styles.hero, meetsTarget ? styles.heroGood : styles.heroNeutral]}>
        <Text style={font.small}>יחס השפעה על החלטה (יעד: 30%)</Text>
        <Text style={styles.ratio}>{ratio}</Text>
        <Text style={font.small}>
          חלק ההתראות שהובילו לפתיחת פירוט או ללחיצה על ״מימשתי״.
        </Text>
      </View>

      <View style={styles.card}>
        <Row label="התראות שנשלחו" value={kpis?.notificationsSent ?? 0} />
        <Row label="התראות שנפתחו" value={kpis?.notificationsOpened ?? 0} />
        <Row label="מימושים שדווחו" value={kpis?.redeemed ?? 0} />
        <Row label="שיתופים שזוהו" value={kpis?.shareResolved ?? 0} />
        <Row label="שיתופים ללא התאמה" value={kpis?.shareUnmatched ?? 0} />
      </View>

      <Text style={font.small}>
        אם ״שיתופים ללא התאמה״ גבוה — חסרים דומיינים ב-merchants.json, וזה התיקון הזול ביותר שאפשר
        לעשות לאפליקציה הזו.
      </Text>

      <Pressable
        accessibilityRole="button"
        onPress={async () => {
          await clearEvents();
          await refresh();
        }}
        style={styles.secondary}
      >
        <Text style={styles.secondaryText}>אפס מונים</Text>
      </Pressable>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.row}>
      <Text style={font.body}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxl },
  back: { ...font.small, color: colors.accent },
  hero: { borderRadius: radius.md, padding: spacing.xl, gap: spacing.xs },
  heroGood: { backgroundColor: colors.accentSoft },
  heroNeutral: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  ratio: { fontSize: 44, fontWeight: '700', color: colors.accent },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowValue: { ...font.body, fontWeight: '700' },
  secondary: {
    alignSelf: 'flex-start',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  secondaryText: { ...font.small, color: colors.text },
});
