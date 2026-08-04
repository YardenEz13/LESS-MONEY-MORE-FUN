import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Gate } from '@sbr/core';
import { border, colors, gateGlyph, gateTone, radius, space, type, type GateTone } from '../theme';

/** Amber is for errands; a caveat you can't act on gets the quiet tone. */
function toneFor(gate: Gate): GateTone {
  if (gate.state === 'blocked') return 'blocked';
  if (gate.state === 'met') return 'met';
  return gate.actionable ? 'action' : 'note';
}

/**
 * The condition strip — the one device this app is built around.
 *
 * Every other benefits app puts a huge percentage on the card and buries the
 * terms in grey small print. Here the terms are the product, so each stated
 * condition gets its own chip carrying the engine's verdict: satisfied,
 * up-to-you, or violated. "15% — 4 gates, 3 already clear, 1 on you" is
 * readable in the three seconds you have at a till, which a paragraph of
 * caveats is not.
 */
export function ConditionStrip({ gates, max = 4 }: { gates: readonly Gate[]; max?: number }) {
  if (gates.length === 0) {
    return (
      <View style={styles.strip}>
        <View style={[styles.chip, styles.chipPlain]}>
          <Text style={[type.chip, { color: gateTone.note.fg }]}>ללא תנאים בתקנון</Text>
        </View>
      </View>
    );
  }

  const shown = gates.slice(0, max);
  const hidden = gates.slice(max);
  // Gates are ordered blocked → pending → met, so the overflow is usually the
  // satisfied ones. Saying so turns "+3" from a truncation mark into the
  // reassurance it actually represents.
  const allHiddenMet = hidden.length > 0 && hidden.every((g) => g.state === 'met');

  return (
    <View style={styles.strip}>
      {shown.map((gate) => (
        <GateChip key={gate.code} gate={gate} />
      ))}
      {hidden.length > 0 && (
        <View
          style={[
            styles.chip,
            allHiddenMet
              ? { backgroundColor: gateTone.met.bg, borderColor: gateTone.met.border }
              : styles.chipPlain,
          ]}
        >
          <Text style={[type.chip, { color: allHiddenMet ? gateTone.met.fg : gateTone.note.fg }]}>
            {allHiddenMet ? `✓ ${hidden.length} מתקיימים` : `+${hidden.length}`}
          </Text>
        </View>
      )}
    </View>
  );
}

export function GateChip({ gate }: { gate: Gate }) {
  const key = toneFor(gate);
  const tone = gateTone[key];
  return (
    <View style={[styles.chip, { backgroundColor: tone.bg, borderColor: tone.border }]}>
      <Text style={[type.chip, styles.glyph, { color: tone.fg }]}>{gateGlyph[key]}</Text>
      <Text
        style={[
          type.chip,
          { color: tone.fg },
          gate.state === 'blocked' && styles.struck,
        ]}
        numberOfLines={1}
      >
        {gate.label}
      </Text>
    </View>
  );
}

/**
 * The expanded form on the detail screen: one row per gate, ordered so the
 * thing standing between you and the discount is the first thing you read.
 */
export function GateList({ gates }: { gates: readonly Gate[] }) {
  if (gates.length === 0) {
    return (
      <View style={[styles.row, { backgroundColor: colors.surfacePrimary }]}>
        <Text style={[type.body, { color: colors.textInverse }]}>
          התקנון לא מציב תנאים נוספים על ההטבה הזו.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.list}>
      {gates.map((gate) => {
        const key = toneFor(gate);
        const tone = gateTone[key];
        return (
          <View key={gate.code} style={styles.row}>
            <View style={[styles.marker, { backgroundColor: tone.bg, borderColor: tone.border }]}>
              <Text style={[type.chip, { color: tone.fg }]}>{gateGlyph[key]}</Text>
            </View>
            <View style={styles.rowText}>
              <Text style={type.bodyStrong}>{gate.label}</Text>
              <Text style={type.small}>{gate.detail}</Text>
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
  strip: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s1 + 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: space.s2 + 2,
    paddingVertical: 5,
    borderRadius: radius.sharp,
    borderWidth: border.hairline,
    maxWidth: 170,
  },
  chipPlain: { backgroundColor: gateTone.note.bg, borderColor: gateTone.note.border },
  glyph: { fontSize: 11 },
  struck: { textDecorationLine: 'line-through' },
  list: {
    borderRadius: radius.sharp,
    borderWidth: border.hairline,
    borderColor: colors.borderHairline,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.s3 - 4,
    backgroundColor: colors.surfacePage,
    paddingVertical: space.s3 - 4,
    paddingHorizontal: space.s3,
    borderBottomWidth: border.hairline,
    borderBottomColor: colors.borderHairlineSoft,
  },
  marker: {
    width: 22,
    height: 22,
    borderRadius: radius.sharp,
    borderWidth: border.hairline,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  /* flex-start so a number-only label ("₪300+") aligns with a Hebrew one — see ui.tsx. */
  rowText: { flex: 1, gap: 2, alignItems: 'flex-start' },
});
