import { I18nManager, Platform, TextStyle } from 'react-native';

/**
 * Design system — "Ledger".
 *
 * The brief is an app you open standing at a till, in Hebrew, to answer one
 * question: do I have something here right now, and what's the catch? So the
 * look is borrowed from the artifact that already answers that honestly — a
 * printed receipt. Ink on warm paper, hairline rules, figures given room,
 * conditions never relegated to grey small print.
 *
 * The accent is a deep teal-green rather than the usual promotional red: this
 * app never sells a deal, it tells you what you already hold. Money kept, not
 * money spent.
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
  /** Page. Warm, but paper-warm — not craft-paper beige. */
  paper: '#FBFAF7',
  /** Cards lift off the page. */
  card: '#FFFFFF',
  /** Deep blue-black. Printed ink, never pure #000. */
  ink: '#16202B',
  inkSoft: '#5A6674',
  inkFaint: '#8D96A1',
  line: '#E7E3DA',
  lineStrong: '#D5CFC2',

  /** Money kept. Primary action, met conditions. */
  mint: '#0E7C66',
  mintSoft: '#DEF0EA',
  mintLine: '#A5D2C5',

  /** Up to you. Pending conditions. */
  amber: '#A1650B',
  amberSoft: '#FAEEDA',
  amberLine: '#E5CB9C',

  /** Violated right now. */
  clay: '#9E362B',
  claySoft: '#F7E5E2',
  clayLine: '#E2B7B0',

  /** Inverted surfaces — the till card, the primary button. */
  inkInverse: '#FFFFFF',
} as const;

export const fonts = {
  /**
   * Frank Ruhl Libre — the digital revival of Frank-Rühl, the face Hebrew
   * newspapers and, more to the point, Hebrew fine print were set in for most
   * of a century. An app whose whole argument is "the terms are the product"
   * should speak in the typeface the terms were actually printed in.
   */
  voice: 'FrankRuhlLibre_400Regular',
  voiceMedium: 'FrankRuhlLibre_500Medium',
  voiceBold: 'FrankRuhlLibre_700Bold',
  voiceBlack: 'FrankRuhlLibre_900Black',
  /**
   * Miriam Libre — the revival of Miriam, the squarish Hebrew face of official
   * forms and early Israeli screens. It carries every number and every
   * condition chip: a ledger total, not a promotional sticker.
   */
  data: 'MiriamLibre_400Regular',
  dataMedium: 'MiriamLibre_500Medium',
  dataBold: 'MiriamLibre_700Bold',
} as const;

/**
 * Type scale.
 *
 * Two Hebrew revivals, split by job rather than by size: the serif does the
 * talking, the squarish sans does the counting. Frank Ruhl has a generous
 * x-height and needs a little more leading than a UI sans at the same size.
 */
export const type = {
  title: { fontFamily: fonts.voiceBold, fontSize: 28, lineHeight: 38, color: colors.ink },
  heading: { fontFamily: fonts.voiceBold, fontSize: 19, lineHeight: 27, color: colors.ink },
  /**
   * Merchant and brand names. Miriam rather than the serif, because half of
   * them are Latin — "Terminal X" set in Frank Ruhl's Latin companion reads
   * like a 1990s masthead. A name is data; the serif is for our own voice.
   */
  identity: { fontFamily: fonts.dataBold, fontSize: 19, lineHeight: 26, color: colors.ink },
  identitySmall: { fontFamily: fonts.dataMedium, fontSize: 16, lineHeight: 23, color: colors.ink },
  body: { fontFamily: fonts.voice, fontSize: 16, lineHeight: 25, color: colors.ink },
  bodyStrong: { fontFamily: fonts.voiceMedium, fontSize: 16, lineHeight: 25, color: colors.ink },
  small: { fontFamily: fonts.voice, fontSize: 14, lineHeight: 21, color: colors.inkSoft },
  quote: { fontFamily: fonts.voice, fontSize: 16.5, lineHeight: 27, color: colors.ink },

  /**
   * Figures in Frank Ruhl Black. Heavy serif numerals read as a printed total
   * rather than a promotional sticker — and, decisively, Miriam draws ₪ as a
   * wide ש-ח ligature, so "₪50" came out looking like "50שח" at 44px. The
   * currency mark has to be unmistakable in the one element people read first.
   */
  figure: { fontFamily: fonts.voiceBlack, fontSize: 32, lineHeight: 38, color: colors.mint },
  figureLarge: { fontFamily: fonts.voiceBlack, fontSize: 46, lineHeight: 56, color: colors.mint },
  figureInline: { fontFamily: fonts.voiceBlack, fontSize: 22, color: colors.mint },
  /**
   * Section marker. Barely tracked: Hebrew has no uppercase, so the small-caps
   * eyebrow convention has nothing to work with, and loose tracking just pulls
   * the letters of a word apart.
   */
  eyebrow: {
    fontFamily: fonts.dataMedium,
    fontSize: 12,
    letterSpacing: 0.2,
    color: colors.inkFaint,
  },
  /**
   * Chips and captions routinely carry amounts ("₪300+", "עד ₪50"), so they
   * follow the voice face for the same reason the figures do. Miriam is left
   * with the jobs where no currency appears and its squarish Latin is the
   * point: names, markers, buttons, counts.
   */
  chip: { fontFamily: fonts.voiceMedium, fontSize: 13, lineHeight: 17 },
  caption: { fontFamily: fonts.voice, fontSize: 12.5, lineHeight: 18, color: colors.inkFaint },
  button: { fontFamily: fonts.dataBold, fontSize: 16, color: colors.inkInverse },
  tableValue: { fontFamily: fonts.dataBold, fontSize: 17, color: colors.ink },
} satisfies Record<string, TextStyle>;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 22, xxl: 32, xxxl: 44 } as const;

export const radius = { sm: 7, md: 12, lg: 18, pill: 999 } as const;

/**
 * One elevation, used sparingly. On paper, a card is a sheet on a sheet —
 * a hairline plus the faintest lift, not a floating panel.
 */
export const lift = {
  shadowColor: '#16202B',
  shadowOpacity: 0.05,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 2 },
  elevation: 1,
} as const;

/**
 * Four tones, not three. A pending gate splits by whether the user can do
 * something about it: amber is reserved for real errands, so a card full of
 * ordinary caveats reads calm instead of alarming.
 */
export const gateTone = {
  met: { bg: colors.mintSoft, border: colors.mintLine, fg: colors.mint },
  action: { bg: colors.amberSoft, border: colors.amberLine, fg: colors.amber },
  note: { bg: colors.paper, border: colors.line, fg: colors.inkSoft },
  blocked: { bg: colors.claySoft, border: colors.clayLine, fg: colors.clay },
} as const;

export type GateTone = keyof typeof gateTone;

export const gateGlyph: Record<GateTone, string> = {
  met: '✓',
  action: '!',
  note: '•',
  blocked: '✕',
};
