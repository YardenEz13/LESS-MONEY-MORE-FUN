import { I18nManager, Platform, TextStyle } from 'react-native';

/**
 * Design system — "מערכת ההנחות" (Deals).
 *
 * A scoreboard meeting port signage. Numbers carry full authority, fills are
 * flat, rules are one pixel. Three laws the rest of this file just enforces:
 *
 *   1. Flat fill only — no gradient, glass, glow or soft shadow.
 *   2. 90° corners. Elevation comes from lines, never from shadows.
 *   3. Hierarchy from weight, size and rule — never from letter-spacing.
 *
 * Three hues, each with one job, so colour carries meaning instead of decoration:
 * green is money kept, blue is yours to act on, orange is running out. Grey is
 * reserved for what you can neither bank nor act on. Anything that cannot be
 * assigned one of those jobs stays on paper.
 *
 * Token names are semantic, never source or brand names: a re-skin is three
 * swaps — the urgent accent, the display face, the hero texture. The palette's
 * division of labour, the 8-grid and the figures on the plate are the system.
 */

export function enforceRtl(): void {
  // The whole app is Hebrew; a dogfooder on an English phone should still get
  // the intended layout. Takes effect after reload on native.
  if (!I18nManager.isRTL) {
    I18nManager.allowRTL(true);
    I18nManager.forceRTL(true);
  }
  // react-native-web reads direction from the document rather than from
  // I18nManager, so without this the web build keeps LTR row order while the
  // text renders right-aligned — rows come out mirrored against native.
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    document.documentElement.dir = 'rtl';
    document.documentElement.lang = 'he';
  }
}

export const colors = {
  /** Page and cards share one fill. A hairline separates them, not a tint. */
  surfacePage: '#F5F3EE',
  /** The one raised paper tone: table headers, selected rows. */
  surfaceRaised: '#EFECE4',
  /** Inset wells — image placeholders, empty slots. */
  surfaceInset: '#E4E0D6',

  /** Money kept. Primary actions, satisfied conditions. */
  surfacePrimary: '#0B6B45',
  surfacePrimaryRaised: '#0E7A4E',
  surfacePrimaryDeep: '#074A30',

  /**
   * The second voice. Green states what you keep; blue states what is yours to
   * do — selected filters, errands, anything the reader acts on rather than
   * banks. Two hues carry twice the meaning one hue plus grey ever could.
   *
   * Deeper and less cyan than it was: against the warm paper the old mid-blue
   * sat at the same visual weight as the green and the two competed. At 7.9:1
   * on paper it now reads as the second voice rather than a rival first.
   */
  surfaceAccent: '#0A4A8F',
  surfaceAccentRaised: '#0E5CAE',
  surfaceAccentDeep: '#063463',

  /**
   * The number plate. Near-black with a green cast rather than navy: the blue
   * became a surface family of its own above, and a navy plate behind a blue
   * chip read as two blues disagreeing. Ink is nobody's hue, so the figure on
   * it belongs to whatever colour the card assigns.
   */
  surfacePlate: '#111310',
  surfacePlateSoft: '#1C1F1A',

  textPrimary: '#111310',
  textMuted: '#5C6157',
  textDisabled: '#8A8C82',
  textInverse: '#F5F3EE',
  textMutedInverse: '#A8B2A4',
  /** Muted text that has to sit on the green. */
  textMutedOnPrimary: '#A8CFBB',

  borderHairline: '#D9D5CB',
  /** Interior separators inside an already-bordered block. */
  borderHairlineSoft: '#E6E2D9',
  /** Separators drawn on the dark plate. */
  borderOnPlate: '#2A2E27',

  /**
   * Expiry and violation. Never set as text directly on the green — that pair
   * is 1.9:1. On green or plate it appears as a full fill with near-black text.
   *
   * Warmer and lighter than the old brick: at 5.4:1 under near-black it now
   * clears 4.5 as a fill at any size, so urgency no longer needs the bright
   * variant to stay legible on paper.
   */
  accentUrgent: '#E1651B',
  /** Pressed-into and dark-background states. */
  accentUrgentBright: '#FF7A29',
  accentUrgentDeep: '#B34A0E',
} as const;

export const fonts = {
  /** EFT_OffSet — headlines and figures */
  displayLight: 'EFT_OffSet',
  display: 'EFT_OffSet',
  displayBold: 'EFT_OffSet',
  /** EFT_Artzisraeli — body and interface text */
  text: 'EFT_Artzisraeli',
  textMedium: 'EFT_Artzisraeli',
  textSemibold: 'EFT_Artzisraeli',
  textBold: 'EFT_Artzisraeli',

  /**
   * Latin runs — "Terminal X", "Cash כאל Pro", "שופרסל LIFE".
   *
   * Both EFT faces do carry A–Z, so nothing ever falls back; the text engine
   * simply draws their Latin, and their Latin is a bookish serif that shares
   * nothing with the Hebrew beside it. Their `&` is also mapped to a shekel
   * glyph, so "Golf & Co" renders as "Golf ₪ Co". Neither is a hierarchy
   * a reader can use, so Latin gets its own pair of faces.
   *
   * These two are the faces the design system already names — the Hebrew
   * simply moved to EFT and left them holding only the Latin half of the job.
   */
  latinDisplay: 'Karantina_700Bold',
  latinText: 'NotoSansHebrew_400Regular',
} as const;

/**
 * Which Latin face stands in for which Hebrew one. Two entries because the
 * weight aliases above all resolve to two real files.
 */
export const latinFace: Record<string, string> = {
  [fonts.display]: fonts.latinDisplay,
  [fonts.text]: fonts.latinText,
};

/**
 * Every figure in the system: aligned columns, and a countdown that doesn't
 * shiver as it ticks. `writingDirection: 'ltr'` is the bidi isolation — it
 * keeps "₪150" and "1+1" in their own order inside a Hebrew sentence.
 */
const numeric = {
  fontVariant: ['tabular-nums', 'lining-nums'],
  writingDirection: 'ltr',
} satisfies TextStyle;

/**
 * Type scale.
 *
 * The design-system page specifies display leading as tight as 0.78. That is a
 * browser line box; RN clips a glyph whose line box is shorter than the font's
 * own ascent + descent, and Android clips hardest. So display leading here sits
 * at ~1.0 — visually tight because the display face is condensed, not because
 * the box is being squeezed past what the text engine will draw.
 */
export const type = {
  display: {
    fontFamily: fonts.displayBold,
    fontSize: 34,
    lineHeight: 36,
    color: colors.textPrimary,
  },
  displaySmall: {
    fontFamily: fonts.displayBold,
    fontSize: 26,
    lineHeight: 29,
    color: colors.textPrimary,
  },

  /** Card headline — a merchant name, a benefit title. */
  lead: {
    fontFamily: fonts.textSemibold,
    fontSize: 20,
    lineHeight: 27,
    color: colors.textPrimary,
  },
  body: { fontFamily: fonts.text, fontSize: 16, lineHeight: 24, color: colors.textPrimary },
  bodyStrong: {
    fontFamily: fonts.textSemibold,
    fontSize: 16,
    lineHeight: 24,
    color: colors.textPrimary,
  },
  small: { fontFamily: fonts.text, fontSize: 14, lineHeight: 21, color: colors.textPrimary },
  caption: { fontFamily: fonts.text, fontSize: 13, lineHeight: 19, color: colors.textMuted },
  /** Section markers and labels. Hebrew has no uppercase — weight does the work. */
  meta: { fontFamily: fonts.textMedium, fontSize: 13, lineHeight: 19, color: colors.textMuted },
  micro: { fontFamily: fonts.textMedium, fontSize: 11, lineHeight: 15, color: colors.textMuted },

  chip: { fontFamily: fonts.textMedium, fontSize: 13.5, lineHeight: 18 },
  button: { fontFamily: fonts.textSemibold, fontSize: 15, color: colors.textInverse },

  /** The plate figure — the thing you read first. */
  figure: {
    ...numeric,
    fontFamily: fonts.displayBold,
    fontSize: 44,
    lineHeight: 44,
    color: colors.textInverse,
  },
  figureLarge: {
    ...numeric,
    fontFamily: fonts.displayBold,
    fontSize: 58,
    lineHeight: 58,
    color: colors.textInverse,
  },
  figureInline: {
    ...numeric,
    fontFamily: fonts.displayBold,
    fontSize: 24,
    lineHeight: 26,
    color: colors.surfacePrimary,
  },
  tableValue: {
    ...numeric,
    fontFamily: fonts.textSemibold,
    fontSize: 17,
    color: colors.textPrimary,
  },
} satisfies Record<string, TextStyle>;

/** 8-base grid. 4 is the only half-step. */
export const space = { s1: 4, s2: 8, s3: 16, s4: 24, s5: 32, s6: 48, s7: 64 } as const;

/**
 * 90° everywhere. `soft` is the single sanctioned alternative and the system
 * picks one for the whole product — this product picked sharp.
 */
export const radius = { sharp: 0, soft: 4 } as const;

/**
 * Hairline separates, rule heads a section, marker states "active".
 *
 * `band` is the heavy one: it closes a full-width band — the section head, the
 * edge under a plate strip. At 6px it is thick enough to read as a structural
 * edge rather than a border, which is the whole point of a system that gets its
 * elevation from lines instead of shadows. Not a substitute for `rule`: `rule`
 * still draws inside a block, `band` only ever ends one.
 */
export const border = { hairline: 1, rule: 2, marker: 4, band: 6 } as const;

/**
 * Four tones, not three. A pending gate splits by whether the user can do
 * something about it, so a card full of ordinary caveats reads calm rather
 * than alarming. Each tone is a flat fill — the chip states its own verdict.
 */
export const gateTone = {
  met: { bg: colors.surfacePrimary, border: colors.surfacePrimary, fg: colors.textInverse },
  /** Blue, not black: an errand is something to do, not something wrong. */
  action: { bg: colors.surfaceAccent, border: colors.surfaceAccent, fg: colors.textInverse },
  note: { bg: 'transparent', border: colors.borderHairline, fg: colors.textMuted },
  /**
   * Urgent as a fill with near-black on top — never as text on a coloured field.
   * The base tone, not the bright one: the warmer orange carries near-black at
   * 5.4:1, so a chip clears 4.5 without borrowing the variant reserved for
   * pressed states and dark backgrounds.
   */
  blocked: {
    bg: colors.accentUrgent,
    border: colors.accentUrgent,
    fg: colors.textPrimary,
  },
} as const;

export type GateTone = keyof typeof gateTone;

export const gateGlyph: Record<GateTone, string> = {
  met: '✓',
  action: '!',
  note: '•',
  blocked: '✕',
};
