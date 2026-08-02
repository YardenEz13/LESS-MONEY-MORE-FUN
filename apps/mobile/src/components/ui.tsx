import React from 'react';
import { Animated, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { colors, radius, space, type } from '../theme';
import { usePressScale } from '../hooks/usePressScale';

/** Back affordance + title. RTL, so "back" points right. */
export function ScreenHeader({
  title,
  eyebrow,
  onBack,
}: {
  title: string;
  eyebrow?: string;
  onBack?: () => void;
}) {
  return (
    <View style={styles.header}>
      {onBack && (
        <Pressable onPress={onBack} accessibilityRole="button" hitSlop={12} style={styles.back}>
          <Text style={styles.backGlyph}>›</Text>
          <Text style={type.small}>חזרה</Text>
        </Pressable>
      )}
      {eyebrow && <Text style={type.eyebrow}>{eyebrow}</Text>}
      <Text style={type.title}>{title}</Text>
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  tone = 'mint',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'mint' | 'ink';
}) {
  const { scale, onPressIn, onPressOut } = usePressScale(0.985);
  return (
    <Animated.View style={{ transform: [{ scale }], flex: 1 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !!disabled }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        style={[
          styles.primary,
          { backgroundColor: tone === 'ink' ? colors.ink : colors.mint },
          disabled && styles.primaryDisabled,
        ]}
      >
        <Text style={styles.primaryLabel}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

export function GhostButton({
  label,
  onPress,
  style,
}: {
  label: string;
  onPress: () => void;
  style?: ViewStyle;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.ghost, style]}>
      <Text style={type.small}>{label}</Text>
    </Pressable>
  );
}

/** Segmented filter. Selected reads as ink-on-paper, not a coloured pill. */
export function FilterRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string; count?: number }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.filterRow}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={[styles.filter, active && styles.filterActive]}
          >
            <Text style={[type.chip, active ? styles.filterLabelActive : styles.filterLabel]}>
              {option.label}
              {option.count != null ? `  ${option.count}` : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A titled block on the paper. The rule under the eyebrow is the structure. */
export function Section({
  eyebrow,
  children,
}: {
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={type.eyebrow}>{eyebrow}</Text>
        <View style={styles.rule} />
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.md, gap: 3 },
  back: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginBottom: space.sm },
  backGlyph: { fontSize: 22, lineHeight: 24, color: colors.inkFaint },
  primary: {
    borderRadius: radius.md,
    paddingVertical: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryDisabled: { backgroundColor: colors.lineStrong },
  primaryLabel: { fontFamily: 'Heebo_700Bold', fontSize: 16, color: colors.inkInverse },
  ghost: {
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm + 1,
    alignSelf: 'flex-start',
  },
  filterRow: {
    flexDirection: 'row',
    gap: space.xs + 2,
    paddingHorizontal: space.xl,
    paddingBottom: space.md,
  },
  filter: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  filterActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  filterLabel: { color: colors.inkSoft },
  filterLabelActive: { color: colors.inkInverse },
  section: { gap: space.md },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.xl,
  },
  rule: { flex: 1, height: 1, backgroundColor: colors.line },
});
