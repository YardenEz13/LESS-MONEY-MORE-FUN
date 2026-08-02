import React from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { formatLastVerified, formatSaving, formatValue, type Evaluation } from '@sbr/core';
import { GateList, gateSummary } from '../components/Gates';
import { GhostButton, PrimaryButton, ScreenHeader, Section } from '../components/ui';
import { programNames } from '../services/catalog';
import { colors, fonts, radius, space, type } from '../theme';

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

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          title={benefit.merchant_name}
          titleIsName
          eyebrow={programNames[benefit.program_id] ?? benefit.program_id}
          onBack={onBack}
        />

        {/* The till card: inverted, deliberately the loudest thing on the
            screen, because this is what you hold up at the counter. It states
            the benefit and the one thing still standing in the way. */}
        <View style={styles.till}>
          <View style={styles.tillValue}>
            <Text style={styles.tillFigure}>{figure}</Text>
            <Text style={styles.tillUnit}>{unit}</Text>
          </View>
          <Text style={styles.tillSaving}>{formatSaving(evaluation)}</Text>
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
            <Text style={type.body}>{benefit.conditions.raw_text_summary}</Text>
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
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { paddingBottom: space.xxl, gap: space.xl },
  till: {
    marginHorizontal: space.xl,
    backgroundColor: colors.ink,
    borderRadius: radius.lg,
    padding: space.xl,
    gap: space.xs,
  },
  tillValue: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  tillFigure: { ...type.figureLarge, color: '#7FE3C6' },
  tillUnit: { fontFamily: fonts.voiceMedium, fontSize: 17, color: '#7FE3C6' },
  tillSaving: { fontFamily: fonts.voice, fontSize: 14, color: '#A9B6C2' },
  tillRule: { height: 1, backgroundColor: '#2C3947', marginVertical: space.md },
  tillNote: { fontFamily: fonts.voiceMedium, fontSize: 16, lineHeight: 25, color: colors.inkInverse },
  quote: {
    marginHorizontal: space.xl,
    backgroundColor: colors.card,
    borderRightWidth: 3,
    borderRightColor: colors.mint,
    borderRadius: radius.sm,
    padding: space.lg,
  },
  trust: {
    marginHorizontal: space.xl,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.lg,
  },
  trustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  trustAction: { paddingVertical: space.md },
  disclaimer: { ...type.caption, marginHorizontal: space.xl, lineHeight: 17 },
  footer: {
    flexDirection: 'row',
    gap: space.md,
    padding: space.lg,
    paddingHorizontal: space.xl,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.card,
  },
  mute: { alignSelf: 'stretch', justifyContent: 'center' },
});
