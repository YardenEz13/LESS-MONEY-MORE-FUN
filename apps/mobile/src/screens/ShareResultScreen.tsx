import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Evaluation } from '@sbr/core';
import { BenefitCard } from '../components/BenefitCard';
import { PrimaryButton, ScreenHeader } from '../components/ui';
import type { ShareResult } from '../services/shareIntent';
import { colors, radius, space, type } from '../theme';

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
            <ScreenHeader eyebrow={result.match.hostname} title={result.match.merchantName} titleIsName />
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
            <ScreenHeader eyebrow={result.hostname} title={result.merchantName} titleIsName />
            <View style={styles.notice}>
              <Text style={type.heading}>אין כאן הטבה תקפה</Text>
              <Text style={type.small}>
                מזהים את האתר, אבל אף מועדון שסימנת לא נותן בו הטבה שתקפה לקנייה אונליין כרגע.
              </Text>
            </View>
          </>
        ) : (
          <>
            <ScreenHeader eyebrow="שיתוף" title="האתר לא בקטלוג" />
            <View style={styles.notice}>
              <Text style={type.heading}>{result.hostname ?? 'לא זוהתה כתובת'}</Text>
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
        <PrimaryButton label="סגור" tone="ink" onPress={onClose} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { paddingBottom: space.xxl },
  lede: { ...type.body, paddingHorizontal: space.xl, paddingBottom: space.lg },
  figureInline: type.figureInline,
  list: { paddingHorizontal: space.xl },
  notice: {
    marginHorizontal: space.xl,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.xl,
    gap: space.sm,
  },
  footer: {
    flexDirection: 'row',
    padding: space.lg,
    paddingHorizontal: space.xl,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.card,
  },
});
