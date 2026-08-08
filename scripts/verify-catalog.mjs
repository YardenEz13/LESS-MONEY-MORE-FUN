#!/usr/bin/env node
/**
 * Network verification of the catalog. The companion to `validate-data.mjs`.
 *
 *   validate-data  offline, runs in CI, fails the build. Shape and references:
 *                  does this benefit name a program that exists.
 *   verify-catalog online, run by hand, never fails the build. Truth:
 *                  is this domain real, does that source page still exist.
 *
 * They are separate because the second kind of check cannot gate a build — a
 * site being down for an hour is not a reason to fail CI, and a check that
 * cries wolf gets ignored, which is worse than not having it.
 *
 *   node scripts/verify-catalog.mjs              # domains only (fast)
 *   node scripts/verify-catalog.mjs --sources    # also check every source_url
 *
 * What a failure here means, by field:
 *
 *   domains    used only to match the hostname of a *shared* URL, never
 *              fetched by the app. `url.ts` strips `www.` from both sides, so
 *              store the registrable domain. An apex that does not serve HTTP
 *              is therefore fine — this script checks `www.` too before
 *              reporting anything, so it does not cry wolf over that.
 *   source_url what the user opens from the detail screen to read the terms
 *              themselves. A 404 here means the offer moved and the benefit is
 *              probably stale, whatever `last_verified_at` claims.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkSources = process.argv.includes('--sources');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';

async function head(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': UA, 'accept-language': 'he-IL,he;q=0.9' },
    });
    return { ok: response.ok, status: response.status, finalHost: new URL(response.url).hostname };
  } catch (error) {
    return { ok: false, status: 0, error: String(error.name ?? error) };
  } finally {
    clearTimeout(timer);
  }
}

const read = async (name) => JSON.parse(await readFile(resolve(root, 'data', name), 'utf8'));
const [merchants, benefits] = await Promise.all([read('merchants.json'), read('benefits.json')]);

console.log('domains');
const domainProblems = [];
for (const merchant of merchants) {
  for (const domain of merchant.domains) {
    // Try the apex, then www — plenty of Israeli sites serve only one of them,
    // and either proves the registrable domain is real, which is all the
    // share-sheet matcher needs.
    let result = await head(`https://${domain}/`);
    if (!result.ok) result = await head(`https://www.${domain}/`);

    if (result.ok) {
      console.log(`  .  ${domain}`);
    } else if (result.status === 403) {
      // Bot protection. The host answered, so the domain exists.
      console.log(`  ~  ${domain}  403 (bot-blocked; host is real)`);
    } else {
      console.log(`  !  ${domain}  ${result.error ?? `HTTP ${result.status}`}`);
      domainProblems.push({ merchant: merchant.id, domain, result });
    }
  }
}

const withDomain = merchants.filter((m) => m.domains.length > 0);
const noDomain = merchants.filter((m) => m.domains.length === 0 && m.id !== 'any_merchant');
const noVenue = merchants.filter((m) => m.venue_ids.length === 0 && m.id !== 'any_merchant');

console.log(`\n${merchants.length} merchants — ${withDomain.length} with a domain, ${noDomain.length} without`);
console.log(`${noVenue.length} have no venue, so no geofence reminder can fire for them`);

if (checkSources) {
  console.log('\nsource urls');
  const urls = [...new Set(benefits.map((b) => b.source_url))];
  for (const url of urls) {
    if (url.includes('example.invalid')) {
      console.log(`  ~  ${url}  (synthetic sample, not a real page)`);
      continue;
    }
    const result = await head(url);
    console.log(`  ${result.ok ? '.' : '!'}  ${url}  ${result.ok ? '' : result.error ?? `HTTP ${result.status}`}`);
  }
}

if (domainProblems.length > 0) {
  console.log('\nunverified — check these from your own network before trusting them:');
  for (const problem of domainProblems) {
    console.log(`  ${problem.merchant.padEnd(20)} ${problem.domain}`);
  }
  console.log('\nA domain that cannot be confirmed is worse than none: it makes the');
  console.log('share sheet silently fail to match instead of obviously not matching.');
}
