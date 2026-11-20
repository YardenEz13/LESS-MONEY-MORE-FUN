import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import {
  applyDoneSteps,
  displayMerchantName,
  formatBasketSaving,
  formatIls,
  formatValue,
  hiddenBenefitIds,
  optimizeTillBasket,
  rankBenefits,
  ticketFace,
  UNIVERSAL_MERCHANT_ID,
  type Evaluation,
  type UserProfile,
} from '@sbr/core';
import { BasketStrip } from '../components/BasketStrip';
import { Crest } from '../components/Kit';
import { PrimaryButton, Text } from '../components/ui';
import { benefits, ownedProgramIds, programNames } from '../services/catalog';
import { usePunches } from '../state/punches';
import { deepOf, fonts, space, stock as stocks, ticket } from '../theme';

interface Props {
  evaluation: Evaluation;
  profile: UserProfile;
  /** The stock the ticket had on the roll. */
  stock: string;
  /** Basket amount carried from Home, or defaults to ₪100 for instant pricing. */
  initialCartAmount?: number | null;
  onClose: () => void;
  onRedeemed: () => void;
}

/**
 * Till mode: the benefit and nothing else, held up to the cashier — plus a
 * one-tap live basket calculator (`₪50 / ₪100 / ₪200 / ₪350` + custom) that
 * prices the exact shekel saving and best 2-club combo stack before paying.
 */
export function TillScreen({
  evaluation: given,
  profile,
  stock,
  initialCartAmount,
  onClose,
  onRedeemed,
}: Props) {
  const { width } = useWindowDimensions();
  const { doneSteps } = usePunches();
  const evaluation = useMemo(() => applyDoneSteps(given, doneSteps), [given, doneSteps]);
  const [cartAmount, setCartAmount] = useState<number | null>(
    initialCartAmount != null && initialCartAmount > 0 ? initialCartAmount : 100,
  );

  const { benefit } = evaluation;
  const { figure } = formatValue(benefit);
  const face = ticketFace(evaluation);
  const name = displayMerchantName(benefit.merchant_name);
  const club = programNames[benefit.program_id] ?? benefit.program_id;
  // "עד 15%" is longer than "62%", so the figure steps down with its length.
  const figureSize = Math.round(width * 0.44 * Math.min(1, 3.5 / [...figure].length));
  const live = face.state !== 'blocked';

  // Only benefits at this counter (same merchant or universal cashback) can
  // stack with this ticket — keeps combo lookup instant at the till.
  const counterEvaluations = useMemo(() => {
    const owned = ownedProgramIds(profile.program_ids);
    const mine = new Set(owned);
    const relevant = benefits.filter(
      (b) =>
        mine.has(b.program_id) &&
        (b.merchant_id === benefit.merchant_id || b.merchant_id === UNIVERSAL_MERCHANT_ID),
    );
    return rankBenefits(relevant, {
      now: new Date(),
      ownedProgramIds: owned,
      mutedBenefitIds: hiddenBenefitIds(profile),
      doneSteps,
      cartAmount: cartAmount ?? undefined,
    });
  }, [benefit.merchant_id, cartAmount, doneSteps, profile]);

  const basketPlan = useMemo(
    () =>
      cartAmount != null && cartAmount > 0
        ? optimizeTillBasket(evaluation, counterEvaluations, cartAmount)
        : null,
    [cartAmount, counterEvaluations, evaluation],
  );

  const comboPartner = useMemo(() => {
    const combo = basketPlan?.bestCombo;
    if (!combo) return null;
    const other = combo.parts.find((p) => p.benefit.id !== benefit.id) ?? combo.parts[1];
    return programNames[other.benefit.program_id] ?? other.benefit.program_id;
  }, [basketPlan, benefit.id]);

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
        <Text style={styles.kicker}>
          {face.stamp ? `${face.stamp} · ` : ''}
          {face.verdict}
        </Text>
      </View>

      <View style={styles.figureBox}>
        <Text
          style={[
            styles.figure,
            {
              fontSize: figureSize,
              lineHeight: figureSize,
              top: -figureSize * 0.08,
              width: figureSize * 4,
            },
          ]}
        >
          {figure}
        </Text>
      </View>

      {live && (
        <View style={styles.optimizer}>
          <Text style={styles.optimizerHead}>כמה הסל בקופה?</Text>
          <BasketStrip
            amount={cartAmount}
            onChange={(next) => setCartAmount(next)}
            surface="stock"
            clearable={false}
          />
          {basketPlan && (
            <View style={styles.resultBox}>
              <Text style={styles.resultMain}>{formatBasketSaving(basketPlan.single)}</Text>
              {basketPlan.single.capped && (
                <Text style={styles.resultSub}>הגיע לתקרת ההנחה בתקנון</Text>
              )}
              {basketPlan.bestCombo && comboPartner && (
                <View style={styles.comboBar}>
                  <Text style={styles.comboTitle}>
                    {`שילוב 2 מועדונים (+ ${comboPartner}): חוסכים ₪${formatIls(
                      basketPlan.bestCombo.estimatedSavingIls,
                    )}`}
                  </Text>
                  <Text style={styles.comboMeta}>
                    {basketPlan.bestCombo.confirmed
                      ? 'שני התקנונים מתירים כפל'
                      : 'כדאי לשאול בקופה אם מותר כפל'}
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>
      )}

      <View style={styles.strip}>
        <Text style={styles.stripVerdict}>
          {face.state === 'ready' ? 'מוכן לקופה' : face.verdict}
        </Text>
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
  head: { paddingHorizontal: space.s3, paddingTop: space.s3, alignItems: 'flex-start', gap: 2 },
  kicker: { fontFamily: fonts.latinText, fontSize: 15, lineHeight: 22, color: ticket.ink2 },
  name: { fontFamily: fonts.display, fontSize: 54, lineHeight: 56, color: ticket.ink },
  figureBox: { flex: 1, minHeight: 110, overflow: 'hidden' },
  /* Absolute so the box crops it: the figure is meant to be bigger than the room. */
  figure: {
    position: 'absolute',
    left: -8,
    fontFamily: fonts.display,
    color: ticket.ink,
    writingDirection: 'ltr',
    fontVariant: ['tabular-nums', 'lining-nums'],
  },
  optimizer: {
    marginHorizontal: space.s3,
    marginBottom: space.s3,
    padding: space.s3 - 4,
    backgroundColor: ticket.ground,
    borderWidth: 2,
    borderColor: ticket.ink,
    borderBottomWidth: 5,
    gap: space.s2,
    alignItems: 'flex-start',
  },
  optimizerHead: {
    fontFamily: fonts.display,
    fontSize: 18,
    lineHeight: 22,
    color: ticket.ink,
  },
  resultBox: {
    alignSelf: 'stretch',
    paddingTop: space.s1,
    borderTopWidth: 1,
    borderTopColor: ticket.rule,
    gap: 4,
    alignItems: 'flex-start',
  },
  resultMain: {
    fontFamily: fonts.display,
    fontSize: 24,
    lineHeight: 28,
    color: ticket.ink,
    fontVariant: ['tabular-nums', 'lining-nums'],
  },
  resultSub: {
    fontFamily: fonts.latinText,
    fontSize: 13,
    lineHeight: 18,
    color: ticket.muted,
  },
  comboBar: {
    alignSelf: 'stretch',
    marginTop: 4,
    paddingHorizontal: space.s2 + 2,
    paddingVertical: space.s2,
    backgroundColor: stocks.bone,
    borderWidth: 1,
    borderColor: ticket.ink,
    alignItems: 'flex-start',
    gap: 2,
  },
  comboTitle: {
    fontFamily: fonts.display,
    fontSize: 17,
    lineHeight: 21,
    color: ticket.ink,
    fontVariant: ['tabular-nums', 'lining-nums'],
  },
  comboMeta: {
    fontFamily: fonts.latinText,
    fontSize: 12.5,
    lineHeight: 17,
    color: ticket.ink2,
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
  stripVerdict: { flex: 1, fontFamily: fonts.display, fontSize: 34, lineHeight: 38, color: stocks.mint },
  stripAction: { width: 130 },
});
