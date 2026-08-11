import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCollected } from '../src/collected';

/**
 * The bug this guards: `benefitId` is documented as stable "so a human review
 * survives the next pipeline run" — but a second run rebuilt every candidate
 * from the cache and ran ALL of them through the confidence gate again, with
 * no memory of what a human had already approved. Since nothing here scores
 * above the low-0.8s, every previously-approved row got a second, unreviewed
 * copy pushed into the review queue alongside the approved one in
 * benefits.json: same id, two records, one of them silently un-approved.
 */
describe('runCollected preserves human review across a re-run', () => {
  const setup = async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sbr-review-'));
    const dataDir = join(dir, 'data');
    const outDir = join(dir, 'out');
    await mkdir(dataDir, { recursive: true });
    await mkdir(outDir, { recursive: true });
    await writeFile(join(dataDir, 'merchants.json'), '[]', 'utf8');

    const collectedFile = join(dir, 'collected.jsonl');
    const record = {
      site: 'test',
      offer_url: 'https://example.invalid/page/1',
      merchant_name: 'עסק לדוגמה',
      listing_headline: '5% הנחה',
      terms_text: '5% הנחה',
      content_hash: 'hash1',
    };
    await writeFile(collectedFile, JSON.stringify(record) + '\n', 'utf8');

    // Pre-seed the extraction cache with a low-confidence benefit — the same
    // shape extract-easy.mjs produces, well under the 0.85 publish gate.
    const cachePath = join(outDir, 'extraction-cache.json');
    const extracted = [
      {
        merchant_name: 'עסק לדוגמה',
        type: 'percent',
        value: 5,
        valid_from: null,
        valid_until: null,
        confidence_score: 0.8,
        confidence_reason: 'ברור מהכותרת',
        conditions: {
          min_spend: null,
          max_discount: null,
          valid_days: null,
          valid_hours: null,
          channel: null,
          stacks_with_club: null,
          exclusions: null,
          usage_limit: null,
          requires_voucher: null,
          raw_text_summary: '5% הנחה',
        },
      },
    ];
    await writeFile(cachePath, JSON.stringify({ hash1: extracted }), 'utf8');

    return { dataDir, outDir, collectedFile };
  };

  it('does not duplicate or un-approve a benefit a human already approved', async () => {
    const { dataDir, outDir, collectedFile } = await setup();
    const run = () =>
      runCollected({
        dataDir,
        outDir,
        file: collectedFile,
        programId: 'testprog',
        programName: 'Test',
      });

    // First run: below threshold, lands in review.
    await run();
    const afterFirst = JSON.parse(await readFile(join(outDir, 'review-queue.json'), 'utf8'));
    expect(afterFirst).toHaveLength(1);
    const id = afterFirst[0].benefit.id;

    // A human approves it — exactly what `review --yes` does.
    await writeFile(
      join(outDir, 'benefits.json'),
      JSON.stringify([{ ...afterFirst[0].benefit, reviewed_by_human: true }]),
      'utf8',
    );
    await writeFile(join(outDir, 'review-queue.json'), '[]', 'utf8');

    // Second run: same cache, same content hash, nothing changed on the page.
    await run();

    const benefits = JSON.parse(await readFile(join(outDir, 'benefits.json'), 'utf8'));
    const queue = JSON.parse(await readFile(join(outDir, 'review-queue.json'), 'utf8'));

    expect(benefits).toHaveLength(1);
    expect(benefits[0].id).toBe(id);
    expect(benefits[0].reviewed_by_human).toBe(true);
    expect(queue).toHaveLength(0);
  });

  it('re-gates a benefit whose terms actually changed, even if a human once approved it', async () => {
    const { dataDir, outDir, collectedFile } = await setup();
    const run = () =>
      runCollected({
        dataDir,
        outDir,
        file: collectedFile,
        programId: 'testprog',
        programName: 'Test',
      });

    await run();
    const first = JSON.parse(await readFile(join(outDir, 'review-queue.json'), 'utf8'));
    await writeFile(
      join(outDir, 'benefits.json'),
      JSON.stringify([{ ...first[0].benefit, reviewed_by_human: true }]),
      'utf8',
    );
    await writeFile(join(outDir, 'review-queue.json'), '[]', 'utf8');

    // The value changes — 5% became 8% — same content_hash key, different cached result.
    const cachePath = join(outDir, 'extraction-cache.json');
    const cache = JSON.parse(await readFile(cachePath, 'utf8'));
    cache.hash1[0].value = 8;
    await writeFile(cachePath, JSON.stringify(cache), 'utf8');

    await run();

    const benefits = JSON.parse(await readFile(join(outDir, 'benefits.json'), 'utf8'));
    const queue = JSON.parse(await readFile(join(outDir, 'review-queue.json'), 'utf8'));

    // The id is the same (program+merchant+type+VALUE hashes it — value moved,
    // so the id moved too), but either way the approval for "5%" must not
    // silently cover "8%".
    expect(queue).toHaveLength(1);
    expect(queue[0].benefit.value).toBe(8);
    expect(benefits.find((b: { value: number }) => b.value === 8)).toBeUndefined();
  });

  it('never leaves the same id in both benefits and the review queue', async () => {
    // Two records for the same chain — different branches, identical deal —
    // deliberately hash to the same id (benefitId is keyed on program +
    // merchant + type + value, not on url; see its docstring). A stale queue
    // row for that id must not survive once the id is published.
    const { dataDir, outDir } = await setup();
    const collectedFile = join(dataDir, '..', 'two-branches.jsonl');
    const twoBranches = [
      {
        site: 'test',
        offer_url: 'https://example.invalid/page/branch-a',
        merchant_name: 'רשת סניפים',
        listing_headline: '5% הנחה',
        terms_text: '5% הנחה',
        content_hash: 'branchA',
      },
      {
        site: 'test',
        offer_url: 'https://example.invalid/page/branch-b',
        merchant_name: 'רשת סניפים',
        listing_headline: '5% הנחה',
        terms_text: '5% הנחה',
        content_hash: 'branchB',
      },
    ];
    await writeFile(collectedFile, twoBranches.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

    const shape = {
      merchant_name: 'רשת סניפים',
      type: 'percent',
      value: 5,
      valid_from: null,
      valid_until: null,
      confidence_score: 0.8,
      confidence_reason: 'ברור מהכותרת',
      conditions: {
        min_spend: null,
        max_discount: null,
        valid_days: null,
        valid_hours: null,
        channel: null,
        stacks_with_club: null,
        exclusions: null,
        usage_limit: null,
        requires_voucher: null,
        raw_text_summary: '5% הנחה',
      },
    };
    await writeFile(
      join(outDir, 'extraction-cache.json'),
      JSON.stringify({ branchA: [shape], branchB: [shape] }),
      'utf8',
    );

    await runCollected({ dataDir, outDir, file: collectedFile, programId: 'testprog', programName: 'Test' });

    const before = JSON.parse(await readFile(join(outDir, 'review-queue.json'), 'utf8'));
    // Both branches collapse to one id — the queue must not carry two rows for it.
    expect(before).toHaveLength(1);
    const id = before[0].benefit.id;

    // Approve it, exactly as `review --yes` does — via mergeBenefits, which is
    // itself id-deduping, so this alone cannot leave a stray queue row behind.
    await writeFile(
      join(outDir, 'benefits.json'),
      JSON.stringify([{ ...before[0].benefit, reviewed_by_human: true }]),
      'utf8',
    );
    await writeFile(join(outDir, 'review-queue.json'), '[]', 'utf8');

    // Re-run: both branch candidates are recognised as already approved and
    // short-circuited before the confidence gate, so neither one ever enters
    // `toGate` — which is exactly the path that used to leave the queue
    // untouched for this id, letting a stale duplicate linger indefinitely.
    await runCollected({ dataDir, outDir, file: collectedFile, programId: 'testprog', programName: 'Test' });

    const benefits = JSON.parse(await readFile(join(outDir, 'benefits.json'), 'utf8'));
    const queue = JSON.parse(await readFile(join(outDir, 'review-queue.json'), 'utf8'));
    const queueIds = new Set(queue.map((item: { benefit: { id: string } }) => item.benefit.id));

    expect(benefits.map((b: { id: string }) => b.id)).toContain(id);
    expect(queueIds.has(id)).toBe(false);
  });
});
