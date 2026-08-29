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
import { PitchStripes, ScarfBand } from '../components/Kit';
import { GhostButton, PrimaryButton, ScreenHeader, Section, Text } from '../components/ui';
import { programNames, programsById } from '../services/catalog';
import { border, colors, radius, space, type } from '../theme';

interface Props {
  evaluation: Evaluation;
  isMuted: boolean;
  isRejected: boolean;
  onReport: () => void;
  onBack: () => void;
  onRedeemed: () => void;
  onToggleMute: () => void;
}

export function BenefitDetailScreen({
  evaluation,
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

        {/* The plate, full width: deliberately the loudest thing on the screen,
            because this is what you hold up at the counter. It states the
            benefit and the one thing still standing in the way.
            The scoreboard, in other words — striped, closed by the scarf, with
            the club that issued the figure named on it. */}
        <View style={styles.tillWrap}>
          <View style={styles.till}>
            <PitchStripes />
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
          <ScarfBand />
        </View>

        <Section eyebrow={gateSummary(gates)}>
          <GateList gates={gates} />
        </Section>

        <Section eyebrow="לשון התקנון">
          <View style={styles.quote}>
            <View style={styles.quoteBar} />
            <Text style={styles.quoteText}>{benefit.conditions.raw_text_summary}</Text>
          </View>
        </Section>

        <Section eyebrow="מקור ואמינות">
          <View style={styles.trust}>
            <TrustRow label="אימות אחרון" value={formatLastVerified(benefit)} />
            <TrustRow
              label="ציון חילוץ"
              value={`${benefit.confidence_score.toFixed(2)}${
                benefit.reviewed_by_human ? ' · אושר ידנית' : ''
              }`}
            />
            <TrustRow label="נקרא מתוך" value={listing} />
            <View style={styles.trustAction}>
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
          </View>
          <Text style={styles.disclaimer}>
            אנחנו לא מנחשים תנאים. מה שלא כתוב בתקנון מסומן כ״לא צוין״ ולא כ״אין הגבלה״.
            הדף שנקרא הוא מה שראינו; התקנון המחייב הוא של המועדון.
          </Text>

          {/* Placed with the source links rather than beside "I redeemed this":
              reporting is a claim that the catalog disagrees with the page above,
              so the two belong next to each other. */}
          <View style={styles.report}>
            {isRejected ? (
              <Text style={styles.reportDone}>
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
    <View style={styles.trustRow}>
      <Text style={[type.small, styles.trustLabel]}>{label}</Text>
      <Text style={[type.bodyStrong, styles.trustValue]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfacePage },
  content: { paddingBottom: space.s5, gap: space.s4 },
  tillWrap: { marginHorizontal: space.s4 },
  till: {
    backgroundColor: colors.surfacePlate,
    borderRadius: radius.sharp,
    padding: space.s4,
    gap: space.s1,
    overflow: 'hidden',
  },
  tillValue: { flexDirection: 'row', alignItems: 'baseline', gap: space.s2 },
  tillFigure: type.figureLarge,
  tillUnit: { ...type.bodyStrong, fontSize: 17, color: colors.textMutedInverse },
  tillSaving: { ...type.small, color: colors.textMutedInverse },
  tillRule: {
    height: border.hairline,
    backgroundColor: colors.borderOnPlate,
    marginVertical: space.s3 - 2,
  },
  tillNote: { ...type.bodyStrong, color: colors.textInverse },
  /* The marker bar is a sibling view, not `borderStartWidth` — see BenefitCard. */
  quote: { marginHorizontal: space.s4, flexDirection: 'row', gap: space.s3 - 2 },
  quoteBar: { width: border.marker, backgroundColor: colors.surfacePrimary },
  quoteText: { ...type.body, flex: 1, paddingVertical: space.s1 },
  trust: {
    marginHorizontal: space.s4,
    borderRadius: radius.sharp,
    borderWidth: border.hairline,
    borderColor: colors.borderHairline,
    paddingHorizontal: space.s3,
  },
  trustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.s3,
    paddingVertical: space.s3 - 4,
    borderBottomWidth: border.hairline,
    borderBottomColor: colors.borderHairlineSoft,
  },
  /**
   * The label is two fixed words and never earns a break; the value is the
   * variable half, so it is the one that gives. `minWidth: 0` is the part that
   * matters on web — without it a flex item cannot go below its own content
   * width, so an unbreakable value pushes the row past the screen instead of
   * wrapping inside it.
   */
  trustLabel: { flexShrink: 0 },
  trustValue: { flexShrink: 1, minWidth: 0 },
  trustAction: { paddingVertical: space.s3 - 4, gap: space.s2 },
  report: { paddingTop: space.s3, borderTopWidth: border.hairline, borderTopColor: colors.borderHairlineSoft },
  reportDone: { ...type.small, color: colors.textMuted },
  disclaimer: { ...type.caption, marginHorizontal: space.s4, lineHeight: 18 },
  footer: {
    flexDirection: 'row',
    gap: space.s2,
    paddingVertical: space.s3 - 4,
    paddingHorizontal: space.s4,
    borderTopWidth: border.hairline,
    borderTopColor: colors.borderHairline,
  },
  mute: { alignSelf: 'stretch', justifyContent: 'center' },
});
