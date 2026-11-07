import React from 'react';
import { Linking, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
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
import { fonts, space, ticket, type } from '../theme';

interface Props {
  evaluation: Evaluation;
  /** The stock the ticket had on the roll, so the colour carries across the tap. */
  stock: string;
  isMuted: boolean;
  isRejected: boolean;
  onReport: () => void;
  onBack: () => void;
  onRedeemed: () => void;
  onTill: () => void;
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
  onTill,
  onToggleMute,
}: Props) {
  const { width } = useWindowDimensions();
  const { benefit, gates, actionsRequired } = evaluation;
  const { figure, unit } = formatValue(benefit);
  const saving = formatSaving(evaluation);
  // The figure is bigger than its box on purpose, and steps down as it gets longer.
  const bigSize = Math.round(width * 0.5 * Math.min(1, 3.5 / [...figure].length));

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
            <View style={styles.bigBox}>
              <Text
                style={[styles.bigFigure, { fontSize: bigSize, lineHeight: bigSize, top: -bigSize * 0.1, width: bigSize * 4 }]}
              >
                {figure}
              </Text>
            </View>
            <Text style={styles.tillUnit}>{unit}</Text>
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

        {/* Three facts in one strip, divided by rules: how many terms, how many are
            left to you, and which club it comes from. */}
        <View style={styles.strip}>
          <StripCell figure={String(gates.length)} label="תנאים" color={ticket.good} />
          <StripCell figure={String(actionsRequired.length)} label="צעדים עליך" color={ticket.gold} divided />
          <StripCell figure={programNames[benefit.program_id] ?? benefit.program_id} label="מועדון" color={ticket.ink} divided />
        </View>

        <Section eyebrow={gateSummary(gates)}>
          <Text style={styles.dateLine}>{formatLastVerified(benefit)}</Text>
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
        <PrimaryButton label="מצב קופה" onPress={onTill} />
        <GhostButton label="מימשתי" onPress={onRedeemed} style={styles.mute} />
        <GhostButton
          label={isMuted ? 'בטל השתקה' : 'השתק'}
          onPress={onToggleMute}
          style={styles.mute}
        />
      </View>
    </View>
  );
}

function StripCell({ figure, label, color, divided }: { figure: string; label: string; color: string; divided?: boolean }) {
  return (
    <View style={[styles.cell, divided && styles.cellDivided]}>
      <Text style={[styles.cellFigure, { color }]} numberOfLines={1}>
        {figure}
      </Text>
      <Text style={styles.cellLabel}>{label}</Text>
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
  bigBox: { alignSelf: 'stretch', height: 190, overflow: 'hidden' },
  bigFigure: {
    position: 'absolute',
    left: -8,
    fontFamily: fonts.display,
    color: ticket.ink,
    writingDirection: 'ltr',
    fontVariant: ['tabular-nums', 'lining-nums'],
  },
  dateLine: { ...type.caption, paddingHorizontal: space.s3 },
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
  strip: { flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: ticket.rule },
  cell: { flex: 1, alignItems: 'center', paddingVertical: space.s2 + 4, paddingHorizontal: space.s2 },
  cellDivided: { borderStartWidth: 1, borderStartColor: ticket.rule },
  cellFigure: { fontFamily: fonts.display, fontSize: 30, lineHeight: 34 },
  cellLabel: { fontFamily: fonts.latinText, fontSize: 13, lineHeight: 18, color: ticket.onGround2 },
  footer: { flexDirection: 'row', alignItems: 'center', columnGap: space.s2, paddingHorizontal: space.s3 - 4, paddingVertical: space.s2 + 2, borderTopWidth: 1, borderTopColor: ticket.rule },

  mute: { alignSelf: 'stretch', justifyContent: 'center', minHeight: 56 },
});
