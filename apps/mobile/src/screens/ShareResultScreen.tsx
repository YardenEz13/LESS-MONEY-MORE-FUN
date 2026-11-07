import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { Evaluation } from '@sbr/core';
import { Ticket, stockFor } from '../components/Ticket';
import { Panel, PrimaryButton, ScreenHeader, Text } from '../components/ui';
import type { ShareResult } from '../services/shareIntent';
import { space, ticket, type } from '../theme';

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
            {result.match.evaluations.map((evaluation, i) => (
              <Ticket
                key={evaluation.benefit.id}
                evaluation={evaluation}
                size={i === 0 ? 'big' : 'mid'}
                // No wallet here, so the stock follows the club alone.
                stock={stockFor(evaluation.benefit.program_id, [])}
                onPress={onSelect}
                glide={null}
              />
            ))}
          </>
        ) : result.kind === 'no_benefits' ? (
          <>
            <ScreenHeader eyebrow={result.hostname} title={result.merchantName} />
            <Panel>
              <Text style={type.displaySmall}>אין כאן הטבה תקפה</Text>
              <Text style={type.small}>
                מזהים את האתר, אבל אף מועדון שסימנת לא נותן בו הטבה שתקפה לקנייה אונליין כרגע.
              </Text>
            </Panel>
          </>
        ) : (
          <>
            <ScreenHeader eyebrow="שיתוף" title="האתר לא בקטלוג" />
            <Panel>
              <Text style={type.displaySmall}>{result.hostname ?? 'לא זוהתה כתובת'}</Text>
              <Text style={type.small}>
                {result.hostname
                  ? 'הדומיין הזה עדיין לא ממופה לבית עסק. הוספה שלו לקטלוג היא התיקון הזול ביותר שאפשר לעשות כאן.'
                  : 'לא נמצאה כתובת אינטרנט בתוכן ששותף.'}
              </Text>
            </Panel>
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
  screen: { flex: 1, backgroundColor: ticket.ground },
  content: { paddingBottom: space.s5, gap: space.s3 },
  lede: { ...type.body, paddingHorizontal: space.s3 },
  figureInline: type.figureInline,
  footer: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: ticket.rule },
});
