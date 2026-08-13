import React, { createContext, useContext, useMemo } from 'react';
import { StyleSheet, Text as RNText, View, type ViewStyle } from 'react-native';
import { programsById } from '../services/catalog';
import {
  colors,
  crestColors,
  crestFallback,
  fonts,
  kit,
  type KitIntensity,
} from '../theme';

/**
 * The kit: pitch stripes, the scarf, and the club crest.
 *
 * These three are the whole football vocabulary, and they are deliberately
 * decoration-with-a-job rather than decoration. The stripes mark which surfaces
 * are *ours* — the green ones the app speaks from, never the reader's paper.
 * The scarf closes a green surface, so it always means "this block ended here".
 * The crest says which club a benefit came from, which is the fastest thing to
 * scan for in a list of nine.
 *
 * Nothing here imports from `ui.tsx`: `ui.tsx` builds its Hero out of these, and
 * a cycle between the two would resolve to `undefined` at module-eval time under
 * Metro long before anyone saw a stripe.
 */

const KitContext = createContext<KitIntensity>('full');

/**
 * Wrap the app once. Defaults to `full` — the shirt is the product's face, and
 * a reader who wants it quieter says so in settings rather than by default.
 */
export function KitProvider({
  intensity,
  children,
}: {
  intensity: KitIntensity;
  children: React.ReactNode;
}) {
  return <KitContext.Provider value={intensity}>{children}</KitContext.Provider>;
}

export function useKit(): KitIntensity {
  return useContext(KitContext);
}

/**
 * Vertical shirt stripes across whatever they are dropped into.
 *
 * Absolutely filled and non-interactive, so it goes *inside* a coloured surface
 * as the first child and costs that surface nothing but `overflow: 'hidden'` —
 * without the clip the stripes run past the block's edge.
 *
 * `tone` picks which way the stripe leans: `light` on a green or ink surface,
 * `dark` on a bright one like the yellow card. Both are drawn at the alpha the
 * current intensity allows, which is the single knob the quiet kit turns.
 */
export function PitchStripes({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const intensity = useKit();
  const alpha = kit.stripeAlpha[intensity];
  const backgroundColor =
    tone === 'light' ? `rgba(245, 243, 238, ${alpha})` : `rgba(17, 19, 16, ${alpha})`;

  // Static: the stripe count never depends on measured width, so this never
  // needs a layout pass — the parent's clip does the fitting.
  const stripes = useMemo(
    () => Array.from({ length: kit.stripeCount }, (_, i) => i),
    [],
  );

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.stripes]}>
      {stripes.map((i) => (
        <View key={i} style={[styles.stripe, { backgroundColor }]} />
      ))}
    </View>
  );
}

/**
 * The scarf: the band that ends a green surface.
 *
 * Blocks rather than a rule, because a rule is already the system's quietest
 * device and this is the loudest. It closes the hero, heads a section, and
 * finishes a list — and the orange block at the end is the only place the kit
 * spends the urgent hue on something that is not urgent, which is what makes it
 * read as a scarf rather than as a warning.
 *
 * Flex weights, not widths: the same band fits a 320px phone and a browser.
 */
const SCARF: ReadonlyArray<readonly [number, 'pitch' | 'gap' | 'flare']> = [
  [6, 'pitch'],
  [3, 'gap'],
  [6, 'pitch'],
  [3, 'gap'],
  [6, 'pitch'],
  [3, 'gap'],
  [6, 'pitch'],
  [2, 'flare'],
];

const SCARF_FILL = {
  pitch: colors.surfacePrimary,
  /* Not the page tone: on paper an identical gap would erase the band into a
     dashed line. One step down is enough to read as a woven block. */
  gap: colors.surfaceInset,
  flare: colors.accentUrgent,
} as const;

export function ScarfBand({ height, style }: { height?: number; style?: ViewStyle }) {
  const intensity = useKit();
  return (
    <View style={[styles.scarf, { height: height ?? kit.scarfHeight[intensity] }, style]}>
      {SCARF.map(([weight, role], i) => (
        <View key={i} style={{ flex: weight, backgroundColor: SCARF_FILL[role] }} />
      ))}
    </View>
  );
}

/**
 * The club badge: one letter on the league's colour.
 *
 * The initial rather than a logo because the catalog has 74 clubs and no
 * artwork for any of them, and a letter that is definitely right beats a
 * placeholder mark that is definitely wrong. Colour comes from the category —
 * see `crestColors` for why it is not per-club.
 */
export function Crest({
  programId,
  size = 26,
}: {
  programId: string;
  size?: number;
}) {
  const program = programsById.get(programId);
  const name = program?.name ?? programId;
  const letter = initial(name);
  const fill = (program && crestColors[program.category]) ?? crestFallback;

  return (
    <View
      // The letter is an abbreviation of a name that is always spelled out
      // beside it, so a reader on a screen reader gets it twice or not at all.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.crest, { width: size, height: size, backgroundColor: fill }]}
    >
      <RNText
        style={[
          styles.crestLetter,
          {
            fontSize: Math.round(size * 0.62),
            lineHeight: Math.round(size * 0.78),
            fontFamily: /[A-Za-z]/.test(letter) ? fonts.latinDisplay : fonts.display,
          },
        ]}
      >
        {letter}
      </RNText>
    </View>
  );
}

/**
 * First letter that carries the name. Skips a leading Latin article or a stray
 * quote so "LIFESTYLE סופר-פארם" badges as L and "כ.א.ל Extra" as כ.
 */
function initial(name: string): string {
  const match = /[א-תA-Za-z0-9]/.exec(name);
  return (match?.[0] ?? name.charAt(0)).toUpperCase();
}

const styles = StyleSheet.create({
  stripes: { flexDirection: 'row', gap: kit.stripeGap },
  stripe: { width: kit.stripeWidth, flexShrink: 0 },
  scarf: { flexDirection: 'row', alignItems: 'stretch' },
  crest: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    /* 90° like everything else — a crest in this system is a shield only in
       the sense that it carries a colour and a letter. */
    paddingBottom: 1,
  },
  crestLetter: {
    color: colors.textInverse,
    textAlign: 'center',
    /* A single glyph, so it keeps its own order inside a Hebrew row. */
    writingDirection: 'ltr',
    includeFontPadding: false,
  },
});
