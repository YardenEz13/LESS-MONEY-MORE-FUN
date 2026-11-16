import React, { useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import type { Evaluation, UserProfile } from '@sbr/core';
import { Ticket, stockFor } from '../components/Ticket';
import { GhostButton, Panel, PrimaryButton, ScreenHeader, Section, Text } from '../components/ui';
import { askAdvisor, isAdvisorConfigured, type AdvisorAnswer } from '../services/advisor';
import { colors, space, ticket, type } from '../theme';

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
 * The ticket under the answer is the same `Ticket` the roll uses, on purpose:
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
          <Panel>
            <Text style={type.small}>
              העוזר כבוי — לא הוגדר שרת ולא מפתח. הגדירו EXPO_PUBLIC_ADVISOR_URL (מומלץ) או
              EXPO_PUBLIC_GEMINI_API_KEY והפעילו מחדש.
            </Text>
          </Panel>
        )}

        {configured && !result && !pending && (
          <View style={styles.examples}>
            {EXAMPLES.map((example) => (
              <GhostButton key={example} label={example} onPress={() => void ask(example)} />
            ))}
          </View>
        )}

        {pending && (
          <View style={styles.pending}>
            <ActivityIndicator color={colors.surfacePrimary} />
          </View>
        )}

        {error && (
          <Panel>
            <Text style={type.small}>{error}</Text>
          </Panel>
        )}

        {result && (
          <>
            <Panel style={styles.answer}>
              <Text style={styles.answerText}>{result.answer}</Text>
              {result.caveat && <Text style={styles.caveat}>שים לב · {result.caveat}</Text>}
            </Panel>

            {result.best && (
              <Section eyebrow="ההמלצה">
                <Ticket
                  evaluation={result.best}
                  size="big"
                  stock={stockFor(result.best.benefit.program_id, profile.program_ids)}
                  onPress={onSelect}
                />
              </Section>
            )}

            {result.runnerUp && (
              <Section eyebrow="חלופה">
                <Ticket
                  evaluation={result.runnerUp}
                  size="mid"
                  stock={stockFor(result.runnerUp.benefit.program_id, profile.program_ids)}
                  onPress={onSelect}
                />
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
  screen: { flex: 1, backgroundColor: ticket.ground },
  content: { paddingBottom: space.s6, gap: space.s3 },
  ask: { paddingHorizontal: space.s3, gap: space.s2 },
  input: {
    ...type.body,
    borderWidth: 1,
    borderColor: ticket.muted,
    paddingHorizontal: space.s3,
    paddingVertical: space.s3 - 4,
    minHeight: 56,
  },
  examples: { paddingHorizontal: space.s3, gap: space.s2, alignItems: 'flex-start' },
  pending: { paddingVertical: space.s4, alignItems: 'center' },
  /* The answer is the one bone ticket on the screen: ink on a stock, like a benefit. */
  answer: { backgroundColor: colors.surfacePlate },
  answerText: { ...type.lead, color: colors.textInverse },
  caveat: { ...type.small, color: colors.textMutedInverse },
  footnote: { ...type.caption, marginHorizontal: space.s3 },
});
