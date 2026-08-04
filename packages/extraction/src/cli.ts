import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { importExtraction, runPipeline } from './pipeline';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

const USAGE = `Usage: npm run extract -- [options]

  --sources <path>   sources file (default packages/extraction/sources.json)
  --out <dir>        output dir  (default data/generated)
  --program <id>     only this program id
  --threshold <n>    confidence threshold (default 0.85, from @sbr/core)
  --offline          read fixtures instead of fetching
  --scrape-only      scrape and print sizes; no model call
  --help

Importing benefits collected by a browser agent (see docs/COWORK_SCRAPE_PROMPT.md):

  --import <path>    JSON file shaped like ExtractionResult
  --program <id>     program the benefits belong to   (required with --import)
  --source-url <url> page they were read from         (required with --import)
`;

function parseArgs(argv: string[]) {
  const args = { ...Object.create(null) } as Record<string, string | boolean>;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token?.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const outDir = resolve(repoRoot, typeof args.out === 'string' ? args.out : 'data/generated');

  if (typeof args.import === 'string') {
    if (typeof args.program !== 'string' || typeof args['source-url'] !== 'string') {
      throw new Error('--import also needs --program <id> and --source-url <url>');
    }
    const imported = await importExtraction({
      dataDir: resolve(repoRoot, 'data'),
      outDir,
      file: resolve(repoRoot, args.import),
      programId: args.program,
      sourceUrl: args['source-url'],
      threshold: typeof args.threshold === 'string' ? Number(args.threshold) : undefined,
    });
    console.log('\n--- import summary ---');
    console.log(`extracted: ${imported.extracted}`);
    console.log(`published: ${imported.published}`);
    console.log(`review:    ${imported.queuedForReview}`);
    if (imported.queuedForReview > 0) {
      console.log('\nReview queue is not empty — those benefits will NOT reach the app until approved.');
    }
    return;
  }

  const scrapeOnly = args['scrape-only'] === true;
  if (!scrapeOnly && !args.offline && !process.env.ANTHROPIC_API_KEY) {
    // Not fatal: the SDK also accepts ANTHROPIC_AUTH_TOKEN or an `ant auth
    // login` profile, so warn rather than refuse.
    console.warn('! ANTHROPIC_API_KEY is not set — relying on another credential source');
  }

  const report = await runPipeline({
    rootDir: repoRoot,
    dataDir: resolve(repoRoot, 'data'),
    outDir,
    sourcesFile: resolve(
      repoRoot,
      typeof args.sources === 'string' ? args.sources : 'packages/extraction/sources.json',
    ),
    offline: args.offline === true,
    scrapeOnly,
    onlyProgram: typeof args.program === 'string' ? args.program : undefined,
    threshold: typeof args.threshold === 'string' ? Number(args.threshold) : undefined,
  });

  console.log('\n--- run summary ---');
  console.log(`scraped:   ${report.scraped}`);
  console.log(`extracted: ${report.extracted}`);
  console.log(`published: ${report.published}`);
  console.log(`review:    ${report.queuedForReview}`);
  console.log(`tokens:    ${report.usage.inputTokens} in / ${report.usage.outputTokens} out`);
  if (report.failures.length > 0) {
    console.log(`failures:  ${report.failures.length}`);
    for (const failure of report.failures) console.log(`  - ${failure.url}: ${failure.error}`);
  }
  if (report.queuedForReview > 0) {
    console.log('\nReview queue is not empty — those benefits will NOT reach the app until approved.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
