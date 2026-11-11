import React, { useState } from 'react';
import { Linking, ScrollView, StyleSheet, Switch, View } from 'react-native';
import type { UserProfile } from '@sbr/core';
import { GhostButton, ListRow, Panel, ScreenHeader, Section, Text } from '../components/ui';
import { programsById, venues } from '../services/catalog';
import { WATCH_PRIVACY } from '../services/watchCopy';
import { handleVenueEnter } from '../services/geofencing';
import { colors, space, ticket, type } from '../theme';

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

/**
 * Every block here is a `Panel` or a run of `ListRow`s, the same pieces the roll
 * is built from: no outlined boxes, a 16dp gutter, display heads.
 */
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
        <Panel>
          <Text style={type.body}>
            {profile.program_ids.length === 0
              ? 'לא סומן אף מועדון.'
              : profile.program_ids.map((id) => programsById.get(id)?.name ?? id).join(' · ')}
          </Text>
          <GhostButton label="ערוך רשימה" onPress={onEditPrograms} />
        </Panel>
      </Section>

      {/* The report loop's other half. A tap in the app cannot reach the
          catalog on its own — there is no backend — so the ids have to be
          readable here and handed to `npm run unpublish`, which is what moves
          them out of the shipped catalog and back into the review queue.
          Without this the button would only be a mute wearing a bug report's
          name. Hidden entirely until something has been reported. */}
      {profile.rejected_benefit_ids.length > 0 && (
        <Section eyebrow="הטבות שדיווחת עליהן">
          <Panel>
            <Text style={type.body}>
              {`${profile.rejected_benefit_ids.length} הטבות סומנו כשגויות והוסתרו. כדי להוציא אותן מהקטלוג, הריצו:`}
            </Text>
            <Text selectable style={styles.command}>
              {`npm run unpublish -- ${profile.rejected_benefit_ids.join(' ')}`}
            </Text>
            <GhostButton label="נקה את הרשימה" onPress={onClearRejections} />
          </Panel>
        </Section>
      )}

      <Section eyebrow="תזכורת בקניון">
        <Panel>
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={type.bodyStrong}>התראות מיקום</Text>
              <Text style={type.caption}>{geofenceStatus}</Text>
            </View>
            <Switch
              accessibilityLabel="התראות מיקום"
              value={profile.notifications_enabled}
              trackColor={{ true: colors.surfacePrimary, false: ticket.rule }}
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
        </Panel>
      </Section>

      <Section eyebrow="בדיקה ידנית">
        <Panel>
          <Text style={type.small}>
            הרצת זרימת ההתראה בלי לנסוע לקניון. עוברת דרך אותו קוד החלטה — שהייה, צינון, שעות שקט.
          </Text>
        </Panel>
        <View>
          {venues.map((venue) => (
            <ListRow
              key={venue.id}
              accessibilityRole="button"
              accessibilityLabel={`הרצת בדיקה: ${venue.name}, ${venue.city}`}
              onPress={async () => {
                await handleVenueEnter(venue.id);
                setSimulated(venue.name);
              }}
            >
              <Text style={[type.body, styles.venueName]}>{venue.name}</Text>
              <Text style={type.caption}>{venue.city}</Text>
            </ListRow>
          ))}
        </View>
        {simulated && (
          <Panel style={styles.hint}>
            <Text style={type.small}>
              הופעלה כניסה ל{simulated}. ההתראה נשלחת בעוד 3 דקות — זהו סף השהייה, והוא נמדד
              על ידי מערכת ההפעלה. אם לא הגיעה גם אחריהן, הצינון של 12 שעות או שעות השקט חסמו
              אותה, וזו התנהגות תקינה.
            </Text>
          </Panel>
        )}
      </Section>

      <Section eyebrow="פרטיות">
        <Panel>
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
          <Text style={type.bodyStrong}>ורשימת המעקב</Text>
          <Text style={type.small}>{WATCH_PRIVACY}</Text>
        </Panel>
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: ticket.ground },
  content: { paddingBottom: space.s6, gap: space.s3 },
  /* Monospace and selectable: this exists to be copied out of the app, and a
     benefit id in the body face is a line nobody can transcribe correctly. */
  command: {
    ...type.small,
    fontFamily: 'monospace',
    backgroundColor: ticket.ground3,
    padding: space.s2,
    alignSelf: 'stretch',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.s3 - 4,
    alignSelf: 'stretch',
  },
  switchText: { flex: 1, gap: 2, alignItems: 'flex-start' },
  venueName: { flex: 1 },
  /* A note, not an alarm: one step lighter than the other panels, nothing coloured. */
  hint: { backgroundColor: ticket.ground3 },
});
