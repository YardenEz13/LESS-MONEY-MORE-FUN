import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { BASKET_PRESETS_ILS } from '@sbr/core';
import { Text } from './ui';
import { fonts, space, stock, ticket } from '../theme';

interface Props {
  /** Active basket amount in ILS, or null when no basket is selected. */
  amount: number | null;
  onChange: (amount: number | null) => void;
  /** Visual surface context: 'paper' on HomeScreen, 'stock' on full-bleed TillScreen. */
  surface?: 'paper' | 'stock';
  /** Allow tapping the active preset again to clear back to null. */
  clearable?: boolean;
}

/**
 * One-tap basket amount strip (`₪50 / ₪100 / ₪200 / ₪350` + custom input).
 *
 * Flat NeoPOP punch-ticket geometry: 90° edges, 1px ink rules, 3px hard bottom
 * offset, zero blur. Tapping an amount immediately prices every offer and combo.
 */
export function BasketStrip({
  amount,
  onChange,
  surface = 'paper',
  clearable = true,
}: Props) {
  const isPreset = amount != null && (BASKET_PRESETS_ILS as readonly number[]).includes(amount);
  const [customOpen, setCustomOpen] = useState(amount != null && !isPreset);
  const [draft, setDraft] = useState(amount != null && !isPreset ? String(amount) : '');

  useEffect(() => {
    if (amount == null) {
      setDraft('');
      return;
    }
    if ((BASKET_PRESETS_ILS as readonly number[]).includes(amount)) {
      setCustomOpen(false);
      setDraft('');
    }
  }, [amount]);

  const selectPreset = (preset: number) => {
    setCustomOpen(false);
    setDraft('');
    if (clearable && amount === preset) onChange(null);
    else onChange(preset);
  };

  const handleCustomText = (text: string) => {
    const digits = text.replace(/[^\d]/g, '').slice(0, 5);
    setDraft(digits);
    const parsed = Number(digits);
    if (digits !== '' && Number.isFinite(parsed) && parsed > 0) {
      onChange(parsed);
    } else if (clearable) {
      onChange(null);
    }
  };

  const chipBg = surface === 'stock' ? ticket.ground : ticket.ground2;
  const chipDrop = surface === 'stock' ? ticket.ink : ticket.rule;

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {BASKET_PRESETS_ILS.map((preset) => {
          const active = !customOpen && amount === preset;
          return (
            <Pressable
              key={preset}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`סל של ${preset} שקלים`}
              onPress={() => selectPreset(preset)}
              style={({ pressed }) => [
                styles.chip,
                { backgroundColor: active ? ticket.ink : chipBg, borderBottomColor: active ? ticket.ink : chipDrop },
                pressed && styles.pressedDown,
              ]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>₪{preset}</Text>
            </Pressable>
          );
        })}

        {customOpen ? (
          <View style={[styles.customBox, { backgroundColor: ticket.ground }]}>
            <Text style={styles.shekel}>₪</Text>
            <TextInput
              value={draft}
              onChangeText={handleCustomText}
              placeholder="סכום"
              placeholderTextColor={ticket.muted}
              keyboardType="numeric"
              returnKeyType="done"
              autoFocus
              accessibilityLabel="סכום סל מותאם בשקלים"
              style={styles.customInput}
            />
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="הזנת סכום סל אחר"
            onPress={() => {
              setCustomOpen(true);
              setDraft(amount != null && !isPreset ? String(amount) : '');
            }}
            style={({ pressed }) => [
              styles.chip,
              styles.customTrigger,
              {
                backgroundColor: amount != null && !isPreset ? ticket.ink : chipBg,
                borderBottomColor: amount != null && !isPreset ? ticket.ink : chipDrop,
              },
              pressed && styles.pressedDown,
            ]}
          >
            <Text style={[styles.chipText, amount != null && !isPreset && styles.chipTextActive]}>
              {amount != null && !isPreset ? `₪${amount}` : 'אחר'}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch' },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 6,
    alignSelf: 'stretch',
  },
  chip: {
    flex: 1,
    minHeight: 40,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: ticket.ink,
    borderBottomWidth: 3,
  },
  customTrigger: { flex: 1.05 },
  pressedDown: { transform: [{ translateY: 2 }] },
  chipText: {
    fontFamily: fonts.display,
    fontSize: 18,
    lineHeight: 22,
    color: ticket.ink,
    writingDirection: 'ltr',
    fontVariant: ['tabular-nums', 'lining-nums'],
  },
  chipTextActive: { color: stock.marigold },
  customBox: {
    flex: 1.4,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.s2,
    borderWidth: 2,
    borderColor: ticket.ink,
    gap: 2,
  },
  shekel: {
    fontFamily: fonts.display,
    fontSize: 18,
    lineHeight: 22,
    color: ticket.ink,
  },
  customInput: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    fontFamily: fonts.display,
    fontSize: 18,
    lineHeight: 22,
    color: ticket.ink,
    writingDirection: 'ltr',
    textAlign: 'left',
  },
});
