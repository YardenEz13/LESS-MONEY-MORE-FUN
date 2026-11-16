import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import {
  extendWatch,
  firstUrl,
  formatPriceVerdict,
  isWatchExpired,
  matchesQuery,
  priceVerdict,
  type WatchItem,
} from '@sbr/core';
import { GhostButton, ListRow, Panel, PrimaryButton, ScreenHeader, SearchField, Text } from '../components/ui';
import { merchants } from '../services/catalog';
import { addWatchFromUrl, checkWatches, currentOfferIds } from '../services/watch';
import { WATCH_PRIVACY } from '../services/watchCopy';
import { logEvent } from '../state/events';
import { addWatch, loadWatchStore, removeWatch, updateWatch, type WatchStore } from '../state/watchlist';
import { colors, space, ticket, type } from '../theme';

const HOUR_MS = 3_600_000;
const MAX_MERCHANT_RESULTS = 20;

/** "לפני שעתיים", "לפני 3 ימים" — how old a reading is, in the words people use. */
function ago(ms: number): string {
  const hours = Math.floor(ms / HOUR_MS);
  if (hours < 1) return 'לפני פחות משעה';
  if (hours === 1) return 'לפני שעה';
  if (hours === 2) return 'לפני שעתיים';
  if (hours < 24) return `לפני ${hours} שעות`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'אתמול' : `לפני ${days} ימים`;
}

/**
 * The status of an item as one plain sentence. Order matters: what the person
 * has to act on (expired) outranks what happened last (an alert), which outranks
 * housekeeping (when it was checked). Always words — never a colour alone.
 */
function statusLine(item: WatchItem, store: WatchStore, now: number): string {
  if (isWatchExpired(item, new Date(now))) return 'פג תוקף — להמשיך?';
  if (item.paused) return 'בהשהיה';
  if (!item.url) return 'עוקב אחרי הטבות חדשות בלבד';
  const reason = store.unreadable[item.id];
  const hasPrice = (store.history[item.id]?.length ?? 0) > 0;
  const checked = store.checked[item.id];
  if (reason && !hasPrice) {
    return reason === 'no_price'
      ? 'אין מחיר בדף — האתר לא מפרסם אותו בצורה שאפשר לקרוא'
      : 'לא הצלחנו לקרוא את הדף — ננסה שוב';
  }
  if (item.last_alert) return `נשלחה התראה ${ago(now - Date.parse(item.last_alert.at))}`;
  if (checked != null) return `נבדק ${ago(now - checked)}`;
  return 'עוד לא נבדק';
}

interface Props {
  onBack: () => void;
}

/**
 * "Tell me when it is cheaper." The list of things the person follows, and the
 * one place they are added, edited and removed.
 *
 * The page address, sizes and prices never leave the phone; the copy at the
 * top of the empty and add states says so, because a feature that opens shop
 * pages on your behalf owes you a sentence on what it does and does not send.
 * Stock is never claimed: a product page speaks for the product, not for a size
 * in a branch, and the alerts say "stock unknown" for that reason.
 */
export function WatchScreen({ onBack }: Props) {
  const [store, setStore] = useState<WatchStore | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [mode, setMode] = useState<'list' | 'add'>('list');
  const [editing, setEditing] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const reload = useCallback(async () => {
    setStore(await loadWatchStore());
    setNow(Date.now());
  }, []);

  // Open → show what is saved at once, then check, then show what the check found.
  useEffect(() => {
    void (async () => {
      await reload();
      await checkWatches();
      await reload();
    })();
  }, [reload]);

  const refresh = async () => {
    setRefreshing(true);
    await checkWatches(new Date(), { manual: true });
    await reload();
    setRefreshing(false);
  };

  if (!store) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <ActivityIndicator color={colors.surfacePrimary} />
      </View>
    );
  }

  if (mode === 'add') {
    return (
      <AddWatch
        onCancel={() => setMode('list')}
        onAdded={async () => {
          setMode('list');
          await reload();
        }}
      />
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        <ScreenHeader eyebrow="מחיר והטבות" title="רשימת מעקב" onBack={onBack} />

        {store.items.length === 0 ? (
          <Panel>
            <Text style={type.displaySmall}>עוד לא עוקבים אחרי כלום</Text>
            <Text style={type.body}>
              הדביקו קישור למוצר ואנחנו נבדוק את המחיר מדי פעם ונתריע כשהוא יורד. אפשר גם
              לעקוב אחרי חנות כדי לשמוע על הטבה חדשה בה.
            </Text>
            <Text style={type.caption}>{WATCH_PRIVACY}</Text>
          </Panel>
        ) : (
          <View>
            {store.items.map((item) => (
              <WatchRow
                key={item.id}
                item={item}
                store={store}
                now={now}
                open={editing === item.id}
                onToggle={() => setEditing(editing === item.id ? null : item.id)}
                onChanged={reload}
              />
            ))}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="הוסף למעקב" onPress={() => setMode('add')} />
      </View>
    </View>
  );
}

function WatchRow({
  item,
  store,
  now,
  open,
  onToggle,
  onChanged,
}: {
  item: WatchItem;
  store: WatchStore;
  now: number;
  open: boolean;
  onToggle: () => void;
  onChanged: () => Promise<void>;
}) {
  const history = store.history[item.id] ?? [];
  const verdict = priceVerdict(history, new Date(now));
  const expired = isWatchExpired(item, new Date(now));
  const detail = [item.size ? `מידה ${item.size}` : null, item.color].filter(Boolean).join(' · ');

  return (
    <View>
      <ListRow
        onPress={onToggle}
        selected={open}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}. ${statusLine(item, store, now)}`}
        accessibilityState={{ expanded: open }}
      >
        <View style={styles.rowBody}>
          <Text style={type.bodyStrong} numberOfLines={2}>
            {item.title}
          </Text>
          {detail !== '' && <Text style={type.caption}>{detail}</Text>}
          {item.url && verdict.kind !== 'no_price' && (
            <Text style={type.small}>{formatPriceVerdict(verdict)}</Text>
          )}
          {item.target_price != null && (
            <Text style={type.caption}>{`יעד: ₪${item.target_price}`}</Text>
          )}
          <Text style={type.caption}>{statusLine(item, store, now)}</Text>
        </View>
        <Text style={styles.chevron}>{open ? '⌃' : '⌄'}</Text>
      </ListRow>

      {expired && (
        <Panel>
          <Text style={type.small}>המעקב הזה הסתיים אחרי 90 יום. רוצים להמשיך?</Text>
          <GhostButton
            label="המשך לעקוב"
            onPress={async () => {
              await updateWatch(item.id, (current) => extendWatch(current, new Date()));
              await onChanged();
            }}
          />
        </Panel>
      )}

      {open && <EditPanel item={item} onChanged={onChanged} />}
    </View>
  );
}

function EditPanel({ item, onChanged }: { item: WatchItem; onChanged: () => Promise<void> }) {
  const [size, setSize] = useState(item.size ?? '');
  const [color, setColor] = useState(item.color ?? '');
  const [target, setTarget] = useState(item.target_price != null ? String(item.target_price) : '');
  const [confirmRemove, setConfirmRemove] = useState(false);

  const parsedTarget = Number(target.replace(',', '.'));
  const targetOk = target.trim() === '' || (Number.isFinite(parsedTarget) && parsedTarget > 0);

  return (
    <Panel>
      <Field label="מידה" value={size} onChange={setSize} placeholder="למשל: 42" />
      <Field label="צבע" value={color} onChange={setColor} placeholder="למשל לבן" />
      <Field
        label="תן לי לדעת כשהמחיר בשקלים הוא עד"
        value={target}
        onChange={setTarget}
        placeholder="לא חובה"
        keyboardType="decimal-pad"
        invalid={!targetOk}
      />
      {!targetOk && <Text style={type.caption}>כתבו מספר, למשל 249</Text>}
      <View style={styles.actions}>
        <GhostButton
          label="שמור"
          onPress={async () => {
            if (!targetOk) return;
            await updateWatch(item.id, (current) => ({
              ...current,
              size: size.trim() || null,
              color: color.trim() || null,
              target_price: target.trim() === '' ? null : parsedTarget,
            }));
            await onChanged();
          }}
        />
        <GhostButton
          label={item.paused ? 'הפעל מעקב' : 'השהה'}
          onPress={async () => {
            await updateWatch(item.id, (current) => ({ ...current, paused: !current.paused }));
            await onChanged();
          }}
        />
        <GhostButton
          label={confirmRemove ? 'בטוח? הסר' : 'הסר'}
          onPress={async () => {
            if (!confirmRemove) {
              setConfirmRemove(true);
              return;
            }
            await removeWatch(item.id);
            await onChanged();
          }}
        />
      </View>
    </Panel>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  keyboardType?: 'decimal-pad';
  invalid?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={type.caption}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textDisabled}
        style={[styles.input, invalid && styles.inputInvalid]}
        keyboardType={keyboardType}
        textAlign="right"
        accessibilityLabel={label}
      />
    </View>
  );
}

/**
 * Add: a link follows a price; free text follows a shop's offers and needs the
 * shop picked, because without a page there is no domain to find it from.
 */
function AddWatch({ onCancel, onAdded }: { onCancel: () => void; onAdded: () => Promise<void> }) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const url = firstUrl(text);
  const typed = text.trim();

  const matches = useMemo(
    () =>
      query.trim() === ''
        ? []
        : merchants.filter((m) => matchesQuery([m.name, m.label], query)),
    [query],
  );

  const addUrl = async (link: string) => {
    setBusy(true);
    setNote(null);
    const { existing, read } = await addWatchFromUrl(link);
    setBusy(false);
    if (existing) {
      setNote('הפריט הזה כבר ברשימה.');
      return;
    }
    // Saved either way. Said plainly when the price could not be read, so the
    // list that follows is not a surprise.
    if (read && !read.ok) {
      setNote(
        read.reason === 'no_price'
          ? 'נשמר, אבל אין מחיר שאפשר לקרוא בדף הזה. נמשיך לעקוב אחרי הטבות בחנות.'
          : 'נשמר, אבל לא הצלחנו לפתוח את הדף עכשיו. ננסה שוב בהמשך.',
      );
      // Leave the note on screen for a moment: leaving at once would hide it.
      setTimeout(() => void onAdded(), 2500);
      return;
    }
    await onAdded();
  };

  const addTyped = async (merchantId: string) => {
    setBusy(true);
    const seenBenefitIds = await currentOfferIds(merchantId);
    await addWatch({ title: typed, merchantId, seenBenefitIds });
    await logEvent({ kind: 'watch_added' });
    setBusy(false);
    await onAdded();
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ScreenHeader eyebrow="רשימת מעקב" title="מה לעקוב?" onBack={onCancel} />

        <View style={styles.addField}>
          <TextInput
            value={text}
            onChangeText={(value) => {
              setText(value);
              setNote(null);
            }}
            editable={!busy}
            placeholder="הדביקו קישור, או כתבו: חולצה לבנה בזארה"
            placeholderTextColor={colors.textDisabled}
            style={[styles.input, styles.addInput]}
            multiline
            textAlign="right"
            accessibilityLabel="קישור למוצר או תיאור"
          />
        </View>

        <Panel style={styles.privacy}>
          <Text style={type.caption}>{WATCH_PRIVACY}</Text>
        </Panel>

        {busy && (
          <View style={styles.pending}>
            <ActivityIndicator color={colors.surfacePrimary} />
            <Text style={type.caption}>קורא את הדף…</Text>
          </View>
        )}

        {note && (
          <Panel>
            <Text style={type.small}>{note}</Text>
          </Panel>
        )}

        {!busy && !url && typed !== '' && (
          <>
            <Text style={styles.lede}>
              בלי קישור אין מחיר לקרוא. נעקוב אחרי הטבות חדשות בחנות — באיזו חנות מדובר?
            </Text>
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder="חיפוש חנות"
              resultCount={matches.length}
            />
            <View>
              {matches.slice(0, MAX_MERCHANT_RESULTS).map((merchant) => (
                <ListRow
                  key={merchant.id}
                  accessibilityRole="button"
                  accessibilityLabel={`עקוב אחרי ${typed} ב${merchant.name}`}
                  onPress={() => void addTyped(merchant.id)}
                >
                  <Text style={[type.body, styles.rowBody]}>{merchant.name}</Text>
                </ListRow>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {url ? (
          <PrimaryButton label="עקוב אחרי המחיר" disabled={busy} onPress={() => void addUrl(url)} />
        ) : (
          <PrimaryButton label="חזרה לרשימה" tone="plate" onPress={onCancel} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: ticket.ground },
  centered: { alignItems: 'center', justifyContent: 'center' },
  content: { paddingBottom: space.s5, gap: space.s3 },
  footer: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: ticket.rule },
  /* minWidth 0 so a long title wraps inside the row instead of widening it. */
  rowBody: { flex: 1, minWidth: 0, gap: 2, alignItems: 'flex-start' },
  chevron: { ...type.body, color: ticket.muted },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s2, alignSelf: 'stretch' },
  field: { alignSelf: 'stretch', gap: 2 },
  input: {
    ...type.body,
    borderWidth: 1,
    borderColor: ticket.muted,
    paddingHorizontal: space.s3,
    paddingVertical: space.s2,
    minHeight: 48,
  },
  inputInvalid: { borderColor: colors.cardRedText },
  addField: { paddingHorizontal: space.s3 },
  addInput: { minHeight: 72 },
  privacy: { backgroundColor: ticket.ground3 },
  pending: { paddingVertical: space.s3, alignItems: 'center', gap: space.s1 },
  lede: { ...type.body, paddingHorizontal: space.s3 },
});
