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
import { Crest, Seam } from './Kit';
import { border, colors, fonts, latinFace, radius, space, ticket, type, useCompact } from '../theme';

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
 * Back affordance, an optional line above the title, then the title.
 *
 * The same head the roll opens with: display title at 31, a quiet line under it,
 * a 16dp gutter, left-aligned. A long merchant name runs to fifty characters, so
 * the title drops a step on the smallest phones.
 *
 * `children` take whatever belongs under the title: a count line, a picker.
 */
export function ScreenHeader({
  title,
  eyebrow,
  crestProgramId,
  onBack,
  children,
}: {
  title: string;
  eyebrow?: string;
  crestProgramId?: string;
  onBack?: () => void;
  children?: React.ReactNode;
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
          <Text style={styles.headerLine}>חזרה</Text>
        </Pressable>
      )}
      {eyebrow &&
        (crestProgramId ? (
          <View style={styles.headerCrestRow}>
            <Crest programId={crestProgramId} size={22} />
            <Text style={styles.headerLine}>{eyebrow}</Text>
          </View>
        ) : (
          <Text style={styles.headerLine}>{eyebrow}</Text>
        ))}
      <Text style={[type.display, compact && styles.titleCompact]}>{title}</Text>
      {children}
    </View>
  );
}

/**
 * Primary action: a full-width mint block, the same as the roll's bar actions in
 * weight. Press is a step down the mint ramp — no shadow to lift, no radius to
 * squash, so state is stated in fill.
 *
 * `disabled` alone carries the disabled state: Pressable derives `aria-disabled`
 * from it on web and `accessibilityState.disabled` on native.
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
      accessibilityState={{ disabled: !!disabled }}
      disabled={!!disabled}
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

/** Secondary action: the roll's outlined button, filling in on press. */
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
      style={({ pressed }) => [styles.ghost, pressed && { backgroundColor: ticket.ground3 }, style]}
    >
      <Text style={styles.ghostLabel}>{label}</Text>
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
  tone = 'paper',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Shown once something has been typed, so a short list reads as filtered rather than empty. */
  resultCount?: number;
  /** `ink` for the punch ticket's dark ground. */
  tone?: 'paper' | 'ink';
}) {
  const ink = tone === 'ink';
  return (
    <View style={styles.searchWrap}>
      <View style={[styles.search, ink && styles.searchInk]}>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={ink ? ticket.onGround2 : colors.textMuted}
          style={[styles.searchInput, ink && styles.searchInputInk]}
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
            <Text style={[styles.searchClearMark, ink && styles.searchMutedInk]}>×</Text>
          </Pressable>
        )}
      </View>
      {value.trim().length > 0 && resultCount != null && (
        <Text style={[styles.searchCount, ink && styles.searchMutedInk]}>
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
 * A titled block: the roll's own block head, then what belongs under it. No rule
 * and no small caps — the head is display type, like "תקף עכשיו".
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
      <Text style={styles.sectionLabel}>{eyebrow}</Text>
      {children}
    </View>
  );
}

/**
 * A quiet ticket: the dark stock, edge to edge, with the tear line along its top.
 * Everything that is a statement rather than a benefit sits on one, so a screen
 * is a roll of them the way the home screen is — no outlined boxes anywhere.
 */
export function Panel({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return (
    <View style={[styles.panel, style]}>
      <Seam />
      {children}
    </View>
  );
}

/**
 * One line of a list: the roll's sheet row. Edge to edge on the ground, a rule
 * under it, a 48dp target. Pass `onPress` to make it a control; `selected` fills it.
 */
export function ListRow({
  children,
  onPress,
  selected,
  ...rest
}: {
  children: React.ReactNode;
  onPress?: () => void;
  selected?: boolean;
} & Omit<React.ComponentProps<typeof Pressable>, 'style' | 'children' | 'onPress'>) {
  if (!onPress) return <View style={[styles.listRow, selected && styles.listRowOn]}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.listRow, (selected || pressed) && styles.listRowOn]}
      {...rest}
    >
      {children}
    </Pressable>
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
    paddingHorizontal: space.s3,
    paddingTop: space.s3,
    paddingBottom: space.s2,
    gap: space.s2,
    alignItems: 'flex-start',
  },
  headerLine: { fontFamily: fonts.latinText, fontSize: 15, lineHeight: 22, color: ticket.onGround2 },
  titleCompact: { fontSize: 26, lineHeight: 30 },
  headerCrestRow: { flexDirection: 'row', alignItems: 'center', gap: space.s2 },
  back: { flexDirection: 'row', alignItems: 'center', gap: space.s1 },
  backGlyph: { fontSize: 22, lineHeight: 24, color: ticket.muted },
  primary: { flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center' },
  primaryDisabled: { backgroundColor: ticket.ground3 },
  primaryDisabledLabel: { color: colors.textDisabled },
  ghost: {
    minHeight: 44,
    paddingHorizontal: space.s3,
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: ticket.onGround,
  },
  ghostLabel: { fontFamily: fonts.latinText, fontSize: 15, lineHeight: 20, color: ticket.onGround },
  section: { gap: space.s2 },
  sectionLabel: {
    ...type.displaySmall,
    paddingHorizontal: space.s3,
    paddingTop: space.s2,
    alignSelf: 'flex-start',
  },
  panel: {
    backgroundColor: ticket.ground2,
    paddingHorizontal: space.s3,
    paddingVertical: space.s3,
    gap: space.s2,
    alignItems: 'flex-start',
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s3 - 2,
    minHeight: 48,
    paddingHorizontal: space.s3,
    paddingVertical: space.s2,
    borderBottomWidth: 1,
    borderBottomColor: ticket.rule,
  },
  listRowOn: { backgroundColor: ticket.ground2 },
  searchWrap: { paddingHorizontal: space.s3, paddingBottom: space.s2, gap: space.s1 },
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
  searchInk: { backgroundColor: ticket.ground2, borderColor: ticket.muted },
  searchInputInk: { color: ticket.onGround },
  searchMutedInk: { color: ticket.onGround2 },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: space.s2,
    rowGap: space.s2,
    paddingHorizontal: space.s3,
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
  livePill: {
    backgroundColor: colors.accentUrgent,
    borderRadius: radius.sharp,
    paddingHorizontal: space.s2 + 2,
    paddingVertical: space.s1 + 1,
    alignSelf: 'flex-start',
  },
  livePillLabel: {
    ...type.micro,
    color: colors.textInverse,
    fontFamily: fonts.latinDisplay,
    letterSpacing: 1.6,
    /* A Latin word, so it keeps its own order inside a Hebrew row. */
    writingDirection: 'ltr',
  },
});
