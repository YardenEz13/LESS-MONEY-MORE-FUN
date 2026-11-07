import React from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';
import { programsById } from '../services/catalog';
import { colors, crestColors, crestFallback, fonts, ticket } from '../theme';

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

/**
 * The tear line along a ticket's top edge. One Text, not thirty views: there is
 * one per row. Half of it sits over the row above, and the dots are the ground
 * colour, so they read as holes punched through both.
 */
export function Seam() {
  return (
    <View style={styles.seam} pointerEvents="none">
      <RNText style={styles.seamDots} numberOfLines={1} allowFontScaling={false}>
        {'●'.repeat(80)}
      </RNText>
    </View>
  );
}

const styles = StyleSheet.create({
  seam: { position: 'absolute', top: -4, left: 0, right: 0, height: 8, overflow: 'hidden', alignItems: 'center' },
  seamDots: {
    fontSize: 7,
    lineHeight: 8,
    letterSpacing: 8,
    color: ticket.ground,
    includeFontPadding: false,
  },
  crest: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 1,
  },
  /* Ink: every crest hue is a light stock. */
  crestLetter: {
    color: colors.textInverse,
    textAlign: 'center',
    /* A single glyph, so it keeps its own order inside a Hebrew row. */
    writingDirection: 'ltr',
    includeFontPadding: false,
  },
});
