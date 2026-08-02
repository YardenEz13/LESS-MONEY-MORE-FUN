import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { GhostButton, ScreenHeader, Section } from '../components/ui';
import { clearEvents, computeKpis, loadEvents, type Kpis } from '../state/events';
import { colors, fonts, radius, space, type } from '../theme';

const TARGET = 0.3;

/**
 * The 30-day validation step needs numbers and there is no analytics backend
 * to read them from, so this screen is the readout. The target is drawn on the
 * bar itself — a percentage without its bar is just a number.
 */
export function StatsScreen({ onBack }: { onBack: () => void }) {
  const [kpis, setKpis] = useState<Kpis | null>(null);

  const refresh = useCallback(async () => {
    setKpis(computeKpis(await loadEvents()));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ratio = kpis?.decisionImpactRatio ?? null;
  const met = (ratio ?? 0) >= TARGET;
  const fill = Math.max(0, Math.min(1, ratio ?? 0));

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <ScreenHeader eyebrow="30 ימי בדיקה" title="האם זה עובד" onBack={onBack} />

      <View style={styles.hero}>
        <Text style={type.eyebrow}>יחס השפעה על החלטה</Text>
        {/* A 52px em-dash reads as a broken element, not as "no data". Say it. */}
        {ratio == null ? (
          <Text style={styles.ratioEmpty}>טרם נמדד</Text>
        ) : (
          <Text style={[styles.ratio, met && styles.ratioMet]}>{Math.round(ratio * 100)}%</Text>
        )}
        <View style={styles.track}>
          <View style={[styles.fill, met && styles.fillMet, { width: `${fill * 100}%` }]} />
          <View style={[styles.target, { start: `${TARGET * 100}%` }]} />
        </View>
        <View style={styles.trackLabels}>
          <Text style={type.caption}>
            {ratio == null
              ? 'עוד לא נשלחו התראות'
              : met
                ? 'מעל היעד'
                : `${Math.round((TARGET - fill) * 100)} נקודות מתחת ליעד`}
          </Text>
          <Text style={type.caption}>יעד 30%</Text>
        </View>
        <Text style={type.small}>
          חלק ההתראות שהובילו לפתיחת פירוט או ללחיצה על ״מימשתי״. מתחת ליעד פירושו שההתראות מגיעות
          ברגע הלא נכון — לא שההטבות גרועות.
        </Text>
      </View>

      <Section eyebrow="ספירה גולמית">
        <View style={styles.table}>
          <Row label="התראות שנשלחו" value={kpis?.notificationsSent ?? 0} />
          <Row label="התראות שנפתחו" value={kpis?.notificationsOpened ?? 0} />
          <Row label="מימושים שדווחו" value={kpis?.redeemed ?? 0} />
          <Row label="שיתופים שזוהו" value={kpis?.shareResolved ?? 0} />
          <Row label="שיתופים ללא התאמה" value={kpis?.shareUnmatched ?? 0} last />
        </View>
        <Text style={styles.note}>
          ״שיתופים ללא התאמה״ גבוה פירושו שחסרים דומיינים ב-merchants.json — התיקון הזול ביותר
          שאפשר לעשות לאפליקציה הזו.
        </Text>
      </Section>

      <View style={styles.reset}>
        <GhostButton
          label="אפס מונים"
          onPress={async () => {
            await clearEvents();
            await refresh();
          }}
        />
      </View>
    </ScrollView>
  );
}

function Row({ label, value, last }: { label: string; value: number; last?: boolean }) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <Text style={type.body}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { paddingBottom: space.xxxl, gap: space.xl },
  hero: {
    marginHorizontal: space.xl,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.xl,
    gap: space.sm,
  },
  ratio: { ...type.figureLarge, fontSize: 52, lineHeight: 58, color: colors.inkFaint },
  ratioMet: { color: colors.mint },
  ratioEmpty: { fontFamily: fonts.voiceMedium, fontSize: 26, lineHeight: 58, color: colors.inkFaint },
  track: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    marginTop: space.sm,
    overflow: 'hidden',
  },
  fill: { position: 'absolute', top: 0, bottom: 0, start: 0, backgroundColor: colors.amberLine },
  fillMet: { backgroundColor: colors.mint },
  target: { position: 'absolute', top: -2, bottom: -2, width: 2, backgroundColor: colors.ink },
  trackLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.xs },
  table: {
    marginHorizontal: space.xl,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowLast: { borderBottomWidth: 0 },
  rowValue: type.tableValue,
  note: { ...type.caption, marginHorizontal: space.xl, lineHeight: 17 },
  reset: { paddingHorizontal: space.xl },
});
