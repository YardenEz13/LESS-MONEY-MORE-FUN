import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Benefit } from '@sbr/core';
import {
  defaultProgramResolver,
  easyProgramsFrom,
  loadSnapshots,
  snapshotFor,
  revertVerify,
  robotsAllows,
  runVerify,
  type FetchResult,
  type PageFetcher,
} from '../src/verify';

const NOW = new Date('2026-11-11T10:00:00.000Z');
const OLD = '2026-10-20T00:00:00.000Z';

const benefit = (id: string, over: Partial<Benefit> = {}): Benefit => ({
  id,
  program_id: 'club',
  merchant_id: `m_${id}`,
  merchant_name: 'אדידס',
  type: 'percent',
  value: 15,
  conditions: { raw_text_summary: '15% הנחה לחברי המועדון' },
  source_url: `https://club.example.org/${id}`,
  last_verified_at: OLD,
  confidence_score: 0.95,
  reviewed_by_human: false,
  ...over,
});

/** A real offer page is long; a 30-character stub would read as an app shell. */
const page = (line: string): FetchResult => ({
  kind: 'page',
  text: `${'הטבות לחברי המועדון בכל הסניפים. '.repeat(10)}\nאדידס\n${line}`,
});

async function tree(
  benefits: Benefit[],
  extra: { queue?: unknown[]; reports?: Record<string, number>; snapshots?: object[] } = {},
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sbr-verify-'));
  await mkdir(join(root, 'data/generated'), { recursive: true });
  await mkdir(join(root, 'collected/catalogs'), { recursive: true });
  await writeFile(join(root, 'data/benefits.json'), JSON.stringify(benefits));
  if (extra.queue) {
    await writeFile(join(root, 'data/generated/review-queue.json'), JSON.stringify(extra.queue));
  }
  if (extra.reports) {
    await writeFile(join(root, 'data/generated/rejections.json'), JSON.stringify(extra.reports));
  }
  if (extra.snapshots) {
    await writeFile(
      join(root, 'collected/catalogs/club.jsonl'),
      extra.snapshots.map((s) => JSON.stringify(s)).join('\n'),
    );
  }
  return root;
}

const catalog = async (root: string): Promise<Benefit[]> =>
  JSON.parse(await readFile(join(root, 'data/benefits.json'), 'utf8')) as Benefit[];

/** A network that answers from a table and records what it was asked. */
function fakeNetwork(table: Record<string, FetchResult>): PageFetcher & { asked: string[] } {
  const asked: string[] = [];
  const fetcher = (async (url: string) => {
    asked.push(url);
    return table[url] ?? { kind: 'error', detail: 'no route' };
  }) as PageFetcher & { asked: string[] };
  fetcher.asked = asked;
  return fetcher;
}

const run = (root: string, fetcher: PageFetcher, over = {}) =>
  runVerify({ root, now: NOW, fetcher, gapMs: 0, log: () => {}, ...over });

describe('runVerify', () => {
  it('confirms a real offer the page still states, and dates it today', async () => {
    const root = await tree([benefit('a')]);
    const report = await run(root, fakeNetwork({ 'https://club.example.org/a': page('15% הנחה') }));
    const [row] = await catalog(root);
    expect(report).toMatchObject({ confirmed: 1, written: true });
    expect(row!.verification?.state).toBe('confirmed');
    expect(row!.last_verified_at).toBe(NOW.toISOString());
  });

  it('demotes when the page now states a different value, and leaves the date alone', async () => {
    const root = await tree([benefit('a')]);
    await run(root, fakeNetwork({ 'https://club.example.org/a': page('10% הנחה') }));
    const [row] = await catalog(root);
    expect(row!.verification?.state).toBe('unverified');
    expect(row!.last_verified_at).toBe(OLD);
  });

  it('rejects when the page is gone', async () => {
    const root = await tree([benefit('a')]);
    await run(root, fakeNetwork({ 'https://club.example.org/a': { kind: 'gone', detail: 'HTTP 404' } }));
    expect((await catalog(root))[0]!.verification?.state).toBe('rejected');
  });

  it('does not confirm while two sources disagree', async () => {
    const mine = benefit('a', { merchant_id: 'adidas' });
    const theirs = benefit('b', {
      merchant_id: 'adidas',
      value: 10,
      source_url: 'https://aggregator.example.net/b',
    });
    const root = await tree([mine, theirs]);
    await run(
      root,
      fakeNetwork({
        'https://club.example.org/a': page('15% הנחה'),
        'https://aggregator.example.net/b': page('10% הנחה'),
      }),
    );
    const rows = await catalog(root);
    expect(rows.map((r) => r.verification?.state)).toEqual(['unverified', 'unverified']);
  });

  it('a source that blocks us ends unverified — never confirmed, never retried around', async () => {
    const rows = ['a', 'b', 'c', 'd', 'e'].map((id) => benefit(id));
    const root = await tree(rows);
    const network = fakeNetwork(
      Object.fromEntries(rows.map((r) => [r.source_url, { kind: 'blocked', detail: 'HTTP 403' }])),
    );
    const report = await run(root, network);
    expect((await catalog(root)).every((r) => r.verification?.state === 'unverified')).toBe(true);
    expect((await catalog(root)).every((r) => r.last_verified_at === OLD)).toBe(true);
    // Three refusals and the host is left alone: the last two are never asked.
    expect(network.asked).toHaveLength(3);
    expect(report.blockedHosts).toEqual(['club.example.org']);
  });

  it('confirms from a collector snapshot with no network, as of the snapshot date', async () => {
    const snapshotAt = '2026-11-09T03:30:00.000Z';
    const root = await tree([benefit('a')], {
      snapshots: [
        {
          offer_url: 'https://club.example.org/a',
          merchant_name: 'אדידס',
          sections: { '15% הנחה לחברי המועדון': 'בכל הסניפים' },
          collected_at: snapshotAt,
        },
      ],
    });
    const network = fakeNetwork({});
    await run(root, network, { offline: true });
    const [row] = await catalog(root);
    expect(network.asked).toHaveLength(0);
    expect(row!.verification).toMatchObject({ state: 'confirmed', checked_at: snapshotAt });
    // The evidence's date, not the run's: an old snapshot must not look new.
    expect(row!.last_verified_at).toBe(snapshotAt);
  });

  it('never moves a date backwards', async () => {
    const root = await tree([benefit('a', { last_verified_at: '2026-11-10T00:00:00.000Z' })], {
      snapshots: [
        {
          offer_url: 'https://club.example.org/a',
          terms_text: '15% הנחה',
          collected_at: '2026-09-01T00:00:00.000Z',
        },
      ],
    });
    await run(root, fakeNetwork({}), { offline: true });
    expect((await catalog(root))[0]!.last_verified_at).toBe('2026-11-10T00:00:00.000Z');
  });

  it('"could not check" does not undo an earlier confirmation', async () => {
    const confirmed = benefit('a', {
      verification: { state: 'confirmed', checked_at: OLD, score: 0.8, checks: [] },
    });
    const root = await tree([confirmed]);
    const report = await run(
      root,
      fakeNetwork({ 'https://club.example.org/a': { kind: 'blocked', detail: 'HTTP 429' } }),
    );
    expect(report).toMatchObject({ kept: 1, written: false });
    expect((await catalog(root))[0]).toEqual(confirmed);
  });

  it('stops, and writes nothing, when a run would take down too much at once', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => benefit(`r${i}`));
    const root = await tree(rows);
    const before = await readFile(join(root, 'data/benefits.json'), 'utf8');
    // A redesign: every page now reads as a different figure.
    const network = fakeNetwork(Object.fromEntries(rows.map((r) => [r.source_url, page('5% הנחה')])));
    const report = await run(root, network);
    expect(report.aborted).toMatch(/would take down 30 of 30/);
    expect(report.written).toBe(false);
    expect(await readFile(join(root, 'data/benefits.json'), 'utf8')).toBe(before);
  });

  it('checks reported offers first when the budget is short', async () => {
    const root = await tree([benefit('a'), benefit('b'), benefit('c')], { reports: { c: 1 } });
    const network = fakeNetwork({ 'https://club.example.org/c': page('15% הנחה') });
    await run(root, network, { limit: 1 });
    expect(network.asked).toEqual(['https://club.example.org/c']);
    // Fresh page evidence outweighs the single report.
    expect((await catalog(root)).find((r) => r.id === 'c')!.verification?.state).toBe('confirmed');
  });

  it('rejects after repeated reports the page cannot answer', async () => {
    const root = await tree([benefit('a')], { reports: { a: 3 } });
    await run(root, fakeNetwork({ 'https://club.example.org/a': { kind: 'blocked', detail: 'HTTP 403' } }));
    expect((await catalog(root))[0]!.verification?.state).toBe('rejected');
  });

  it('promotes a queued low-confidence row only on evidence', async () => {
    const proven = benefit('q1', { confidence_score: 0.6 });
    const unproven = benefit('q2', { confidence_score: 0.6 });
    const root = await tree([], {
      queue: [
        { benefit: proven, reason: 'low confidence', queued_at: OLD },
        { benefit: unproven, reason: 'low confidence', queued_at: OLD },
      ],
    });
    const report = await run(
      root,
      fakeNetwork({ 'https://club.example.org/q1': page('15% הנחה') }),
      { includeQueue: true },
    );
    expect(report.promoted).toBe(1);
    expect((await catalog(root)).map((r) => r.id)).toEqual(['q1']);
    const queue = JSON.parse(
      await readFile(join(root, 'data/generated/review-queue.json'), 'utf8'),
    ) as { benefit: Benefit }[];
    expect(queue.map((item) => item.benefit.id)).toEqual(['q2']);
  });

  it('writes an audit line per decision and can be reverted', async () => {
    const root = await tree([benefit('a')]);
    const before = await readFile(join(root, 'data/benefits.json'), 'utf8');
    await run(root, fakeNetwork({ 'https://club.example.org/a': page('15% הנחה') }));
    const audit = (await readFile(join(root, 'data/generated/verify-audit.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { id: string; from: string; to: string });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ id: 'a', from: 'none', to: 'confirmed' });

    expect(await revertVerify(root)).toBe(true);
    expect(await readFile(join(root, 'data/benefits.json'), 'utf8')).toBe(before);
  });

  it('a dry run reports and writes nothing', async () => {
    const root = await tree([benefit('a')]);
    const before = await readFile(join(root, 'data/benefits.json'), 'utf8');
    const report = await run(root, fakeNetwork({ 'https://club.example.org/a': page('15% הנחה') }), {
      dryRun: true,
    });
    expect(report).toMatchObject({ confirmed: 1, written: false });
    expect(await readFile(join(root, 'data/benefits.json'), 'utf8')).toBe(before);
  });
});

describe('loadSnapshots', () => {
  it('keeps the newest dated record per program and url, and skips undated ones', async () => {
    const root = await tree([], {
      snapshots: [
        { offer_url: 'u1', terms_text: 'old', collected_at: '2026-01-01T00:00:00.000Z' },
        { offer_url: 'u1', terms_text: 'new', verified_at: '2026-06-01T00:00:00.000Z' },
        { offer_url: 'u2', terms_text: 'undated' },
      ],
    });
    const snapshots = await loadSnapshots(join(root, 'collected'), defaultProgramResolver({}));
    expect(snapshotFor(snapshots, { program_id: 'club', source_url: 'u1' })).toMatchObject({
      text: 'new',
      source: 'link_check',
    });
    expect(snapshotFor(snapshots, { program_id: 'club', source_url: 'u2' })).toBeUndefined();
  });

  it("never judges one club's offer by another club's listing of the same page", async () => {
    const root = await mkdtemp(join(tmpdir(), 'sbr-verify-'));
    await mkdir(join(root, 'collected/easy'), { recursive: true });
    const url = 'https://easy.example/page/1';
    await writeFile(
      join(root, 'collected/easy/MAX.jsonl'),
      JSON.stringify({ offer_url: url, listing_headline: '10% הנחה', verified_at: OLD }),
    );
    await writeFile(
      join(root, 'collected/easy/Unmapped-List.jsonl'),
      JSON.stringify({ offer_url: url, listing_headline: '3% הנחה', verified_at: NOW.toISOString() }),
    );
    const snapshots = await loadSnapshots(
      join(root, 'collected'),
      defaultProgramResolver({ MAX: 'max' }),
    );
    expect(snapshotFor(snapshots, { program_id: 'max', source_url: url })?.text).toContain('10%');
    // The unmapped list is nobody's evidence, however new it is.
    expect(snapshots.size).toBe(1);
  });

  it('reads the slug map out of the crawler', async () => {
    const map = await easyProgramsFrom(join(import.meta.dirname, '../../../scripts/scrape-easy.mjs'));
    expect(map.MAX).toBe('max');
    expect(Object.keys(map).length).toBeGreaterThan(20);
  });
});

describe('listing pages', () => {
  const listing = (merchantLine: string) =>
    `${'מבצעים לחברי המועדון. '.repeat(10)}\nנייקי — 30% הנחה\n${'עוד הטבות. '.repeat(40)}\n${merchantLine}`;

  it('confirms only when the figure sits beside the merchant', async () => {
    const shared = 'https://club.example.org/all';
    const rows = [
      benefit('a', { source_url: shared }),
      benefit('b', { source_url: shared, merchant_name: 'נייקי', value: 30 }),
    ];
    const root = await tree(rows);
    await run(root, fakeNetwork({ [shared]: { kind: 'page', text: listing('אדידס') } }));
    const states = Object.fromEntries((await catalog(root)).map((r) => [r.id, r.verification?.state]));
    // 'a' (אדידס 15%) is not stated beside its name: a listing page cannot demote it.
    expect(states).toEqual({ a: 'unverified', b: 'confirmed' });
    const a = (await catalog(root)).find((r) => r.id === 'a')!;
    expect(a.verification?.checks.find((c) => c.code === 'page_states_value')?.outcome).toBe('unknown');
  });

  it('a shared page that does not name the merchant demotes nothing', async () => {
    const shared = 'https://club.example.org/home';
    const rows = [
      benefit('a', { source_url: shared }),
      benefit('b', { source_url: shared, merchant_name: 'נייקי' }),
    ];
    const root = await tree(rows);
    const home = { kind: 'page' as const, text: 'כל ההטבות של המועדון במקום אחד. '.repeat(20) };
    const report = await run(root, fakeNetwork({ [shared]: home }));
    expect(report.takenDown).toBe(0);
  });

  it('confirms a computed saving by its own pair of prices', async () => {
    const row = benefit('a', {
      type: 'fixed',
      value: 6500,
      conditions: { raw_text_summary: 'מתקן משחקים ב-3,499 ש״ח במקום 9,999 ש״ח' },
    });
    const root = await tree([row]);
    await run(root, fakeNetwork({ [row.source_url]: page('רק ב-₪3,499 במקום ₪9,999') }));
    expect((await catalog(root))[0]!.verification?.state).toBe('confirmed');
  });
});

describe('robotsAllows', () => {
  const robots = `
    User-agent: *
    Disallow: /private/
    Allow: /private/open
    Disallow: /search

    User-agent: SmartBenefitsRecall
    Disallow: /`;
  it('applies the group that names us over the wildcard', () => {
    expect(robotsAllows(robots, '/benefits')).toBe(false);
  });
  it('lets the longest rule win inside the wildcard group', () => {
    const wildcard = robots.split('User-agent: SmartBenefitsRecall')[0]!;
    expect(robotsAllows(wildcard, '/benefits')).toBe(true);
    expect(robotsAllows(wildcard, '/private/x')).toBe(false);
    expect(robotsAllows(wildcard, '/private/open/x')).toBe(true);
  });
  it('allows everything when there is no file to speak of', () => {
    expect(robotsAllows('', '/anything')).toBe(true);
  });
});
