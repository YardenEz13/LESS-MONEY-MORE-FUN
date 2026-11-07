import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { GhostButton, ListRow, Panel, ScreenHeader, Section, Text } from '../components/ui';
import { clearEvents, computeKpis, loadEvents, type Kpis } from '../state/events';
import { colors, space, ticket, type } from '../theme';

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

      {/* The KPI is a figure that matters, so it is a bone ticket of its own. */}
      <Panel style={styles.hero}>
        <Text style={styles.heroLabel}>יחס השפעה על החלטה</Text>
        {/* A 58px em-dash reads as a broken element, not as "no data". Say it. */}
        {ratio == null ? (
          <Text style={styles.ratioEmpty}>טרם נמדד</Text>
        ) : (
          <Text style={[styles.ratio, met && styles.ratioMet]}>{Math.round(ratio * 100)}%</Text>
        )}
        {/* Both layers are flex rows, so the bar grows from the reading edge in
            either direction — `start`/`left` offsets do not survive RTL on web. */}
        <View style={styles.track}>
          <View style={[styles.fill, met && styles.fillMet, { width: `${fill * 100}%` }]} />
          <View style={styles.targetRow} pointerEvents="none">
            <View style={{ width: `${TARGET * 100}%` }} />
            <View style={styles.target} />
          </View>
        </View>
        <View style={styles.trackLabels}>
          <Text style={styles.heroCaption}>
            {ratio == null
              ? 'עוד לא נשלחו התראות'
              : met
                ? 'מעל היעד'
                : `${Math.round((TARGET - fill) * 100)} נקודות מתחת ליעד`}
          </Text>
          <Text style={styles.heroCaption}>יעד 30%</Text>
        </View>
        <Text style={styles.heroBody}>
          חלק ההתראות שהובילו לפתיחת פירוט או ללחיצה על ״מימשתי״. מתחת ליעד פירושו שההתראות מגיעות
          ברגע הלא נכון — לא שההטבות גרועות.
        </Text>
      </Panel>

      <Section eyebrow="ספירה גולמית">
        <View>
          <Row label="התראות שנשלחו" value={kpis?.notificationsSent ?? 0} />
          <Row label="התראות שנפתחו" value={kpis?.notificationsOpened ?? 0} />
          <Row label="מימושים שדווחו" value={kpis?.redeemed ?? 0} />
          <Row label="שיתופים שזוהו" value={kpis?.shareResolved ?? 0} />
          <Row label="שיתופים ללא התאמה" value={kpis?.shareUnmatched ?? 0} />
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

function Row({ label, value }: { label: string; value: number }) {
  return (
    <ListRow>
      <Text style={[type.body, styles.rowLabel]}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </ListRow>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: ticket.ground },
  content: { paddingBottom: space.s6, gap: space.s3 },
  hero: { backgroundColor: colors.surfacePlate },
  heroLabel: { ...type.meta, color: colors.textMutedInverse },
  heroCaption: { ...type.caption, color: colors.textMutedInverse },
  heroBody: { ...type.small, color: colors.textMutedInverse },
  ratio: { ...type.figureLarge, color: colors.textMutedInverse },
  ratioMet: { color: '#0B6B45' },
  ratioEmpty: { ...type.displaySmall, color: colors.textMutedInverse },
  track: {
    height: 8,
    alignSelf: 'stretch',
    backgroundColor: colors.surfacePlateSoft,
    marginTop: space.s2,
    flexDirection: 'row',
  },
  /* The plate is bone, so the bar is drawn in the ticket's void red and deep green. */
  fill: { backgroundColor: ticket.void },
  fillMet: { backgroundColor: '#0B6B45' },
  /* The target sits on the bar itself — a percentage without its bar is just a number. */
  targetRow: { ...StyleSheet.absoluteFillObject, top: -3, bottom: -3, flexDirection: 'row' },
  target: { width: 2, backgroundColor: colors.textInverse },
  trackLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    marginTop: space.s1,
  },
  rowLabel: { flex: 1 },
  rowValue: type.tableValue,
  note: { ...type.caption, marginHorizontal: space.s3 },
  reset: { paddingHorizontal: space.s3 },
});
