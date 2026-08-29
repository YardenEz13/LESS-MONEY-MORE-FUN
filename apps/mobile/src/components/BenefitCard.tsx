import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { formatSaving, formatValue, type Evaluation } from '@sbr/core';
import { ConditionStrip } from './Gates';
import { Crest, PitchStripes } from './Kit';
import { Text } from './ui';
import { merchantLine, programNames, programsById } from '../services/catalog';
import {
  border,
  colors,
  crestColors,
  crestFallback,
  kit,
  radius,
  space,
  type,
  useCompact,
} from '../theme';

interface Props {
  evaluation: Evaluation;
  onPress: () => void;
}

/**
 * The card is the system's thesis in one object: the figure gets a dark plate
 * of its own, the terms get the strip, and nothing else competes.
 *
 * It is also a shirt. The club's colour runs along the top edge, its crest
 * opens the identity line, and the plate is the squad number — the unit set
 * above the figure the way a name sits above a number, which is why the two
 * swapped order. None of that is decoration standing in for information: in a
 * list of nine benefits from six clubs, *which club* is the fastest thing to
 * scan for and it used to be a line of 13px grey.
 *
 * The plate takes the row's end edge from flex order alone, so it swaps sides
 * between RTL and LTR with no code change. Its hairline is a real 1px view
 * rather than a `borderStartWidth`: react-native-web compiles logical borders
 * to physical sides against a locale context that its stub I18nManager always
 * reports as LTR, so `start` lands on the wrong edge in the web build. A
 * sibling view is unambiguous on every platform.
 *
 * The plate is the card's one fixed cost, and on a small phone it is the
 * expensive one: 104dp of a 272dp card leaves the merchant name 133dp, and the
 * catalog holds names past fifty characters. It gives 20dp back below 360 —
 * the figure steps down with it, since the widest the catalog produces ("3.5%",
 * "₪233") needs 85dp at full size and would not clear the narrower plate.
 */
export function BenefitCard({ evaluation, onPress }: Props) {
  const { benefit, gates, actionsRequired } = evaluation;
  const { figure, unit } = formatValue(benefit);
  const ready = actionsRequired.length === 0;
  const compact = useCompact();

  const category = programsById.get(benefit.program_id)?.category;
  const clubColor = (category && crestColors[category]) ?? crestFallback;
  // "מכולת · גבעתיים". Absent for the handful of merchants the source never
  // described, and then the name simply stands alone as it always did.
  const place = merchantLine(benefit.merchant_id);
  // Null whenever the cart is unknown, which on this screen is always — the
  // footer then ends at the readiness line and the plate figure stands alone.
  const saving = formatSaving(evaluation);

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
      {/* The club's colours along the top edge. A hairline card in a list of
          hairline cards has no way to say who it belongs to; this does it
          without spending a single line of vertical space on text. */}
      <View style={[styles.clubEdge, { backgroundColor: clubColor }]} />

      <View style={styles.top}>
        <View style={styles.identity}>
          <View style={styles.club}>
            <Crest programId={benefit.program_id} size={22} />
            <Text style={styles.clubName} numberOfLines={1}>
              {programNames[benefit.program_id] ?? benefit.program_id}
            </Text>
          </View>
          <Text style={type.lead} numberOfLines={2}>
            {benefit.merchant_name}
          </Text>
          {place && (
            <Text style={styles.place} numberOfLines={1}>
              {place}
            </Text>
          )}
        </View>
        <View style={styles.rule} />
        {/* Green is "money kept" in this system, so a benefit with nothing left
            to do earns the green plate — and, being ours, the stripes with it.
            One still waiting on the reader keeps the neutral ink. Colour states
            the verdict the footer spells out. */}
        <View style={[styles.plate, compact && styles.plateCompact, ready && styles.plateReady]}>
          {ready && <PitchStripes />}
          <Text style={[styles.plateUnit, ready && styles.plateUnitReady]}>{unit}</Text>
          <Text
            style={[
              type.figure,
              { fontSize: kit.figureSize, lineHeight: kit.figureSize },
              compact && styles.figureCompact,
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {figure}
          </Text>
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
        {saving && (
          <Text style={type.caption} numberOfLines={1}>
            {saving}
          </Text>
        )}
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
  clubEdge: { height: border.marker },
  club: { flexDirection: 'row', alignItems: 'center', gap: space.s2 - 2 },
  clubName: { ...type.meta, flexShrink: 1 },
  /* `caption`, not `meta`: the trade is context for the name above it, and a
     second medium-weight line would compete with the club it sits under. */
  place: { ...type.caption, flexShrink: 1 },
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
    /* Clips the stripes to the plate — see PitchStripes. */
    overflow: 'hidden',
  },
  /* `adjustsFontSizeToFit` is a native-only prop, so the web build cannot rely
     on it to rescue a figure that outgrows the plate — hence the explicit step. */
  plateCompact: { width: 84, paddingHorizontal: space.s1 + 2 },
  figureCompact: { fontSize: 34, lineHeight: 34 },
  plateReady: { backgroundColor: colors.surfacePrimary },
  /* Above the figure, not below it: the name goes over the number on a shirt. */
  plateUnit: { ...type.micro, color: colors.textMutedInverse, marginBottom: space.s1 },
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
