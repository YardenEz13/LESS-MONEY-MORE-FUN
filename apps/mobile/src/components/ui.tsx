import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text as RNText,
  View,
  type TextProps,
  type ViewStyle,
} from 'react-native';
import { latinRuns } from '@sbr/core';
import { border, colors, fonts, latinFace, radius, space, type } from '../theme';

function splitLatin(node: React.ReactNode, face: string): React.ReactNode {
  if (Array.isArray(node)) {
    return node.map((child, i) => (
      <React.Fragment key={i}>{splitLatin(child, face)}</React.Fragment>
    ));
  }
  if (typeof node !== 'string') return node;

  const runs = latinRuns(node);
  // The common case in a Hebrew app: nothing to swap, so nothing to nest.
  if (runs.length === 1 && !runs[0].latin) return node;

  return runs.map((run, i) =>
    run.latin ? (
      <RNText key={i} style={{ fontFamily: face }}>
        {run.text}
      </RNText>
    ) : (
      run.text
    ),
  );
}

/**
 * Text, with Latin runs drawn in a Latin face.
 *
 * React Native has no per-script font list — `fontFamily` is one family, and
 * the platform only falls back for glyphs the font is missing. The EFT faces
 * are not missing Latin (see theme.ts), so the split has to happen in the tree
 * instead: each run becomes a nested Text carrying the Latin face that matches
 * the role, inheriting size, colour and leading from its parent.
 *
 * Every screen imports Text from here rather than from react-native, so this is
 * the one place the rule lives.
 */
export function Text({ style, children, ...rest }: TextProps) {
  const face = latinFace[StyleSheet.flatten(style)?.fontFamily ?? ''];
  return (
    <RNText style={style} {...rest}>
      {face ? splitLatin(children, face) : children}
    </RNText>
  );
}

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
          <Text style={type.meta}>חזרה</Text>
        </Pressable>
      )}
      {eyebrow && <Text style={type.meta}>{eyebrow}</Text>}
      <Text style={type.display}>{title}</Text>
    </View>
  );
}

/**
 * Primary action. Press is a colour step down the green ramp — the system has
 * no shadow to lift and no radius to squash, so state has to be stated in fill.
 */
export function PrimaryButton({
  label,
  onPress,
  disabled,
  tone = 'primary',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'primary' | 'plate';
}) {
  const base = tone === 'plate' ? colors.surfacePlate : colors.surfacePrimary;
  const pressedFill = tone === 'plate' ? colors.surfacePlateSoft : colors.surfacePrimaryDeep;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primary,
        { backgroundColor: pressed ? pressedFill : base },
        disabled && styles.primaryDisabled,
      ]}
    >
      <Text style={[type.button, disabled && styles.primaryDisabledLabel]}>{label}</Text>
    </Pressable>
  );
}

/** Secondary action: hairline in the primary green, filling in on press. */
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
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.ghost,
        pressed && { backgroundColor: colors.surfacePrimary },
        style,
      ]}
    >
      {({ pressed }) => (
        <Text
          style={[
            type.button,
            { color: pressed ? colors.textInverse : colors.surfacePrimary },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/** Segmented filter. Selected is a solid blue chip — a choice, not a verdict. */
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
            <Text
              style={[
                type.chip,
                { color: active ? colors.textInverse : colors.textPrimary },
              ]}
            >
              {option.label}
              {option.count != null ? `  ${option.count}` : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * A titled block. The heavy green band under the label is the section device —
 * the same one the design-system page uses to head 01 COLOUR, 02 TYPE.
 *
 * It reads as green rather than ink now, and at `band` rather than `rule`: the
 * page turned its section heads into structural edges, and a 2px ink line under
 * a small label was reading as another hairline in a layout already full of
 * them. Green at 6px states that a new part of the screen starts here.
 */
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
        <Text style={styles.sectionLabel}>{eyebrow}</Text>
      </View>
      {children}
    </View>
  );
}

/**
 * The live marker: orange fill, near-black on top, never orange text.
 *
 * Tracking is the one place the system spends letter-spacing. The rule against
 * it is about Hebrew, where hierarchy has to come from weight and size because
 * there is no uppercase to track; this is a Latin word set in caps, which is
 * exactly the case tracking exists for.
 */
export function LivePill({ label = 'LIVE' }: { label?: string }) {
  return (
    <View style={styles.livePill}>
      <Text style={styles.livePillLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * `alignItems: flex-start` rather than leaving the children full-width: a
   * Text gets `dir="auto"`, so a Latin merchant name or a number-only label
   * resolves LTR and `text-align: start` then flushes it to the *left* while
   * its Hebrew neighbours sit right. Sizing each line to its content and
   * letting the cross axis place it keeps the column aligned in both
   * directions, and leaves the run's internal order untouched — forcing
   * `direction: rtl` instead would reorder "₪300+" into "+₪300".
   */
  header: {
    paddingHorizontal: space.s4,
    paddingTop: space.s3,
    paddingBottom: space.s2,
    gap: space.s1,
    alignItems: 'flex-start',
  },
  back: { flexDirection: 'row', alignItems: 'center', gap: space.s1, marginBottom: space.s2 },
  backGlyph: { fontSize: 22, lineHeight: 24, color: colors.textDisabled },
  primary: {
    flex: 1,
    borderRadius: radius.sharp,
    paddingVertical: space.s3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryDisabled: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: border.hairline,
    borderColor: colors.borderHairline,
  },
  primaryDisabledLabel: { color: colors.textDisabled },
  ghost: {
    borderRadius: radius.sharp,
    borderWidth: border.hairline,
    borderColor: colors.surfacePrimary,
    paddingHorizontal: space.s4,
    paddingVertical: space.s2 + 4,
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterRow: {
    flexDirection: 'row',
    gap: space.s2,
    paddingHorizontal: space.s4,
    paddingBottom: space.s2,
  },
  filter: {
    paddingHorizontal: space.s3 - 2,
    paddingVertical: space.s2,
    borderRadius: radius.sharp,
    borderWidth: border.hairline,
    borderColor: colors.borderHairline,
  },
  filterActive: { backgroundColor: colors.surfaceAccent, borderColor: colors.surfaceAccent },
  section: { gap: space.s3 },
  sectionHead: {
    marginHorizontal: space.s4,
    borderBottomWidth: border.band,
    borderBottomColor: colors.surfacePrimary,
    paddingBottom: space.s2,
  },
  sectionLabel: { ...type.meta, color: colors.textPrimary },
  livePill: {
    backgroundColor: colors.accentUrgent,
    borderRadius: radius.sharp,
    paddingHorizontal: space.s2 + 2,
    paddingVertical: space.s1 + 1,
    alignSelf: 'flex-start',
  },
  livePillLabel: {
    ...type.micro,
    color: colors.textPrimary,
    fontFamily: fonts.latinDisplay,
    letterSpacing: 1.6,
    /* A Latin word, so it keeps its own order inside a Hebrew row. */
    writingDirection: 'ltr',
  },
});
