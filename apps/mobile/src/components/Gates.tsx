import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Gate, GateCode } from '@sbr/core';
import { Text } from './ui';
import { punchKey } from '../state/punches';
import {
  colors,
  fonts,
  gateTone,
  gateVerdict,
  space,
  ticket,
  type,
  type GateTone,
} from '../theme';

/** Yellow is for errands; a caveat you can't act on gets the quiet tone. */
function toneFor(gate: Gate): GateTone {
  if (gate.state === 'blocked') return 'blocked';
  if (gate.state === 'met') return 'met';
  return gate.actionable ? 'action' : 'note';
}

/**
 * The verdict word sits on paper, not on the card, so it cannot use the card's
 * own fill: `cardYellow` is a 1.7:1 text colour and no size fixes that. Each
 * tone names the darkest member of its family that still reads as that family.
 */
const VERDICT_INK: Record<GateTone, string> = {
  met: ticket.good,
  action: colors.cardYellowDeep,
  note: colors.textMuted,
  blocked: colors.cardRedText,
};

interface GateListProps {
  gates: readonly Gate[];
  /** When provided alongside `onPunch`, actionable gates can be manually punched. */
  benefitId?: string;
  punched?: ReadonlySet<string>;
  onPunch?: (code: GateCode) => void;
}

/**
 * The expanded form on the detail screen: one row per gate, ordered so the
 * thing standing between you and the discount is the first thing you read.
 *
 * Actionable gates (`action` tone) and user-punched gates are interactive holes:
 * tapping punches the hole and promotes the ticket toward ready ("מוכן לקופה"),
 * persisting until Israel midnight.
 */
export function GateList({ gates, benefitId, punched, onPunch }: GateListProps) {
  if (gates.length === 0) {
    return (
      <View style={[styles.row, { backgroundColor: colors.surfacePrimary, borderBottomWidth: 0 }]}>
        <Text style={[type.body, { color: colors.textInverse }]}>
          התקנון לא מציב תנאים נוספים על ההטבה הזו.
        </Text>
      </View>
    );
  }

  return (
    <View>
      {gates.map((gate, index) => {
        const key = toneFor(gate);
        const tone = gateTone[key];
        const isUserPunched =
          benefitId != null && punched != null && punched.has(punchKey(benefitId, gate.code));
        const canPunch = onPunch != null && (key === 'action' || isUserPunched);

        const markerNode = isUserPunched ? (
          <View style={[styles.marker, styles.markerPunched]}>
            <Text style={styles.markerCheck}>✓</Text>
          </View>
        ) : key === 'action' && canPunch ? (
          <View style={[styles.marker, styles.markerActionable]}>
            <Text style={[styles.markerNumber, { color: ticket.ink }]}>+</Text>
          </View>
        ) : (
          <View style={[styles.marker, { backgroundColor: tone.bg, borderColor: tone.border }]}>
            <Text style={[styles.markerNumber, { color: tone.fg }]}>{index + 1}</Text>
          </View>
        );

        const content = (
          <>
            {markerNode}
            <View style={styles.rowText}>
              <Text style={type.bodyStrong}>{gate.label}</Text>
              <Text style={type.small}>{gate.detail}</Text>
              <View style={styles.verdictRow}>
                <Text style={[styles.verdict, { color: VERDICT_INK[key] }]}>
                  {isUserPunched ? 'נוקב היום · מוכן' : gateVerdict[key]}
                </Text>
                {canPunch && (
                  <View style={[styles.punchChip, isUserPunched && styles.punchChipDone]}>
                    <Text style={[styles.punchChipText, isUserPunched && styles.punchChipTextDone]}>
                      {isUserPunched ? 'ביטול ניקוב' : 'לחץ לניקוב'}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </>
        );

        if (canPunch) {
          return (
            <Pressable
              key={gate.code}
              accessibilityRole="checkbox"
              aria-checked={isUserPunched}
              accessibilityLabel={
                isUserPunched ? `בטל ניקוב: ${gate.label}` : `נקב כהושלם: ${gate.label}`
              }
              onPress={() => onPunch(gate.code)}
              style={({ pressed }) => [
                styles.row,
                isUserPunched && styles.rowPunched,
                pressed && styles.rowPressed,
              ]}
            >
              {content}
            </Pressable>
          );
        }

        return (
          <View key={gate.code} style={styles.row}>
            {content}
          </View>
        );
      })}
    </View>
  );
}

/**
 * Denominator line: "7 תנאים · 2 עליך · 2 מתקיימים".
 *
 * Counts only what the reader can act on or rely on. Caveats — no stacking,
 * excluded categories — are listed below but not tallied here; a number that
 * lumps "top up your basket" together with "excludes tobacco" tells you
 * nothing about whether you can use the benefit.
 */
export function gateSummary(gates: readonly Gate[]): string {
  if (gates.length === 0) return 'ללא תנאים בתקנון';
  const met = gates.filter((g) => g.state === 'met').length;
  const actions = gates.filter((g) => g.state === 'pending' && g.actionable).length;
  const blocked = gates.filter((g) => g.state === 'blocked').length;
  const parts = [`${gates.length} תנאים`];
  if (blocked > 0) parts.push(`${blocked} חוסמים`);
  if (actions > 0) parts.push(`${actions} עליך`);
  if (met > 0) parts.push(`${met} מתקיימים`);
  return parts.join(' · ');
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.s3 - 4,
    paddingVertical: space.s3 - 4,
    paddingHorizontal: space.s3,
    borderBottomWidth: 1,
    borderBottomColor: ticket.rule,
  },
  rowPunched: { backgroundColor: ticket.ground2 },
  rowPressed: { backgroundColor: ticket.ground3, transform: [{ translateY: 2 }] },
  /* A round mark, the same shape as the holes on the roll's tickets. */
  marker: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderBottomWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerActionable: {
    backgroundColor: ticket.punch,
    borderColor: ticket.ink,
    borderWidth: 2,
    borderBottomWidth: 4,
  },
  /* Punched hole: paper ground showing through with a deep mint wall on top. */
  markerPunched: {
    backgroundColor: ticket.ground,
    borderColor: ticket.good,
    borderWidth: 2,
    borderTopWidth: 5,
    borderBottomWidth: 2,
  },
  markerNumber: { fontFamily: fonts.display, fontSize: 24, lineHeight: 28 },
  markerCheck: { fontFamily: fonts.display, fontSize: 20, lineHeight: 24, color: ticket.good },
  verdictRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.s2,
    marginTop: 4,
  },
  verdict: { ...type.micro },
  punchChip: {
    backgroundColor: ticket.punch,
    borderWidth: 1,
    borderColor: ticket.ink,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  punchChipDone: {
    backgroundColor: ticket.ground,
    borderColor: ticket.muted,
  },
  punchChipText: {
    fontFamily: fonts.display,
    fontSize: 13,
    lineHeight: 16,
    color: ticket.ink,
  },
  punchChipTextDone: { color: ticket.muted },
  /* flex-start so a number-only label ("₪300+") aligns with a Hebrew one — see ui.tsx. */
  rowText: { flex: 1, gap: 2, alignItems: 'flex-start' },
});
