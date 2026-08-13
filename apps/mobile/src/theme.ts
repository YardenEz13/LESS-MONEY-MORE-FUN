import { I18nManager, Platform, TextStyle, useWindowDimensions } from 'react-native';

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
 * Colour carries meaning instead of decoration, and the metaphor that assigns
 * the meanings is football. The pitch is green and green is money kept. The
 * referee's yellow is an errand you can still run; his red is a condition the
 * T&C says you fail. Orange is the clock — live now, running out. Blue is the
 * choice in your hands: a filter, a tab, a combination.
 *
 * Two families never mix. **Verdict** hues (green, yellow, red, orange) judge;
 * **crest** hues (claret, violet, teal) only identify which club a benefit came
 * from and appear nowhere except inside a crest. So a violet square is never
 * mistaken for a ruling, and a yellow one always is.
 *
 * Token names are semantic, never source or brand names: a re-skin is three
 * swaps — the urgent accent, the display face, the kit stripe. The palette's
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

  /** The pitch. Money kept, primary actions, satisfied conditions. */
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

  /**
   * The referee's yellow: a caution, not a sending-off. Every condition the
   * reader can still do something about — top up the basket, issue the voucher,
   * switch channel — is booked in this colour.
   *
   * Only ever a fill under near-black (10.3:1). Yellow text on paper is 1.7:1
   * and there is no size at which that becomes readable, so the token has no
   * text role at all.
   */
  cardYellow: '#F2B705',
  /**
   * The yellow's ink-side twin: the card's own border, and the one form the
   * booking may take as *text* on paper (4.9:1). Deep enough to be olive rather
   * than gold, because anything brighter fails at 13px and the whole point of
   * having it is that the detail screen can name the verdict in words.
   */
  cardYellowDeep: '#8A6500',

  /**
   * The referee's red: the T&C itself says no. Not "hurry" — orange already
   * carries hurry — but "this one is off the pitch for now".
   *
   * Carries paper at 5.1:1, so unlike the yellow it is a fill with light text.
   */
  cardRed: '#C81E2B',
  cardRedDeep: '#8E121C',
} as const;

/**
 * Crest hues — the club badge, and nothing else.
 *
 * A benefit comes from somewhere, and in a list of nine cards from six clubs
 * the source is the fastest thing to scan for. Every other colour in this file
 * is a ruling, so identity needed hues that can never be read as one: no green,
 * no yellow, no red, no orange. Three leagues, three kits, each carrying paper
 * above 5:1.
 *
 * Keyed by `Program['category']` rather than by program id on purpose — 74
 * clubs would need 74 hues nobody can tell apart, and the category is what the
 * reader is actually distinguishing: a card, a workplace, a shop.
 */
export const crestColors: Record<string, string> = {
  /** Claret — a credit card. */
  credit_card: '#8A1538',
  /** Violet — a workplace or union club. */
  employer_club: '#4B2E83',
  /** Teal — a retail club. */
  retail_club: '#0E6E6E',
};

/** A club with no category, or one added after this file was written. */
export const crestFallback = colors.surfacePlate;

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
 * One breakpoint, and it divides phones from phones — not phones from tablets.
 *
 * 360dp is where the small Androids and the 1st-gen SE sit; below it the fixed
 * costs of the layout (a 24dp gutter each side, a 104dp number plate) stop being
 * a small fraction of the screen and start being most of it. A benefit card at
 * 320 has 133dp left for a merchant name that runs to fifty characters, so the
 * plate has to give some of it back.
 *
 * Only what is *fixed* gets a compact value. Anything that can be stated as
 * "wrap when you run out" is written that way instead — `flexWrap` degrades at
 * every width, while a breakpoint only fires at one, and the hero's headline
 * and its action row never fit on one line on any phone we ship to.
 */
export const compactWidth = 360;

/**
 * True on a small phone. A hook rather than a module constant because the web
 * build resizes under you and RN only reports orientation changes this way.
 */
export function useCompact(): boolean {
  const { width } = useWindowDimensions();
  return width < compactWidth;
}

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
 *
 * The vocabulary is the referee's, because his is the one everyone already
 * knows and it happens to be exactly this app's job: a booking is not a
 * sending-off, and the difference between "bring the voucher" and "not valid
 * on a Saturday" is precisely the difference between yellow and red. `card`
 * marks the two tones that get an actual card drawn rather than a square.
 */
export const gateTone = {
  met: { bg: colors.surfacePrimary, border: colors.surfacePrimary, fg: colors.textInverse, card: false },
  /** Booked — yellow under near-black. An errand is not a foul. */
  action: { bg: colors.cardYellow, border: colors.cardYellowDeep, fg: colors.textPrimary, card: true },
  note: { bg: 'transparent', border: colors.borderHairline, fg: colors.textMuted, card: false },
  /** Sent off — red under paper. The T&C, not the clock, is what says no. */
  blocked: { bg: colors.cardRed, border: colors.cardRedDeep, fg: colors.textInverse, card: true },
} as const;

export type GateTone = keyof typeof gateTone;

export const gateGlyph: Record<GateTone, string> = {
  met: '✓',
  action: '!',
  note: '•',
  blocked: '✕',
};

/**
 * The ruling in two words, for the expanded list where there is room for it.
 *
 * The chip on a card cannot afford these — it has the label and the colour and
 * that is the whole budget — but a reader who opened the detail screen is
 * asking exactly this question, and "תלוי בכם" answers it in a way a yellow
 * rectangle alone does not.
 */
export const gateVerdict: Record<GateTone, string> = {
  met: 'מתקיים',
  action: 'תלוי בכם',
  note: 'לתשומת לב',
  blocked: 'לא מתקיים',
};

/**
 * The kit — the football half of the system, and the only part of this file
 * that draws texture rather than states a value.
 *
 * Two intensities, both real. `full` is the shirt: stripes at full strength,
 * the scarf at full depth, display type at scoreboard size. `quiet` keeps every
 * token and every layout and simply turns the volume down — a quarter-strength
 * stripe, a thin scarf, smaller display. Nothing moves between them, so a
 * screen laid out in one is laid out in the other, and the reader who does not
 * want to be a supporter still gets a system rather than a fan site.
 *
 * A stripe is drawn as a row of fixed-width views, not as a gradient: React
 * Native has no repeating background, and a row of flat fills is what the
 * design system asks for anyway.
 */
export const kit = {
  /** One stripe plus one gap is the period. Roughly a shirt panel at phone width. */
  stripeWidth: 26,
  stripeGap: 26,
  /** Enough stripes to cross a tablet in landscape; the parent clips the rest. */
  stripeCount: 40,
  stripeAlpha: { full: 0.17, quiet: 0.05 },
  /** The scarf: the band that closes a green surface. */
  scarfHeight: { full: 16, quiet: 7 },
  /** Display type is the scoreboard, so it is the first thing intensity moves. */
  heroSize: { full: 46, quiet: 36 },
  figureSize: { full: 48, quiet: 40 },
} as const;

export type KitIntensity = keyof typeof kit.stripeAlpha;
