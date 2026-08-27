import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { Program, UserProfile } from '@sbr/core';
import { Crest } from '../components/Kit';
import { Hero, PrimaryButton, Section, Text } from '../components/ui';
import { benefits, programs } from '../services/catalog';
import { toggleProgram } from '../state/profile';
import { border, colors, radius, space, type } from '../theme';

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

  const selected = profile.program_ids.length;

  return (
    <View style={styles.screen}>
      {/* The first thing anyone sees. It used to be this form on bare paper —
          no colour, no statement, straight into checkboxes. */}
      <Hero eyebrow="הגדרה חד-פעמית" title="מה יש לך בארנק?">
        <Text style={styles.heroLine}>
          <Text style={styles.heroFigure}>{selected}</Text>
          {'  '}
          {selected === 1 ? 'מועדון נבחר' : 'מועדונים נבחרו'}
        </Text>
      </Hero>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.intro}>
          <Text style={type.body}>
            סמן את המועדונים והכרטיסים שברשותך. לא נשאל ת״ז, סיסמה או מספר כרטיס — הסימון נשמר
            במכשיר שלך ולא נשלח לשום מקום.
          </Text>
        </View>

        {sections.map((section) => (
          <Section key={section.category} eyebrow={SECTION_TITLES[section.category] ?? ''}>
            <View style={styles.group}>
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
    <Pressable
      accessibilityRole="checkbox"
      /* aria-checked, not accessibilityState — see the note in components/ui. */
      aria-checked={selected}
      accessibilityLabel={program.name}
      onPress={onPress}
      style={[styles.row, selected && styles.rowSelected]}
    >
      <View style={[styles.box, selected && styles.boxOn]}>
        {selected && <Text style={styles.check}>✓</Text>}
      </View>
      {/* The crest the benefit cards will carry, shown at the moment the reader
          picks the club — so the badge on a card two screens later is already
          something they have seen and chosen. */}
      <Crest programId={program.id} size={24} />
      <View style={styles.rowText}>
        <Text style={type.bodyStrong}>{program.name}</Text>
        {program.hint && <Text style={type.caption}>{program.hint}</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfacePage },
  content: { paddingTop: space.s4, paddingBottom: space.s5, gap: space.s4 },
  intro: { paddingHorizontal: space.s4, gap: space.s2 },
  heroLine: { ...type.body, color: colors.textMutedOnPrimary },
  heroFigure: { ...type.figureInline, color: colors.textInverse },
  group: {
    marginHorizontal: space.s4,
    borderRadius: radius.sharp,
    borderWidth: border.hairline,
    borderColor: colors.borderHairline,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s3 - 2,
    paddingVertical: space.s3 - 2,
    paddingHorizontal: space.s3,
    borderBottomWidth: border.hairline,
    borderBottomColor: colors.borderHairlineSoft,
  },
  rowSelected: { backgroundColor: colors.surfaceRaised },
  /* flex-start so Latin club names ("Max") align with Hebrew ones — see ui.tsx. */
  rowText: { flex: 1, gap: 1, alignItems: 'flex-start' },
  box: {
    width: 22,
    height: 22,
    borderRadius: radius.sharp,
    borderWidth: border.hairline,
    borderColor: colors.borderHairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: colors.surfacePrimary, borderColor: colors.surfacePrimary },
  check: { color: colors.textInverse, fontSize: 13, lineHeight: 16 },
  footer: {
    flexDirection: 'row',
    paddingVertical: space.s3 - 4,
    paddingHorizontal: space.s4,
    borderTopWidth: border.hairline,
    borderTopColor: colors.borderHairline,
  },
});
