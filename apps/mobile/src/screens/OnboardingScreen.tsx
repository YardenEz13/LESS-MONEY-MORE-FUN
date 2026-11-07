import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { matchesQuery, type Program, type UserProfile } from '@sbr/core';
import { Crest } from '../components/Kit';
import { ListRow, PrimaryButton, ScreenHeader, SearchField, Section, Text } from '../components/ui';
import { benefits, programs } from '../services/catalog';
import { toggleProgram } from '../state/profile';
import { colors, fonts, space, ticket, type } from '../theme';

/**
 * `public` is deliberately absent. It is granted to everyone rather than
 * chosen, and the `order` below is what decides which sections render — a
 * category with no title here simply cannot appear on this screen.
 */
const SECTION_TITLES: Partial<Record<Program['category'], string>> = {
  credit_card: 'כרטיסי אשראי',
  employer_club: 'מועדוני מעסיק וארגון',
  retail_club: 'מועדוני קמעונאות',
};

interface Props {
  profile: UserProfile;
  onChange: (profile: UserProfile) => void;
  onDone: () => void;
}

/**
 * The 60-second onboarding: tap what you hold, done. The copy leads with what
 * we *don't* ask for, because that's the unusual part and the reason someone
 * would trust this screen at all.
 */
export function OnboardingScreen({ profile, onChange, onDone }: Props) {
  const sections = useMemo(() => {
    // Only clubs the catalog can actually pay off on.
    //
    // The program list is generated from every discount list easy publishes,
    // which is far more clubs than we hold benefits for. Offering one with
    // nothing behind it is a promise the app cannot keep: the user ticks it,
    // and their list is no longer than before. A program reappears here the
    // moment a reviewed benefit ships for it, so this needs no maintenance.
    const withBenefits = new Set(benefits.map((b) => b.program_id));
    const offered = programs.filter(
      (p) => withBenefits.has(p.id) || (p.parent_id && withBenefits.has(p.parent_id)),
    );
    const order: Program['category'][] = ['credit_card', 'employer_club', 'retail_club'];
    return order.map((category) => ({
      category,
      items: offered.filter((p) => p.category === category),
    }));
  }, []);

  const [query, setQuery] = useState('');

  // Filtered after the sections are built, so a club keeps its section heading
  // when it is the only match — "which kind of thing is this" is most of what a
  // name like מפתח or יחד tells you.
  const shownSections = useMemo(
    () =>
      sections
        .map((section) => ({
          ...section,
          items: section.items.filter((p) => matchesQuery([p.name, p.hint], query)),
        }))
        .filter((section) => section.items.length > 0),
    [sections, query],
  );
  const matchCount = shownSections.reduce((n, s) => n + s.items.length, 0);

  const selected = profile.program_ids.length;

  return (
    <View style={styles.screen}>
      <ScreenHeader eyebrow="הגדרה חד-פעמית" title="מה יש לך בארנק?">
        <Text style={styles.count}>
          <Text style={styles.countFigure}>{selected}</Text>
          {'  '}
          {selected === 1 ? 'מועדון נבחר' : 'מועדונים נבחרו'}
        </Text>
      </ScreenHeader>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.intro}>
          <Text style={type.body}>
            סמן את המועדונים והכרטיסים שברשותך. לא נשאל ת״ז, סיסמה או מספר כרטיס — הסימון נשמר
            במכשיר שלך ולא נשלח לשום מקום.
          </Text>
        </View>

        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="חיפוש מועדון או כרטיס"
          resultCount={matchCount}
        />

        {matchCount === 0 && query.trim() !== '' && (
          <View style={styles.intro}>
            <Text style={type.body}>
              {`לא נמצא מועדון שמתאים ל״${query.trim()}״. יש כאן רק מועדונים שיש להם הטבות בקטלוג.`}
            </Text>
          </View>
        )}

        {shownSections.map((section) => (
          <Section key={section.category} eyebrow={SECTION_TITLES[section.category] ?? ''}>
            <View>
              {section.items.map((program) => (
                <ProgramRow
                  key={program.id}
                  program={program}
                  selected={profile.program_ids.includes(program.id)}
                  onPress={() => onChange(toggleProgram(profile, program.id))}
                />
              ))}
            </View>
          </Section>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={selected === 0 ? 'סמן לפחות מועדון אחד' : `סיימתי · ${selected} נבחרו`}
          disabled={selected === 0}
          onPress={onDone}
        />
      </View>
    </View>
  );
}

function ProgramRow({
  program,
  selected,
  onPress,
}: {
  program: Program;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <ListRow
      accessibilityRole="checkbox"
      /* aria-checked, not accessibilityState — see the note in components/ui. */
      aria-checked={selected}
      accessibilityLabel={program.name}
      onPress={onPress}
      selected={selected}
    >
      <View style={[styles.box, selected && styles.boxOn]}>
        {selected && <Text style={styles.check}>✓</Text>}
      </View>
      {/* The crest the club carries elsewhere, shown at the moment the reader
          picks it — so the badge two screens later is already one they chose. */}
      <Crest programId={program.id} size={24} />
      <View style={styles.rowText}>
        <Text style={type.bodyStrong}>{program.name}</Text>
        {program.hint && <Text style={type.caption}>{program.hint}</Text>}
      </View>
    </ListRow>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: ticket.ground },
  content: { paddingTop: space.s2, paddingBottom: space.s5, gap: space.s3 },
  intro: { paddingHorizontal: space.s3, gap: space.s2 },
  /* The roll's count line: a quiet sentence with the number in marigold display. */
  count: { fontFamily: fonts.latinText, fontSize: 15, lineHeight: 22, color: ticket.onGround2 },
  countFigure: { ...type.figureInline },
  /* flex-start so Latin club names ("Max") align with Hebrew ones — see ui.tsx. */
  rowText: { flex: 1, gap: 1, alignItems: 'flex-start' },
  box: {
    width: 22,
    height: 22,
    borderWidth: 1,
    borderColor: ticket.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: colors.surfacePrimary, borderColor: colors.surfacePrimary },
  check: { color: colors.textInverse, fontSize: 13, lineHeight: 16 },
  footer: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: ticket.rule },
});
