#!/usr/bin/env node
/**
 * Pull reported benefits out of the shipped catalog and back into review.
 *
 * The app has no backend, so a "this discount is wrong" tap can only be
 * recorded on the device. Settings prints the ids and the command; this is the
 * command. It is the other half of the report button — without it the button
 * would only be a mute wearing a bug report's name.
 *
 * Moves rather than deletes. A wrong benefit is evidence about a source that
 * will be crawled again next week, and dropping it silently means the next
 * extraction re-publishes the same row with the same error. In the queue it is
 * a row a human has to look at, and `publish:catalog` already refuses to
 * promote anything sitting there — so the withdrawal survives the next run.
 *
 * Run: npm run unpublish -- <benefit-id> [<benefit-id> ...]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = resolve(root, 'data/benefits.json');
const QUEUE = resolve(root, 'data/generated/review-queue.json');

const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (ids.length === 0) {
  console.error('Usage: npm run unpublish -- <benefit-id> [<benefit-id> ...]');
  console.error('The ids are listed in the app under הגדרות > הטבות שדיווחת עליהן.');
  process.exit(1);
}

const readJson = async (path, fallback) => {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
};

const catalog = await readJson(CATALOG, []);
const queue = await readJson(QUEUE, []);

const wanted = new Set(ids);
const pulled = catalog.filter((b) => wanted.has(b.id));
const kept = catalog.filter((b) => !wanted.has(b.id));
const missing = ids.filter((id) => !catalog.some((b) => b.id === id));

for (const id of missing) console.warn(`  not in the catalog, skipped: ${id}`);
if (pulled.length === 0) {
  console.log('nothing to do');
  process.exit(0);
}

// Not queued twice if the same id is reported on two devices, or twice here.
const alreadyQueued = new Set(queue.map((item) => item.benefit?.id).filter(Boolean));
const added = pulled
  .filter((benefit) => !alreadyQueued.has(benefit.id))
  .map((benefit) => ({
    // `reviewed_by_human` is cleared on purpose: whatever approval this row once
    // carried was for terms a user has now contradicted at the till.
    benefit: { ...benefit, reviewed_by_human: false },
    reason: 'דווח מהאפליקציה כהטבה שגויה',
    queued_at: new Date().toISOString(),
  }));

if (process.argv.includes('--dry-run')) {
  console.log(`--dry-run: would pull ${pulled.length}, queue ${added.length}`);
  for (const b of pulled) console.log(`  ${b.merchant_name} — ${b.type} ${b.value} (${b.program_id})`);
  process.exit(0);
}

await writeFile(CATALOG, `${JSON.stringify(kept, null, 2)}\n`, 'utf8');
await writeFile(QUEUE, `${JSON.stringify([...queue, ...added], null, 2)}\n`, 'utf8');

console.log(`catalog:  ${catalog.length} -> ${kept.length}`);
console.log(`queue:    ${queue.length} -> ${queue.length + added.length}`);
for (const b of pulled) console.log(`  pulled: ${b.merchant_name} — ${b.type} ${b.value} (${b.program_id})`);
console.log('\nRun validate:data, then clear the list in the app.');
