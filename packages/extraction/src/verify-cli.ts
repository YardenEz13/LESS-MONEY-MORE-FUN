import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { revertVerify, runVerify, sampleAudit } from './verify';

const USAGE = `Usage: npm run verify:auto -- [options]

Confirms, demotes and retires offers in data/benefits.json on machine evidence.
No step waits for a person. See docs/DATA_SOURCES.md, "Automatic confirmation".

  --limit <n>   live page fetches this run may spend (default 200)
  --offline     no network: judge on collected snapshots only
  --queue       also judge data/generated/review-queue.json and promote what
                the evidence confirms
  --dry-run     report, write nothing
  --revert      kill switch: restore the catalog from before the last write
  --root <dir>  repo root (default: this repo)
  --help
`;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

const root = resolve(
  value('root') ?? process.env.SBR_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../..'),
);

async function main(): Promise<void> {
  if (flag('help')) {
    console.log(USAGE);
    return;
  }
  if (flag('revert')) {
    const restored = await revertVerify(root);
    console.log(
      restored
        ? 'restored data/benefits.json from data/generated/benefits.last-good.json'
        : 'nothing to restore: no verifier run has written the catalog on this machine',
    );
    if (!restored) process.exitCode = 1;
    return;
  }

  const startedAt = new Date();
  const limit = value('limit');
  const report = await runVerify({
    root,
    now: startedAt,
    limit: limit != null ? Number(limit) : undefined,
    offline: flag('offline'),
    dryRun: flag('dry-run'),
    includeQueue: flag('queue'),
  });

  console.log(`judged:      ${report.total}`);
  console.log(`confirmed:   ${report.confirmed}${report.promoted ? ` (${report.promoted} out of the review queue)` : ''}`);
  console.log(`unverified:  ${report.unverified}`);
  console.log(`taken down:  ${report.takenDown} of ${report.conclusive} conclusive verdicts (demoted or rejected on evidence; the rest of "unverified" is "could not check")`);
  console.log(`rejected:    ${report.rejected}`);
  console.log(`kept as-is:  ${report.kept}  (confirmed earlier, could not be re-checked this run)`);
  console.log(`fetched:     ${report.fetched} pages`);
  if (report.blockedHosts.length > 0) {
    console.log(`refused by:  ${report.blockedHosts.join(', ')}  (left alone — not retried, not worked around)`);
  }
  if (report.aborted) {
    process.exitCode = 1;
    return;
  }
  if (!report.written) {
    console.log(flag('dry-run') ? '\n--dry-run: nothing written' : '\nno verdict changed: nothing written');
    return;
  }
  console.log('\nwrote data/benefits.json  (undo: npm run verify:auto -- --revert)');
  const sample = await sampleAudit(root, startedAt.toISOString());
  if (sample.length > 0) {
    console.log('\na sample of what was confirmed, if you want to check the checker:');
    for (const entry of sample) console.log(`  ${entry.merchant} — ${entry.source_url}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
