import { I18nManager, Platform, TextStyle, useWindowDimensions } from 'react-native';

/**
 * Design system — the punch ticket.
 *
 * One dark ground, flat stocks, ink on every stock, one-pixel rules and no
 * shadows. The `colors` tokens below keep their old names so screens did not
 * have to change, but their meaning is the ticket's: `surfacePage` is the
 * ground, `textInverse` is ink (text drawn on a stock, mint or sky fill), mint
 * is money kept, marigold an errand you can still run, dead grey with the void
 * red a condition the terms fail. `ticket` holds the stocks themselves.
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

/**
 * The punch ticket: the one source of colour. Everything else in this file, and
 * every screen, takes its hex from here, so a re-skin is this block and nothing else.
 *
 * Flat stocks on a deep indigo ground. A stock says which card you pay with, so it
 * is handed out from the clubs this person holds rather than fixed per club. Ink on
 * every stock clears 4.5:1, and so does `void` on `dead`, the grey of a blocked
 * ticket, which is why a verdict never relies on colour alone: it is also a word.
 */
export const stock = {
  coral: '#FF7F5F',
  marigold: '#F5C83E',
  mint: '#76E5AD',
  sky: '#79CEEF',
  orchid: '#E8A8E1',
  bone: '#E7DDC8',
} as const;

export const ticket = {
  ground: '#14101F',
  ground2: '#201A30',
  ground3: '#30284A',
  onGround: '#F4EEE0',
  onGround2: '#D9D4E0',
  muted: '#A9A3B8',
  rule: '#463D63',
  /** In the order the roll hands them out. */
  stocks: [stock.coral, stock.marigold, stock.mint, stock.sky, stock.orchid, stock.bone],
  dead: '#BDBFB8',
  ink: '#14101F',
  ink2: '#2A2240',
  void: '#79000C',
  /** The step still yours to do. The loudest thing on a ticket. */
  punch: stock.marigold,
} as const;

export const colors = {
  /** Page and cards share one fill: the roll's deep indigo ground. */
  surfacePage: ticket.ground,
  /** The one raised tone: table headers, selected rows. */
  surfaceRaised: ticket.ground2,
  /** Inset wells — image placeholders, empty slots. */
  surfaceInset: ticket.ground3,

  /** Mint: money kept, primary actions, satisfied conditions. Ink sits on it. */
  surfacePrimary: stock.mint,
  surfacePrimaryRaised: '#8FEBBD',
  surfacePrimaryDeep: '#4FC48A',

  /** Sky: what is yours to choose or do — a selected filter, an errand. */
  surfaceAccent: stock.sky,
  surfaceAccentRaised: '#9AD9F2',
  surfaceAccentDeep: '#4FAFD6',

  /**
   * The bone stock, for a figure that has to be held up. Ink sits on it, which
   * is why `textInverse` below is ink: "inverse" means "on a stock", not "on a
   * dark fill", now that the page itself is the dark one.
   */
  surfacePlate: stock.bone,
  surfacePlateSoft: '#CFC4A8',

  textPrimary: ticket.onGround,
  textMuted: ticket.muted,
  textDisabled: '#857E98',
  /** Ink: any text drawn on a stock, mint or sky fill. */
  textInverse: ticket.ink,
  textMutedInverse: ticket.ink2,
  /** Muted text that has to sit on mint. */
  textMutedOnPrimary: ticket.ink2,

  borderHairline: ticket.rule,
  /** Interior separators inside an already-bordered block. */
  borderHairlineSoft: ticket.ground3,
  /** Separators drawn on the bone plate. */
  borderOnPlate: '#B5AB92',

  /** Expiry and the clock. A fill under ink, never text. */
  accentUrgent: stock.coral,
  accentUrgentBright: '#FF9A80',
  accentUrgentDeep: '#E5603E',

  /**
   * Marigold: an errand you can still run. A fill under ink, and on the dark
   * ground it also reads as text, so the deep twin is the same colour.
   */
  cardYellow: stock.marigold,
  cardYellowDeep: stock.marigold,

  /**
   * A condition the T&C fails: the dead grey of a blocked ticket with the void
   * red on it, as on the roll. `cardRedText` is the one form that has to read
   * as text on the dark ground.
   */
  cardRed: ticket.dead,
  cardRedDeep: ticket.void,
  cardRedText: '#FF9A8A',
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
  credit_card: stock.orchid,
  /** Violet — a workplace or union club. */
  employer_club: stock.sky,
  /** Teal — a retail club. */
  retail_club: stock.bone,
};

/** A club with no category, or one added after this file was written. */
export const crestFallback = ticket.dead;

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
  /** A screen title: the same 31 the roll's own title uses. */
  display: {
    fontFamily: fonts.displayBold,
    fontSize: 31,
    lineHeight: 36,
    color: colors.textPrimary,
  },
  /** A block head: "תקף עכשיו" on the roll, a section name elsewhere. */
  displaySmall: {
    fontFamily: fonts.displayBold,
    fontSize: 22,
    lineHeight: 27,
    color: colors.textPrimary,
  },

  /** A name: a merchant, a club, a setting. */
  lead: {
    fontFamily: fonts.textSemibold,
    fontSize: 20,
    lineHeight: 27,
    color: colors.textPrimary,
  },
  /* Running text is the Latin-capable Hebrew face, as on the roll: the EFT faces
     are for names and figures, and read badly at paragraph length. */
  body: { fontFamily: fonts.latinText, fontSize: 15, lineHeight: 22, color: colors.textPrimary },
  bodyStrong: {
    fontFamily: fonts.textSemibold,
    fontSize: 16,
    lineHeight: 24,
    color: colors.textPrimary,
  },
  small: { fontFamily: fonts.latinText, fontSize: 14, lineHeight: 20, color: colors.textPrimary },
  caption: { fontFamily: fonts.latinText, fontSize: 13.5, lineHeight: 19, color: colors.textMuted },
  meta: { fontFamily: fonts.latinText, fontSize: 14, lineHeight: 20, color: colors.textMuted },
  micro: { fontFamily: fonts.latinText, fontSize: 12.5, lineHeight: 16, color: colors.textMuted },

  chip: { fontFamily: fonts.latinText, fontSize: 14, lineHeight: 19 },
  button: { fontFamily: fonts.displayBold, fontSize: 17, lineHeight: 22, color: colors.textInverse },

  /** The plate figure — the thing you read first. */
  figure: {
    ...numeric,
    fontFamily: fonts.displayBold,
    fontSize: 44,
    lineHeight: 46,
    color: colors.textInverse,
  },
  figureLarge: {
    ...numeric,
    fontFamily: fonts.displayBold,
    fontSize: 58,
    lineHeight: 60,
    color: colors.textInverse,
  },
  figureInline: {
    ...numeric,
    fontFamily: fonts.displayBold,
    fontSize: 22,
    lineHeight: 26,
    color: colors.cardYellow,
  },
  tableValue: {
    ...numeric,
    fontFamily: fonts.displayBold,
    fontSize: 28,
    lineHeight: 30,
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
  /** Marigold under ink. An errand is not a foul. */
  action: { bg: colors.cardYellow, border: colors.cardYellowDeep, fg: colors.textInverse, card: true },
  note: { bg: 'transparent', border: colors.borderHairline, fg: colors.textMuted, card: false },
  /** Dead grey with the void red: the T&C, not the clock, says no. */
  blocked: { bg: colors.cardRed, border: colors.cardRedDeep, fg: colors.cardRedDeep, card: true },
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
