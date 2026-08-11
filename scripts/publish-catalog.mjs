#!/usr/bin/env node
/**
 * Promote reviewed pipeline output into the catalog the app ships.
 *
 * There are two files on purpose:
 *
 *   data/generated/benefits.json  pipeline output. Git-ignored, rewritten by
 *                                 every run, nobody has looked at it yet.
 *   data/benefits.json            what ends up on a phone. Committed, so the
 *                                 diff is reviewable and a fresh clone builds
 *                                 without ever running the pipeline.
 *
 * Promotion is a deliberate step rather than the pipeline writing straight to
 * the shipped file: this is the last point where a human sees what is about to
 * reach someone standing at a till. The review queue is the other gate, and
 * this script refuses to promote anything still sitting in it.
 *
 *   node scripts/publish-catalog.mjs            # merge, report, write
 *   node scripts/publish-catalog.mjs --dry-run  # report only
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Overridable so the test can point at a temp tree. Without this the paths are
// pinned to the real repo no matter the cwd, and a test that *looked* isolated
// would quietly publish the actual catalog.
const root = process.env.SBR_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GENERATED = resolve(root, 'data/generated/benefits.json');
const QUEUE = resolve(root, 'data/generated/review-queue.json');
const SHIPPED = resolve(root, 'data/benefits.json');

const dryRun = process.argv.includes('--dry-run');

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

const generated = await readJson(GENERATED, null);
if (generated === null) {
  console.error(
    `nothing to publish — ${GENERATED} does not exist.\n` +
      'run the pipeline first (npm run extract -- ...)',
  );
  process.exit(1);
}

const shipped = await readJson(SHIPPED, []);
const queue = await readJson(QUEUE, []);

// A benefit that is queued for review must not also be shipped. It should never
// be in both, but a stale generated file plus a fresh queue can produce it, and
// silently shipping an unreviewed benefit is exactly the failure the queue exists
// to prevent.
const queuedIds = new Set(queue.map((item) => item.benefit?.id).filter(Boolean));
const blocked = generated.filter((benefit) => queuedIds.has(benefit.id));
const publishable = generated.filter((benefit) => !queuedIds.has(benefit.id));

const byId = new Map(shipped.map((benefit) => [benefit.id, benefit]));

// Withdraw anything that is back in the review queue.
//
// Leaving it out of `publishable` was not enough: the previously-shipped copy
// stayed in the catalog, so un-approving a benefit had no effect on what
// reaches a phone. Publishing was one-way, which also meant a benefit whose
// merchant got remapped left its old row live forever. The queue is the
// authority on "not approved", so a queued id must not ship — including one
// shipped by an earlier run.
let withdrawn = 0;
for (const id of queuedIds) {
  if (byId.delete(id)) withdrawn += 1;
}

let added = 0;
let updated = 0;
for (const benefit of publishable) {
  if (byId.has(benefit.id)) {
    if (JSON.stringify(byId.get(benefit.id)) !== JSON.stringify(benefit)) updated += 1;
  } else {
    added += 1;
  }
  byId.set(benefit.id, benefit);
}

const merged = [...byId.values()];

console.log(`generated:   ${generated.length}`);
console.log(`in review:   ${queue.length}${blocked.length ? ` (${blocked.length} blocked from publish)` : ''}`);
console.log(`added:       ${added}`);
console.log(`updated:     ${updated}`);
console.log(`unchanged:   ${publishable.length - added - updated}`);
if (withdrawn > 0) console.log(`withdrawn:   ${withdrawn} (back in review — pulled from the catalog)`);
console.log(`catalog:     ${shipped.length} -> ${merged.length}`);

if (dryRun) {
  console.log('\n--dry-run: nothing written');
} else {
  await writeFile(SHIPPED, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  console.log(`\nwrote ${SHIPPED}`);
  console.log('review the diff before committing — this is what reaches a phone.');
}
