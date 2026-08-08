import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { formatSaving, formatValue, type Evaluation } from '@sbr/core';
import { ConditionStrip } from './Gates';
import { Text } from './ui';
import { programNames } from '../services/catalog';
import { border, colors, radius, space, type } from '../theme';

interface Props {
  evaluation: Evaluation;
  onPress: () => void;
}

/**
 * The card is the system's thesis in one object: the figure gets a dark plate
 * of its own, the terms get the strip, and nothing else competes.
 *
 * The plate takes the row's end edge from flex order alone, so it swaps sides
 * between RTL and LTR with no code change. Its hairline is a real 1px view
 * rather than a `borderStartWidth`: react-native-web compiles logical borders
 * to physical sides against a locale context that its stub I18nManager always
 * reports as LTR, so `start` lands on the wrong edge in the web build. A
 * sibling view is unambiguous on every platform.
 */
export function BenefitCard({ evaluation, onPress }: Props) {
  const { benefit, gates, actionsRequired } = evaluation;
  const { figure, unit } = formatValue(benefit);
  const ready = actionsRequired.length === 0;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${figure} ${unit} ב${benefit.merchant_name}, ${
        ready
          ? 'אין מה לעשות מראש'
          : actionsRequired.length === 1
            ? 'דבר אחד לעשות מראש'
            : `${actionsRequired.length} דברים לעשות מראש`
      }`}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.top}>
        <View style={styles.identity}>
          <Text style={type.meta} numberOfLines={1}>
            {programNames[benefit.program_id] ?? benefit.program_id}
          </Text>
          <Text style={type.lead} numberOfLines={2}>
            {benefit.merchant_name}
          </Text>
        </View>
        <View style={styles.rule} />
        {/* Green is "money kept" in this system, so a benefit with nothing left
            to do earns the green plate; one still waiting on the reader keeps
            the neutral ink. Colour states the verdict the footer spells out. */}
        <View style={[styles.plate, ready && styles.plateReady]}>
          <Text style={type.figure} numberOfLines={1} adjustsFontSizeToFit>
            {figure}
          </Text>
          <Text style={[styles.plateUnit, ready && styles.plateUnitReady]}>{unit}</Text>
        </View>
      </View>

      <View style={styles.strip}>
        <ConditionStrip gates={gates} max={3} />
      </View>

      <View style={styles.footer}>
        {/* One indicator, not two: the square states readiness, the copy explains it. */}
        <View style={[styles.marker, ready ? styles.markerReady : styles.markerPending]} />
        <Text style={styles.readiness} numberOfLines={1}>
          {ready ? 'אפשר ללכת לקופה' : actionsRequired.map((g) => g.label).join(' · ')}
        </Text>
        <Text style={type.caption} numberOfLines={1}>
          {formatSaving(evaluation)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfacePage,
    borderRadius: radius.sharp,
    borderWidth: border.hairline,
    borderColor: colors.borderHairline,
    marginBottom: space.s3,
  },
  cardPressed: { backgroundColor: colors.surfaceRaised },
  top: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderBottomWidth: border.hairline,
    borderBottomColor: colors.borderHairline,
  },
  identity: {
    flex: 1,
    minWidth: 0,
    paddingVertical: space.s3 - 2,
    paddingHorizontal: space.s3,
    gap: space.s1,
    justifyContent: 'center',
    /* Sizes each line to content so a Latin name aligns with a Hebrew one — see ui.tsx. */
    alignItems: 'flex-start',
  },
  rule: { width: border.hairline, backgroundColor: colors.borderHairline },
  plate: {
    width: 104,
    flexShrink: 0,
    backgroundColor: colors.surfacePlate,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.s2 + 4,
    paddingHorizontal: space.s2,
  },
  plateReady: { backgroundColor: colors.surfacePrimary },
  plateUnit: { ...type.micro, color: colors.textMutedInverse, marginTop: space.s1 + 2 },
  /* The muted-on-green tone; textMutedInverse is tuned for ink and goes flat
     against the green. */
  plateUnitReady: { color: colors.textMutedOnPrimary },
  strip: { paddingVertical: space.s2 + 4, paddingHorizontal: space.s3 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s2,
    paddingVertical: space.s2 + 3,
    paddingHorizontal: space.s3,
    borderTopWidth: border.hairline,
    borderTopColor: colors.borderHairlineSoft,
  },
  marker: { width: 8, height: 8, flexShrink: 0 },
  markerReady: { backgroundColor: colors.surfacePrimary },
  markerPending: { backgroundColor: colors.accentUrgent },
  /* Flex, not `marginStart:'auto'` — same web/native direction trap as the rule. */
  readiness: { ...type.caption, flex: 1 },
});
