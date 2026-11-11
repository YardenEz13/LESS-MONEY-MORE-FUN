import { appendFile, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import vm from 'node:vm';
import {
  Benefit,
  DEFAULT_CHANGE_GUARD,
  DEFAULT_VERIFICATION_POLICY,
  changeGuard,
  decideVerification,
  freshnessFor,
  merchantOnPage,
  secondSource,
  termsContradiction,
  toVerification,
  offerOnPage,
  type ChangeGuardPolicy,
  type VerificationCheck,
  type VerificationDecision,
  type VerificationPolicy,
  type VerificationState,
} from '@sbr/core';
import { decodeBytes, detectCharset, extractJsonLd, htmlToText } from './scrape';

/**
 * The automatic verifier: confirms, demotes and retires offers with nobody
 * reading a queue.
 *
 * What it replaces is the `review` CLI and the "look at the diff" step in
 * `publish:catalog`. What it keeps is their standard. The rules live in
 * `@sbr/core` (`verification.ts`) and are pure; this file gathers the evidence
 * they judge and writes the result, and it is deliberately the only part that
 * touches a network or a disk.
 *
 * Evidence comes from two places:
 *
 *   a dated snapshot   the text a collector already saved for this exact URL
 *                      (`collected/**.jsonl`). Free, works offline, and it is
 *                      the only route to a page that needs a browser to render.
 *                      Its date is the date of the evidence — an old snapshot
 *                      confirms the offer as of then, and the freshness rules
 *                      age it out like any other row.
 *   a live fetch       one plain GET of the source URL, identified honestly,
 *                      robots.txt respected, paced per host. A refusal is
 *                      "could not check" and is left at that: this never
 *                      retries around a block, rotates anything, or pretends to
 *                      be a browser.
 *
 * Three things it will not do, each of which a person used to guarantee:
 *   - confirm on a guess (no evidence about the offer itself → `unverified`)
 *   - write a date nothing earned (`last_verified_at` moves only on a
 *     confirmation, to the evidence's own date, and only forward)
 *   - let one broken run empty the catalog (`changeGuard`, and `--revert`)
 */

export type FetchResult =
  | { kind: 'page'; text: string }
  /** 404 / 410: the page is gone. The only network result that rejects. */
  | { kind: 'gone'; detail: string }
  /** Refused, rate-limited, captcha, robots.txt, server error: could not check. */
  | { kind: 'blocked'; detail: string }
  | { kind: 'error'; detail: string };

export type PageFetcher = (url: string) => Promise<FetchResult>;

export interface Snapshot {
  /** When a collector read the page. */
  at: string;
  text: string;
  /** `link_check`: the date only proves the link opened (easy.co.il). */
  source: 'text_read' | 'link_check';
}

export interface AuditEntry {
  at: string;
  id: string;
  merchant: string;
  source_url: string;
  from: VerificationState | 'none' | 'queued';
  to: VerificationState | 'kept';
  score: number;
  reasons: string[];
  checks: VerificationCheck[];
}

export interface VerifyReport {
  total: number;
  /** Rows whose verdict changed or was written for the first time. */
  confirmed: number;
  unverified: number;
  rejected: number;
  /** An earlier `confirmed` left alone because this run could not check it. */
  kept: number;
  /** Queue rows promoted into the catalog on evidence. */
  promoted: number;
  /** Rows this run conclusively demoted or rejected — what the change guard counts. */
  takenDown: number;
  /** Verdicts reached on evidence, as opposed to "could not check". */
  conclusive: number;
  fetched: number;
  blockedHosts: string[];
  /** Set when the change guard stopped the run. Nothing was written. */
  aborted: string | null;
  written: boolean;
}

export interface VerifyOptions {
  /** Repo root: holds `data/` and `collected/`. */
  root: string;
  now?: Date;
  /** Live fetches this run may spend. 0, or `offline`, means snapshots only. */
  limit?: number;
  offline?: boolean;
  dryRun?: boolean;
  /** Also judge the review queue, and promote what the evidence confirms. */
  includeQueue?: boolean;
  fetcher?: PageFetcher;
  /** Defaults to reading `scripts/scrape-easy.mjs` under `root`. */
  programOf?: ProgramResolver;
  /** Pause between two requests to one host. */
  gapMs?: number;
  policy?: VerificationPolicy;
  guard?: ChangeGuardPolicy;
  log?: (line: string) => void;
}

const paths = (root: string) => ({
  catalog: join(root, 'data/benefits.json'),
  queue: join(root, 'data/generated/review-queue.json'),
  reports: join(root, 'data/generated/rejections.json'),
  audit: join(root, 'data/generated/verify-audit.jsonl'),
  lastGood: join(root, 'data/generated/benefits.last-good.json'),
  collected: join(root, 'collected'),
});

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
}

/** Every string in a collected record's body, joined. */
function recordText(record: Record<string, unknown>): string {
  const parts: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === 'string') parts.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value)) {
        parts.push(key); // section headings carry the offer ("50 ₪ הנחה…")
        walk(inner);
      }
    }
  };
  for (const key of ['merchant_name', 'listing_headline', 'sections', 'terms_text']) {
    walk(record[key]);
  }
  return parts.join('\n');
}

/** Which program a collected file belongs to, or null when nobody has said. */
export type ProgramResolver = (group: string, file: string) => string | null;

/**
 * easy.co.il list slug -> program id, read from the crawler that owns it.
 *
 * Read out of `scripts/scrape-easy.mjs` rather than copied, so the two cannot
 * drift: the crawler is where a new club gets mapped. The literal is evaluated
 * in an empty context, the same way the crawler's own tests rewrite it.
 */
export async function easyProgramsFrom(scrapeEasyPath: string): Promise<Record<string, string>> {
  try {
    const source = await readFile(scrapeEasyPath, 'utf8');
    const literal = /const PROGRAMS = (\{[\s\S]*?\n\});/.exec(source)?.[1];
    if (!literal) return {};
    return vm.runInNewContext(`(${literal})`, {}, { timeout: 1000 }) as Record<string, string>;
  } catch {
    return {};
  }
}

/**
 * The default resolver: a catalog file is named after its program
 * (`collected/catalogs/max.jsonl`), an easy file after its list slug.
 */
export function defaultProgramResolver(easyPrograms: Record<string, string>): ProgramResolver {
  return (group, file) => {
    const name = basename(file, '.jsonl');
    if (group === 'easy') return easyPrograms[name] ?? null;
    return name;
  };
}

const snapshotKey = (programId: string, url: string) => `${programId}\u0000${url}`;

/**
 * The newest dated snapshot of each (program, URL) any collector has saved.
 *
 * Keyed by program as well as URL because one business page is listed by many
 * clubs — 1023 easy.co.il URLs sit in more than one list with a *different*
 * headline in each — and judging a Max benefit against the Isracard list's
 * headline would confirm or demote it on someone else's terms. A record whose
 * file maps to no program is not evidence for anyone.
 *
 * `collected_at` is when the text was read; easy.co.il records carry
 * `verified_at` instead, the date of their last link check. A record with
 * neither has no date to lend an offer, so it is not evidence.
 */
export async function loadSnapshots(
  collectedDir: string,
  programOf: ProgramResolver,
): Promise<Map<string, Snapshot>> {
  const snapshots = new Map<string, Snapshot>();
  let groups: string[];
  try {
    groups = await readdir(collectedDir);
  } catch {
    return snapshots;
  }
  for (const group of groups) {
    let files: string[];
    try {
      files = (await readdir(join(collectedDir, group))).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const file of files) {
      const programId = programOf(group, file);
      if (!programId) continue;
      const lines = (await readFile(join(collectedDir, group, file), 'utf8')).split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        let record: Record<string, unknown>;
        try {
          record = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        const url = record.offer_url;
        const at = record.collected_at ?? record.verified_at;
        if (typeof url !== 'string' || typeof at !== 'string' || Number.isNaN(Date.parse(at))) continue;
        const key = snapshotKey(programId, url);
        const known = snapshots.get(key);
        if (!known || at > known.at) {
          snapshots.set(key, {
            at: new Date(at).toISOString(),
            text: recordText(record),
            // A link check proves the page opened, not that its text was
            // re-read on that day — said so wherever this date is shown.
            source: record.collected_at ? 'text_read' : 'link_check',
          });
        }
      }
    }
  }
  return snapshots;
}

/** The snapshot for a benefit: its own program's record of its own URL. */
export function snapshotFor(
  snapshots: ReadonlyMap<string, Snapshot>,
  benefit: Pick<Benefit, 'program_id' | 'source_url'>,
): Snapshot | undefined {
  return snapshots.get(snapshotKey(benefit.program_id, benefit.source_url));
}

const USER_AGENT = 'SmartBenefitsRecall/0.1 (catalog verifier; personal project; contact via repo)';
/** The token robots.txt rules are matched against. */
const ROBOTS_TOKEN = 'smartbenefitsrecall';

/**
 * The Disallow/Allow rules that apply to us in a robots.txt.
 *
 * A group naming our own token wins over `*`, as the standard says. Only
 * prefixes and `$` are understood; a pattern with a `*` in the middle is
 * treated as its prefix up to the star, which can only disallow more.
 */
export function robotsAllows(robotsTxt: string, path: string): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; prefix: string }[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const field = match[1]!.toLowerCase();
    const value = match[2]!.trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === 'disallow' || field === 'allow') && current) {
      lastWasAgent = false;
      if (value) current.rules.push({ allow: field === 'allow', prefix: value.split('*')[0]! });
    } else {
      lastWasAgent = false;
    }
  }
  const ours =
    groups.find((g) => g.agents.some((a) => a !== '*' && ROBOTS_TOKEN.includes(a))) ??
    groups.find((g) => g.agents.includes('*'));
  if (!ours) return true;
  // Longest matching rule wins; Allow wins a tie.
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of ours.rules) {
    const exact = rule.prefix.endsWith('$');
    const prefix = exact ? rule.prefix.slice(0, -1) : rule.prefix;
    if (exact ? path !== prefix : !path.startsWith(prefix)) continue;
    if (!best || prefix.length > best.length || (prefix.length === best.length && rule.allow)) {
      best = { allow: rule.allow, length: prefix.length };
    }
  }
  return best ? best.allow : true;
}

const REFUSED = new Set([401, 403, 407, 429, 451]);

/** One honest GET, with robots.txt checked first. */
export function createFetcher(timeoutMs = 20_000): PageFetcher {
  const robots = new Map<string, string | null>();

  const get = async (url: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'user-agent': USER_AGENT, 'accept-language': 'he-IL,he;q=0.9,en;q=0.5' },
      });
    } finally {
      clearTimeout(timer);
    }
  };

  return async (url) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { kind: 'error', detail: 'not a URL' };
    }
    try {
      if (!robots.has(parsed.origin)) {
        // A robots.txt that is missing or will not load forbids nothing; the
        // page request itself will say if we are unwelcome.
        const response = await get(`${parsed.origin}/robots.txt`).catch(() => null);
        robots.set(parsed.origin, response?.ok ? await response.text() : null);
      }
      const rules = robots.get(parsed.origin);
      if (rules && !robotsAllows(rules, parsed.pathname + parsed.search)) {
        return { kind: 'blocked', detail: 'robots.txt disallows this path' };
      }

      const response = await get(url);
      if (response.status === 404 || response.status === 410) {
        return { kind: 'gone', detail: `HTTP ${response.status}` };
      }
      if (REFUSED.has(response.status) || response.status >= 500) {
        return { kind: 'blocked', detail: `HTTP ${response.status}` };
      }
      if (!response.ok) return { kind: 'error', detail: `HTTP ${response.status}` };
      if (/captcha|challenge/i.test(new URL(response.url).pathname)) {
        return { kind: 'blocked', detail: 'redirected to a challenge page' };
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      const html = decodeBytes(bytes, detectCharset(response.headers.get('content-type'), bytes));
      const structured = extractJsonLd(html);
      return { kind: 'page', text: `${structured}\n${htmlToText(html)}` };
    } catch (error) {
      return { kind: 'error', detail: (error as Error).name || 'network error' };
    }
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

/** A host that refuses this many requests in a row is left alone for the run. */
const HOST_GIVE_UP_AFTER = 3;

interface Candidate {
  benefit: Benefit;
  queued: boolean;
  reports: number;
}

interface Judged {
  candidate: Candidate;
  checks: VerificationCheck[];
  decision: VerificationDecision;
  /** The date the evidence carries: a live fetch is now, a snapshot is its own. */
  evidenceAt: string;
}

export async function runVerify(options: VerifyOptions): Promise<VerifyReport> {
  const {
    root,
    now = new Date(),
    offline = false,
    dryRun = false,
    includeQueue = false,
    gapMs = 700,
    policy = DEFAULT_VERIFICATION_POLICY,
    guard = DEFAULT_CHANGE_GUARD,
    log = console.log,
  } = options;
  const limit = offline ? 0 : (options.limit ?? 200);
  const fetcher = options.fetcher ?? createFetcher();
  const p = paths(root);

  const catalog = Benefit.array().parse(await readJson<unknown[]>(p.catalog, []));
  const queue = includeQueue
    ? await readJson<{ benefit: unknown; reason?: string; queued_at?: string }[]>(p.queue, [])
    : [];
  const reports = await readJson<Record<string, number>>(p.reports, {});
  const programOf =
    options.programOf ??
    defaultProgramResolver(await easyProgramsFrom(join(root, 'scripts/scrape-easy.mjs')));
  const snapshots = await loadSnapshots(p.collected, programOf);

  // How many rows each source URL carries. A URL behind many offers is a
  // listing page, and a figure found somewhere on it says little about one row.
  const sharedUrls = new Map<string, number>();
  for (const b of catalog) sharedUrls.set(b.source_url, (sharedUrls.get(b.source_url) ?? 0) + 1);

  const candidates: Candidate[] = catalog.map((benefit) => ({
    benefit,
    queued: false,
    reports: reports[benefit.id] ?? 0,
  }));
  const catalogIds = new Set(catalog.map((b) => b.id));
  for (const item of queue) {
    const parsed = Benefit.safeParse(item.benefit);
    if (!parsed.success || catalogIds.has(parsed.data.id)) continue;
    candidates.push({
      benefit: parsed.data,
      queued: true,
      // `unpublish` queues a row because someone at a till said it was wrong.
      reports: Math.max(reports[parsed.data.id] ?? 0, /דווח/.test(item.reason ?? '') ? 1 : 0),
    });
  }

  /** The checks that cost nothing: terms, a second source, reports, a snapshot. */
  const freeChecks = (candidate: Candidate): { checks: VerificationCheck[]; snapshot?: Snapshot } => {
    const { benefit } = candidate;
    const contradiction = termsContradiction(benefit);
    const checks: VerificationCheck[] = [
      { code: 'terms_consistent', outcome: contradiction ? 'fail' : 'pass', detail: contradiction },
      secondSource(benefit, catalog),
      {
        code: 'user_reports',
        outcome: candidate.reports > 0 ? 'fail' : 'pass',
        detail: String(candidate.reports),
      },
    ];
    const snapshot = snapshotFor(snapshots, benefit);
    if (snapshot) {
      checks.push({
        code: 'seen_in_recrawl',
        outcome: offerOnPage(snapshot.text, benefit, { shared: (sharedUrls.get(benefit.source_url) ?? 0) > 1 }),
        detail: `${snapshot.at}${snapshot.source === 'link_check' ? ' (link check)' : ''}`,
      });
    }
    return { checks, snapshot };
  };

  const judge = (candidate: Candidate, checks: VerificationCheck[], snapshot?: Snapshot): Judged => {
    const decision = decideVerification(checks, policy);
    const live = checks.some((c) => c.code === 'page_states_value' && c.outcome === 'pass');
    const evidenceAt =
      decision.state === 'confirmed' && !live && snapshot ? snapshot.at : now.toISOString();
    return { candidate, checks, decision, evidenceAt };
  };

  const judged = new Map<string, Judged>();
  const needsFetch: { candidate: Candidate; checks: VerificationCheck[]; snapshot?: Snapshot }[] = [];
  for (const candidate of candidates) {
    const { checks, snapshot } = freeChecks(candidate);
    const first = judge(candidate, checks, snapshot);
    judged.set(candidate.benefit.id, first);
    // A snapshot recent enough that the row is not even ageing settles it; a
    // rejection on the terms alone does too. Everything else is worth a fetch.
    const settled =
      first.decision.state === 'rejected' ||
      (first.decision.state === 'confirmed' &&
        now.getTime() - Date.parse(first.evidenceAt) <=
          freshnessFor(candidate.benefit).agingDays * 86_400_000);
    if (!settled) needsFetch.push({ candidate, checks, snapshot });
  }

  // Reported rows first — a report is the one signal that something changed —
  // then the rows that have gone longest without proof.
  needsFetch.sort(
    (a, b) =>
      b.candidate.reports - a.candidate.reports ||
      a.candidate.benefit.last_verified_at.localeCompare(b.candidate.benefit.last_verified_at),
  );

  const pages = new Map<string, FetchResult>();
  const refusals = new Map<string, number>();
  const lastHit = new Map<string, number>();
  const blockedHosts = new Set<string>();
  let fetched = 0;

  for (const { candidate, checks, snapshot } of needsFetch) {
    const url = candidate.benefit.source_url;
    const host = hostOf(url);
    let page = pages.get(url);
    if (!page) {
      if (fetched >= limit || blockedHosts.has(host)) continue;
      const wait = (lastHit.get(host) ?? 0) + gapMs - Date.now();
      if (wait > 0) await sleep(wait);
      page = await fetcher(url);
      lastHit.set(host, Date.now());
      pages.set(url, page);
      fetched += 1;
      if (page.kind === 'blocked') {
        const count = (refusals.get(host) ?? 0) + 1;
        refusals.set(host, count);
        if (count >= HOST_GIVE_UP_AFTER) {
          blockedHosts.add(host);
          log(`  ${host} refused ${count} requests in a row — leaving it alone for this run`);
        }
      } else {
        refusals.set(host, 0);
      }
    }

    const live: VerificationCheck[] =
      page.kind === 'page'
        ? [
            { code: 'source_reachable', outcome: 'pass' },
            {
              code: 'page_names_merchant',
              // A listing or home page shared by many rows not naming one of
              // them says nothing about that one: same rule as the value.
              outcome: ((outcome) =>
                outcome === 'fail' && (sharedUrls.get(candidate.benefit.source_url) ?? 0) > 1
                  ? 'unknown'
                  : outcome)(merchantOnPage(page.text, candidate.benefit.merchant_name)),
            },
            {
              code: 'page_states_value',
              outcome: offerOnPage(page.text, candidate.benefit, {
                shared: (sharedUrls.get(candidate.benefit.source_url) ?? 0) > 1,
              }),
            },
          ]
        : [
            {
              code: 'source_reachable',
              outcome: page.kind === 'gone' ? 'fail' : 'unknown',
              detail: page.detail,
            },
          ];
    judged.set(candidate.benefit.id, judge(candidate, [...live, ...checks], snapshot));
  }

  // --- apply -----------------------------------------------------------------
  const report: VerifyReport = {
    total: candidates.length,
    confirmed: 0,
    unverified: 0,
    rejected: 0,
    kept: 0,
    promoted: 0,
    takenDown: 0,
    conclusive: 0,
    fetched,
    blockedHosts: [...blockedHosts],
    aborted: null,
    written: false,
  };
  const audit: AuditEntry[] = [];
  const next: Benefit[] = [];
  const promotedIds = new Set<string>();
  let conclusive = 0;
  let takenDown = 0;

  for (const { candidate, checks, decision, evidenceAt } of judged.values()) {
    const { benefit, queued } = candidate;
    const previous = benefit.verification?.state;
    const entry = (to: AuditEntry['to']): AuditEntry => ({
      at: now.toISOString(),
      id: benefit.id,
      merchant: benefit.merchant_name,
      source_url: benefit.source_url,
      from: queued ? 'queued' : (previous ?? 'none'),
      to,
      score: decision.score,
      reasons: decision.reasons,
      checks,
    });

    if (queued) {
      // The queue holds what the confidence gate refused. Only evidence lets a
      // row out of it; anything short of confirmed stays exactly where it is.
      if (decision.state !== 'confirmed') continue;
      report.promoted += 1;
      report.confirmed += 1;
      promotedIds.add(benefit.id);
      audit.push(entry('confirmed'));
      next.push({
        ...benefit,
        verification: toVerification(decision, checks, evidenceAt),
        last_verified_at: evidenceAt,
      });
      continue;
    }

    // "Could not check" must not undo an earlier confirmation: the row keeps
    // its verdict and its old date, and the freshness rules age it out.
    if (!decision.conclusive && previous === 'confirmed') {
      report.kept += 1;
      next.push(benefit);
      continue;
    }
    if (decision.conclusive) conclusive += 1;

    const unchanged =
      previous === decision.state &&
      (decision.state !== 'confirmed' || evidenceAt <= benefit.verification!.checked_at);
    if (unchanged) {
      next.push(benefit);
      continue;
    }

    report[decision.state] += 1;
    // Taken down: a row people could see as usable that this run conclusively
    // demotes or rejects. A first "could not check" label is not one.
    if (decision.conclusive && decision.state !== 'confirmed' && previous !== decision.state) {
      takenDown += 1;
    }
    audit.push(entry(decision.state));
    next.push({
      ...benefit,
      verification: toVerification(decision, checks, evidenceAt),
      // Forward only, and only on a confirmation: no other outcome is proof.
      last_verified_at:
        decision.state === 'confirmed' && evidenceAt > benefit.last_verified_at
          ? evidenceAt
          : benefit.last_verified_at,
    });
  }

  report.takenDown = takenDown;
  report.conclusive = conclusive;
  const verdict = changeGuard({ checked: conclusive, takenDown }, guard);
  if (!verdict.ok) {
    report.aborted = verdict.reason;
    log(`STOPPED: ${verdict.reason}`);
    log('Nothing was written. The catalog is exactly as it was.');
    return report;
  }

  if (dryRun) return report;
  if (audit.length === 0) return report;

  await mkdir(dirname(p.audit), { recursive: true });
  // The kill switch's other half: what `--revert` puts back.
  await copyFile(p.catalog, p.lastGood);
  await writeFile(p.catalog, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  if (promotedIds.size > 0) {
    const remaining = queue.filter(
      (item) => !promotedIds.has((item.benefit as { id?: string } | null)?.id ?? ''),
    );
    await writeFile(p.queue, `${JSON.stringify(remaining, null, 2)}\n`, 'utf8');
  }
  await appendFile(p.audit, audit.map((entry) => JSON.stringify(entry)).join('\n') + '\n', 'utf8');
  report.written = true;
  return report;
}

/** The kill switch: put back the catalog as it was before the last write. */
export async function revertVerify(root: string): Promise<boolean> {
  const p = paths(root);
  try {
    await copyFile(p.lastGood, p.catalog);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * A few of this run's confirmations, for anyone who wants to check the checker.
 * Nothing waits on it being read.
 */
export async function sampleAudit(root: string, since: string, size = 10): Promise<AuditEntry[]> {
  let lines: string[];
  try {
    lines = (await readFile(paths(root).audit, 'utf8')).split('\n').filter(Boolean);
  } catch {
    return [];
  }
  const entries = lines
    .map((line) => JSON.parse(line) as AuditEntry)
    .filter((entry) => entry.at >= since && entry.to === 'confirmed');
  const step = Math.max(1, Math.floor(entries.length / size));
  return entries.filter((_, index) => index % step === 0).slice(0, size);
}
