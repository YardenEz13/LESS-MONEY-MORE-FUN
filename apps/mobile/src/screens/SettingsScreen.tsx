import React, { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import type { UserProfile } from '@sbr/core';
import { GhostButton, ScreenHeader, Section, Text } from '../components/ui';
import { programsById, venues } from '../services/catalog';
import { handleVenueEnter } from '../services/geofencing';
import { border, colors, radius, space, type } from '../theme';

interface Props {
  profile: UserProfile;
  geofenceStatus: string;
  /** The failure is one only the OS settings page can clear — see App.tsx. */
  geofenceFixable: boolean;
  onChange: (profile: UserProfile) => void;
  onEditPrograms: () => void;
  onEnableGeofencing: () => void;
  onClearRejections: () => void;
  onBack: () => void;
}


export function SettingsScreen({
  profile,
  geofenceStatus,
  geofenceFixable,
  onChange,
  onEditPrograms,
  onEnableGeofencing,
  onClearRejections,
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

      {/* The report loop's other half. A tap in the app cannot reach the
          catalog on its own — there is no backend — so the ids have to be
          readable here and handed to `npm run unpublish`, which is what moves
          them out of the shipped catalog and back into the review queue.
          Without this the button would only be a mute wearing a bug report's
          name. Hidden entirely until something has been reported. */}
      {profile.rejected_benefit_ids.length > 0 && (
        <Section eyebrow="הטבות שדיווחת עליהן">
          <View style={styles.card}>
            <Text style={type.body}>
              {`${profile.rejected_benefit_ids.length} הטבות סומנו כשגויות והוסתרו. כדי להוציא אותן מהקטלוג, הריצו:`}
            </Text>
            <Text selectable style={styles.command}>
              {`npm run unpublish -- ${profile.rejected_benefit_ids.join(' ')}`}
            </Text>
            <GhostButton label="נקה את הרשימה" onPress={onClearRejections} />
          </View>
        </Section>
      )}

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
              accessibilityLabel={`הרצת בדיקה: ${venue.name}, ${venue.city}`}
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
              הופעלה כניסה ל{simulated}. ההתראה נשלחת בעוד 3 דקות — זהו סף השהייה, והוא נמדד
              על ידי מערכת ההפעלה. אם לא הגיעה גם אחריהן, הצינון של 12 שעות או שעות השקט חסמו
              אותה, וזו התנהגות תקינה.
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
  /* Monospace and selectable: this exists to be copied out of the app, and a
     benefit id in the body face is a line nobody can transcribe correctly. */
  command: {
    ...type.small,
    fontFamily: 'monospace',
    backgroundColor: colors.surfaceInset,
    padding: space.s2,
    borderRadius: radius.sharp,
  },
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
