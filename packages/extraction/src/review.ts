import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Benefit } from '@sbr/core';
import { JsonStore, mergeBenefits } from './store';

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
/**
 * Approve a whole class of benefits by a rule the operator states themselves.
 *
 * A queue of thousands of aggregator one-liners cannot be read one at a time,
 * and the realistic alternative — someone holding [a] down — is rubber-stamping
 * with extra steps. This makes the judgement explicit instead: you name the
 * shape you trust (`--type percent --min-value 1`), see the count and a sample
 * first, and only a second run with `--yes` writes anything.
 *
 * Deliberately not an `--approve-all`. The rule *is* the review: it has to be
 * something you could defend afterwards, and it is echoed into the output so
 * the decision stays recoverable.
 */
function parseRule(argv: string[]) {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const type = value('--type');
  const program = value('--program');
  const minValue = value('--min-value');
  const maxValue = value('--max-value');
  const minConfidence = value('--min-confidence');
  if (!type && !program && !minValue && !maxValue && !minConfidence) return null;

  const num = (raw: string | undefined, flag: string) => {
    if (raw == null) return undefined;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) throw new Error(`${flag} expects a number, got "${raw}"`);
    return parsed;
  };
  const lo = num(minValue, '--min-value');
  const hi = num(maxValue, '--max-value');
  const conf = num(minConfidence, '--min-confidence');

  return {
    describe: () =>
      [
        type && `type=${type}`,
        program && `program=${program}`,
        lo != null && `value>=${lo}`,
        hi != null && `value<=${hi}`,
        conf != null && `confidence>=${conf}`,
      ]
        .filter(Boolean)
        .join(' AND '),
    matches(benefit: Benefit) {
      if (type && benefit.type !== type) return false;
      if (program && benefit.program_id !== program) return false;
      if (lo != null && benefit.value < lo) return false;
      if (hi != null && benefit.value > hi) return false;
      if (conf != null && benefit.confidence_score < conf) return false;
      return true;
    },
  };
}

async function main(): Promise<void> {
  const outDir = resolve(repoRoot, 'data/generated');
  const store = new JsonStore(outDir);
  const state = await store.read();

  if (state.reviewQueue.length === 0) {
    console.log('תור הבדיקה ריק.');
    return;
  }

  const rule = parseRule(process.argv.slice(2));
  if (rule) {
    const hit = state.reviewQueue.filter((item) => rule.matches(item.benefit));
    console.log(`כלל: ${rule.describe()}`);
    console.log(`תואמים ${hit.length} מתוך ${state.reviewQueue.length} בתור.\n`);
    for (const item of hit.slice(0, 10)) {
      const b = item.benefit;
      console.log(
        `  ${b.merchant_name} — ${b.type} ${b.value} (${b.confidence_score.toFixed(2)})  ${b.source_url}`,
      );
    }
    if (hit.length > 10) console.log(`  … ועוד ${hit.length - 10}`);

    if (!process.argv.includes('--yes')) {
      console.log('\nהרצה יבשה — לא נכתב דבר. הוסף --yes כדי לאשר את כל התואמים.');
      return;
    }

    const approvedIds = new Set(hit.map((item) => item.benefit.id));
    await store.write({
      benefits: mergeBenefits(
        state.benefits,
        hit.map((item) => ({ ...item.benefit, reviewed_by_human: true })),
      ),
      reviewQueue: state.reviewQueue.filter((item) => !approvedIds.has(item.benefit.id)),
    });
    console.log(`\nאושרו ${hit.length} לפי הכלל. נשארו בתור ${state.reviewQueue.length - hit.length}.`);
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
