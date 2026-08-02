import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { conditionLines, type Evaluation } from '@sbr/core';
import { colors, font, radius, spacing } from '../theme';

/**
 * The condition breakdown is the product. A discount headline without its
 * terms is what sends someone to a till with the wrong expectation, so
 * blockers are shown first and unknowns are labelled as unknown rather than
 * quietly omitted.
 */
export function ConditionList({ evaluation }: { evaluation: Evaluation }) {
  const lines = conditionLines(evaluation);

  if (lines.length === 0) {
    return (
      <View style={[styles.row, styles.clear]}>
        <Text style={styles.clearText}>ללא תנאים נוספים בתקנון</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {lines.map((line, index) => (
        <View
          key={`${line.tone}-${index}`}
          style={[styles.row, line.tone === 'blocked' ? styles.blocked : styles.note]}
        >
          <Text style={line.tone === 'blocked' ? styles.blockedText : styles.noteText}>
            {line.tone === 'blocked' ? '✕  ' : '•  '}
            {line.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  row: { padding: spacing.md, borderRadius: radius.sm },
  blocked: { backgroundColor: '#F7E9E9' },
  note: { backgroundColor: colors.background },
  clear: { backgroundColor: colors.accentSoft },
  blockedText: { ...font.body, color: colors.danger },
  noteText: font.body,
  clearText: { ...font.body, color: colors.accent },
});
