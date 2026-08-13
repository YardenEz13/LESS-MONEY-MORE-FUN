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
import { Crest, PitchStripes, ScarfBand, useKit } from './Kit';
import { border, colors, fonts, kit, latinFace, radius, space, type } from '../theme';

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

/**
 * The green plate that opens a screen: the system's one dominant fill, the
 * urgent edge on the reading side, and the band that stops the display type
 * from floating. `right` takes the screen's actions, `children` anything that
 * belongs inside the green — a count line, a location picker.
 *
 * The edge is a sibling view rather than `borderStartWidth`: RN and web
 * disagree about which side "start" is under forced RTL, and flex order does
 * not.
 *
 * Striped and closed by the scarf, because this is the surface the app speaks
 * from and the kit is how it signs what it says. The scarf sits outside the
 * green rather than inside its padding: it is the edge of the block, and an
 * edge that floats above a margin stops reading as one.
 */
export function Hero({
  eyebrow,
  title,
  right,
  children,
}: {
  eyebrow: string;
  title: string;
  right?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const intensity = useKit();
  return (
    <>
      <View style={styles.hero}>
        <PitchStripes />
        <View style={styles.heroEdge} />
        <View style={styles.heroBody}>
          <View style={styles.heroTop}>
            <View style={styles.heroHeadline}>
              <Text style={styles.heroEyebrow}>{eyebrow}</Text>
              <Text
                style={[
                  styles.heroTitle,
                  { fontSize: kit.heroSize[intensity], lineHeight: kit.heroSize[intensity] + 2 },
                ]}
              >
                {title}
              </Text>
              <View style={styles.heroUnderline} />
            </View>
            {right}
          </View>
          {children}
        </View>
      </View>
      <ScarfBand />
    </>
  );
}

/**
 * Back affordance + title. RTL, so "back" points right.
 *
 * `crestProgramId` badges the eyebrow when the screen belongs to one club, so
 * the detail screen opens with the same crest the card the reader tapped was
 * carrying. Omit it and the eyebrow is plain text as before.
 */
export function ScreenHeader({
  title,
  eyebrow,
  crestProgramId,
  onBack,
}: {
  title: string;
  eyebrow?: string;
  crestProgramId?: string;
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
      {eyebrow &&
        (crestProgramId ? (
          <View style={styles.headerCrestRow}>
            <Crest programId={crestProgramId} size={22} />
            <Text style={styles.headerEyebrow}>{eyebrow}</Text>
          </View>
        ) : (
          <Text style={styles.headerEyebrow}>{eyebrow}</Text>
        ))}
      <Text style={type.display}>{title}</Text>
      {/* The same scarf the hero closes with, at section scale: it ties the
          inner screens to the green without giving them a second dominant
          surface. */}
      <ScarfBand height={border.marker} style={styles.headerScarf} />
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
      {/* The one button that commits gets the shirt. Disabled drops it: a
          striped button that does nothing is the worst of both. */}
      {!disabled && <PitchStripes />}
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
 * A titled block. The heavy band under the label is the section device — the
 * same one the design-system page uses to head 01 COLOUR, 02 TYPE.
 *
 * It reads as green rather than ink, and at `band` rather than `rule`: the page
 * turned its section heads into structural edges, and a 2px ink line under a
 * small label was reading as another hairline in a layout already full of them.
 * Green at 6px states that a new part of the screen starts here.
 *
 * Woven rather than solid now, so the device that heads a section is the same
 * object that closes the hero. At 6px the scarf's blocks read as a texture in
 * the band rather than as eight separate rectangles, which is the difference
 * between a section head and a second hero.
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
        <ScarfBand height={border.band} style={styles.sectionScarf} />
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
 *
 * `minute` appends the match clock — `LIVE 6'` — for the one thing in this app
 * that genuinely has a running minute: how long you have been standing in the
 * mall. Nothing else may borrow it; a clock that is always on stops being one.
 */
export function LivePill({ label = 'LIVE', minute }: { label?: string; minute?: number }) {
  return (
    <View style={styles.livePill}>
      <Text style={styles.livePillLabel}>
        {label}
        {minute == null ? '' : ` ${minute}’`}
      </Text>
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
  hero: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: colors.surfacePrimary,
    /* The stripes are wider than any phone; without the clip they run on. */
    overflow: 'hidden',
  },
  heroEdge: { width: 10, backgroundColor: colors.accentUrgent },
  heroBody: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: space.s4,
    paddingVertical: space.s3,
    gap: space.s2,
  },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  heroHeadline: { gap: space.s1, flexShrink: 1 },
  heroEyebrow: { ...type.meta, color: colors.textMutedOnPrimary },
  /* Size and leading are set at the call site from the kit intensity — this is
     everything about the headline that does not change between the two. */
  heroTitle: { ...type.display, color: colors.textInverse },
  heroUnderline: {
    height: border.band,
    width: 132,
    backgroundColor: colors.textInverse,
    marginTop: space.s1,
  },
  headerEyebrow: { ...type.meta, color: colors.surfacePrimary },
  headerCrestRow: { flexDirection: 'row', alignItems: 'center', gap: space.s2 - 2 },
  headerScarf: { width: 96, marginTop: space.s1 },
  back: { flexDirection: 'row', alignItems: 'center', gap: space.s1, marginBottom: space.s2 },
  backGlyph: { fontSize: 22, lineHeight: 24, color: colors.textDisabled },
  primary: {
    flex: 1,
    borderRadius: radius.sharp,
    paddingVertical: space.s3,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
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
  sectionHead: { marginHorizontal: space.s4 },
  sectionLabel: { ...type.meta, color: colors.textPrimary, paddingBottom: space.s2 },
  sectionScarf: { alignSelf: 'stretch' },
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
