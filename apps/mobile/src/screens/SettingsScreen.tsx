import React, { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import type { UserProfile } from '@sbr/core';
import { ScarfBand } from '../components/Kit';
import { GhostButton, ScreenHeader, Section, Text } from '../components/ui';
import { programsById, venues } from '../services/catalog';
import { handleVenueEnter } from '../services/geofencing';
import { border, colors, radius, space, type, type KitIntensity } from '../theme';

interface Props {
  profile: UserProfile;
  geofenceStatus: string;
  /** The failure is one only the OS settings page can clear — see App.tsx. */
  geofenceFixable: boolean;
  kitIntensity: KitIntensity;
  onChange: (profile: UserProfile) => void;
  onChangeKit: (intensity: KitIntensity) => void;
  onEditPrograms: () => void;
  onEnableGeofencing: () => void;
  onBack: () => void;
}

const KIT_OPTIONS: ReadonlyArray<{ value: KitIntensity; label: string; hint: string }> = [
  { value: 'full', label: 'מלא', hint: 'פסים גלויים, צעיף מלא, מספרים בגודל לוח תוצאות.' },
  { value: 'quiet', label: 'מאופק', hint: 'אותם צבעים ואותה פריסה, ברבע עוצמה.' },
];

export function SettingsScreen({
  profile,
  geofenceStatus,
  geofenceFixable,
  kitIntensity,
  onChange,
  onChangeKit,
  onEditPrograms,
  onEnableGeofencing,
  onBack,
}: Props) {
  const [simulated, setSimulated] = useState<string | null>(null);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <ScreenHeader title="הגדרות" onBack={onBack} />

      <Section eyebrow="המועדונים שלי">
        <View style={styles.card}>
          <Text style={type.body}>
            {profile.program_ids.length === 0
              ? 'לא סומן אף מועדון.'
              : profile.program_ids.map((id) => programsById.get(id)?.name ?? id).join(' · ')}
          </Text>
          <GhostButton label="ערוך רשימה" onPress={onEditPrograms} />
        </View>
      </Section>

      {/* Two readings of one screen, both real: nothing moves between them, so
          this changes the volume and never the layout. Default is מלא — the kit
          is the product's face, and quiet is a choice rather than a retreat. */}
      <Section eyebrow="עוצמת המדים">
        <View style={styles.card}>
          <View style={styles.kitRow}>
            {KIT_OPTIONS.map((option) => {
              const active = option.value === kitIntensity;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  /* `checked`, not `selected`: a radio announces checkedness,
                     and react-native-web maps `selected` to an aria attribute
                     that role="radio" does not carry. */
                  accessibilityState={{ checked: active }}
                  onPress={() => onChangeKit(option.value)}
                  style={[styles.kitOption, active && styles.kitOptionOn]}
                >
                  <Text style={[type.bodyStrong, active && styles.kitLabelOn]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={type.small}>
            {KIT_OPTIONS.find((o) => o.value === kitIntensity)?.hint}
          </Text>
          {/* The control shows its own result: the scarf below is drawn at the
              intensity just chosen, so the choice is legible before leaving. */}
          <ScarfBand />
        </View>
      </Section>

      <Section eyebrow="תזכורת בקניון">
        <View style={styles.card}>
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={type.bodyStrong}>התראות מיקום</Text>
              <Text style={type.caption}>{geofenceStatus}</Text>
            </View>
            <Switch
              accessibilityLabel="התראות מיקום"
              value={profile.notifications_enabled}
              trackColor={{ true: colors.surfacePrimary, false: colors.borderHairline }}
              onValueChange={(value) => onChange({ ...profile, notifications_enabled: value })}
            />
          </View>
          {/* The privacy sentence has to keep up with the mechanism: choosing
              the fences now reads the device's last known position, which the
              old wording did not describe. It is still read on-device and still
              never sent, and saying so precisely is the point of saying it. */}
          <Text style={type.small}>
            עד 20 המקומות הקרובים אליך במעקב — קניונים והסניפים שבהם יש לך הטבה. הבחירה נעשית
            על המכשיר לפי המיקום האחרון שלו, ומערכת ההפעלה מודיעה לנו רק על כניסה לאחד מהם.
            אנחנו לא עוקבים אחרי המיקום שלך, ושום דבר לא נשלח החוצה.
          </Text>
          {/* Retrying in-app cannot clear these two — the grant they need only
              exists on the OS settings page, so that is where the button goes. */}
          {geofenceFixable ? (
            <GhostButton label="פתח הגדרות" onPress={() => void Linking.openSettings()} />
          ) : (
            <GhostButton label="הפעל מחדש" onPress={onEnableGeofencing} />
          )}
        </View>
      </Section>

      <Section eyebrow="בדיקה ידנית">
        <View style={styles.card}>
          <Text style={type.small}>
            הרצת זרימת ההתראה בלי לנסוע לקניון. עוברת דרך אותו קוד החלטה — שהייה, צינון, שעות שקט.
          </Text>
        </View>
        <View style={styles.venues}>
          {venues.map((venue) => (
            <Pressable
              key={venue.id}
              accessibilityRole="button"
              onPress={async () => {
                await handleVenueEnter(venue.id);
                setSimulated(venue.name);
              }}
              style={styles.venueRow}
            >
              <Text style={type.body}>{venue.name}</Text>
              <Text style={type.caption}>{venue.city}</Text>
            </Pressable>
          ))}
        </View>
        {simulated && (
          <View style={styles.hint}>
            <View style={styles.hintBar} />
            <Text style={styles.hintText}>
              הופעלה כניסה ל{simulated}. אם לא הגיעה התראה — סף השהייה של 3 דקות או הצינון של 12
              שעות חסם אותה, וזו התנהגות תקינה.
            </Text>
          </View>
        )}
      </Section>

      <Section eyebrow="פרטיות">
        <View style={styles.card}>
          <Text style={type.small}>
            אין חשבון, אין שרת, אין ת״ז. הפרופיל, יומן האינטראקציות והקטלוג יושבים על המכשיר.
            מחיקת האפליקציה מוחקת הכול.
          </Text>
          <Text style={type.bodyStrong}>חריג אחד: העוזר החכם</Text>
          <Text style={type.small}>
            כששואלים שאלה במסך ״שאל״, השאלה יחד עם רשימת המועדונים שסימנת וההטבות התואמות
            נשלחות ל-Gemini של Google כדי לנסח תשובה. רשימת המועדונים מעידה על דברים אישיים —
            ״חבר״ מעיד על שירות קבע, ״הייטקזון״ על מקום העבודה. שום דבר לא נשלח עד שתשאלו,
            ואפשר להשתמש באפליקציה כרגיל בלי המסך הזה.
          </Text>
        </View>
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfacePage },
  content: { paddingBottom: space.s6, gap: space.s4 },
  card: {
    marginHorizontal: space.s4,
    borderRadius: radius.sharp,
    borderWidth: border.hairline,
    borderColor: colors.borderHairline,
    padding: space.s3,
    gap: space.s3 - 4,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.s3 - 4,
  },
  switchText: { flex: 1, gap: 2 },
  kitRow: { flexDirection: 'row', gap: space.s2 },
  kitOption: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space.s2 + 2,
    borderWidth: border.hairline,
    borderColor: colors.borderHairline,
    borderRadius: radius.sharp,
  },
  kitOptionOn: { backgroundColor: colors.surfaceAccent, borderColor: colors.surfaceAccent },
  kitLabelOn: { color: colors.textInverse },
  venues: {
    marginHorizontal: space.s4,
    borderRadius: radius.sharp,
    borderWidth: border.hairline,
    borderColor: colors.borderHairline,
  },
  venueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.s3,
    paddingVertical: space.s3 - 4,
    paddingHorizontal: space.s3,
    borderBottomWidth: border.hairline,
    borderBottomColor: colors.borderHairlineSoft,
  },
  /* A note, not an alarm: the marker bar carries it, no coloured field. */
  hint: {
    marginHorizontal: space.s4,
    flexDirection: 'row',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sharp,
  },
  hintBar: { width: border.marker, backgroundColor: colors.accentUrgent },
  hintText: { ...type.small, flex: 1, padding: space.s3 },
});
