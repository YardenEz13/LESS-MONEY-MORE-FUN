import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Program, UserProfile } from '@sbr/core';
import { programs } from '../services/catalog';
import { toggleProgram } from '../state/profile';
import { colors, font, radius, spacing } from '../theme';

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
 * The 60-second onboarding from the PRD: tap what you hold, done. No ID
 * number, no password, no card number — nothing that would turn a reminder
 * app into a credentials liability.
 */
export function OnboardingScreen({ profile, onChange, onDone }: Props) {
  const sections = useMemo(() => {
    const order: Program['category'][] = ['credit_card', 'employer_club', 'retail_club'];
    return order.map((category) => ({
      category,
      items: programs.filter((p) => p.category === category),
    }));
  }, []);

  const selectedCount = profile.program_ids.length;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={font.title}>מה יש לך בארנק?</Text>
        <Text style={styles.subtitle}>
          סמן את המועדונים והכרטיסים שברשותך. אנחנו לא מבקשים ת״ז, סיסמה או מספר כרטיס — הבחירה
          נשמרת רק במכשיר שלך.
        </Text>

        {sections.map((section) => (
          <View key={section.category} style={styles.section}>
            <Text style={styles.sectionTitle}>{SECTION_TITLES[section.category]}</Text>
            {section.items.map((program) => {
              const selected = profile.program_ids.includes(program.id);
              return (
                <Pressable
                  key={program.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  onPress={() => onChange(toggleProgram(profile, program.id))}
                  style={({ pressed }) => [
                    styles.item,
                    selected && styles.itemSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.itemText}>
                    <Text style={font.body}>{program.name}</Text>
                    {program.hint && <Text style={font.small}>{program.hint}</Text>}
                  </View>
                  <Text style={selected ? styles.checkOn : styles.checkOff}>
                    {selected ? '✓' : ''}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          disabled={selectedCount === 0}
          onPress={onDone}
          style={({ pressed }) => [
            styles.cta,
            selectedCount === 0 && styles.ctaDisabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.ctaText}>
            {selectedCount === 0 ? 'בחר לפחות מועדון אחד' : `המשך (${selectedCount})`}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.lg },
  subtitle: { ...font.small, lineHeight: 20 },
  section: { gap: spacing.sm },
  sectionTitle: { ...font.heading, fontSize: 16, marginTop: spacing.sm },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  itemSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  itemText: { flex: 1, gap: 2 },
  pressed: { opacity: 0.7 },
  checkOn: { fontSize: 18, color: colors.accent, fontWeight: '700' },
  checkOff: { fontSize: 18 },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  cta: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: 'center',
  },
  ctaDisabled: { backgroundColor: colors.textMuted },
  ctaText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
