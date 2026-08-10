#!/usr/bin/env node
/**
 * Export the review queue as a spreadsheet.
 *
 * Reviewing thousands of rows one keypress at a time is not review, it is
 * rubber-stamping with extra steps. A sheet lets you sort by value, spot the
 * outliers that matter, and decide on a class at a time — then approve with
 * `review --type ... --yes`. Read-only: this never touches the queue.
 *
 * UTF-8 BOM on purpose. Without it Excel reads the Hebrew as mojibake, which
 * makes the whole export useless for the one audience it has.
 *
 * Run: npm run export:queue
 */
import { readFile, writeFile } from 'node:fs/promises';

const OUT = 'data/generated/review-queue.csv';

const cell = (value) => {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const queue = JSON.parse(await readFile('data/generated/review-queue.json', 'utf8'));

const header = [
  'program', 'merchant', 'merchant_mapped', 'type', 'value', 'confidence',
  'why', 'valid_until', 'min_spend', 'channel', 'requires_voucher',
  'source_text', 'source_url',
];

const rows = queue
  // The reason lives on the queue item, not on the benefit — `toBenefit` does
  // not carry it across. Flatten it in, since "why is this only 0.45" is the
  // whole point of reviewing a row.
  .map((item) => ({ ...item.benefit, why: item.reason }))
  // Highest value first: if anything here is wrong, it is wrong in the
  // direction that costs someone a trip, so it should be read first.
  .sort((a, b) => b.value - a.value || a.program_id.localeCompare(b.program_id))
  .map((b) => [
    b.program_id,
    b.merchant_name,
    b.merchant_id.startsWith('unmapped_') ? 'no' : 'yes',
    b.type,
    b.value,
    b.confidence_score,
    b.why,
    b.valid_until ?? '',
    b.conditions.min_spend ?? '',
    b.conditions.channel ?? '',
    b.conditions.requires_voucher ?? '',
    b.conditions.raw_text_summary,
    b.source_url,
  ]);

await writeFile(
  OUT,
  '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n',
  'utf8',
);

console.log(`${rows.length} benefits -> ${OUT}`);
console.log('sorted by value, highest first — the rows most costly to get wrong are at the top');
