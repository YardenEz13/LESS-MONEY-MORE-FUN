import React from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { displayMerchantName, formatValue, ticketFace, type Evaluation } from '@sbr/core';
import { Crest } from '../components/Kit';
import { PrimaryButton, Text } from '../components/ui';
import { programNames } from '../services/catalog';
import { deepOf, fonts, space, stock as stocks, ticket } from '../theme';

interface Props {
  evaluation: Evaluation;
  /** The stock the ticket had on the roll. */
  stock: string;
  onClose: () => void;
  onRedeemed: () => void;
}

/**
 * Till mode: the benefit and nothing else, held up to the cashier.
 *
 * The whole screen is the ticket's stock, the name is set large and the figure is
 * bigger than the screen wants, cropped by its own box. The verdict word sits on
 * an ink strip at the foot, with the one action that belongs at a till.
 */
export function TillScreen({ evaluation, stock, onClose, onRedeemed }: Props) {
  const { width } = useWindowDimensions();
  const { benefit } = evaluation;
  const { figure } = formatValue(benefit);
  const face = ticketFace(evaluation);
  const name = displayMerchantName(benefit.merchant_name);
  const club = programNames[benefit.program_id] ?? benefit.program_id;
  // "עד 15%" is longer than "62%", so the figure steps down with its length.
  const figureSize = Math.round(width * 0.56 * Math.min(1, 3.5 / [...figure].length));
  const live = face.state !== 'blocked';

  return (
    <View style={[styles.screen, { backgroundColor: live ? stock : ticket.dead }]}>
      <View style={styles.top}>
        <View style={styles.club}>
          <Crest programId={benefit.program_id} size={24} />
          <Text style={styles.clubName}>{club}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="סגור"
          onPress={onClose}
          style={({ pressed }) => [
            styles.close,
            { borderBottomColor: deepOf(live ? stock : ticket.dead) },
            pressed && styles.pressedDown,
          ]}
        >
          <Text style={styles.closeMark}>×</Text>
        </Pressable>
      </View>

      <View style={styles.head}>
        <Text style={styles.kicker}>הראו בקופה</Text>
        <Text style={styles.name} numberOfLines={2}>
          {name}
        </Text>
        <Text style={styles.kicker}>{face.stamp ? `${face.stamp} · ` : ''}{face.verdict}</Text>
      </View>

      <View style={styles.figureBox}>
        <Text
          style={[
            styles.figure,
            { fontSize: figureSize, lineHeight: figureSize, top: -figureSize * 0.12, width: figureSize * 4 },
          ]}
        >
          {figure}
        </Text>
      </View>

      <View style={styles.strip}>
        <Text style={styles.stripVerdict}>{face.verdict}</Text>
        {live && (
          <View style={styles.stripAction}>
            <PrimaryButton label="מימשתי" onPress={onRedeemed} />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.s3,
    paddingTop: space.s3,
  },
  club: { flexDirection: 'row', alignItems: 'center', columnGap: space.s2 },
  clubName: { fontFamily: fonts.latinText, fontSize: 15, lineHeight: 22, color: ticket.ink },
  close: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ticket.ground,
    borderBottomWidth: 4,
  },
  pressedDown: { transform: [{ translateY: 3 }] },
  closeMark: { fontFamily: fonts.display, fontSize: 30, lineHeight: 34, color: ticket.ink },
  head: { paddingHorizontal: space.s3, paddingTop: space.s4, alignItems: 'flex-start', gap: 2 },
  kicker: { fontFamily: fonts.latinText, fontSize: 15, lineHeight: 22, color: ticket.ink2 },
  name: { fontFamily: fonts.display, fontSize: 64, lineHeight: 64, color: ticket.ink },
  figureBox: { flex: 1, overflow: 'hidden' },
  /* Absolute so the box crops it: the figure is meant to be bigger than the room. */
  figure: {
    position: 'absolute',
    left: -8,
    fontFamily: fonts.display,
    color: ticket.ink,
    writingDirection: 'ltr',
    fontVariant: ['tabular-nums', 'lining-nums'],
  },
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: space.s3,
    backgroundColor: ticket.ink,
    paddingStart: space.s3,
    paddingEnd: space.s3 - 4,
    paddingVertical: space.s2 + 4,
  },
  stripVerdict: { flex: 1, fontFamily: fonts.display, fontSize: 36, lineHeight: 40, color: stocks.mint },
  stripAction: { width: 130 },
});
