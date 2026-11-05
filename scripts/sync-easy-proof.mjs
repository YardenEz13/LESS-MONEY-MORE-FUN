#!/usr/bin/env node
/**
 * Give shipped easy.co.il rows the date of their last real link check.
 *
 * Touches `last_verified_at` and nothing else: it never adds or removes a row,
 * and a date only moves forward. While easy refuses the check there is no newer
 * proof, so these rows stay stale rather than looking renewed.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.SBR_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'collected/easy');
const shipped = join(root, 'data/benefits.json');

const proof = new Map();
for (const file of (await readdir(dir)).filter((f) => f.endsWith('.jsonl'))) {
  for (const line of (await readFile(join(dir, file), 'utf8')).split('\n')) {
    if (!line.trim()) continue;
    const { offer_url: url, verified_at: at } = JSON.parse(line);
    if (at && !(proof.get(url) >= at)) proof.set(url, at);
  }
}

const rows = JSON.parse(await readFile(shipped, 'utf8'));
let moved = 0;
for (const row of rows) {
  const at = proof.get(row.source_url);
  if (at && Date.parse(at) > Date.parse(row.last_verified_at)) {
    row.last_verified_at = new Date(at).toISOString();
    moved += 1;
  }
}
if (moved) await writeFile(shipped, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
console.log(`easy link proof: ${moved} rows moved forward, ${rows.length} rows in catalog`);
