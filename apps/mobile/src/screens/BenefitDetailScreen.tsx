import React from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { formatLastVerified, formatSaving, formatValue, type Evaluation } from '@sbr/core';
import { GateList, gateSummary } from '../components/Gates';
import { GhostButton, PrimaryButton, ScreenHeader, Section, Text } from '../components/ui';
import { programNames } from '../services/catalog';
import { border, colors, radius, space, type } from '../theme';

interface Props {
  evaluation: Evaluation;
  isMuted: boolean;
  onBack: () => void;
  onRedeemed: () => void;
  onToggleMute: () => void;
}

export function BenefitDetailScreen({
  evaluation,
  isMuted,
  onBack,
  onRedeemed,
  onToggleMute,
}: Props) {
  const { benefit, gates, actionsRequired } = evaluation;
  const { figure, unit } = formatValue(benefit);
  const saving = formatSaving(evaluation);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          title={benefit.merchant_name}
          eyebrow={programNames[benefit.program_id] ?? benefit.program_id}
          onBack={onBack}
        />

        {/* The plate, full width: deliberately the loudest thing on the screen,
            because this is what you hold up at the counter. It states the
            benefit and the one thing still standing in the way. */}
        <View style={styles.till}>
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
            <View style={styles.trustAction}>
              <GhostButton
                label="פתח את עמוד המקור"
                onPress={() => void Linking.openURL(benefit.source_url)}
              />
            </View>
          </View>
          <Text style={styles.disclaimer}>
            אנחנו לא מנחשים תנאים. מה שלא כתוב בתקנון מסומן כ״לא צוין״ ולא כ״אין הגבלה״.
          </Text>
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
      <Text style={type.small}>{label}</Text>
      <Text style={type.bodyStrong}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfacePage },
  content: { paddingBottom: space.s5, gap: space.s4 },
  till: {
    marginHorizontal: space.s4,
    backgroundColor: colors.surfacePlate,
    borderRadius: radius.sharp,
    padding: space.s4,
    gap: space.s1,
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
  trustAction: { paddingVertical: space.s3 - 4 },
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
