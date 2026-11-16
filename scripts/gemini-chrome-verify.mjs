#!/usr/bin/env node
/**
 * Verify offers with YOUR Gemini account, driving YOUR Chrome. No API key.
 *
 * Chrome runs with a remote-debugging port and a dedicated profile you log into
 * Gemini once (scripts/start-chrome-gemini.ps1). This script attaches to it, and
 * for each stale offer:
 *   1. opens the offer's source page in a tab and reads the rendered text
 *      (so JS-rendered catalogs such as Cal work too, unlike plain HTTP);
 *   2. opens a fresh Gemini chat, pastes the same question the API version asks,
 *      and reads the JSON answer;
 *   3. applies the SAME guards as gemini-verify.mjs: the quote must occur in the
 *      page text and the offer's number must be on the page. Otherwise: unclear.
 *
 * What it will not do: solve or work around a captcha, challenge or block. A 403,
 * 429 or a challenge page counts as a refusal; after REFUSALS_BEFORE_STOP in a
 * row from one site it skips that site for the run. It paces itself (default 8 s
 * per offer) because it is your real browser and your real account.
 *
 * The Gemini page markup is not an API and changes. Selectors are listed in
 * SELECTORS; run with --probe to see which ones match today and fix them there.
 *
 *   node scripts/gemini-chrome-verify.mjs --probe
 *   node scripts/gemini-chrome-verify.mjs [--write] [--max 40] [--venue azrieli_tlv]
 *        [--programs max,cal] [--min-age-days 14] [--port 9222] [--gap-s 8]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SYSTEM, REPORT, applyVerdicts, checkVerdict, selectRows, venueBenefitIds } from './gemini-verify.mjs';

export const SELECTORS = {
  input: ['rich-textarea div[contenteditable="true"]', 'div.ql-editor[contenteditable="true"]', 'div[role="textbox"]'],
  send: ['button[aria-label*="Send" i]', 'button.send-button', 'button[mat-icon-button][aria-label*="שלח"]'],
  stop: ['button[aria-label*="Stop" i]', 'button[aria-label*="עצור"]'],
  answer: ['model-response message-content', 'message-content.model-response-text', '.model-response-text'],
};
const GEMINI_URL = process.env.GEMINI_URL ?? 'https://gemini.google.com/app';
const PAGE_CHARS = 8_000;
const REFUSALS_BEFORE_STOP = 3;
const CHALLENGE = /captcha|are you a robot|verify you are human|access denied|just a moment|בדיקת אבטחה|אימות אנושי/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** First selector that matches something visible, or null. */
async function pick(page, list) {
  for (const sel of list) {
    const loc = page.locator(sel).last();
    if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) return loc;
  }
  return null;
}

/** The model's reply is JSON, possibly wrapped in prose or a code fence. */
export function parseAnswer(text) {
  const match = String(text ?? '').match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

export function buildPrompt(row, pageText) {
  return `${SYSTEM}

Reply with ONLY the JSON object, no other text.

Merchant: ${row.merchant_name}
Club id: ${row.program_id}
Kind: ${row.type}
Value: ${row.value}
Terms summary: ${row.conditions?.raw_text_summary ?? ''}

--- PAGE TEXT ---
${pageText}`;
}

async function readSource(context, url) {
  const tab = await context.newPage();
  try {
    const res = await tab.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const status = res?.status() ?? 0;
    if (status === 403 || status === 429) return { refused: true };
    await tab.waitForTimeout(2500); // let a client-rendered catalog paint
    const title = await tab.title().catch(() => '');
    const text = (await tab.evaluate(() => document.body?.innerText ?? '')).replace(/\s+/g, ' ').trim();
    if (CHALLENGE.test(title) || (text.length < 400 && CHALLENGE.test(text))) return { refused: true };
    if (status === 404 || status === 410) return { gone: true };
    return { text: text.slice(0, PAGE_CHARS) };
  } finally {
    await tab.close().catch(() => {});
  }
}

async function askGemini(context, prompt) {
  const tab = await context.newPage();
  try {
    await tab.goto(GEMINI_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await tab.waitForTimeout(2500);
    if (/accounts\.google\.com/.test(tab.url())) throw new Error('not logged in to Gemini in this Chrome profile');
    const input = await pick(tab, SELECTORS.input);
    if (!input) throw new Error('Gemini input box not found: run --probe and update SELECTORS');
    await input.click();
    await input.fill(prompt);
    const send = await pick(tab, SELECTORS.send);
    if (send) await send.click();
    else await tab.keyboard.press('Enter');
    // Done when the stop button is gone and the answer text has stopped changing.
    let last = '';
    let stable = 0;
    for (let i = 0; i < 90 && stable < 3; i++) {
      await sleep(1000);
      const stopping = await pick(tab, SELECTORS.stop);
      const answer = await pick(tab, SELECTORS.answer);
      const text = answer ? ((await answer.innerText().catch(() => '')) ?? '') : '';
      if (!stopping && text && text === last) stable += 1;
      else stable = 0;
      last = text;
    }
    if (!last) throw new Error('no answer from Gemini (limit reached? run --probe)');
    return last;
  } finally {
    await tab.close().catch(() => {});
  }
}

async function probe(context) {
  const tab = await context.newPage();
  await tab.goto(GEMINI_URL, { waitUntil: 'domcontentloaded' });
  await tab.waitForTimeout(3000);
  console.log('url:', tab.url());
  for (const [name, list] of Object.entries(SELECTORS)) {
    for (const sel of list) {
      const n = await tab.locator(sel).count();
      console.log(`${name.padEnd(7)} ${n > 0 ? 'MATCH' : '  -  '} ${sel}`);
    }
  }
  await tab.close();
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (n) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
  let chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    console.error('Run `npm install` first (playwright-core is a dev dependency).');
    process.exit(2);
  }
  const port = Number(opt('port') ?? 9222);
  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  } catch {
    console.error(`Cannot reach Chrome on port ${port}. Start it with scripts/start-chrome-gemini.ps1 and log in to Gemini once.`);
    process.exit(2);
  }
  const context = browser.contexts()[0];
  if (args.includes('--probe')) {
    await probe(context);
    await browser.close();
    return;
  }

  const rows = JSON.parse(await readFile('data/benefits.json', 'utf8'));
  const todo = selectRows(rows, {
    minAgeDays: Number(opt('min-age-days') ?? 14),
    max: Number(opt('max') ?? 40),
    programs: opt('programs')?.split(','),
    ids: opt('venue') ? await venueBenefitIds(opt('venue'), rows) : undefined,
  });
  const gapMs = Number(opt('gap-s') ?? 8) * 1000;
  const refusals = new Map();
  const results = [];
  for (const [i, row] of todo.entries()) {
    const host = new URL(row.source_url).host;
    if ((refusals.get(host) ?? 0) >= REFUSALS_BEFORE_STOP) {
      results.push({ id: row.id, verdict: 'unclear', reason: 'host_refusing' });
      continue;
    }
    try {
      const page = await readSource(context, row.source_url);
      if (page.refused) {
        refusals.set(host, (refusals.get(host) ?? 0) + 1);
        results.push({ id: row.id, verdict: 'unclear', reason: 'refused' });
      } else if (page.gone || !page.text) {
        results.push({ id: row.id, verdict: 'unclear', reason: 'page_gone' });
      } else {
        refusals.set(host, 0);
        const answer = parseAnswer(await askGemini(context, buildPrompt(row, page.text)));
        const verdict = checkVerdict(row, page.text, answer);
        results.push({ id: row.id, verdict, evidence: verdict === 'unclear' ? undefined : answer.evidence, url: row.source_url });
      }
    } catch (error) {
      results.push({ id: row.id, verdict: 'unclear', reason: String(error.message ?? error).slice(0, 140) });
      if (/not logged in|input box not found/.test(String(error.message))) break; // every row would fail the same way
    }
    const r = results.at(-1);
    console.log(`[${i + 1}/${todo.length}] ${r.verdict.padEnd(12)} ${row.merchant_name}${r.reason ? ` (${r.reason})` : ''}`);
    await sleep(gapMs);
  }
  await browser.close();

  const moved = args.includes('--write') ? applyVerdicts(rows, results) : 0;
  if (moved) await writeFile('data/benefits.json', `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
  await mkdir(dirname(REPORT), { recursive: true });
  await writeFile(REPORT, JSON.stringify({ at: new Date().toISOString(), via: 'chrome', moved, withdrawCandidates: results.filter((r) => r.verdict === 'not_offered'), results }, null, 1), 'utf8');
  const n = (v) => results.filter((r) => r.verdict === v).length;
  console.log(`\n${n('still_offered')} still offered, ${n('not_offered')} no longer offered, ${n('unclear')} unclear`);
  console.log(`${moved} rows moved forward${args.includes('--write') ? '' : ' (dry run: pass --write)'}; report -> ${REPORT}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
