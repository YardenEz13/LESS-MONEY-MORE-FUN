#!/usr/bin/env node
/**
 * "Is it done yet?" — one command.
 *
 * Answers the only three questions worth asking between runs: how much of the
 * catalog is proven, whether a job is running right now, and when the next one
 * fires. Everything here is read-only; it never touches the network.
 *
 *   npm run status
 */
import { readFile, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

async function coverage() {
  let total = 0;
  let verified = 0;
  let oldest = null;
  for (const file of (await readdir('collected/easy')).filter((f) => f.endsWith('.jsonl'))) {
    for (const line of (await readFile(`collected/easy/${file}`, 'utf8')).split('\n')) {
      if (!line.trim()) continue;
      total += 1;
      const at = JSON.parse(line).verified_at;
      if (!at) continue;
      verified += 1;
      if (!oldest || at < oldest) oldest = at;
    }
  }
  return { total, verified, oldest };
}

/** Last line matching `re`, or null. Logs are appended, so newest is last. */
async function lastLine(path, re) {
  try {
    const lines = (await readFile(path, 'utf8')).split('\n').filter((l) => re.test(l));
    return lines.at(-1)?.trim() ?? null;
  } catch {
    return null;
  }
}

async function tasks() {
  try {
    const { stdout } = await execFileP('powershell', [
      '-NoProfile',
      '-Command',
      `Get-ScheduledTask -TaskName 'LessMoneyMoreFun*' | ForEach-Object { $i = $_ | Get-ScheduledTaskInfo; '{0}|{1}|{2}' -f $_.TaskName, $_.State, $i.NextRunTime }`,
    ]);
    return stdout.trim().split('\n').filter(Boolean).map((l) => l.trim().split('|'));
  } catch {
    return [];
  }
}

const { total, verified, oldest } = await coverage();
const pct = total ? Math.round((verified / total) * 100) : 0;
const bar = '█'.repeat(Math.round(pct / 5)).padEnd(20, '·');

console.log(`\nlinks proven   ${bar} ${pct}%  (${verified}/${total})`);
if (verified < total) {
  const days = Math.ceil((total - verified) / 500);
  console.log(`               ~${days} more daily pass${days === 1 ? '' : 'es'} to full coverage`);
}
if (oldest) console.log(`oldest proof   ${oldest.slice(0, 10)}`);

console.log('\nscheduled');
for (const [name, state, next] of await tasks()) {
  const label = state === 'Running' ? 'RUNNING NOW' : `next ${next}`;
  console.log(`  ${name.padEnd(36)} ${label}`);
}

console.log('\nlast outcome');
const weekly = await lastLine('data/generated/weekly-refresh.log', /^RESULT:/);
const daily = await lastLine('data/generated/link-check.log', /^COVERAGE:/);
console.log(`  weekly refresh   ${weekly ?? 'no run yet'}`);
console.log(`  daily link check ${daily ?? 'no run yet'}`);
console.log();
