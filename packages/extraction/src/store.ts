import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Benefit, DEFAULT_MIN_CONFIDENCE, Merchant, dateOnlyToInstant } from '@sbr/core';
import type { ExtractedBenefit } from './schema';

export interface ReviewItem {
  benefit: Benefit;
  reason: string;
  queued_at: string;
}

export interface StoreShape {
  benefits: Benefit[];
  reviewQueue: ReviewItem[];
}

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '_')
    .replace(/^_|_$/g, '');
}

function normalizeMerchantName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s'"׳״־-]+/g, '');
}

/**
 * Map an extracted merchant name onto a known merchant, so a benefit can be
 * tied to the domains and mall locations we already track. Unknown merchants
 * get a slug id: the benefit is still usable in the list view, it just can't
 * fire a geofence or a share-sheet match until someone adds it to the catalog.
 */
export function resolveMerchantId(name: string, merchants: readonly Merchant[]): string {
  const target = normalizeMerchantName(name);
  const match = merchants.find((m) => normalizeMerchantName(m.name) === target);
  return match ? match.id : `unmapped_${slugify(name)}`;
}

/**
 * Stable id derived from the identity of the offer rather than from the run.
 * Re-scraping the same benefit lands on the same id, which is what lets a
 * human review survive the next pipeline run.
 */
export function benefitId(parts: {
  programId: string;
  merchantId: string;
  type: string;
  value: number;
}): string {
  const digest = createHash('sha256')
    .update([parts.programId, parts.merchantId, parts.type, parts.value].join('|'))
    .digest('hex')
    .slice(0, 12);
  return `${parts.programId}_${parts.merchantId}_${digest}`;
}

/**
 * A validity date as an instant.
 *
 * The extraction schema asks for ISO 8601 and a bare `YYYY-MM-DD` satisfies
 * that, so the model returning one is correct — but `Benefit` wants a full
 * timestamp, and the mismatch used to throw and abort the entire run rather
 * than spoil one benefit. Dates are pinned to the edge of the local day that
 * keeps the benefit usable for exactly as long as the T&C says.
 */
function toInstant(value: string | null | undefined, edge: 'start' | 'end'): string | null {
  if (!value) return null;
  return dateOnlyToInstant(value, edge) ?? value;
}

export function toBenefit(
  extracted: ExtractedBenefit,
  context: { programId: string; sourceUrl: string; merchants: readonly Merchant[]; now: Date },
): Benefit {
  const merchantId = resolveMerchantId(extracted.merchant_name, context.merchants);
  return Benefit.parse({
    id: benefitId({
      programId: context.programId,
      merchantId,
      type: extracted.type,
      value: extracted.value,
    }),
    program_id: context.programId,
    merchant_id: merchantId,
    merchant_name: extracted.merchant_name,
    google_place_id: null,
    type: extracted.type,
    value: extracted.value,
    conditions: extracted.conditions,
    valid_from: toInstant(extracted.valid_from, 'start'),
    valid_until: toInstant(extracted.valid_until, 'end'),
    // A per-offer url from the collector beats the run-wide one: it is what the
    // user opens to check the terms themselves.
    source_url: extracted.source_url ?? context.sourceUrl,
    last_verified_at: context.now.toISOString(),
    confidence_score: extracted.confidence_score,
    reviewed_by_human: false,
  });
}

/**
 * The confidence gate. Anything the model was unsure about goes to a human
 * instead of to a device — see KPI #2 in the PRD.
 */
export function partitionByConfidence(
  candidates: Array<{ benefit: Benefit; reason: string }>,
  threshold: number = DEFAULT_MIN_CONFIDENCE,
): { publish: Benefit[]; review: Array<{ benefit: Benefit; reason: string }> } {
  const publish: Benefit[] = [];
  const review: Array<{ benefit: Benefit; reason: string }> = [];
  for (const candidate of candidates) {
    if (candidate.benefit.confidence_score >= threshold) publish.push(candidate.benefit);
    else review.push(candidate);
  }
  return { publish, review };
}

/**
 * Merge a fresh run into what is already stored.
 *
 * A human's approval must survive a re-run when the terms have not changed.
 * If the terms *did* change, the approval is dropped on purpose — it approved
 * the old wording, not this one. A benefit with no stored predecessor keeps
 * whatever flag it arrives with, which is how the review CLI publishes an
 * approval for a benefit that was never in the store to begin with.
 */
export function mergeBenefits(existing: readonly Benefit[], incoming: readonly Benefit[]): Benefit[] {
  const byId = new Map(existing.map((b) => [b.id, b]));
  for (const benefit of incoming) {
    const previous = byId.get(benefit.id);
    if (previous == null) {
      byId.set(benefit.id, benefit);
      continue;
    }
    const termsUnchanged =
      JSON.stringify(previous.conditions) === JSON.stringify(benefit.conditions) &&
      previous.value === benefit.value &&
      previous.type === benefit.type;
    byId.set(benefit.id, {
      ...benefit,
      reviewed_by_human: termsUnchanged ? previous.reviewed_by_human : false,
    });
  }
  return [...byId.values()];
}

export class JsonStore {
  constructor(private readonly dir: string) {}

  private path(file: string): string {
    return join(this.dir, file);
  }

  async read(): Promise<StoreShape> {
    return {
      benefits: await this.readJson<Benefit[]>('benefits.json', []),
      reviewQueue: await this.readJson<ReviewItem[]>('review-queue.json', []),
    };
  }

  async write(store: StoreShape): Promise<void> {
    await this.writeJson('benefits.json', store.benefits);
    await this.writeJson('review-queue.json', store.reviewQueue);
  }

  private async readJson<T>(file: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await readFile(this.path(file), 'utf8')) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
      throw error;
    }
  }

  private async writeJson(file: string, value: unknown): Promise<void> {
    const target = this.path(file);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }
}
