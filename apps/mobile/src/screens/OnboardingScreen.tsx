import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Program, UserProfile } from '@sbr/core';
import { PrimaryButton, Section } from '../components/ui';
import { programs } from '../services/catalog';
import { toggleProgram } from '../state/profile';
import { colors, radius, space, type } from '../theme';

const SECTION_TITLES: Record<Program['category'], string> = {
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
    const order: Program['category'][] = ['credit_card', 'employer_club', 'retail_club'];
    return order.map((category) => ({
      category,
      items: programs.filter((p) => p.category === category),
    }));
  }, []);

  const selected = profile.program_ids.length;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.intro}>
          <Text style={type.eyebrow}>הגדרה חד-פעמית</Text>
          <Text style={type.title}>מה יש לך בארנק?</Text>
          <Text style={type.body}>
            סמן את המועדונים והכרטיסים שברשותך. לא נשאל ת״ז, סיסמה או מספר כרטיס — הסימון נשמר
            במכשיר שלך ולא נשלח לשום מקום.
          </Text>
        </View>

        {sections.map((section) => (
          <Section key={section.category} eyebrow={SECTION_TITLES[section.category]}>
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
      accessibilityState={{ checked: selected }}
      accessibilityLabel={program.name}
      onPress={onPress}
      style={[styles.row, selected && styles.rowSelected]}
    >
      <View style={[styles.box, selected && styles.boxOn]}>
        {selected && <Text style={styles.check}>✓</Text>}
      </View>
      <View style={styles.rowText}>
        <Text style={type.bodyStrong}>{program.name}</Text>
        {program.hint && <Text style={type.caption}>{program.hint}</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { paddingTop: space.xxl, paddingBottom: space.xxl, gap: space.xl },
  intro: { paddingHorizontal: space.xl, gap: space.sm },
  group: {
    marginHorizontal: space.xl,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md + 2,
    paddingHorizontal: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowSelected: { backgroundColor: colors.mintSoft },
  rowText: { flex: 1, gap: 1 },
  box: {
    width: 21,
    height: 21,
    borderRadius: radius.sm - 2,
    borderWidth: 1.5,
    borderColor: colors.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: colors.mint, borderColor: colors.mint },
  check: { color: colors.inkInverse, fontSize: 13, lineHeight: 16 },
  footer: {
    flexDirection: 'row',
    padding: space.lg,
    paddingHorizontal: space.xl,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.card,
  },
});
