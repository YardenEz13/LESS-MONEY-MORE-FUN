import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  catalogIsStale,
  findCombos,
  hiddenBenefitIds,
  matchesQuery,
  rankBenefits,
  REFERENCE_BASKET_ILS,
  type Combo,
  type Coordinates,
  type Evaluation,
  type UserProfile,
  type Venue,
} from '@sbr/core';
import { BenefitCard } from '../components/BenefitCard';
import { Crest, PitchStripes, ScarfBand } from '../components/Kit';
import { FilterRow, GhostButton, Hero, LivePill, SearchField, Text } from '../components/ui';
import {
  benefits,
  benefitsAtVenue,
  benefitsNear,
  merchantLine,
  nearestCatalogPlace,
  ownedProgramIds,
  programNames,
  venues,
} from '../services/catalog';
import { currentVenue, dwellMinutes } from '../services/geofencing';
import { border, colors, radius, space, type, useCompact } from '../theme';

type Filter = 'all' | 'ready' | 'conditional';

/**
 * How far "here" reaches when the fix lands outside every mall.
 *
 * ponytail: one fixed radius. 500m is roughly a five-minute walk and keeps a
 * Tel Aviv high street from returning half the city — 2258 of the 3925
 * catalogued branches are in Tel Aviv alone. Make it a setting when someone
 * driving complains, not before.
 */
const WALKING_RADIUS_M = 500;

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
  const [query, setQuery] = useState('');

  /** Where the user is. Null means "everywhere" — the default, not an error. */
  const [venue, setVenue] = useState<Venue | null>(null);
  /** A fix that landed outside every mall: still a place, just not a named one. */
  const [here, setHere] = useState<Coordinates | null>(null);
  const [picking, setPicking] = useState(false);
  const [locating, setLocating] = useState(false);

  /**
   * The match minute: how long the geofence has had you inside this venue.
   * Null whenever there was no entry event to count from — a manual pin, or a
   * build with no background permission — and the pill simply says LIVE.
   */
  const [minute, setMinute] = useState<number | null>(null);
  useEffect(() => {
    if (!venue) {
      setMinute(null);
      return;
    }
    let cancelled = false;
    void dwellMinutes(venue.id).then((m) => {
      if (!cancelled) setMinute(m);
    });
    return () => {
      cancelled = true;
    };
  }, [venue]);

  const locate = useCallback(async () => {
    setLocating(true);
    const where = await currentVenue();
    setLocating(false);
    if (!where.ok) {
      setPicking(true);
      return;
    }
    // Standing in no tracked mall is the normal case, not a failure: the ten
    // venues cover 6% of catalogued branches. Pin the point instead and let the
    // list answer from branch distance. The manual sheet is now only for "no
    // fix at all".
    setVenue(where.venue);
    setHere(where.venue ? null : where.here);
  }, []);

  // Channel is left unset here: the user isn't at a till or in a checkout yet,
  // so an in-store-only benefit is a note rather than a blocker.
  const evaluations = useMemo(
    () =>
      rankBenefits(benefits, {
        now: new Date(),
        ownedProgramIds: ownedProgramIds(profile.program_ids),
        mutedBenefitIds: hiddenBenefitIds(profile),
      }),
    [profile.program_ids, profile.muted_benefit_ids],
  );

  // Checked against the whole catalog rather than the filtered list: the answer
  // is about the bundle's age, not about what this user happens to hold.
  const catalogStale = useMemo(() => catalogIsStale(benefits, new Date()), []);

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
  const hereIds = useMemo(() => {
    if (venue) return new Set(benefitsAtVenue(venue.id).map((b) => b.id));
    if (here) return new Set(benefitsNear(here, WALKING_RADIUS_M).map((b) => b.id));
    return null;
  }, [venue, here]);
  const atPlace = hereIds ? byFilter.filter((e) => hereIds.has(e.benefit.id)) : byFilter;

  // Searched over the trade and city as well as the name, because most of the
  // catalog is businesses nobody has heard of: "מכולת" and "גבעתיים" are how you
  // find one whose name you never knew — the same line the card already shows.
  const shown = useMemo(
    () =>
      query.trim() === ''
        ? atPlace
        : atPlace.filter((e) =>
            matchesQuery(
              [e.benefit.merchant_name, merchantLine(e.benefit.merchant_id), programNames[e.benefit.program_id]],
              query,
            ),
          ),
    [atPlace, query],
  );

  // Counted off `evaluations`, not `shown`: the plate reports what this place is
  // worth to the user, and must not drop when they tick a filter above it.
  const hereCount = hereIds ? evaluations.filter((e) => hereIds.has(e.benefit.id)).length : 0;

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
          nearby={here != null}
          count={hereCount}
          minute={minute}
          locating={locating}
          onLocate={locate}
          onPick={() => setPicking(true)}
          onClear={() => {
            setVenue(null);
            setHere(null);
          }}
        />
      </Hero>

      {picking && (
        <VenueSheet
          countAt={countAt}
          onChoose={(chosen) => {
            setVenue(chosen);
            setHere(null);
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

      <SearchField
        value={query}
        onChange={setQuery}
        placeholder="חיפוש בית עסק, תחום או עיר"
        resultCount={shown.length}
      />

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {/* Geofencing armed is the one genuinely live state in the app, so it
            gets the system's live marker. Off keeps the quiet square — a pill
            that is always there stops meaning "now". */}
        <View style={[styles.geofence, geofenceActive && styles.geofenceOn]}>
          {geofenceActive && <PitchStripes />}
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

        {shown.length === 0 && query.trim() !== '' ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>אין תוצאות</Text>
            <Text style={styles.emptyBody}>
              {`לא נמצא בית עסק שמתאים ל״${query.trim()}״ מבין ${evaluations.length} ההטבות שלך.`}
            </Text>
            <GhostButton label="נקה חיפוש" onPress={() => setQuery('')} />
          </View>
        ) : shown.length === 0 ? (
          <EmptyState
            filter={filter}
            hasPrograms={profile.program_ids.length > 0}
            here={hereIds && !venue ? here : null}
            catalogStale={catalogStale}
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

        {/* Full time. The same band that closes the hero closes the list, so
            the reader knows the scroll ended rather than stalled. */}
        <ScarfBand style={styles.listEnd} />
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
          {/* Both crests, because a combo is the one card that belongs to two
              clubs at once and the pair is the whole point of it. */}
          <View style={styles.comboCrests}>
            <Crest programId={first.benefit.program_id} size={20} />
            <Crest programId={second.benefit.program_id} size={20} />
            <Text style={styles.comboEyebrow} numberOfLines={1}>
              אפשר לשלב · {combo.merchantName}
            </Text>
          </View>
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
          {[
            combo.confirmed
              ? 'שני התקנונים מתירים כפל · ההערכה לפי הסדר הפחות מיטיב'
              : combo.caveats.join(' · '),
            // The plate figure assumes a cart, since a list screen has none —
            // named here rather than left for the number to imply it's real.
            combo.isEstimate ? `לפי סל לדוגמה של ₪${REFERENCE_BASKET_ILS}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
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
  nearby,
  count,
  minute,
  locating,
  onLocate,
  onPick,
  onClear,
}: {
  venue: Venue | null;
  /** A fix outside every mall — a place with no name, but still a place. */
  nearby: boolean;
  count: number;
  minute: number | null;
  locating: boolean;
  onLocate: () => void;
  onPick: () => void;
  onClear: () => void;
}) {
  if (venue || nearby) {
    return (
      <View style={styles.whereRow}>
        <View style={styles.whereActive}>
          {/* Being somewhere is the app's kick-off, so the pinned plate runs the
              clock. No entry event, no minute — see `dwellMinutes`. */}
          {minute != null && <LivePill minute={minute} />}
          <Text style={styles.whereActiveText} numberOfLines={1}>
            {venue ? venue.name : 'קרוב אליך'} · {count} הטבות כאן
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="סגור"
          onPress={onClose}
          hitSlop={12}
        >
          <Text style={type.meta}>סגור</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.sheetList} keyboardShouldPersistTaps="handled">
        {venues.map((v) => (
          <Pressable
            key={v.id}
            accessibilityRole="button"
            // The city as well as the name: "קניון עזריאלי" alone is three
            // different malls in this list.
            accessibilityLabel={`${v.name}, ${v.city}`}
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
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.iconAction}
    >
      <Text style={styles.iconActionLabel}>{label}</Text>
    </Pressable>
  );
}

function EmptyState({
  filter,
  hasPrograms,
  here,
  catalogStale,
  onEditPrograms,
}: {
  filter: Filter;
  hasPrograms: boolean;
  /** A pinned point that returned nothing — the coverage case, not the no-deals case. */
  here: Coordinates | null;
  /** The list is empty because the catalog aged out — see `catalogIsStale`. */
  catalogStale: boolean;
  onEditPrograms: () => void;
}) {
  // Nothing within walking distance has two very different causes, and telling
  // them apart is the whole job of this branch. "every benefit is blocked right
  // now" is a statement about the day; "the catalog does not reach this city"
  // is a statement about the catalog, and showing the first when the second is
  // true is how an app reads as broken to everyone outside Gush Dan.
  const nearest = here ? nearestCatalogPlace(here) : null;


  // Staleness is checked before the user's own choices, because it outranks
  // them: when the catalog has aged out every row is blocked no matter what is
  // ticked, and telling someone to go pick more clubs would send them to fix
  // the one thing that is not broken.
  const copy = catalogStale
    ? {
        title: 'הקטלוג לא עודכן מזמן',
        body: 'כל ההטבות אומתו לפני יותר מ-45 יום, ולכן אינן מוצגות. עדכן את האפליקציה כדי לקבל קטלוג חדש — הרשימה תחזור מיד.',
      }
    : !hasPrograms
    ? {
        title: 'עוד לא סימנת מועדונים',
        body: 'פתח הגדרות וסמן את הכרטיסים והמועדונים שברשותך. זה לוקח פחות מדקה.',
      }
    : nearest
      ? {
          title: 'הקטלוג לא מגיע לכאן',
          body: `אין בקטלוג בית עסק בטווח הליכה מכאן. הקרוב ביותר נמצא ב${nearest.city}, כ-${Math.round(nearest.km)} ק״מ מכאן. הכיסוי כרגע מרוכז בגוש דן.`,
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
      {/* The mark: a penalty area drawn in the 2px rule — box inside box, spot
          in the middle. The pitch's own markings are the one football device
          made entirely of 90° lines, so the empty state gets to be a diagram
          rather than an icon and still obeys the system. */}
      <View style={styles.emptyMark}>
        <View style={styles.emptyMarkInner} />
        <View style={styles.emptyMarkSpot} />
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s2,
    backgroundColor: colors.surfacePlate,
    paddingHorizontal: space.s3 - 2,
    paddingVertical: space.s2 - 1,
    justifyContent: 'flex-start',
  },
  whereActiveText: { ...type.caption, color: colors.textInverse, flexShrink: 1 },

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
  comboCrests: { flexDirection: 'row', alignItems: 'center', gap: space.s1 + 2 },
  comboEyebrow: { ...type.meta, color: colors.surfaceAccent, flexShrink: 1 },
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
    overflow: 'hidden',
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
    width: 76,
    height: 56,
    borderWidth: border.rule,
    borderColor: colors.surfacePrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyMarkInner: {
    position: 'absolute',
    width: 34,
    height: 24,
    borderWidth: border.rule,
    borderColor: colors.surfacePrimary,
  },
  emptyMarkSpot: { width: 6, height: 6, backgroundColor: colors.surfacePrimary },
  emptyTitle: { ...type.display, textAlign: 'center' },
  emptyBody: { ...type.small, color: colors.textMuted, textAlign: 'center', maxWidth: 280 },
  listEnd: { marginTop: space.s2 },
  footnote: { ...type.caption, marginTop: space.s3, lineHeight: 18 },
});
