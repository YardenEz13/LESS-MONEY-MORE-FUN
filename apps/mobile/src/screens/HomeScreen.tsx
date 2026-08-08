import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  findCombos,
  rankBenefits,
  type Combo,
  type Evaluation,
  type UserProfile,
} from '@sbr/core';
import { BenefitCard } from '../components/BenefitCard';
import { FilterRow, GhostButton, LivePill, Text } from '../components/ui';
import { benefits, ownedProgramIds, programNames } from '../services/catalog';
import { border, colors, radius, space, type } from '../theme';

type Filter = 'all' | 'ready' | 'conditional';

interface Props {
  profile: UserProfile;
  geofenceStatus: string;
  geofenceActive: boolean;
  onSelect: (evaluation: Evaluation) => void;
  onOpenSettings: () => void;
  onOpenStats: () => void;
  onOpenAdvisor: () => void;
}

export function HomeScreen({
  profile,
  geofenceStatus,
  geofenceActive,
  onSelect,
  onOpenSettings,
  onOpenStats,
  onOpenAdvisor,
}: Props) {
  const [filter, setFilter] = useState<Filter>('all');

  // Channel is left unset here: the user isn't at a till or in a checkout yet,
  // so an in-store-only benefit is a note rather than a blocker.
  const evaluations = useMemo(
    () =>
      rankBenefits(benefits, {
        now: new Date(),
        ownedProgramIds: ownedProgramIds(profile.program_ids),
        mutedBenefitIds: profile.muted_benefit_ids,
      }),
    [profile.program_ids, profile.muted_benefit_ids],
  );

  // Two offers on one purchase. Shown above the list because a combo is the
  // one thing a user cannot work out by scrolling — it only exists between
  // two cards, never on either of them.
  const combos = useMemo(() => findCombos(evaluations, { limit: 2 }), [evaluations]);

  // Readiness is "nothing left to do", not "no caveats at all" — see Gate
  // in @sbr/core. Counting caveats here would make the number permanently 0.
  const ready = evaluations.filter((e) => e.actionsRequired.length === 0);
  const conditional = evaluations.filter((e) => e.actionsRequired.length > 0);
  const shown = filter === 'ready' ? ready : filter === 'conditional' ? conditional : evaluations;

  return (
    <View style={styles.screen}>
      {/* The hero: the one dominant green surface, per the design system. */}
      <View style={styles.header}>
        {/* The urgent edge. A sibling view rather than `borderStartWidth`: same
            web/native direction trap the card's rule works around, and flex
            order puts it on the reading edge in either direction. */}
        <View style={styles.headerEdge} />
        <View style={styles.headerBody}>
          <View style={styles.headerTop}>
            <View style={styles.headline}>
              <Text style={styles.headerEyebrow}>מה שכבר יש לך</Text>
              <Text style={styles.headerTitle}>ההטבות שלך</Text>
              {/* The band under the display — the device that stops the title
                  from floating on the green. */}
              <View style={styles.headerUnderline} />
            </View>
            <View style={styles.actions}>
              <IconAction label="שאל" onPress={onOpenAdvisor} />
              <IconAction label="מדדים" onPress={onOpenStats} />
              <IconAction label="הגדרות" onPress={onOpenSettings} />
            </View>
          </View>

          {/* The count is the page's thesis: not "12 deals!", but how many of them
              you can actually use right now. */}
          <Text style={styles.headerLine}>
            <Text style={styles.headerFigure}>{ready.length}</Text>
            {'  '}מוכנות לשימוש מתוך {evaluations.length} רלוונטיות
          </Text>
        </View>
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
        {/* Geofencing armed is the one genuinely live state in the app, so it
            gets the system's live marker. Off keeps the quiet square — a pill
            that is always there stops meaning "now". */}
        <View style={[styles.geofence, geofenceActive && styles.geofenceOn]}>
          {geofenceActive ? <LivePill /> : <View style={[styles.dot, styles.dotOff]} />}
          <Text style={[type.caption, geofenceActive && styles.geofenceOnText]}>
            {geofenceStatus}
          </Text>
        </View>

        {filter === 'all' &&
          combos.map((combo) => (
            <ComboCard
              key={combo.parts.map((p) => p.benefit.id).join('+')}
              combo={combo}
              onPress={() => onSelect(combo.parts[0])}
            />
          ))}

        {shown.length === 0 ? (
          <EmptyState
            filter={filter}
            hasPrograms={profile.program_ids.length > 0}
            onEditPrograms={onOpenSettings}
          />
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

/**
 * A stackable pair. Deliberately does not look like a BenefitCard: the plate
 * carries a sum that is an *estimate of a combination*, which is a weaker claim
 * than the figure on a single card, and the strip says so rather than hiding it.
 */
function ComboCard({ combo, onPress }: { combo: Combo; onPress: () => void }) {
  const [first, second] = combo.parts;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`שילוב הטבות ב${combo.merchantName}, חיסכון משוער ${Math.round(
        combo.estimatedSavingIls,
      )} שקלים`}
      onPress={onPress}
      style={({ pressed }) => [styles.combo, pressed && { backgroundColor: colors.surfaceRaised }]}
    >
      <View style={styles.comboTop}>
        <View style={styles.comboIdentity}>
          <Text style={styles.comboEyebrow}>אפשר לשלב · {combo.merchantName}</Text>
          <Text style={type.lead} numberOfLines={2}>
            {first.benefit.merchant_name === second.benefit.merchant_name
              ? `${programNames[first.benefit.program_id]} + ${programNames[second.benefit.program_id]}`
              : `${first.benefit.merchant_name} + ${second.benefit.merchant_name}`}
          </Text>
        </View>
        <View style={styles.comboRule} />
        <View style={styles.comboPlate}>
          <Text style={styles.comboFigure} numberOfLines={1} adjustsFontSizeToFit>
            ₪{Math.round(combo.estimatedSavingIls)}
          </Text>
          <Text style={styles.comboPlateUnit}>יחד</Text>
        </View>
      </View>

      <View style={styles.comboBody}>
        <Text style={type.caption}>
          {first.benefit.conditions.raw_text_summary}
        </Text>
        <Text style={type.caption}>{second.benefit.conditions.raw_text_summary}</Text>
      </View>

      <View style={styles.comboFooter}>
        <View
          style={[
            styles.marker,
            { backgroundColor: combo.confirmed ? colors.surfacePrimary : colors.accentUrgent },
          ]}
        />
        <Text style={[type.caption, styles.comboVerdict]} numberOfLines={2}>
          {combo.confirmed
            ? 'שני התקנונים מתירים כפל · ההערכה לפי הסדר הפחות מיטיב'
            : combo.caveats.join(' · ')}
        </Text>
      </View>
    </Pressable>
  );
}

function IconAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.iconAction}>
      <Text style={styles.iconActionLabel}>{label}</Text>
    </Pressable>
  );
}

function EmptyState({
  filter,
  hasPrograms,
  onEditPrograms,
}: {
  filter: Filter;
  hasPrograms: boolean;
  onEditPrograms: () => void;
}) {
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
      {/* The mark: a square outlined in the 2px rule, holding a single bar. */}
      <View style={styles.emptyMark}>
        <View style={styles.emptyMarkBar} />
      </View>
      <Text style={styles.emptyTitle}>{copy.title}</Text>
      <Text style={styles.emptyBody}>{copy.body}</Text>
      {!hasPrograms && <GhostButton label="עריכת המועדונים" onPress={onEditPrograms} />}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfacePage },
  header: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: colors.surfacePrimary,
    marginBottom: space.s3,
  },
  headerEdge: { width: 10, backgroundColor: colors.accentUrgent },
  headerBody: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: space.s4,
    paddingTop: space.s3,
    paddingBottom: space.s3,
    gap: space.s2,
  },
  headerTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  headline: { gap: space.s1, flexShrink: 1 },
  headerEyebrow: { ...type.meta, color: colors.textMutedOnPrimary },
  headerTitle: { ...type.display, color: colors.textInverse, fontSize: 40, lineHeight: 42 },
  headerUnderline: {
    height: border.band,
    width: 132,
    backgroundColor: colors.textInverse,
    marginTop: space.s1,
  },
  headerLine: { ...type.body, color: colors.textMutedOnPrimary },
  headerFigure: { ...type.figureInline, color: colors.textInverse },
  actions: { flexDirection: 'row', gap: space.s2, paddingTop: space.s1 },
  iconAction: {
    paddingHorizontal: space.s3 - 2,
    paddingVertical: space.s2,
    borderRadius: radius.sharp,
    borderWidth: border.hairline,
    borderColor: colors.surfacePrimaryRaised,
  },
  iconActionLabel: { ...type.caption, color: colors.textInverse },
  list: { paddingHorizontal: space.s4, paddingBottom: space.s6 },
  combo: {
    borderWidth: border.hairline,
    borderColor: colors.surfaceAccent,
    marginBottom: space.s3,
  },
  comboTop: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderBottomWidth: border.hairline,
    borderBottomColor: colors.borderHairline,
  },
  comboIdentity: {
    flex: 1,
    minWidth: 0,
    paddingVertical: space.s3 - 2,
    paddingHorizontal: space.s3,
    gap: space.s1,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  comboEyebrow: { ...type.meta, color: colors.surfaceAccent },
  comboRule: { width: border.hairline, backgroundColor: colors.borderHairline },
  comboPlate: {
    width: 104,
    flexShrink: 0,
    backgroundColor: colors.surfaceAccent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.s2 + 4,
    paddingHorizontal: space.s2,
  },
  comboFigure: { ...type.figure, fontSize: 34, lineHeight: 34 },
  comboPlateUnit: { ...type.micro, color: colors.textInverse, marginTop: space.s1 + 2 },
  comboBody: {
    paddingVertical: space.s2 + 4,
    paddingHorizontal: space.s3,
    gap: space.s1,
  },
  comboFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s2,
    paddingVertical: space.s2 + 3,
    paddingHorizontal: space.s3,
    borderTopWidth: border.hairline,
    borderTopColor: colors.borderHairlineSoft,
  },
  marker: { width: 8, height: 8, flexShrink: 0 },
  comboVerdict: { flex: 1 },
  geofence: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s2,
    paddingVertical: space.s2,
    paddingHorizontal: space.s3 - 2,
    marginBottom: space.s3,
    borderRadius: radius.sharp,
    borderWidth: border.hairline,
    borderColor: colors.borderHairline,
  },
  geofenceOn: { backgroundColor: colors.surfacePrimary, borderColor: colors.surfacePrimary },
  geofenceOnText: { color: colors.textInverse },
  /* Square, not a circle — the system has one radius and it is zero. */
  dot: { width: 8, height: 8, borderRadius: radius.sharp },
  dotOff: { backgroundColor: colors.borderHairline },
  empty: {
    borderRadius: radius.sharp,
    borderWidth: border.hairline,
    borderColor: colors.borderHairline,
    paddingVertical: space.s5,
    paddingHorizontal: space.s4,
    gap: space.s3 - 2,
    alignItems: 'center',
  },
  emptyMark: {
    width: 56,
    height: 56,
    borderWidth: border.rule,
    borderColor: colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyMarkBar: { width: 22, height: border.rule, backgroundColor: colors.textPrimary },
  emptyTitle: { ...type.display, textAlign: 'center' },
  emptyBody: { ...type.small, color: colors.textMuted, textAlign: 'center', maxWidth: 280 },
  footnote: { ...type.caption, marginTop: space.s3, lineHeight: 18 },
});
