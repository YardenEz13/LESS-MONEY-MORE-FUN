import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Merchant } from '@sbr/core';
import { extractBenefits } from './extract';
import { assessPage, extractJsonLd, htmlToText, scrapePage, type ScrapedPage } from './scrape';
import {
  JsonStore,
  mergeBenefits,
  partitionByConfidence,
  toBenefit,
  type ReviewItem,
} from './store';
import { ExtractionResult, type ExtractedBenefit } from './schema';

export interface Source {
  program_id: string;
  program_name: string;
  url: string;
  /** Local HTML fixture used instead of the network when --offline is set. */
  fixture?: string;
}

export interface PipelineOptions {
  /** Repo root; fixture paths in sources.json are resolved against it. */
  rootDir: string;
  dataDir: string;
  outDir: string;
  sourcesFile: string;
  /** Read fixtures from disk instead of fetching — used by tests and dry runs. */
  offline?: boolean;
  /** Scrape only; skip the model call. */
  scrapeOnly?: boolean;
  onlyProgram?: string;
  threshold?: number;
}

export interface PipelineReport {
  scraped: number;
  extracted: number;
  published: number;
  queuedForReview: number;
  failures: Array<{ url: string; error: string }>;
  usage: { inputTokens: number; outputTokens: number };
}

async function loadSource(
  source: Source,
  offline: boolean,
  rootDir: string,
): Promise<ScrapedPage> {
  if (offline) {
    if (!source.fixture) throw new Error(`${source.url}: --offline needs a fixture`);
    // Fixtures are our own files and always UTF-8, so they skip charset
    // detection — but they run the same structuring and scoring as the network
    // path, or a dry run would grade a different page than production does.
    const html = await readFile(resolve(rootDir, source.fixture), 'utf8');
    const structured = extractJsonLd(html);
    const body = htmlToText(html);
    const text = structured ? `${structured}\n\n${body}` : body;
    return {
      url: source.url,
      text,
      fetchedAt: new Date().toISOString(),
      quality: assessPage(html, text, 'utf-8'),
    };
  }
  return scrapePage(source.url);
}

export interface ImportOptions {
  dataDir: string;
  outDir: string;
  /** JSON file shaped like ExtractionResult — what a browser agent hands back. */
  file: string;
  programId: string;
  sourceUrl: string;
  threshold?: number;
}

/**
 * Take benefits collected by hand — a browser agent working a login-walled or
 * client-rendered site the fetch pipeline cannot reach — and put them through
 * the identical confidence gate.
 *
 * Deliberately not a bypass. A benefit that arrives this way is still scored,
 * still queued for review below the threshold, and still merged by the same
 * stable id, so a later automated run updates the row rather than duplicating
 * it. The only thing this skips is the scrape and the model call.
 */
export async function importExtraction(options: ImportOptions): Promise<PipelineReport> {
  const parsed = ExtractionResult.parse(
    JSON.parse(await readFile(options.file, 'utf8')),
  );
  const merchants = Merchant.array().parse(
    JSON.parse(await readFile(`${options.dataDir}/merchants.json`, 'utf8')),
  );
  const store = new JsonStore(options.outDir);
  const existing = await store.read();
  const now = new Date();

  const candidates = parsed.benefits.map((item) => ({
    benefit: toBenefit(item, {
      programId: options.programId,
      sourceUrl: options.sourceUrl,
      merchants,
      now,
    }),
    reason: item.confidence_reason,
  }));

  const { publish, review } = partitionByConfidence(candidates, options.threshold);
  const queuedAt = now.toISOString();
  const touchedIds = new Set(candidates.map((c) => c.benefit.id));

  await store.write({
    benefits: mergeBenefits(existing.benefits, publish),
    reviewQueue: [
      ...existing.reviewQueue.filter((item) => !touchedIds.has(item.benefit.id)),
      ...review.map((item) => ({ ...item, queued_at: queuedAt })),
    ],
  });

  return {
    scraped: 0,
    extracted: candidates.length,
    published: publish.length,
    queuedForReview: review.length,
    failures: [],
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

export async function runPipeline(options: PipelineOptions): Promise<PipelineReport> {
  const sources: Source[] = JSON.parse(await readFile(options.sourcesFile, 'utf8'));
  const merchants = Merchant.array().parse(
    JSON.parse(await readFile(`${options.dataDir}/merchants.json`, 'utf8')),
  );
  const store = new JsonStore(options.outDir);
  const existing = await store.read();

  const report: PipelineReport = {
    scraped: 0,
    extracted: 0,
    published: 0,
    queuedForReview: 0,
    failures: [],
    usage: { inputTokens: 0, outputTokens: 0 },
  };

  const selected = options.onlyProgram
    ? sources.filter((s) => s.program_id === options.onlyProgram)
    : sources;
  if (selected.length === 0) {
    throw new Error(`no sources matched${options.onlyProgram ? ` program ${options.onlyProgram}` : ''}`);
  }

  const candidates: Array<{ benefit: ReturnType<typeof toBenefit>; reason: string }> = [];
  const now = new Date();

  for (const source of selected) {
    let page: ScrapedPage;
    try {
      page = await loadSource(source, options.offline ?? false, options.rootDir);
      report.scraped += 1;
      console.log(
        `  scraped ${source.url} (${page.text.length} chars, ` +
          `${page.quality.offerTerms} offer terms, ${page.quality.charset})`,
      );
    } catch (error) {
      report.failures.push({ url: source.url, error: String(error) });
      console.error(`  ! scrape failed: ${String(error)}`);
      continue;
    }

    if (options.scrapeOnly) continue;

    let extracted: ExtractedBenefit[];
    try {
      const output = await extractBenefits({
        programName: source.program_name,
        sourceUrl: source.url,
        pageText: page.text,
      });
      extracted = output.result.benefits;
      report.usage.inputTokens += output.usage.inputTokens;
      report.usage.outputTokens += output.usage.outputTokens;
      console.log(`  extracted ${extracted.length} benefits — ${output.result.page_summary}`);
    } catch (error) {
      report.failures.push({ url: source.url, error: String(error) });
      console.error(`  ! extraction failed: ${String(error)}`);
      continue;
    }

    for (const item of extracted) {
      report.extracted += 1;
      candidates.push({
        benefit: toBenefit(item, {
          programId: source.program_id,
          sourceUrl: source.url,
          merchants,
          now,
        }),
        reason: item.confidence_reason,
      });
    }
  }

  const { publish, review } = partitionByConfidence(candidates, options.threshold);
  report.published = publish.length;
  report.queuedForReview = review.length;

  const queuedAt = now.toISOString();
  const newQueue: ReviewItem[] = review.map((item) => ({ ...item, queued_at: queuedAt }));
  // Drop stale queue entries for benefits this run re-extracted — the fresh
  // verdict replaces the old one rather than stacking beside it.
  const touchedIds = new Set(candidates.map((c) => c.benefit.id));
  const keptQueue = existing.reviewQueue.filter((item) => !touchedIds.has(item.benefit.id));

  await store.write({
    benefits: mergeBenefits(existing.benefits, publish),
    reviewQueue: [...keptQueue, ...newQueue],
  });

  return report;
}
