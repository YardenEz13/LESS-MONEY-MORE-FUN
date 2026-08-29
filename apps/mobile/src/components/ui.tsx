import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text as RNText,
  TextInput,
  View,
  type TextProps,
  type ViewStyle,
} from 'react-native';
import { latinRuns } from '@sbr/core';
import { Crest, PitchStripes, ScarfBand } from './Kit';
import { border, colors, fonts, kit, latinFace, radius, space, type, useCompact } from '../theme';

/**
 * A note that applies to every control in the app, not just the ones here:
 * state a checkbox/tab/radio's on-ness with the `aria-*` props, never with
 * `accessibilityState`.
 *
 * react-native-web 0.21 forwards `aria-checked`, `aria-selected` and friends
 * straight to the DOM, but it has no mapping for the legacy `accessibilityState`
 * object at all — the key is absent from its forwarded-props table, so it is
 * dropped in silence. A row that states its state only that way renders as
 * `role="checkbox"` with no `aria-checked` on it, and a screen reader on the web
 * build cannot tell a ticked club from an unticked one.
 *
 * React Native 0.71+ reads the same `aria-*` props on View and Pressable and
 * folds them back into `accessibilityState`, so the modern spelling is the one
 * that works on both platforms and the legacy one is never needed alongside it.
 * `accessibilityRole` is unaffected — it still maps to `role` on web.
 */

/**
 * The other thing the EFT faces get wrong, alongside the `&` → ₪ mapping in
 * theme.ts: U+00B7 MIDDLE DOT — the app's separator, in gate summaries, combo
 * lines and trust rows — carries an advance of about 65em in both faces. One
 * of them makes its line ~1000px wide, and because that width becomes the
 * automatic minimum size of a flex item, the row it sits in cannot shrink back:
 * the value runs off the screen and its neighbours collapse to nothing.
 *
 * So the middot joins the Latin runs: drawn in the Latin face beside it, which
 * measures it at a quarter of an em like every other font does. Fixed here
 * rather than by swapping the character at each call site, because separators
 * also arrive from the catalogue — `raw_text_summary` is scraped text, and
 * nothing in this app chooses what is in it.
 */
const EFT_BROKEN = /(·+)/;

/** Latin runs, plus the characters the Hebrew faces mismeasure. */
function faceRuns(text: string): Array<{ text: string; latin: boolean }> {
  return latinRuns(text).flatMap((run) =>
    run.latin
      ? [run]
      : run.text
          .split(EFT_BROKEN)
          .filter(Boolean)
          .map((part) => ({ text: part, latin: part.startsWith('·') })),
  );
}

function splitLatin(node: React.ReactNode, face: string): React.ReactNode {
  if (Array.isArray(node)) {
    return node.map((child, i) => (
      <React.Fragment key={i}>{splitLatin(child, face)}</React.Fragment>
    ));
  }
  if (typeof node !== 'string') return node;

  const runs = faceRuns(node);
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
 * `heroTop` wraps rather than shrinking. The title is 207dp of display type and
 * a screen's action row runs to ~200dp; against a body that is 262dp wide on a
 * 320 phone and 332dp on a 390 one, the two have never fitted side by side on
 * anything we ship to. Shrinking is what the layout used to do, and at 320 it
 * left the title 66dp — five lines of two characters each, and a hero eating
 * two thirds of the screen. Wrapping puts the actions on their own line at the
 * width where they stop fitting and leaves them beside the title above it.
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
  const compact = useCompact();
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
                  { fontSize: kit.heroSize, lineHeight: kit.heroSize + 2 },
                  compact && styles.heroTitleCompact,
                ]}
              >
                {title}
              </Text>
              <View style={[styles.heroUnderline, compact && styles.heroUnderlineCompact]} />
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
 * The title is whatever the screen is about, and on the detail screen that is a
 * merchant name — the catalog holds several past fifty characters. At 34dp on a
 * 320 screen that is seven lines before the content starts, so display drops a
 * step when the screen does.
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
  const compact = useCompact();
  return (
    <View style={styles.header}>
      {onBack && (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="חזרה"
          hitSlop={12}
          style={styles.back}
        >
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
      <Text style={compact ? type.displaySmall : type.display}>{title}</Text>
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
 *
 * `disabled` alone carries the disabled state: Pressable derives `aria-disabled`
 * from it on web and `accessibilityState.disabled` from it on native, and on web
 * it wins over any `aria-disabled` passed in alongside — so stating the state a
 * second time would be dead weight. Coerced, so native gets a definite `false`
 * rather than falling through to whatever `accessibilityState` holds.
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
      accessibilityLabel={label}
      // Announced as well as painted: a greyed button that still reports itself
      // as available is a tap a screen-reader user makes and gets nothing from.
      accessibilityState={{ disabled: !!disabled }}
      disabled={!!disabled}
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
      accessibilityLabel={label}
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

/**
 * Segmented filter. Selected is a solid blue chip — a choice, not a verdict.
 *
 * The row itself is the `tablist`: a `tab` outside one is an orphan, and a
 * screen reader needs the container to announce "2 of 3" rather than reading
 * three unrelated controls.
 *
 * It wraps rather than truncating. The three chips plus their counts come to
 * 332dp — under the 320 screen's gutters, and wider still as a count goes from
 * one digit to two. Chips do not shrink in RN, so the row used to run out
 * through its own padding and sit visibly off-centre; a truncated "דורש פעו…"
 * would be worse than a second line.
 */
/**
 * The search box. One component for both lists that got too long to scan: 61
 * clubs at onboarding and 1199 merchants after it.
 *
 * `textAlign: 'right'` rather than leaving it to the platform. The catalog is
 * Hebrew with Latin brand names all through it ("Fox Home", "KSP"), and an
 * input left to auto-align jumps its alignment the moment the first Latin
 * character is typed — the field visibly moves while someone is using it. It is
 * a Hebrew field that sometimes holds Latin text, so it is pinned that way.
 *
 * The clear button is a real control rather than relying on the keyboard's,
 * because on a filtered list "how do I get everything back" is the second
 * thing anyone needs and the platform's own clear affordance is inconsistent.
 */
export function SearchField({
  value,
  onChange,
  placeholder,
  resultCount,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Shown once something has been typed, so a short list reads as filtered rather than empty. */
  resultCount?: number;
}) {
  return (
    <View style={styles.searchWrap}>
      <View style={styles.search}>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          style={styles.searchInput}
          accessibilityLabel={placeholder}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="never"
        />
        {value.length > 0 && (
          <Pressable
            onPress={() => onChange('')}
            accessibilityRole="button"
            accessibilityLabel="נקה חיפוש"
            style={styles.searchClear}
          >
            <Text style={styles.searchClearMark}>×</Text>
          </Pressable>
        )}
      </View>
      {value.trim().length > 0 && resultCount != null && (
        <Text style={styles.searchCount}>
          {resultCount === 0 ? 'אין תוצאות' : `${resultCount} תוצאות`}
        </Text>
      )}
    </View>
  );
}

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
    <View accessibilityRole="tablist" style={styles.filterRow}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            // The count is part of the name on purpose: "מוכן לקופה" and
            // "מוכן לקופה, 238" are different amounts of information, and the
            // number is the reason someone picks the tab.
            accessibilityLabel={
              option.count != null ? `${option.label}, ${option.count}` : option.label
            }
            accessibilityState={{ selected: active }}
            aria-selected={active}
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
  heroTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    columnGap: space.s3,
    rowGap: space.s2,
  },
  heroHeadline: { gap: space.s1, flexShrink: 1 },
  heroEyebrow: { ...type.meta, color: colors.textMutedOnPrimary },
  /* Size and leading are set at the call site — this is
     everything about the headline that does not change between the two. */
  heroTitle: { ...type.display, color: colors.textInverse },
  /* One step down the display ramp, so the title still clears the gutters on a
     320 screen once the actions have taken their own line. */
  heroTitleCompact: { fontSize: 34, lineHeight: 36 },
  heroUnderline: {
    height: border.band,
    width: 132,
    backgroundColor: colors.textInverse,
    marginTop: space.s1,
  },
  /* The band is a proportion of the title, not a fixed length. */
  heroUnderlineCompact: { width: 112 },
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
  searchWrap: { paddingHorizontal: space.s4, paddingBottom: space.s2, gap: space.s1 },
  /* Flat fill, 90 degrees, one hairline — the same three rules as every other
     surface in the system. No focus glow: the caret already says where you are. */
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderWidth: border.hairline,
    borderColor: colors.borderHairline,
    borderRadius: radius.sharp,
    paddingHorizontal: space.s3,
  },
  searchInput: {
    flex: 1,
    ...type.body,
    paddingVertical: space.s2 + 2,
    textAlign: 'right',
  },
  searchClear: { paddingHorizontal: space.s2, paddingVertical: space.s1 },
  searchClearMark: { ...type.body, color: colors.textMuted, fontSize: 20, lineHeight: 22 },
  searchCount: { ...type.caption, paddingHorizontal: space.s1 },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: space.s2,
    rowGap: space.s2,
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
