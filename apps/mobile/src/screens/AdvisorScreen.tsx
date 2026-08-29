import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import type { Evaluation, UserProfile } from '@sbr/core';
import { BenefitCard } from '../components/BenefitCard';
import { PrimaryButton, ScreenHeader, Section, Text } from '../components/ui';
import { askAdvisor, isAdvisorConfigured, type AdvisorAnswer } from '../services/advisor';
import { border, colors, radius, space, type } from '../theme';

const EXAMPLES = [
  'איפה הכי משתלם לתדלק?',
  'אני צריך לקנות מצרכים לשבת',
  'משהו לארוחת ערב עם הילדים',
];

interface Props {
  profile: UserProfile;
  onSelect: (evaluation: Evaluation) => void;
  onBack: () => void;
}

/**
 * Ask in Hebrew, get an answer drawn from benefits you already hold.
 *
 * The card under the answer is the same `BenefitCard` the list uses, on purpose:
 * the advisor is a way *into* the catalog, not a second source of truth with its
 * own idea of what a benefit says.
 */
export function AdvisorScreen({ profile, onSelect, onBack }: Props) {
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AdvisorAnswer | null>(null);

  const configured = isAdvisorConfigured();

  const ask = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setQuestion(trimmed);
    setPending(true);
    setError(null);
    setResult(null);
    try {
      setResult(await askAdvisor(trimmed, profile));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ScreenHeader eyebrow="שאל אותי" title="מה משתלם עכשיו" onBack={onBack} />

        <View style={styles.ask}>
          <TextInput
            value={question}
            onChangeText={setQuestion}
            editable={!pending}
            placeholder="למשל: איפה הכי משתלם לתדלק?"
            placeholderTextColor={colors.textDisabled}
            style={styles.input}
            multiline
            textAlign="right"
            onSubmitEditing={() => void ask(question)}
            accessibilityLabel="שאלה לעוזר"
          />
          <PrimaryButton
            label={pending ? 'חושב…' : 'שאל'}
            disabled={pending || !question.trim() || !configured}
            onPress={() => void ask(question)}
          />
        </View>

        {!configured && (
          <View style={styles.notice}>
            <View style={styles.noticeBar} />
            <Text style={styles.noticeText}>
              העוזר כבוי — לא הוגדר מפתח Gemini. הגדירו EXPO_PUBLIC_GEMINI_API_KEY והפעילו מחדש.
            </Text>
          </View>
        )}

        {configured && !result && !pending && (
          <View style={styles.examples}>
            {EXAMPLES.map((example) => (
              <Pressable
                key={example}
                accessibilityRole="button"
                accessibilityLabel={example}
                onPress={() => void ask(example)}
                style={({ pressed }) => [styles.example, pressed && styles.examplePressed]}
              >
                <Text style={type.chip}>{example}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {pending && (
          <View style={styles.pending}>
            <ActivityIndicator color={colors.surfacePrimary} />
          </View>
        )}

        {error && (
          <View style={styles.notice}>
            <View style={[styles.noticeBar, { backgroundColor: colors.accentUrgent }]} />
            <Text style={styles.noticeText}>{error}</Text>
          </View>
        )}

        {result && (
          <>
            <View style={styles.answer}>
              <Text style={styles.answerText}>{result.answer}</Text>
              {result.caveat && <Text style={styles.caveat}>שים לב · {result.caveat}</Text>}
            </View>

            {result.best && (
              <Section eyebrow="ההמלצה">
                <View style={styles.cards}>
                  <BenefitCard
                    evaluation={result.best}
                    onPress={() => onSelect(result.best!)}
                  />
                </View>
              </Section>
            )}

            {result.runnerUp && (
              <Section eyebrow="חלופה">
                <View style={styles.cards}>
                  <BenefitCard
                    evaluation={result.runnerUp}
                    onPress={() => onSelect(result.runnerUp!)}
                  />
                </View>
              </Section>
            )}

            <Text style={styles.footnote}>
              התשובה נוסחה על ידי Gemini מתוך ההטבות שכבר יש לך. הדירוג עצמו נעשה במכשיר, לפי
              התנאים בתקנון — ומה שלא כתוב שם לא הופך לטובת ההטבה.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfacePage },
  content: { paddingBottom: space.s6, gap: space.s4 },
  ask: { paddingHorizontal: space.s4, gap: space.s2 },
  input: {
    ...type.body,
    borderWidth: border.hairline,
    borderColor: colors.borderHairline,
    borderRadius: radius.sharp,
    paddingHorizontal: space.s3,
    paddingVertical: space.s3 - 4,
    minHeight: 56,
  },
  examples: { paddingHorizontal: space.s4, gap: space.s2, alignItems: 'flex-start' },
  example: {
    borderWidth: border.hairline,
    borderColor: colors.borderHairline,
    borderRadius: radius.sharp,
    paddingHorizontal: space.s3 - 2,
    paddingVertical: space.s2,
  },
  examplePressed: { backgroundColor: colors.surfaceRaised },
  pending: { paddingVertical: space.s4, alignItems: 'center' },
  notice: { marginHorizontal: space.s4, flexDirection: 'row', backgroundColor: colors.surfaceRaised },
  noticeBar: { width: border.marker, backgroundColor: colors.surfaceAccent },
  noticeText: { ...type.small, flex: 1, padding: space.s3 },
  answer: {
    marginHorizontal: space.s4,
    backgroundColor: colors.surfacePlate,
    padding: space.s4,
    gap: space.s2,
  },
  answerText: { ...type.lead, color: colors.textInverse },
  caveat: { ...type.small, color: colors.textMutedInverse },
  cards: { paddingHorizontal: space.s4 },
  footnote: { ...type.caption, marginHorizontal: space.s4, lineHeight: 18 },
});
