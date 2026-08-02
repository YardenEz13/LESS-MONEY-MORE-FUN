import React from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatSaving, formatValue, type Evaluation } from '@sbr/core';
import { ConditionStrip } from './Gates';
import { programNames } from '../services/catalog';
import { colors, lift, radius, space, type } from '../theme';
import { usePressScale } from '../hooks/usePressScale';

interface Props {
  evaluation: Evaluation;
  onPress: () => void;
}

export function BenefitCard({ evaluation, onPress }: Props) {
  const { benefit, gates, actionsRequired } = evaluation;
  const { scale, onPressIn, onPressOut } = usePressScale();
  const { figure, unit } = formatValue(benefit);
  const ready = actionsRequired.length === 0;

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        accessibilityRole="button"
        accessibilityLabel={`${figure} ${unit} ב${benefit.merchant_name}, ${
          ready
            ? 'אין מה לעשות מראש'
            : actionsRequired.length === 1
              ? 'דבר אחד לעשות מראש'
              : `${actionsRequired.length} דברים לעשות מראש`
        }`}
        style={styles.card}
      >
        {/* Readiness is a rule down the leading edge, not a badge — it reads at
            a glance without competing with the figure. */}
        <View style={[styles.edge, ready ? styles.edgeReady : styles.edgePending]} />

        <View style={styles.top}>
          <View style={styles.identity}>
            <Text style={type.eyebrow}>{programNames[benefit.program_id] ?? benefit.program_id}</Text>
            <Text style={type.identity} numberOfLines={1}>
              {benefit.merchant_name}
            </Text>
          </View>
          <View style={styles.value}>
            <Text style={styles.figure} numberOfLines={1}>
              {figure}
            </Text>
            <Text style={type.caption}>{unit}</Text>
          </View>
        </View>

        <ConditionStrip gates={gates} max={3} />

        <View style={styles.footer}>
          <Text style={type.caption}>{formatSaving(evaluation)}</Text>
          <Text style={[type.caption, ready ? styles.footerReady : styles.footerPending]}>
            {ready ? 'אפשר ללכת לקופה' : actionsRequired.map((g) => g.label).join(' · ')}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.lg,
    paddingRight: space.lg + 6,
    marginBottom: space.md,
    gap: space.md,
    overflow: 'hidden',
    ...lift,
  },
  edge: { position: 'absolute', top: 0, bottom: 0, right: 0, width: 4 },
  edgeReady: { backgroundColor: colors.mint },
  edgePending: { backgroundColor: colors.amberLine },
  top: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: space.md,
  },
  identity: { flex: 1, gap: 3 },
  value: { alignItems: 'flex-end' },
  figure: type.figure,
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: space.sm + 2,
  },
  footerReady: { color: colors.mint },
  footerPending: { color: colors.amber, flexShrink: 1, textAlign: 'left' },
});
