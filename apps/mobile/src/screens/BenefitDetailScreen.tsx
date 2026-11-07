import React from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import {
  extractHostname,
  formatLastVerified,
  formatSaving,
  formatValue,
  type Evaluation,
} from '@sbr/core';
import { GateList, gateSummary } from '../components/Gates';
import { Seam } from '../components/Kit';
import { GhostButton, ListRow, Panel, PrimaryButton, ScreenHeader, Section, Text } from '../components/ui';
import { programNames, programsById } from '../services/catalog';
import { space, ticket, type } from '../theme';

interface Props {
  evaluation: Evaluation;
  /** The stock the ticket had on the roll, so the colour carries across the tap. */
  stock: string;
  isMuted: boolean;
  isRejected: boolean;
  onReport: () => void;
  onBack: () => void;
  onRedeemed: () => void;
  onToggleMute: () => void;
}

export function BenefitDetailScreen({
  evaluation,
  stock,
  isMuted,
  isRejected,
  onReport,
  onBack,
  onRedeemed,
  onToggleMute,
}: Props) {
  const { benefit, gates, actionsRequired } = evaluation;
  const { figure, unit } = formatValue(benefit);
  const saving = formatSaving(evaluation);

  // Where this came from, in two parts, because they are two different claims.
  // `source_url` is the page we actually read — for 2731 of 2763 benefits that
  // is easy.co.il, a directory, not the club's own terms. The club's catalog is
  // where the binding version lives. Naming the listing host rather than just
  // offering a button matters: "we read this on a directory" and "we read this
  // on max.co.il" deserve different amounts of trust, and only one of them is
  // the issuer.
  const listing = extractHostname(benefit.source_url) ?? benefit.source_url;
  const club = programsById.get(benefit.program_id);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          title={benefit.merchant_name}
          eyebrow={programNames[benefit.program_id] ?? benefit.program_id}
          crestProgramId={benefit.program_id}
          onBack={onBack}
        />

        {/* The ticket, full width in the stock it had on the roll: deliberately
            the loudest thing on the screen, because this is what you hold up
            at the counter. It states the benefit and the one thing still
            standing in the way, and ends on the tear line. */}
        <View>
          <View style={[styles.till, { backgroundColor: stock }]}>
            <View style={styles.tillValue}>
              <Text style={styles.tillFigure}>{figure}</Text>
              <Text style={styles.tillUnit}>{unit}</Text>
            </View>
            {saving && <Text style={styles.tillSaving}>{saving}</Text>}
            <View style={styles.tillRule} />
            <Text style={styles.tillNote}>
              {actionsRequired.length === 0
                ? 'אין מה להכין מראש — אפשר ללכת לקופה.'
                : actionsRequired.length === 1
                  ? actionsRequired[0]!.detail
                  : `להכין מראש: ${actionsRequired.map((g) => g.label).join(' · ')}`}
            </Text>
          </View>
          <View>
            <Seam />
          </View>
        </View>

        <Section eyebrow={gateSummary(gates)}>
          <GateList gates={gates} />
        </Section>

        <Section eyebrow="לשון התקנון">
          <Panel>
            <Text style={type.body}>{benefit.conditions.raw_text_summary}</Text>
          </Panel>
        </Section>

        <Section eyebrow="מקור ואמינות">
          <View>
            <TrustRow label="אימות אחרון" value={formatLastVerified(benefit)} />
            <TrustRow
              label="ציון חילוץ"
              value={`${benefit.confidence_score.toFixed(2)}${
                benefit.reviewed_by_human ? ' · אושר ידנית' : ''
              }`}
            />
            <TrustRow label="נקרא מתוך" value={listing} />
          </View>
          <View style={styles.actions}>
            <GhostButton
              label={`פתח את הדף ב${listing}`}
              onPress={() => void Linking.openURL(benefit.source_url)}
            />
            {club?.catalog_url && (
              <GhostButton
                label={`התקנון אצל ${club.name}`}
                onPress={() => void Linking.openURL(club.catalog_url!)}
              />
            )}
          </View>
          <Text style={styles.disclaimer}>
            אנחנו לא מנחשים תנאים. מה שלא כתוב בתקנון מסומן כ״לא צוין״ ולא כ״אין הגבלה״.
            הדף שנקרא הוא מה שראינו; התקנון המחייב הוא של המועדון.
          </Text>

          {/* Placed with the source links rather than beside "I redeemed this":
              reporting is a claim that the catalog disagrees with the page above,
              so the two belong next to each other. */}
          <View style={styles.actions}>
            {isRejected ? (
              <Text style={type.small}>
                דווח כשגוי. ההטבה הוסתרה ותוחזר לבדיקה בעדכון הקטלוג הבא.
              </Text>
            ) : (
              <GhostButton label="ההטבה לא נכונה" onPress={onReport} />
            )}
          </View>
        </Section>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="מימשתי את ההטבה" onPress={onRedeemed} />
        <GhostButton
          label={isMuted ? 'בטל השתקה' : 'השתק'}
          onPress={onToggleMute}
          style={styles.mute}
        />
      </View>
    </View>
  );
}

function TrustRow({ label, value }: { label: string; value: string }) {
  return (
    <ListRow>
      <Text style={[type.small, styles.trustLabel]}>{label}</Text>
      <Text style={[type.bodyStrong, styles.trustValue]}>{value}</Text>
    </ListRow>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: ticket.ground },
  content: { paddingBottom: space.s5, gap: space.s3 },
  till: { paddingHorizontal: space.s3, paddingVertical: space.s3, gap: space.s1, alignItems: 'flex-start' },
  tillValue: { flexDirection: 'row', alignItems: 'baseline', gap: space.s2 },
  tillFigure: type.figureLarge,
  tillUnit: { ...type.bodyStrong, fontSize: 17, color: ticket.ink2 },
  tillSaving: { ...type.small, color: ticket.ink2 },
  tillRule: { height: 1, alignSelf: 'stretch', backgroundColor: ticket.ink2, marginVertical: space.s3 - 2 },
  tillNote: { ...type.bodyStrong, color: ticket.ink },
  /**
   * The label is two fixed words and never earns a break; the value is the
   * variable half, so it is the one that gives. `minWidth: 0` is the part that
   * matters on web — without it a flex item cannot go below its own content
   * width, so an unbreakable value pushes the row past the screen instead of
   * wrapping inside it.
   */
  trustLabel: { flexShrink: 0 },
  trustValue: { flex: 1, minWidth: 0, textAlign: 'left' },
  actions: { paddingHorizontal: space.s3, gap: space.s2, alignItems: 'flex-start' },
  disclaimer: { ...type.caption, marginHorizontal: space.s3 },
  footer: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: ticket.rule },
  mute: { alignSelf: 'stretch', justifyContent: 'center', borderWidth: 0, minHeight: 56 },
});
