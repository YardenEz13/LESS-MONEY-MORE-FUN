import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { rankBenefits, type Evaluation, type UserProfile } from '@sbr/core';
import { BenefitCard } from '../components/BenefitCard';
import { FilterRow } from '../components/ui';
import { benefits } from '../services/catalog';
import { colors, radius, space, type } from '../theme';

type Filter = 'all' | 'ready' | 'conditional';

interface Props {
  profile: UserProfile;
  geofenceStatus: string;
  geofenceActive: boolean;
  onSelect: (evaluation: Evaluation) => void;
  onOpenSettings: () => void;
  onOpenStats: () => void;
}

export function HomeScreen({
  profile,
  geofenceStatus,
  geofenceActive,
  onSelect,
  onOpenSettings,
  onOpenStats,
}: Props) {
  const [filter, setFilter] = useState<Filter>('all');

  // Channel is left unset here: the user isn't at a till or in a checkout yet,
  // so an in-store-only benefit is a note rather than a blocker.
  const evaluations = useMemo(
    () =>
      rankBenefits(benefits, {
        now: new Date(),
        ownedProgramIds: profile.program_ids,
        mutedBenefitIds: profile.muted_benefit_ids,
      }),
    [profile.program_ids, profile.muted_benefit_ids],
  );

  // Readiness is "nothing left to do", not "no caveats at all" — see Gate
  // in @sbr/core. Counting caveats here would make the number permanently 0.
  const ready = evaluations.filter((e) => e.actionsRequired.length === 0);
  const conditional = evaluations.filter((e) => e.actionsRequired.length > 0);
  const shown = filter === 'ready' ? ready : filter === 'conditional' ? conditional : evaluations;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.headline}>
            <Text style={type.eyebrow}>מה שכבר יש לך</Text>
            <Text style={type.title}>ההטבות שלך</Text>
          </View>
          <View style={styles.actions}>
            <IconAction label="מדדים" onPress={onOpenStats} />
            <IconAction label="הגדרות" onPress={onOpenSettings} />
          </View>
        </View>

        {/* The count is the page's thesis: not "12 deals!", but how many of them
            you can actually use right now. */}
        <Text style={type.body}>
          <Text style={styles.figureInline}>{ready.length}</Text>
          {'  '}מוכנות לשימוש מתוך {evaluations.length} רלוונטיות
        </Text>
      </View>

      <FilterRow<Filter>
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'הכול', count: evaluations.length },
          { value: 'ready', label: 'מוכן לקופה', count: ready.length },
          { value: 'conditional', label: 'דורש פעולה', count: conditional.length },
        ]}
      />

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        <View style={[styles.geofence, geofenceActive && styles.geofenceOn]}>
          <View style={[styles.dot, geofenceActive ? styles.dotOn : styles.dotOff]} />
          <Text style={[type.caption, geofenceActive && styles.geofenceOnText]}>
            {geofenceStatus}
          </Text>
        </View>

        {shown.length === 0 ? (
          <EmptyState filter={filter} hasPrograms={profile.program_ids.length > 0} />
        ) : (
          shown.map((evaluation) => (
            <BenefitCard
              key={evaluation.benefit.id}
              evaluation={evaluation}
              onPress={() => onSelect(evaluation)}
            />
          ))
        )}

        <Text style={styles.footnote}>
          הטבות שתנאי בהן לא מתקיים כרגע — יום, שעה, תוקף או אימות ישן — לא מוצגות כאן בכלל.
        </Text>
      </ScrollView>
    </View>
  );
}

function IconAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.iconAction}>
      <Text style={type.caption}>{label}</Text>
    </Pressable>
  );
}

function EmptyState({ filter, hasPrograms }: { filter: Filter; hasPrograms: boolean }) {
  const copy = !hasPrograms
    ? {
        title: 'עוד לא סימנת מועדונים',
        body: 'פתח הגדרות וסמן את הכרטיסים והמועדונים שברשותך. זה לוקח פחות מדקה.',
      }
    : filter === 'ready'
      ? {
          title: 'אין הטבה שמוכנה כרגע',
          body: 'עבור ללשונית ״דורש פעולה״ — שם ההטבות שמחכות למשהו ממך: סכום מינימום, שובר שצריך להנפיק, או קנייה בערוץ אחר.',
        }
      : {
          title: 'אין הטבות להצגה',
          body: 'כל ההטבות בקטלוג חסומות כרגע. עדיף רשימה ריקה מהטבה שתגלה בקופה שאינה תקפה.',
        };

  return (
    <View style={styles.empty}>
      <Text style={type.heading}>{copy.title}</Text>
      <Text style={type.small}>{copy.body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  header: { paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.md, gap: space.md },
  headerTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  headline: { gap: 3 },
  actions: { flexDirection: 'row', gap: space.xs + 2, paddingTop: space.sm },
  iconAction: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  figureInline: { fontFamily: 'Rubik_700Bold', fontSize: 22, color: colors.mint },
  list: { paddingHorizontal: space.xl, paddingBottom: space.xxxl },
  geofence: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    marginBottom: space.lg,
    borderRadius: radius.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  geofenceOn: { backgroundColor: colors.mintSoft, borderColor: colors.mintLine },
  geofenceOnText: { color: colors.mint },
  dot: { width: 7, height: 7, borderRadius: radius.pill },
  dotOn: { backgroundColor: colors.mint },
  dotOff: { backgroundColor: colors.lineStrong },
  empty: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.xl,
    gap: space.sm,
  },
  footnote: { ...type.caption, marginTop: space.lg, lineHeight: 17 },
});
