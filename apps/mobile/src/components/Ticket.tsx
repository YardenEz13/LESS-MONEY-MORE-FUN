import React, { memo } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text as RNText,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  displayMerchantName,
  formatLastVerified,
  formatValue,
  ticketFace,
  type Evaluation,
  type HoleState,
} from '@sbr/core';
import { Seam } from './Kit';
import { Text } from './ui';
import { benefits, merchantLine, programNames } from '../services/catalog';
import { deepOf, fonts, space, stockDeep, ticket } from '../theme';

export type TicketSize = 'big' | 'mid' | 'slim';

/** One line of the wall behind the holes; holes clip it, so it can only be this tall. */
const WALL_LINE = 26;
const WALL_PERIOD = WALL_LINE * 2;

/**
 * Real shop names for the wall behind the holes. Hebrew only and short: the EFT
 * faces draw Latin as a serif, and a whole word has to fit a hole to read as one.
 */
const WALL_NAMES = [...new Set(benefits.map((b) => b.merchant_name))]
  .filter((name) => name.length <= 12 && /^[֐-׿\s]+$/.test(name))
  .slice(0, 60);

/** Which way a scroll value moves the wall so it appears not to move at all. */
export function wallOffset(scrollY: Animated.Value): Animated.AnimatedSubtraction<number> {
  return Animated.subtract(Animated.modulo(scrollY, WALL_PERIOD), WALL_PERIOD);
}

function hashOf(text: string): number {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum += text.charCodeAt(i);
  return sum;
}

/**
 * The stock for a club: its place among the clubs this person holds.
 *
 * ponytail: six colours, so a seventh club repeats one. The card's name is always
 * printed, so nothing depends on the colour alone. Add stocks if real wallets
 * routinely pass six.
 */
export function stockFor(programId: string, ownedIds: readonly string[]): string {
  const at = ownedIds.indexOf(programId);
  return ticket.stocks[(at >= 0 ? at : hashOf(programId)) % ticket.stocks.length]!;
}

/**
 * React Native cannot cut a real hole in a view without a new native dependency,
 * so a hole is the ground colour with the wall drawn inside it. It reads the same,
 * and `glide` keeps the wall still on screen while the ticket scrolls past it.
 * One Text node with nested spans, because a screen of tickets has dozens of holes.
 */
function Hole({ size, seed, glide }: { size: number; seed: number; glide: Animated.AnimatedNode | null }) {
  const a = WALL_NAMES[seed % WALL_NAMES.length] ?? '';
  const b = WALL_NAMES[(seed + 7) % WALL_NAMES.length] ?? '';
  // Deep tones: the pastel stocks cannot be read as text on a paper-coloured hole.
  const one = stockDeep[ticket.stocks[seed % ticket.stocks.length]!]!;
  const two = stockDeep[ticket.stocks[(seed + 2) % ticket.stocks.length]!]!;
  return (
    <View style={[styles.hole, { width: size, height: size, borderRadius: size / 2 }]}>
      <Animated.View style={[styles.wall, glide ? { transform: [{ translateY: glide }] } : null]}>
        <RNText style={styles.wallText} allowFontScaling={false}>
          <RNText style={{ color: one }}>{`${a}\n`}</RNText>
          <RNText style={{ color: two }}>{`${b}\n`}</RNText>
          <RNText style={{ color: one }}>{`${a}\n`}</RNText>
          <RNText style={{ color: two }}>{b}</RNText>
        </RNText>
      </Animated.View>
    </View>
  );
}

function Mark({
  state,
  size,
  seed,
  glide,
}: {
  state: HoleState;
  size: number;
  seed: number;
  glide: Animated.AnimatedNode | null;
}) {
  if (state === 'punched') return <Hole size={size} seed={seed} glide={glide} />;
  const shape = { width: size, height: size, borderRadius: size / 2 };
  if (state === 'open') return <View style={[shape, styles.open]} />;
  return (
    <View style={[shape, styles.bad]}>
      <View style={[styles.badBar, { width: size * 0.72 }]} />
    </View>
  );
}

interface Props {
  evaluation: Evaluation;
  size: TicketSize;
  /** The stock for this card. A blocked ticket ignores it and turns grey. */
  stock: string;
  onPress: (evaluation: Evaluation) => void;
  glide: Animated.AnimatedNode | null;
}

/**
 * One benefit, as a ticket. Size follows what it can do for you now: ready and at
 * the head of the roll is big, the rest of the live ones are mid, blocked are slim.
 *
 * The open circle shows what is left and opens the ticket. It does not punch yet:
 * a punch has to survive a restart and expire, which needs saved state that does
 * not exist. So it says so by not carrying the word "לנקב" from the prototype.
 */
export const Ticket = memo(function Ticket({ evaluation, size, stock, onPress, glide }: Props) {
  const { width } = useWindowDimensions();
  const { benefit } = evaluation;
  const { figure, unit } = formatValue(benefit);
  const face = ticketFace(evaluation);
  const name = displayMerchantName(benefit.merchant_name);
  const club = programNames[benefit.program_id] ?? benefit.program_id;
  const place = merchantLine(benefit.merchant_id);
  const seed = hashOf(benefit.id);

  const base = size === 'big' ? Math.min(width * 0.34, 128) : size === 'mid' ? 60 : 30;
  // Display figures run to "עד 3.5%": shrink what is long, since the web build has
  // no `adjustsFontSizeToFit` to fall back on.
  const figureSize = Math.round(base * Math.min(1, 3.5 / [...figure].length));
  const figureNode = (
    <View style={styles.figureCol}>
      <Text
        style={[
          styles.figure,
          { fontSize: figureSize, lineHeight: figureSize * 1.02 },
          // "עד 15%" starts in Hebrew and has to read from the right.
          { writingDirection: /^[֐-׿]/.test(figure) ? 'rtl' : 'ltr' },
        ]}
        numberOfLines={1}
      >
        {figure}
      </Text>
      {size !== 'slim' && <Text style={styles.unit}>{unit}</Text>}
    </View>
  );

  const label = `${figure} ${unit} ב${name}, ${face.stamp ? `${face.stamp}, ` : ''}${face.verdict}, בכרטיס ${club}`;
  const background = { backgroundColor: face.state === 'blocked' ? ticket.dead : stock };
  // The overprint under a live ticket; a blocked one stays flat.
  const depth =
    face.state === 'blocked'
      ? null
      : { borderBottomColor: deepOf(stock), ...(size === 'big' ? { borderBottomWidth: 8 } : null) };

  if (size === 'slim') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => onPress(evaluation)}
        style={({ pressed }) => [styles.slim, background, pressed && styles.pressed]}
      >
        <Seam />
        <View style={[styles.grow, styles.identity]}>
          <Text style={styles.slimName} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.slimVerdict} numberOfLines={2}>
            <Text style={styles.stampWord}>{face.stamp}. </Text>
            {face.verdict}
          </Text>
        </View>
        {figureNode}
      </Pressable>
    );
  }

  const holeSize = size === 'big' ? 44 : 36;
  const rail = face.holes.length > 0 && (
    <View style={styles.rail}>
      {face.holes.map((hole, i) => (
        <View key={hole.code} style={styles.cell}>
          <Mark state={hole.state} size={holeSize} seed={seed + i} glide={glide} />
          <Text style={styles.cellLabel} numberOfLines={2}>
            {hole.label}
          </Text>
        </View>
      ))}
    </View>
  );

  const identity = (
    <>
      <Text style={size === 'big' ? styles.nameBig : styles.name} numberOfLines={2}>
        {name}
      </Text>
      {place && (
        <Text style={styles.line} numberOfLines={1}>
          {place}
        </Text>
      )}
      <Text style={styles.line} numberOfLines={1}>
        בכרטיס {club}, {formatLastVerified(benefit)}
      </Text>
    </>
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => onPress(evaluation)}
      style={({ pressed }) => [styles.ticket, background, depth, pressed && styles.pressedDown]}
    >
      <Seam />
      {size === 'big' ? (
        <>
          <View style={styles.identity}>{identity}</View>
          <View style={styles.bigRow}>
            <Text style={styles.verdictBig}>{face.verdict}</Text>
            {figureNode}
          </View>
        </>
      ) : (
        <>
          <View style={styles.midRow}>
            <View style={[styles.identity, styles.grow]}>{identity}</View>
            {figureNode}
          </View>
          <Text style={styles.verdict}>{face.verdict}</Text>
        </>
      )}
      {rail}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  ticket: { paddingHorizontal: space.s3, paddingTop: space.s3, paddingBottom: space.s2 + 4, borderBottomWidth: 5 },
  pressed: { opacity: 0.86 },
  /* The ticket drops onto its overprint, as a press does. */
  pressedDown: { transform: [{ translateY: 3 }] },
  grow: { flex: 1, minWidth: 0 },
  /* flex-start so a Latin or number-only line aligns with a Hebrew one: see ui.tsx. */
  identity: { alignItems: 'flex-start' },
  midRow: { flexDirection: 'row', alignItems: 'flex-start', columnGap: space.s2 + 4 },
  bigRow: { flexDirection: 'row', alignItems: 'flex-end', columnGap: space.s2 + 4 },

  nameBig: { fontFamily: fonts.text, fontSize: 31, lineHeight: 36, color: ticket.ink },
  name: { fontFamily: fonts.text, fontSize: 25, lineHeight: 29, color: ticket.ink },
  line: { fontFamily: fonts.latinText, fontSize: 13.5, lineHeight: 19, color: ticket.ink2 },

  figureCol: { alignItems: 'flex-end', flexShrink: 0 },
  figure: { fontFamily: fonts.display, color: ticket.ink, fontVariant: ['tabular-nums', 'lining-nums'] },
  unit: { fontFamily: fonts.latinText, fontSize: 13, lineHeight: 17, color: ticket.ink2 },

  verdict: { fontFamily: fonts.display, fontSize: 17, lineHeight: 22, color: ticket.ink, marginTop: space.s2 },
  verdictBig: {
    flex: 1,
    minWidth: 0,
    fontFamily: fonts.display,
    fontSize: 25,
    lineHeight: 29,
    color: ticket.ink,
    marginBottom: space.s4,
  },

  rail: { flexDirection: 'row', columnGap: space.s1, marginTop: space.s2 + 4 },
  /* A quarter of the row whatever the count, so holes line up from ticket to ticket. */
  cell: { width: '24%', alignItems: 'center', rowGap: space.s1 },
  cellLabel: {
    fontFamily: fonts.latinText,
    fontSize: 12.5,
    lineHeight: 15,
    color: ticket.ink,
    textAlign: 'center',
  },

  hole: { backgroundColor: ticket.ground, overflow: 'hidden', alignItems: 'center' },
  wall: { width: 170 },
  wallText: {
    fontFamily: fonts.display,
    fontSize: 22,
    lineHeight: WALL_LINE,
    textAlign: 'center',
  },
  open: { backgroundColor: ticket.punch, borderWidth: 3, borderColor: ticket.ink },
  bad: { borderWidth: 3, borderColor: ticket.void, alignItems: 'center', justifyContent: 'center' },
  badBar: { height: 3, backgroundColor: ticket.void, transform: [{ rotate: '45deg' }] },

  slim: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: space.s2 + 4,
    paddingHorizontal: space.s3,
    paddingVertical: space.s2 + 4,
  },
  slimName: { fontFamily: fonts.text, fontSize: 19, lineHeight: 24, color: ticket.ink },
  slimVerdict: { fontFamily: fonts.latinText, fontSize: 13.5, lineHeight: 18, color: ticket.void },
  stampWord: { fontFamily: fonts.display, color: ticket.void },
});
