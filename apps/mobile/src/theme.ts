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
  display: 'Rubik_700Bold',
  displayMedium: 'Rubik_500Medium',
  body: 'Heebo_400Regular',
  bodyMedium: 'Heebo_500Medium',
  bodyBold: 'Heebo_700Bold',
} as const;

/**
 * Type scale. Rubik carries the headlines and every figure — its Hebrew is
 * geometric and holds up at large sizes. Heebo does the reading work, where
 * neutrality beats character.
 */
export const type = {
  hero: { fontFamily: fonts.display, fontSize: 44, lineHeight: 48, color: colors.ink },
  title: { fontFamily: fonts.display, fontSize: 27, lineHeight: 34, color: colors.ink },
  heading: { fontFamily: fonts.display, fontSize: 18, lineHeight: 24, color: colors.ink },
  figure: { fontFamily: fonts.display, fontSize: 32, lineHeight: 36, color: colors.mint },
  /** Small caps-ish section marker. Letter-spaced, never bold. */
  eyebrow: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    letterSpacing: 1.4,
    color: colors.inkFaint,
  },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.ink },
  bodyStrong: { fontFamily: fonts.bodyMedium, fontSize: 15, lineHeight: 22, color: colors.ink },
  small: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.inkSoft },
  chip: { fontFamily: fonts.bodyMedium, fontSize: 12.5, lineHeight: 16 },
  caption: { fontFamily: fonts.body, fontSize: 11.5, lineHeight: 16, color: colors.inkFaint },
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
