import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Benefit } from '@sbr/core';
import { JsonStore, mergeBenefits } from './store.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

function render(benefit: Benefit, reason: string, index: number, total: number): string {
  const c = benefit.conditions;
  const lines = [
    `\n[${index + 1}/${total}] ${benefit.merchant_name} — ${benefit.type} ${benefit.value}`,
    `  מועדון:      ${benefit.program_id}`,
    `  ביטחון:      ${benefit.confidence_score.toFixed(2)} — ${reason}`,
    `  מינימום:     ${c.min_spend ?? 'לא צוין'}`,
    `  תקרה:        ${c.max_discount ?? 'לא צוינה'}`,
    `  ימים:        ${c.valid_days?.join(',') ?? 'לא צוינו'}`,
    `  שעות:        ${c.valid_hours ? `${c.valid_hours.from}-${c.valid_hours.to}` : 'לא צוינו'}`,
    `  ערוץ:        ${c.channel ?? 'לא צוין'}`,
    `  כפל מבצעים:  ${c.stacks_with_club ?? 'לא צוין'}`,
    `  לא כולל:     ${c.exclusions?.join(', ') ?? '—'}`,
    `  סיכום:       ${c.raw_text_summary}`,
    `  מקור:        ${benefit.source_url}`,
  ];
  return lines.join('\n');
}

/**
 * Work the review queue.
 *
 * Approving sets `reviewed_by_human`, which is the only thing that lets a
 * benefit below the confidence threshold reach a device. Nothing here edits
 * the terms — a wrong extraction gets rejected and fixed at the prompt or the
 * source, not patched by hand into a record that the next run will overwrite.
 */
async function main(): Promise<void> {
  const outDir = resolve(repoRoot, 'data/generated');
  const store = new JsonStore(outDir);
  const state = await store.read();

  if (state.reviewQueue.length === 0) {
    console.log('תור הבדיקה ריק.');
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const approved: Benefit[] = [];
  const remaining: typeof state.reviewQueue = [];

  for (const [index, item] of state.reviewQueue.entries()) {
    console.log(render(item.benefit, item.reason, index, state.reviewQueue.length));
    const answer = (await rl.question('  [a]ישור / [r]דחייה / [s]דלג / [q]יציאה: ')).trim().toLowerCase();

    if (answer === 'q') {
      remaining.push(...state.reviewQueue.slice(index));
      break;
    }
    if (answer === 'a') approved.push({ ...item.benefit, reviewed_by_human: true });
    else if (answer === 's') remaining.push(item);
    // 'r' (and anything else) drops the item: the next pipeline run will
    // re-extract it if it is still on the source page.
  }

  rl.close();
  await store.write({
    benefits: mergeBenefits(state.benefits, approved),
    reviewQueue: remaining,
  });

  console.log(`\nאושרו ${approved.length}, נשארו בתור ${remaining.length}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
