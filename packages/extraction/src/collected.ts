import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Merchant } from '@sbr/core';
import { extractBenefits } from './extract';
import {
  JsonStore,
  mergeBenefits,
  partitionByConfidence,
  toBenefit,
  type ReviewItem,
} from './store';
import { ExtractedBenefit, type ExtractionResult } from './schema';
import type { PipelineReport } from './pipeline';

/**
 * Turn a browser agent's raw page dump into benefits.
 *
 * The collector (`discount_scraper`) deliberately stops at raw text: crawling is
 * cheap and repeatable, extraction is the expensive judgement step. This is the
 * seam between them, and it exists so the second half can be re-run — after a
 * prompt change, a schema change, a threshold change — without touching the
 * site again.
 *
 * Records are keyed by the collector's `content_hash`, so a re-crawl only pays
 * the model for offers whose text actually changed. On a catalog of 800+ offers
 * that is the difference between a re-run costing pennies and costing the whole
 * crawl again.
 */

/** One line of the collector's JSONL. Only the fields we consume are typed. */
export interface CollectedRecord {
  site: string;
  category?: string;
  offer_url: string;
  merchant_name?: string;
  listing_headline?: string;
  sections?: Record<string, string>;
  terms_text: string;
  content_hash: string;
  warning?: string;
}

/** The section Israeli card catalogs put the binding terms in. */
const BINDING_TERMS_HEADING = 'חשוב לדעת';

interface CacheShape {
  /** content_hash -> what the model said about that exact text. */
  [contentHash: string]: ExtractedBenefit[];
}

export interface CollectedOptions {
  dataDir: string;
  outDir: string;
  file: string;
  programId: string;
  programName: string;
  threshold?: number;
  /** Cap the number of *model calls*; cache hits do not count against it. */
  limit?: number;
  concurrency?: number;
  /** Re-extract even when the hash is already cached. */
  refresh?: boolean;
}

/**
 * Assemble the text for one offer, binding terms first.
 *
 * Order is deliberate. `חשוב לדעת` carries the minimum spend, the usage cap and
 * the exclusions — the things this product exists to surface — so it leads,
 * ahead of marketing copy that would otherwise dominate a truncated prompt.
 */
export function buildPageText(record: CollectedRecord): string {
  const parts: string[] = [];
  if (record.merchant_name) parts.push(`בית העסק: ${record.merchant_name}`);
  if (record.listing_headline) parts.push(`כותרת ההטבה: ${record.listing_headline}`);

  const binding = record.sections?.[BINDING_TERMS_HEADING];
  if (binding) parts.push(`${BINDING_TERMS_HEADING}:\n${binding}`);

  for (const [heading, body] of Object.entries(record.sections ?? {})) {
    if (heading === BINDING_TERMS_HEADING) continue;
    parts.push(`${heading}:\n${body}`);
  }

  // Always include the full body: the section split is heuristic, and a heading
  // the collector did not know about would otherwise drop its terms silently.
  parts.push(`טקסט מלא של העמוד:\n${record.terms_text}`);
  return parts.join('\n\n');
}

export async function readCollected(file: string): Promise<CollectedRecord[]> {
  const raw = await readFile(file, 'utf8');
  const records: CollectedRecord[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as CollectedRecord;
      if (parsed.offer_url && parsed.terms_text) records.push(parsed);
    } catch {
      // A truncated final line is normal if a crawl was interrupted.
    }
  }
  // The collector can emit the same offer under two category paths.
  const byUrl = new Map(records.map((record) => [record.offer_url, record]));
  return [...byUrl.values()];
}

async function readCache(path: string): Promise<CacheShape> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as CacheShape;
  } catch {
    return {};
  }
}

/** Run `worker` over `items` with at most `limit` in flight. */
async function pooled<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index]!);
    }
  });
  await Promise.all(runners);
}

export async function runCollected(options: CollectedOptions): Promise<PipelineReport> {
  const records = await readCollected(options.file);
  const merchants = Merchant.array().parse(
    JSON.parse(await readFile(`${options.dataDir}/merchants.json`, 'utf8')),
  );
  const store = new JsonStore(options.outDir);
  const existing = await store.read();

  const cachePath = join(options.outDir, 'extraction-cache.json');
  const cache = options.refresh ? {} : await readCache(cachePath);

  const report: PipelineReport = {
    scraped: records.length,
    extracted: 0,
    published: 0,
    queuedForReview: 0,
    failures: [],
    usage: { inputTokens: 0, outputTokens: 0 },
  };

  const cached = records.filter((r) => cache[r.content_hash]);
  let toExtract = records.filter((r) => !cache[r.content_hash]);
  const capped = options.limit != null && toExtract.length > options.limit;
  if (capped) toExtract = toExtract.slice(0, options.limit);

  console.log(
    `  ${records.length} offers — ${cached.length} cached, ${toExtract.length} to extract` +
      (capped ? ` (capped by --limit; ${records.length - cached.length - toExtract.length} left)` : ''),
  );

  let done = 0;
  await pooled(toExtract, options.concurrency ?? 4, async (record) => {
    try {
      const output = await extractBenefits({
        programName: options.programName,
        sourceUrl: record.offer_url,
        pageText: buildPageText(record),
      });
      cache[record.content_hash] = output.result.benefits;
      report.usage.inputTokens += output.usage.inputTokens;
      report.usage.outputTokens += output.usage.outputTokens;
    } catch (error) {
      report.failures.push({ url: record.offer_url, error: String(error) });
    }
    done += 1;
    if (done % 20 === 0) console.log(`    ${done}/${toExtract.length}`);
  });

  // Persist the cache even on a partial run, so an interrupted or capped pass
  // never has to pay for the same page twice.
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(cache, null, 1), 'utf8');

  const now = new Date();
  const candidates: Array<{ benefit: ReturnType<typeof toBenefit>; reason: string }> = [];
  for (const record of records) {
    for (const item of cache[record.content_hash] ?? []) {
      const parsed = ExtractedBenefit.safeParse(item);
      if (!parsed.success) continue;
      report.extracted += 1;
      candidates.push({
        benefit: toBenefit(parsed.data, {
          programId: options.programId,
          sourceUrl: record.offer_url,
          merchants,
          now,
        }),
        reason: parsed.data.confidence_reason,
      });
    }
  }

  // A benefit a human already approved must not be re-gated by a later run.
  // benefitId is stable across a re-scrape *by design* (see its docstring) so
  // that review survives the next pipeline run — but confidence never rises
  // above ~0.8 here, so blindly re-running partitionByConfidence on every
  // candidate would re-queue every approved row every single time. Anything
  // whose id and terms are unchanged from an already-published, human-approved
  // record is left published; only genuinely new or changed candidates go
  // through the confidence gate.
  const publishedById = new Map(existing.benefits.map((b) => [b.id, b]));
  const alreadyApproved = (benefit: (typeof candidates)[number]['benefit']) => {
    const prior = publishedById.get(benefit.id);
    return (
      prior?.reviewed_by_human === true &&
      JSON.stringify(prior.conditions) === JSON.stringify(benefit.conditions) &&
      prior.value === benefit.value &&
      prior.type === benefit.type
    );
  };
  const toGate = candidates.filter((c) => !alreadyApproved(c.benefit));

  const { publish, review } = partitionByConfidence(toGate, options.threshold);
  report.published = publish.length;
  report.queuedForReview = review.length;

  const queuedAt = now.toISOString();
  const touchedIds = new Set(toGate.map((c) => c.benefit.id));
  const newQueue: ReviewItem[] = review.map((item) => ({ ...item, queued_at: queuedAt }));

  const mergedBenefits = mergeBenefits(existing.benefits, publish);

  // Two things a queue must never contain: two rows for the same id (a chain
  // with five branches at an identical discount is one benefit, not five —
  // the id is deliberately shared, see benefitId's docstring) and a row whose
  // id is already sitting in `benefits` as a human-approved publish. Both are
  // collapsed the same way `mergeBenefits` already collapses its own array:
  // last write wins per id, via a Map.
  const publishedIds = new Set(mergedBenefits.map((b) => b.id));
  const rawQueue = [
    ...existing.reviewQueue.filter((item) => !touchedIds.has(item.benefit.id)),
    ...newQueue,
  ];
  const queueById = new Map(rawQueue.map((item) => [item.benefit.id, item]));
  const dedupedQueue = [...queueById.values()].filter((item) => !publishedIds.has(item.benefit.id));

  await store.write({
    benefits: mergedBenefits,
    reviewQueue: dedupedQueue,
  });

  return report;
}
