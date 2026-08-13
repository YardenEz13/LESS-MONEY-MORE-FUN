import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  findCombos,
  rankBenefits,
  type Combo,
  type Evaluation,
  type UserProfile,
  type Venue,
} from '@sbr/core';
import { BenefitCard } from '../components/BenefitCard';
import { FilterRow, GhostButton, Hero, LivePill, Text } from '../components/ui';
import { benefits, benefitsAtVenue, ownedProgramIds, programNames, venues } from '../services/catalog';
import { currentVenue } from '../services/geofencing';
import { border, colors, radius, space, type, useCompact } from '../theme';

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

  /** Where the user is. Null means "everywhere" — the default, not an error. */
  const [venue, setVenue] = useState<Venue | null>(null);
  const [picking, setPicking] = useState(false);
  const [locating, setLocating] = useState(false);

  const locate = useCallback(async () => {
    setLocating(true);
    const where = await currentVenue();
    setLocating(false);
    // Not in any tracked mall, or no fix: fall through to the manual list
    // rather than leaving the user with a spinner that resolved to nothing.
    if (where.ok && where.venue) setVenue(where.venue);
    else setPicking(true);
  }, []);

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
  const byFilter = filter === 'ready' ? ready : filter === 'conditional' ? conditional : evaluations;

  // A chosen venue narrows whatever the filter already selected, rather than
  // replacing it — "ready, here" is the question someone standing in a mall
  // is actually asking.
  const hereIds = useMemo(
    () => (venue ? new Set(benefitsAtVenue(venue.id).map((b) => b.id)) : null),
    [venue],
  );
  const shown = hereIds ? byFilter.filter((e) => hereIds.has(e.benefit.id)) : byFilter;

  /**
   * How many benefits a venue is worth *to this user*.
   *
   * Counting the catalog instead would advertise a mall as having 8 when the
   * list below it shows 5 — the other three belong to clubs they do not hold
   * or are blocked right now. A count that disagrees with the list under it
   * teaches the reader to distrust both.
   */
  const countAt = useCallback(
    (venueId: string) => {
      const ids = new Set(benefitsAtVenue(venueId).map((b) => b.id));
      return evaluations.filter((e) => ids.has(e.benefit.id)).length;
    },
    [evaluations],
  );

  return (
    <View style={styles.screen}>
      {/* The hero: the one dominant green surface, per the design system. */}
      <Hero
        eyebrow="מה שכבר יש לך"
        title="ההטבות שלך"
        right={
          <View style={styles.actions}>
            <IconAction label="שאל" onPress={onOpenAdvisor} />
            <IconAction label="מדדים" onPress={onOpenStats} />
            <IconAction label="הגדרות" onPress={onOpenSettings} />
          </View>
        }
      >
        {/* The count is the page's thesis: not "12 deals!", but how many of them
            you can actually use right now. */}
        <Text style={styles.headerLine}>
          <Text style={styles.headerFigure}>{ready.length}</Text>
          {'  '}מוכנות לשימוש מתוך {evaluations.length} רלוונטיות
        </Text>

        <WhereAmI
          venue={venue}
          count={venue ? countAt(venue.id) : 0}
          locating={locating}
          onLocate={locate}
          onPick={() => setPicking(true)}
          onClear={() => setVenue(null)}
        />
      </Hero>

      {picking && (
        <VenueSheet
          countAt={countAt}
          onChoose={(chosen) => {
            setVenue(chosen);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}

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
  const compact = useCompact();
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
        <View style={[styles.comboPlate, compact && styles.comboPlateCompact]}>
          <Text
            style={[styles.comboFigure, compact && styles.comboFigureCompact]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
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

/**
 * "Where are you" — the foreground half of location, living inside the hero.
 *
 * Two affordances rather than one because GPS is not reliable indoors, which
 * is exactly where a mall is: the locate button is the fast path, the manual
 * list is the one that always works. Neither needs background permission, so
 * this row does its job on a phone that refused it and inside Expo Go.
 */
function WhereAmI({
  venue,
  count,
  locating,
  onLocate,
  onPick,
  onClear,
}: {
  venue: Venue | null;
  count: number;
  locating: boolean;
  onLocate: () => void;
  onPick: () => void;
  onClear: () => void;
}) {
  if (venue) {
    return (
      <View style={styles.whereRow}>
        <View style={styles.whereActive}>
          <Text style={styles.whereActiveText} numberOfLines={1}>
            {venue.name} · {count} הטבות כאן
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="הצג הטבות מכל המיקומים"
          onPress={onClear}
          style={styles.whereGhost}
        >
          <Text style={styles.whereGhostLabel}>הכול</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={styles.whereRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="אתר את המיקום שלי"
        onPress={onLocate}
        disabled={locating}
        style={styles.whereGhost}
      >
        {locating ? (
          <ActivityIndicator size="small" color={colors.textInverse} />
        ) : (
          <Text style={styles.whereGhostLabel}>איפה אני?</Text>
        )}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="בחר מיקום מתוך רשימה"
        onPress={onPick}
        style={styles.whereGhost}
      >
        <Text style={styles.whereGhostLabel}>בחר מיקום</Text>
      </Pressable>
    </View>
  );
}

/** The manual fallback: every tracked venue, tap to pin. */
function VenueSheet({
  countAt,
  onChoose,
  onClose,
}: {
  countAt: (venueId: string) => number;
  onChoose: (venue: Venue) => void;
  onClose: () => void;
}) {
  return (
    <View style={styles.sheet}>
      <View style={styles.sheetHead}>
        <Text style={type.bodyStrong}>איפה אתה עכשיו?</Text>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={12}>
          <Text style={type.meta}>סגור</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.sheetList} keyboardShouldPersistTaps="handled">
        {venues.map((v) => (
          <Pressable
            key={v.id}
            accessibilityRole="button"
            onPress={() => onChoose(v)}
            style={({ pressed }) => [
              styles.sheetRow,
              pressed && { backgroundColor: colors.surfaceRaised },
            ]}
          >
            <Text style={type.body}>{v.name}</Text>
            <Text style={type.caption}>{countAt(v.id)}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
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
  headerLine: { ...type.body, color: colors.textMutedOnPrimary },
  headerFigure: { ...type.figureInline, color: colors.textInverse },
  /* Wraps for the same reason the hero's top row does: three labelled chips are
     ~197dp, and once they have taken their own line they fit whole on a 320
     screen — but a fourth action, or a longer word, should break rather than
     push one off the edge. */
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s2, paddingTop: space.s1 },
  iconAction: {
    paddingHorizontal: space.s3 - 2,
    paddingVertical: space.s2,
    borderRadius: radius.sharp,
    borderWidth: border.hairline,
    borderColor: colors.surfacePrimaryRaised,
  },
  iconActionLabel: { ...type.caption, color: colors.textInverse },

  whereRow: { flexDirection: 'row', alignItems: 'center', gap: space.s2, marginTop: space.s1 },
  whereGhost: {
    paddingHorizontal: space.s3 - 2,
    paddingVertical: space.s2 - 2,
    borderWidth: border.hairline,
    borderColor: colors.textMutedOnPrimary,
    minHeight: 34,
    justifyContent: 'center',
  },
  whereGhostLabel: { ...type.caption, color: colors.textInverse },
  /* Pinned location is a fact, so it reads as a filled plate rather than an
     outline — the same move the geofence band makes when it goes live. */
  whereActive: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.surfacePlate,
    paddingHorizontal: space.s3 - 2,
    paddingVertical: space.s2 - 1,
    justifyContent: 'center',
  },
  whereActiveText: { ...type.caption, color: colors.textInverse },

  sheet: {
    marginHorizontal: space.s4,
    marginTop: space.s3,
    borderWidth: border.hairline,
    borderColor: colors.surfaceAccent,
    backgroundColor: colors.surfacePage,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.s3,
    paddingVertical: space.s2 + 2,
    borderBottomWidth: border.rule,
    borderBottomColor: colors.surfaceAccent,
  },
  sheetList: { maxHeight: 260 },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.s3,
    paddingVertical: space.s3 - 4,
    borderBottomWidth: border.hairline,
    borderBottomColor: colors.borderHairlineSoft,
  },

  list: { paddingHorizontal: space.s4, paddingBottom: space.s6, paddingTop: space.s3 },
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
  /* Matches the benefit card's plate step, so a combo and a card sitting in the
     same list keep the same end column at both widths. */
  comboPlateCompact: { width: 84, paddingHorizontal: space.s1 + 2 },
  comboFigure: { ...type.figure, fontSize: 34, lineHeight: 34 },
  comboFigureCompact: { fontSize: 28, lineHeight: 28 },
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
