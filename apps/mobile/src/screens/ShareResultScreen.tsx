import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { Evaluation } from '@sbr/core';
import { BenefitCard } from '../components/BenefitCard';
import { PrimaryButton, ScreenHeader, Text } from '../components/ui';
import type { ShareResult } from '../services/shareIntent';
import { border, colors, radius, space, type } from '../theme';

interface Props {
  result: ShareResult;
  onSelect: (evaluation: Evaluation) => void;
  onClose: () => void;
}

/**
 * What you see a second after hitting Share in a mobile checkout. The channel
 * is pinned to online upstream, so anything shown here is genuinely usable on
 * this site — no "valid in stores only" teases.
 */
export function ShareResultScreen({ result, onSelect, onClose }: Props) {
  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {result.kind === 'match' ? (
          <>
            <ScreenHeader eyebrow={result.match.hostname} title={result.match.merchantName} />
            <Text style={styles.lede}>
              {result.match.evaluations.length === 1 ? (
                'הטבה אחת תקפה לקנייה באתר הזה.'
              ) : (
                <>
                  <Text style={styles.figureInline}>{result.match.evaluations.length}</Text>
                  {'  '}הטבות תקפות לקנייה באתר הזה, הטובה ביותר למעלה.
                </>
              )}
            </Text>
            <View style={styles.list}>
              {result.match.evaluations.map((evaluation) => (
                <BenefitCard
                  key={evaluation.benefit.id}
                  evaluation={evaluation}
                  onPress={() => onSelect(evaluation)}
                />
              ))}
            </View>
          </>
        ) : result.kind === 'no_benefits' ? (
          <>
            <ScreenHeader eyebrow={result.hostname} title={result.merchantName} />
            <View style={styles.notice}>
              <Text style={type.displaySmall}>אין כאן הטבה תקפה</Text>
              <Text style={type.small}>
                מזהים את האתר, אבל אף מועדון שסימנת לא נותן בו הטבה שתקפה לקנייה אונליין כרגע.
              </Text>
            </View>
          </>
        ) : (
          <>
            <ScreenHeader eyebrow="שיתוף" title="האתר לא בקטלוג" />
            <View style={styles.notice}>
              <Text style={type.displaySmall}>{result.hostname ?? 'לא זוהתה כתובת'}</Text>
              <Text style={type.small}>
                {result.hostname
                  ? 'הדומיין הזה עדיין לא ממופה לבית עסק. הוספה שלו לקטלוג היא התיקון הזול ביותר שאפשר לעשות כאן.'
                  : 'לא נמצאה כתובת אינטרנט בתוכן ששותף.'}
              </Text>
            </View>
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="סגור" tone="plate" onPress={onClose} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfacePage },
  content: { paddingBottom: space.s5 },
  lede: { ...type.body, paddingHorizontal: space.s4, paddingBottom: space.s3 },
  figureInline: type.figureInline,
  list: { paddingHorizontal: space.s4 },
  notice: {
    marginHorizontal: space.s4,
    borderRadius: radius.sharp,
    borderWidth: border.hairline,
    borderColor: colors.borderHairline,
    padding: space.s4,
    gap: space.s2,
  },
  footer: {
    flexDirection: 'row',
    paddingVertical: space.s3 - 4,
    paddingHorizontal: space.s4,
    borderTopWidth: border.hairline,
    borderTopColor: colors.borderHairline,
  },
});
