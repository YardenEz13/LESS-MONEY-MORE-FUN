import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  catalogIsStale,
  displayMerchantName,
  findCombos,
  hiddenBenefitIds,
  matchesQuery,
  rankBenefits,
  REFERENCE_BASKET_ILS,
  type BlockerCode,
  type Combo,
  type Coordinates,
  type Evaluation,
  type UserProfile,
  type Venue,
} from '@sbr/core';
import { Seam } from '../components/Kit';
import { stockFor, Ticket, wallOffset, type TicketSize } from '../components/Ticket';
import { GhostButton, LivePill, SearchField, Text } from '../components/ui';
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
import { deepOf, fonts, space, stock, ticket } from '../theme';

/**
 * How far "here" reaches when the fix lands outside every mall.
 *
 * ponytail: one fixed radius. 500m is roughly a five-minute walk and keeps a
 * Tel Aviv high street from returning half the city — 2258 of the 3925
 * catalogued branches are in Tel Aviv alone. Make it a setting when someone
 * driving complains, not before.
 */
const WALKING_RADIUS_M = 500;

/** Blocked for a reason about this person's list, not about today: never shown. */
const NEVER_LISTED: ReadonlySet<BlockerCode> = new Set<BlockerCode>([
  'program_not_owned',
  'muted',
  'low_confidence',
  // The automatic verifier retired it: a vanished page, self-contradicting
  // terms, or repeated reports. Not "not now" — not at all.
  'rejected',
]);

/** Bone: a combo belongs to two clubs, so it takes neither club's stock. */
const COMBO_STOCK = ticket.stocks[5];

type Row =
  | { kind: 'head'; key: string; title: string }
  | { kind: 'ticket'; key: string; evaluation: Evaluation; size: TicketSize }
  | { kind: 'combo'; key: string; combo: Combo }
  | { kind: 'empty'; key: string }
  | { kind: 'fold'; key: string; count: number };

interface Props {
  profile: UserProfile;
  geofenceStatus: string;
  geofenceActive: boolean;
  onSelect: (evaluation: Evaluation) => void;
  onOpenSettings: () => void;
  onOpenStats: () => void;
  onOpenAdvisor: () => void;
  onOpenWatch: () => void;
}

export function HomeScreen({
  profile,
  geofenceStatus,
  geofenceActive,
  onSelect,
  onOpenSettings,
  onOpenStats,
  onOpenAdvisor,
  onOpenWatch,
}: Props) {
  const [query, setQuery] = useState('');
  const [foldOpen, setFoldOpen] = useState(false);

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

  /** The wall behind the holes holds still on screen while the roll scrolls over it. */
  const scrollY = useRef(new Animated.Value(0)).current;
  const wall = useMemo(() => wallOffset(scrollY), [scrollY]);
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);
  const glide = reduceMotion ? null : wall;

  const owned = useMemo(() => ownedProgramIds(profile.program_ids), [profile.program_ids]);

  // Channel is left unset here: the user isn't at a till or in a checkout yet,
  // so an in-store-only benefit is a note rather than a blocker. Blocked rows are
  // kept this time, because "not now" is an answer worth folding, not hiding.
  const ranked = useMemo(() => {
    const mine = new Set(owned);
    return rankBenefits(
      benefits.filter((b) => mine.has(b.program_id)),
      { now: new Date(), ownedProgramIds: owned, mutedBenefitIds: hiddenBenefitIds(profile) },
      { hideBlocked: false },
    );
  }, [owned, profile.muted_benefit_ids, profile.rejected_benefit_ids]);

  const evaluations = useMemo(() => ranked.filter((e) => e.status !== 'blocked'), [ranked]);
  const notNow = useMemo(
    () =>
      ranked.filter(
        (e) => e.status === 'blocked' && !e.blockers.some((b) => NEVER_LISTED.has(b.code)),
      ),
    [ranked],
  );

  // Checked against the whole catalog rather than the filtered list: the answer
  // is about the bundle's age, not about what this user happens to hold.
  const catalogStale = useMemo(() => catalogIsStale(benefits, new Date()), []);

  // Two offers on one purchase. Kept high in the roll because a combo is the one
  // thing a user cannot work out by scrolling — it only exists between two
  // tickets, never on either of them.
  const combos = useMemo(() => findCombos(evaluations, { limit: 2 }), [evaluations]);

  // Readiness is "nothing left to do", not "no caveats at all" — see Gate
  // in @sbr/core. Counting caveats here would make the number permanently 0.
  const readyCount = useMemo(
    () => evaluations.filter((e) => e.actionsRequired.length === 0).length,
    [evaluations],
  );

  const hereIds = useMemo(() => {
    if (venue) return new Set(benefitsAtVenue(venue.id).map((b) => b.id));
    if (here) return new Set(benefitsNear(here, WALKING_RADIUS_M).map((b) => b.id));
    return null;
  }, [venue, here]);

  // Searched over the trade and city as well as the name, because most of the
  // catalog is businesses nobody has heard of: "מכולת" and "גבעתיים" are how you
  // find one whose name you never knew — the same line the ticket already shows.
  const visible = useCallback(
    (e: Evaluation) =>
      (!hereIds || hereIds.has(e.benefit.id)) &&
      (query.trim() === '' ||
        matchesQuery(
          [e.benefit.merchant_name, merchantLine(e.benefit.merchant_id), programNames[e.benefit.program_id]],
          query,
        )),
    [hereIds, query],
  );

  const shownLive = useMemo(() => evaluations.filter(visible), [evaluations, visible]);
  const shownNotNow = useMemo(() => notNow.filter(visible), [notNow, visible]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const toRow = (evaluation: Evaluation, size: TicketSize): Row => ({
      kind: 'ticket',
      key: evaluation.benefit.id,
      evaluation,
      size,
    });
    // A combo answers the same question as the list under it: both halves have to
    // be here and match the search, or it is an offer for somewhere else.
    const comboRows = combos
      .filter((combo) => combo.parts.every(visible))
      .map((combo): Row => ({ kind: 'combo', key: combo.parts.map((p) => p.benefit.id).join('+'), combo }));
    const ready = shownLive.filter((e) => e.actionsRequired.length === 0);
    const steps = shownLive.filter((e) => e.actionsRequired.length > 0);

    // One big ticket: the answer. Then the combos, then everything else mid, so
    // the first thing that needs doing is not several screens down.
    if (ready.length > 0) {
      out.push({ kind: 'head', key: 'head-ready', title: 'תקף עכשיו' });
      ready.forEach((e, i) => {
        out.push(toRow(e, i === 0 ? 'big' : 'mid'));
        if (i === 0) out.push(...comboRows);
      });
    }
    if (steps.length > 0) {
      out.push({ kind: 'head', key: 'head-steps', title: 'עוד צעד ממך' });
      if (ready.length === 0) out.push(...comboRows);
      steps.forEach((e) => out.push(toRow(e, 'mid')));
    }
    if (shownLive.length === 0) out.push({ kind: 'empty', key: 'empty' });
    if (shownNotNow.length > 0) {
      out.push({ kind: 'fold', key: 'fold', count: shownNotNow.length });
      if (foldOpen) shownNotNow.forEach((e) => out.push(toRow(e, 'slim')));
    }
    return out;
  }, [combos, foldOpen, shownLive, shownNotNow, visible]);

  // Counted off `evaluations`, not the visible rows: this reports what the place
  // is worth to the user, and must not drop as they type in the search below it.
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

  const renderRow = useCallback(
    ({ item }: { item: Row }) => {
      switch (item.kind) {
        case 'head':
          return (
            <Text accessibilityRole="header" style={styles.rollHead}>
              {item.title}
            </Text>
          );
        case 'ticket':
          return (
            <Ticket
              evaluation={item.evaluation}
              size={item.size}
              stock={stockFor(item.evaluation.benefit.program_id, owned)}
              onPress={onSelect}
              glide={glide}
            />
          );
        case 'combo':
          return <ComboTicket combo={item.combo} onPress={() => onSelect(item.combo.parts[0])} />;
        case 'fold':
          return (
            <Pressable
              accessibilityRole="button"
              aria-expanded={foldOpen}
              accessibilityLabel={`לא עכשיו, ${item.count} הטבות`}
              onPress={() => setFoldOpen((open) => !open)}
              style={styles.fold}
            >
              <Text style={styles.foldTitle}>לא עכשיו ({item.count})</Text>
              <Text style={styles.foldAction}>{foldOpen ? 'סגירה' : 'פתיחה'}</Text>
            </Pressable>
          );
        case 'empty':
          return query.trim() !== '' ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>אין תוצאות</Text>
              <Text style={styles.emptyBody}>
                {`לא נמצא בית עסק שמתאים ל״${query.trim()}״ מבין ${evaluations.length} ההטבות שלך.`}
              </Text>
              <GhostButton label="נקה חיפוש" onPress={() => setQuery('')} />
            </View>
          ) : (
            <EmptyState
              hasPrograms={profile.program_ids.length > 0}
              here={hereIds && !venue ? here : null}
              catalogStale={catalogStale}
              onEditPrograms={onOpenSettings}
            />
          );
      }
    },
    [
      catalogStale,
      evaluations.length,
      foldOpen,
      glide,
      here,
      hereIds,
      onOpenSettings,
      onSelect,
      owned,
      profile.program_ids.length,
      query,
      venue,
    ],
  );

  const pinned = venue != null || here != null;

  return (
    <View style={styles.screen}>
      {/* FlatList, not map-in-a-ScrollView: someone holding a few clubs has
          thousands of rows, and mounting them all froze the screen on a phone. */}
      <Animated.FlatList
        data={rows}
        keyExtractor={(row: Row) => row.key}
        renderItem={renderRow}
        initialNumToRender={12}
        windowSize={7}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.list}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: Platform.OS !== 'web',
        })}
        ListHeaderComponent={
          <View style={styles.head}>
            <Text accessibilityRole="header" style={styles.title}>
              {pinned ? 'מה אפשר פה עכשיו' : 'מה אפשר עכשיו'}
            </Text>
            {/* The page's thesis in three numbers: how many you can use right now,
                how many wait on a step from you, and how many clubs this is drawn from. */}
            <View style={styles.stats}>
              <Stat figure={readyCount} label="מוכנות" color={ticket.good} />
              <Stat figure={evaluations.length - readyCount} label="דורשות צעד" color={ticket.gold} />
              <Stat figure={owned.length} label="מועדונים" color={ticket.blue} />
            </View>

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

            {/* Geofencing armed is the one genuinely live state in the app, so it
                gets the live marker. Off is plain words: a pill that is always
                there stops meaning "now". */}
            <View style={styles.geofence}>
              {geofenceActive && <LivePill />}
              <Text style={styles.geofenceText}>{geofenceStatus}</Text>
            </View>

            <View style={styles.searchRow}>
              <SearchField
                tone="ink"
                value={query}
                onChange={setQuery}
                placeholder="חיפוש בית עסק, תחום או עיר"
                resultCount={shownLive.length}
              />
            </View>
          </View>
        }
      />

      {/* At the bottom, where a thumb reaches while the other hand holds a wallet. */}
      <View style={styles.actions}>
        <BarAction label="מדדים" onPress={onOpenStats} />
        <BarAction label="מעקב" onPress={onOpenWatch} />
        <BarAction label="שאל" onPress={onOpenAdvisor} primary />
        <BarAction label="הגדרות" onPress={onOpenSettings} />
      </View>
    </View>
  );
}

/**
 * A stackable pair. Printed apart from a benefit: the figure is an *estimate of a
 * combination*, which is a weaker claim than a single ticket's, and the last line
 * says so rather than hiding it.
 */
function ComboTicket({ combo, onPress }: { combo: Combo; onPress: () => void }) {
  const [first, second] = combo.parts;
  const firstName = displayMerchantName(first.benefit.merchant_name);
  const secondName = displayMerchantName(second.benefit.merchant_name);
  const estimate = `₪${Math.round(combo.estimatedSavingIls)}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`שילוב הטבות ב${combo.merchantName}, חיסכון משוער ${Math.round(
        combo.estimatedSavingIls,
      )} שקלים`}
      onPress={onPress}
      style={({ pressed }) => [styles.combo, pressed && styles.pressed]}
    >
      <Seam />
      <View style={styles.comboTop}>
        <View style={styles.comboIdentity}>
          <Text style={styles.comboLine} numberOfLines={1}>
            אפשר לשלב ב{displayMerchantName(combo.merchantName)}
          </Text>
          <Text style={styles.comboName} numberOfLines={2}>
            {first.benefit.merchant_name === second.benefit.merchant_name
              ? `${programNames[first.benefit.program_id]} + ${programNames[second.benefit.program_id]}`
              : `${firstName} + ${secondName}`}
          </Text>
        </View>
        <View style={styles.comboFigureCol}>
          <Text style={styles.comboFigure} numberOfLines={1}>
            {estimate}
          </Text>
          {/* The figure assumes a cart, since a list screen has none. Printed under
              the number, where no line clamp can cut it off. */}
          <Text style={styles.comboLine}>
            {combo.isEstimate ? `יחד, בסל של ₪${REFERENCE_BASKET_ILS}` : 'יחד'}
          </Text>
        </View>
      </View>
      <Text style={styles.comboLine} numberOfLines={1}>
        {first.benefit.conditions.raw_text_summary}
      </Text>
      <Text style={styles.comboLine} numberOfLines={1}>
        {second.benefit.conditions.raw_text_summary}
      </Text>
      <Text style={styles.comboVerdict} numberOfLines={2}>
        {combo.confirmed
          ? 'שני התקנונים מתירים כפל · ההערכה לפי הסדר הפחות מיטיב'
          : combo.caveats.join(' · ')}
      </Text>
    </Pressable>
  );
}

/**
 * "Where are you" — the foreground half of location.
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
          {/* No entry event, no minute — see `dwellMinutes`. */}
          {minute != null && <LivePill minute={minute} />}
          <Text style={styles.whereActiveText} numberOfLines={1}>
            {venue ? venue.name : 'קרוב אליך'} · {count} הטבות כאן
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="הצג הטבות מכל המיקומים"
          onPress={onClear}
          style={styles.whereButton}
        >
          <Text style={styles.whereLabel}>הכול</Text>
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
        style={styles.whereButton}
      >
        {locating ? (
          <ActivityIndicator size="small" color={ticket.onGround} />
        ) : (
          <Text style={styles.whereLabel}>איפה אני?</Text>
        )}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="בחר מיקום מתוך רשימה"
        onPress={onPick}
        style={styles.whereButton}
      >
        <Text style={styles.whereLabel}>בחר מיקום</Text>
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
        <Text style={styles.sheetTitle}>איפה אתה עכשיו?</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="סגור"
          onPress={onClose}
          hitSlop={12}
        >
          <Text style={styles.sheetClose}>סגור</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.sheetList} nestedScrollEnabled keyboardShouldPersistTaps="handled">
        {venues.map((v) => (
          <Pressable
            key={v.id}
            accessibilityRole="button"
            // The city as well as the name: "קניון עזריאלי" alone is three
            // different malls in this list.
            accessibilityLabel={`${v.name}, ${v.city}`}
            onPress={() => onChoose(v)}
            style={({ pressed }) => [styles.sheetRow, pressed && styles.sheetRowPressed]}
          >
            <Text style={styles.sheetRowName}>{v.name}</Text>
            <Text style={styles.sheetClose}>{countAt(v.id)}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function Stat({ figure, label, color }: { figure: number; label: string; color: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statFigure, { color }]}>{figure}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/** One big mint action among two small bone ones: the thumb's first choice is plain. */
function BarAction({ label, onPress, primary }: { label: string; onPress: () => void; primary?: boolean }) {
  const fill = primary ? stock.mint : stock.bone;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.barAction,
        primary && styles.barActionPrimary,
        { backgroundColor: fill, borderBottomColor: deepOf(fill) },
        pressed && styles.barActionPressed,
      ]}
    >
      <Text style={[styles.barLabel, primary && styles.barLabelPrimary]}>{label}</Text>
    </Pressable>
  );
}

function EmptyState({
  hasPrograms,
  here,
  catalogStale,
  onEditPrograms,
}: {
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
        body: 'כל ההטבות אומתו לפני יותר מ-45 יום, ולכן אינן מוצגות כתקפות. עדכן את האפליקציה כדי לקבל קטלוג חדש — הרשימה תחזור מיד.',
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
      : {
          title: 'אין הטבות להצגה',
          body: 'כל ההטבות שלך חסומות כרגע. עדיף רשימה ריקה מהטבה שתגלה בקופה שאינה תקפה.',
        };

  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{copy.title}</Text>
      <Text style={styles.emptyBody}>{copy.body}</Text>
      {!hasPrograms && <GhostButton label="עריכת המועדונים" onPress={onEditPrograms} />}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: ticket.ground },
  list: { paddingBottom: space.s5 },
  pressed: { opacity: 0.86 },

  /* flex-start so a Latin or number-only line aligns with a Hebrew one: see ui.tsx. */
  head: { paddingHorizontal: space.s3, paddingTop: space.s3, gap: space.s2, alignItems: 'flex-start' },
  title: { fontFamily: fonts.display, fontSize: 40, lineHeight: 42, color: ticket.onGround },
  count: { fontFamily: fonts.latinText, fontSize: 15, lineHeight: 22, color: ticket.onGround2 },
  countFigure: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: ticket.punch,
    fontVariant: ['tabular-nums', 'lining-nums'],
  },
  geofence: { flexDirection: 'row', alignItems: 'center', gap: space.s2 },
  geofenceText: { flexShrink: 1, fontFamily: fonts.latinText, fontSize: 13.5, lineHeight: 19, color: ticket.muted },
  /* SearchField brings its own 24dp gutter for the paper screens; here it lines up
     with the rest of the header instead. */
  searchRow: { alignSelf: 'stretch', marginHorizontal: -space.s4 },

  whereRow: { flexDirection: 'row', alignItems: 'center', gap: space.s2, alignSelf: 'stretch' },
  whereButton: {
    minHeight: 44,
    paddingHorizontal: space.s3,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: ticket.muted,
  },
  whereLabel: { fontFamily: fonts.latinText, fontSize: 14, color: ticket.onGround },
  /* A pinned place is a fact, so it reads as a filled plate rather than an outline. */
  whereActive: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s2,
    paddingHorizontal: space.s3 - 4,
    backgroundColor: ticket.ground3,
  },
  whereActiveText: { flexShrink: 1, fontFamily: fonts.latinText, fontSize: 14, color: ticket.onGround },

  sheet: { alignSelf: 'stretch', borderWidth: 1, borderColor: ticket.muted, backgroundColor: ticket.ground2 },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.s3,
    paddingVertical: space.s2 + 2,
    borderBottomWidth: 1,
    borderBottomColor: ticket.rule,
  },
  sheetTitle: { fontFamily: fonts.display, fontSize: 17, lineHeight: 22, color: ticket.onGround },
  sheetClose: { fontFamily: fonts.latinText, fontSize: 14, color: ticket.onGround2 },
  sheetList: { maxHeight: 260 },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: space.s3,
    borderBottomWidth: 1,
    borderBottomColor: ticket.rule,
  },
  sheetRowPressed: { backgroundColor: ticket.ground3 },
  sheetRowName: { fontFamily: fonts.latinText, fontSize: 15, color: ticket.onGround },

  rollHead: {
    fontFamily: fonts.display,
    fontSize: 22,
    lineHeight: 27,
    color: ticket.onGround,
    paddingHorizontal: space.s3,
    paddingTop: space.s4,
    paddingBottom: space.s2 + 2,
    alignSelf: 'flex-start',
  },

  combo: {
    backgroundColor: COMBO_STOCK,
    paddingHorizontal: space.s3,
    paddingVertical: space.s3 - 2,
    gap: space.s1,
    alignItems: 'flex-start',
  },
  comboTop: { flexDirection: 'row', alignItems: 'flex-start', columnGap: space.s2 + 4, alignSelf: 'stretch' },
  comboIdentity: { flex: 1, minWidth: 0, alignItems: 'flex-start' },
  comboName: { fontFamily: fonts.text, fontSize: 22, lineHeight: 27, color: ticket.ink },
  comboLine: { fontFamily: fonts.latinText, fontSize: 13.5, lineHeight: 19, color: ticket.ink2 },
  comboFigureCol: { alignItems: 'flex-end', flexShrink: 0 },
  comboFigure: {
    fontFamily: fonts.display,
    fontSize: 44,
    lineHeight: 46,
    color: ticket.ink,
    writingDirection: 'ltr',
    fontVariant: ['tabular-nums', 'lining-nums'],
  },
  comboVerdict: { fontFamily: fonts.display, fontSize: 14, lineHeight: 19, color: ticket.ink, marginTop: space.s1 },

  fold: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: space.s3,
    marginTop: space.s3,
  },
  foldTitle: { fontFamily: fonts.display, fontSize: 22, lineHeight: 27, color: ticket.onGround },
  foldAction: { fontFamily: fonts.latinText, fontSize: 14, color: ticket.onGround2, textDecorationLine: 'underline' },

  empty: { paddingHorizontal: space.s3, paddingVertical: space.s5, gap: space.s3 - 2, alignItems: 'flex-start' },
  emptyTitle: { fontFamily: fonts.display, fontSize: 26, lineHeight: 30, color: ticket.onGround },
  emptyBody: { fontFamily: fonts.latinText, fontSize: 15, lineHeight: 22, color: ticket.onGround2 },

  stats: { flexDirection: 'row', alignSelf: 'stretch', columnGap: space.s3, paddingTop: space.s1 },
  stat: { flexDirection: 'row', alignItems: 'baseline', columnGap: space.s1 + 2 },
  statFigure: {
    fontFamily: fonts.display,
    fontSize: 34,
    lineHeight: 36,
    fontVariant: ['tabular-nums', 'lining-nums'],
  },
  statLabel: { fontFamily: fonts.latinText, fontSize: 13, lineHeight: 18, color: ticket.onGround2 },

  actions: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    columnGap: space.s2 + 2,
    paddingHorizontal: space.s3 - 4,
    paddingTop: space.s2 + 2,
    paddingBottom: space.s3 - 4,
    borderTopWidth: 1,
    borderTopColor: ticket.rule,
    backgroundColor: ticket.ground,
  },
  barAction: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 4 },
  barActionPrimary: { flex: 1.5, minHeight: 62, borderBottomWidth: 5 },
  barActionPressed: { transform: [{ translateY: 3 }] },
  barLabel: { fontFamily: fonts.display, fontSize: 21, lineHeight: 26, color: ticket.ink },
  barLabelPrimary: { fontSize: 28, lineHeight: 32 },
});
