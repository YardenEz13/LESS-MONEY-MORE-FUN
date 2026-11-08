import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Gate } from '@sbr/core';
import { Text } from './ui';
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
  met: colors.surfacePrimary,
  action: colors.cardYellowDeep,
  note: colors.textMuted,
  blocked: colors.cardRedText,
};

/**
 * The expanded form on the detail screen: one row per gate, ordered so the
 * thing standing between you and the discount is the first thing you read.
 *
 * The marker is a round mark, the shape the roll's holes have; the glyph stays on
 * it because colour is the fast channel, not the only one — roughly one reader in
 * twelve cannot separate the marigold from the grey.
 */
export function GateList({
  gates,
  punched,
  onPunch,
}: {
  gates: readonly Gate[];
  /** Codes the user marked done today; shown met and tappable to undo. */
  punched?: ReadonlySet<string>;
  /** Present on screens where a step can be punched by hand. */
  onPunch?: (gate: Gate) => void;
}) {
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
        return (
          <View key={gate.code} style={styles.row}>
            {(() => {
              const isPunched = punched?.has(gate.code) ?? false;
              const canPunch = onPunch != null && (isPunched || (gate.state === 'pending' && gate.actionable));
              const mark = (
                <View style={[styles.marker, { backgroundColor: tone.bg, borderColor: tone.border }]}>
                  <Text style={[styles.markerNumber, { color: tone.fg }]}>{isPunched ? '✓' : index + 1}</Text>
                </View>
              );
              if (!canPunch) return mark;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={isPunched ? `בטל סימון: ${gate.label}` : `סמן כבוצע: ${gate.label}`}
                  accessibilityHint="הסימון נמחק בחצות"
                  hitSlop={8}
                  onPress={() => onPunch(gate)}
                >
                  {mark}
                </Pressable>
              );
            })()}
            <View style={styles.rowText}>
              <Text style={type.bodyStrong}>{gate.label}</Text>
              <Text style={type.small}>{gate.detail}</Text>
              {/* The ruling, in the ruling's colour. `note` is grey by design:
                  "worth knowing" is not a verdict and should not look like one. */}
              <Text style={[styles.verdict, { color: VERDICT_INK[key] }]}>
                {punched?.has(gate.code) ? 'סימנת — עד חצות' : onPunch && key === 'action' ? `${gateVerdict[key]} · הקש על העיגול כשבוצע` : gateVerdict[key]}
              </Text>
            </View>
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
  markerNumber: { fontFamily: fonts.display, fontSize: 24, lineHeight: 28 },
  verdict: { ...type.micro, marginTop: 3 },
  /* flex-start so a number-only label ("₪300+") aligns with a Hebrew one — see ui.tsx. */
  rowText: { flex: 1, gap: 2, alignItems: 'flex-start' },
});
