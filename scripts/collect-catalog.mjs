#!/usr/bin/env node
/**
 * Collect a Tier-1 benefits catalog into the same JSONL the browser collector
 * produces.
 *
 * This is Route B without the manual browser session — and, by default, without
 * a paid rendering API. The catalogs that carry the actual *conditions* look
 * client-rendered, but only their **navigation** is: max.co.il/benefits is an
 * Angular shell with no offer links in the HTML, while every offer page under it
 * is server-rendered and answers a plain GET with its `חשוב לדעת` block intact.
 *
 * So the two halves have different needs, and separating them is what makes this
 * free: *discovery* wants a rendered DOM and happens rarely (offer URLs rotate
 * monthly), so it lives in `scripts/seeds/<program>.txt`; *collection* is plain
 * HTTP and is the half that repeats.
 *
 * Output: collected/catalogs/<program>.jsonl, ready for
 *   npm run extract -- --collected collected/catalogs/max.jsonl --program max
 *
 * It stops at raw text on purpose. Crawling is cheap and repeatable, extraction
 * is the expensive judgement step, and keeping the seam means a prompt or
 * schema change can be re-run without touching the sites again.
 *
 * Why sections matter here and not on easy: `collected.ts` promotes the
 * `חשוב לדעת` block to the top of the model prompt, ahead of marketing copy.
 * Both transports produce headings, so that block survives as a section — which
 * is the whole reason this route yields conditions at all.
 *
 * Sites that render their offer *pages* in the browser too (adif.org.il returns
 * 6 characters of text) still need `--transport firecrawl`, or a browser
 * session. Those are named in scripts/firecrawl-sources.json.
 *
 * ponytail: no headless browser dependency. Seeds are a text file a human or a
 * browser session refreshes; add Playwright only if that ever stops being true.
 */
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const API = 'https://api.firecrawl.dev/v2';
const KEY = process.env.FIRECRAWL_API_KEY;

/** The section Israeli card catalogs put the binding terms in. */
const BINDING_TERMS_HEADING = 'חשוב לדעת';

const OFFER_TERMS = /הנחה|הנחות|מבצע|מבצעים|הטבה|הטבות|קופון|שובר|זיכוי|קאשבק|החזר|מועדון|%|₪/g;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ *
 * Plain-fetch transport — the default, and the reason this script no
 * longer needs a paid API.
 *
 * The catalogs split in a way that is easy to miss: max.co.il/benefits is
 * an Angular shell (85KB, no offer links in the HTML), but every *offer*
 * page under it is server-rendered — plain curl returns 90KB with the
 * `חשוב לדעת` block present. So rendering was never needed for the part
 * that carries the product; only for *finding* the URLs.
 *
 * Discovery therefore moves out of the run and into `scripts/seeds/<program>.txt`,
 * refreshed occasionally from a browser. Collection stays free HTTP, which
 * is the half that has to repeat.
 * ------------------------------------------------------------------ */

/** A real browser UA: max answers a default Node fetch with a challenge. */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

/** The handful of named entities that actually show up in Hebrew retail HTML. */
const NAMED_ENTITIES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", shy: '',
  ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', bull: '•',
  middot: '·', deg: '°', times: '×', trade: '™', reg: '®', copy: '©',
  euro: '€', pound: '£', ils: '₪',
};

function decodeEntities(input) {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z][a-z0-9]*);/gi, (whole, name) => {
      const hit = NAMED_ENTITIES[name.toLowerCase()];
      return hit === undefined ? whole : hit;
    });
}

/**
 * Content-Type wins, then `<meta charset>`, then UTF-8 — hvr.co.il still
 * serves windows-1255, and decoded as UTF-8 it yields zero Hebrew characters.
 */
function detectCharset(contentType, bytes) {
  const fromHeader = contentType?.match(/charset=["']?\s*([\w-]+)/i)?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  const head = Buffer.from(bytes.subarray(0, 4096)).toString('latin1');
  return (head.match(/<meta[^>]+charset=["']?\s*([\w-]+)/i)?.[1] ?? 'utf-8').toLowerCase();
}

/**
 * HTML to the markdown-ish shape the section parser already reads.
 *
 * Only headings and block boundaries matter: `sectionsFromMarkdown` keys off
 * `#` lines and the known plain labels, and everything downstream is unchanged.
 */
export function htmlToMarkdown(html) {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(
        /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
        (_, level, body) => `\n\n${'#'.repeat(Number(level))} ${body.replace(/<[^>]+>/g, ' ').trim()}\n\n`,
      )
      .replace(/<li\b[^>]*>/gi, '\n- ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|section|article|h[1-6])\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Fetch one page and return the same shape the Firecrawl transport returns. */
async function fetchPage(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': UA, 'accept-language': 'he-IL,he;q=0.9,en;q=0.5' },
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const html = new TextDecoder(detectCharset(response.headers.get('content-type'), bytes))
    .decode(bytes);
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim();
  return { markdown: htmlToMarkdown(html), metadata: { title, statusCode: response.status } };
}

async function firecrawl(path, body, tries = 3) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    let response;
    try {
      response = await fetch(`${API}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (error) {
      if (attempt === tries) throw error;
      await sleep(4000 * attempt);
      continue;
    }
    // 429 is a quota talking. Back off; never tighten the loop.
    if (response.status === 429 && attempt < tries) {
      await sleep(15_000 * attempt);
      continue;
    }
    const json = await response.json();
    if (json?.success === false && attempt < tries) {
      await sleep(4000 * attempt);
      continue;
    }
    return json;
  }
  throw new Error(`${path}: exhausted ${tries} attempts`);
}

/**
 * Section labels these catalogs write as plain paragraphs.
 *
 * `#` and `**bold**` are unambiguous markup and are always honoured. A bare
 * line is not: "20% הנחה לחברי מועדון" is short, standalone and looks exactly
 * like a label, so any generic short-line rule swallows real offer text as a
 * heading. Only these known labels are promoted — an unrecognised one simply
 * stays in the body, which costs nothing, because the only key anything
 * downstream looks up by name is `חשוב לדעת`.
 */
const PLAIN_LABELS = new Set([
  'חשוב לדעת', 'תנאים', 'תנאי ההטבה', 'תנאי השימוש', 'תנאי המבצע', 'תקנון',
  'פרטים נוספים', 'מידע נוסף', 'הערות', 'כל הפרטים', 'איך זה עובד?',
  'איך מממשים?', 'הגבלות', 'סייגים', 'למי זה מתאים?',
]);

/**
 * Is this line acting as a heading?
 *
 * Not just `#`. The catalogs style their section labels with CSS rather than
 * heading elements, so the one that matters most arrives as a bare paragraph:
 * max.co.il emits `חשוב לדעת` — the binding terms — as plain text between two
 * blank lines. Matching only ATX headings finds none of them, and the terms
 * sink to the bottom of a truncated prompt: the exact failure this route exists
 * to fix.
 */
function headingAt(lines, i) {
  const line = lines[i].trim();
  if (!line) return null;

  const atx = /^#{1,6}\s+(.+?)\s*$/.exec(line);
  if (atx) return clean(atx[1]).replace(/:$/, '');

  const bold = /^\*\*\s*([^*]+?)\s*\*\*:?$/.exec(line);
  if (bold) return clean(bold[1]).replace(/:$/, '');

  const blankBefore = i === 0 || !lines[i - 1].trim();
  const blankAfter = i + 1 >= lines.length || !lines[i + 1].trim();
  if (!blankBefore || !blankAfter) return null;
  const label = clean(line).replace(/:$/, '');
  return PLAIN_LABELS.has(label) ? label : null;
}

/**
 * Split Firecrawl markdown into { heading -> body }.
 *
 * Everything above the first heading is dropped: it is site chrome — skip
 * links, nav, cookie bars — and never the offer. Bodies are stripped of link
 * syntax and images so the model reads prose rather than URL noise.
 */
export function sectionsFromMarkdown(markdown) {
  const sections = {};
  const lines = markdown.split('\n');
  let heading = null;
  let buffer = [];

  const flush = () => {
    if (!heading) return;
    const raw = buffer.join('\n');
    const body = clean(raw);
    // A heading with no prose under it is a nav label, not a section. Link text
    // does not count as prose: `clean` unwraps `[עמוד הבית](/)` to a bare word,
    // so a footer menu would otherwise read as content and dilute the prompt.
    if (body && !isLinksOnly(raw)) {
      sections[heading] = sections[heading] ? `${sections[heading]}\n${body}` : body;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const next = headingAt(lines, i);
    if (next) {
      flush();
      heading = next;
      buffer = [];
    } else if (heading) {
      buffer.push(lines[i]);
    }
  }
  flush();
  return sections;
}

/**
 * The "נגיש בקליק" accessibility toolbar, which most Israeli retail sites
 * embed. It renders as a run of short menu lines plus a language switcher, and
 * `onlyMainContent` does not remove it — one collected record was 400 chars of
 * font-size controls before its first word about the offer. It is pure chrome:
 * every site's copy is identical, so it tells the model nothing and crowds out
 * the terms inside the prompt window.
 */
/**
 * Matched as keywords, not whole lines, and against a short line only.
 *
 * Anchored full-line patterns are brittle here: the same control is written
 * `גווני אפור` unpointed and `גְּוָנֵי אֲפוֹר` pointed, and stripping the points
 * leaves `גוני` — a different string, defeating an exact match. Sites also vary
 * the wording ("סגירה", "כלי נגישות", "תפריט נגישות"). A keyword inside a line
 * of 40 characters or less is the tolerant version of the same test; real offer
 * text does not talk about screen readers and contrast.
 */
const A11Y_KEYWORD =
  /נגישות|ניגודיות|גו{1,2}ני אפור|שחור לבן|קורא\S* מסך|הגדלת טקסט|הקטנת טקסט|גודל גופן|איפוס|ריווח|זכוכית מגדלת|הדגשת קישורים|טקסט מודגש|מפת אתר|עצירת אנימציות|מונחים ו?ביטויים|גופן קריא|פוקוס המקלדת|סמן ה?עכבר|הדפסה נגישה|מיקוד אזור התוכן|ניווט לפי|לפתיחת התפריט|נגיש בקליק|צבע (רקע|כותרת|טקסט)|דלג (מעל|אל)/;

/**
 * Hebrew vowel points. The same widget ships pointed on some sites
 * (`כְּלֵי נְגִישׁוּת`) and unpointed on others, and the pointed copy sailed
 * straight through the filter into three collected catalogs. Points are removed
 * for the comparison only — never from the text that reaches the model, where
 * they are simply how that page is written.
 */
const NIQQUD = /[֑-ׇ]/g;

/** Vowel points and list bullets removed, for comparison only. */
function stripPoints(line) {
  return line.trim().replace(/^[-*+•]\s*/, '').replace(NIQQUD, '').replace(/[:.]$/, '').trim();
}

/** `enEnglishheעבריתruРусский…` — the language switcher collapsed to one line. */
const LANG_BLOB = /^(?:[a-z]{2}[^\s]{2,12}){3,}$/;

/**
 * Toolbar glyphs and stray control labels the widget leaves behind.
 *
 * Deliberately does NOT match a bare percentage. The zoom control renders as
 * `100%`, but so does a discount on its own line — and dropping "20%" before
 * the model ever sees it is the one mistake this whole route exists to prevent.
 * A stray zoom level surviving into the prompt costs nothing by comparison.
 */
const WIDGET_NOISE = /^(✔|✖|⯈|◀|▶|\+|-|he|en|ru|ar|es|fr|it|ro|pt|de|nl|pl|cs|sr|el|עברית|English)$/;

function isChrome(line) {
  // The widget renders its controls as list items, so the bullet comes off
  // before the comparison, along with vowel points and a trailing colon.
  const t = stripPoints(line);
  if (!t) return true;
  if (t.length <= 40 && A11Y_KEYWORD.test(t)) return true;
  return LANG_BLOB.test(t) || WIDGET_NOISE.test(t) || /^סגירה$/.test(t);
}

/**
 * Does this line carry an actual offer?
 *
 * Not the same question as `OFFER_TERMS`, which exists to judge a whole page
 * and counts a bare `%`. Here a bare `%` is actively misleading: the font-size
 * and zoom controls render as `100%`, and treating those as offer content
 * split every widget into fragments the run rule could not see. So a real offer
 * line needs an offer *word*, a shekel sign, or a percentage that is not 100%.
 */
function isOfferLine(line) {
  if (/הנחה|הנחות|הטבה|הטבות|מבצע|מבצעים|קופון|שובר|זיכוי|קאשבק|החזר|מועדון|₪/.test(line)) {
    return true;
  }
  const pct = line.match(/(\d+)%/);
  return Boolean(pct) && pct[1] !== '100';
}

/**
 * Drop the accessibility toolbar as a *block*, not line by line.
 *
 * Enumerating its vocabulary does not converge: after `ניגודיות` and
 * `קורא מסך` came `ריווח בין מילים`, `הסתרת תמונות`, `קוראי מסך`,
 * `סמן גדול כהה` — every site ships a slightly different build, pointed or
 * unpointed. What is stable is the shape: a run of short control labels with no
 * offer vocabulary anywhere in it. So find runs of short offer-free lines and
 * drop the whole run when any line in it is recognisably accessibility
 * furniture. One rule, instead of a list that grows every time a new site is
 * added.
 */
function dropChromeRuns(lines) {
  const short = (l) => l.length <= 40 && !isOfferLine(l);
  const kept = [];
  for (let i = 0; i < lines.length; ) {
    let j = i;
    while (j < lines.length && short(lines[j])) j++;
    const run = lines.slice(i, j);
    // Four is the shortest run that is reliably a menu rather than a genuine
    // short list of offer bullets.
    const isChromeRun = run.length >= 4 && run.some((l) => A11Y_KEYWORD.test(stripPoints(l)));
    if (!isChromeRun) kept.push(...run);
    if (j === i) kept.push(lines[i++]);
    else i = j;
  }
  return kept;
}

/** Nothing here but images and links — a menu, not a section of the offer. */
function isLinksOnly(text) {
  return !text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[-*_`>|#\s]/g, '')
    .trim();
}

/** Markdown to plain prose: drop images, unwrap links, collapse whitespace. */
function clean(text) {
  const lines = text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Markdown escapes, before the characters they escape are stripped —
    // otherwise `\*` becomes a bare `\` littered through the terms text.
    .replace(/\\([*_\-#.[\]()])/g, '$1')
    // Whatever escapes are left are litter, not content: the style.co.il pages
    // separate their offer cards with runs of bare backslashes.
    .replace(/\\+/g, ' ')
    .replace(/[*_`>]/g, ' ')
    .replace(/^\s*[-–—]\s*$/gm, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  // Blocks first, then stragglers. Doing it the other way round lets the
  // line-level filter delete the very lines that hold a run together, splitting
  // one toolbar into fragments too short for the run rule to recognise.
  return dropChromeRuns(lines)
    .filter((line) => !isChrome(line))
    .join('\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * The business name, as written on the page.
 *
 * The `<title>` is written for search engines — "ווטרלנד - פארק המים של אילת –
 * MAX הטבות בכרטיס אשראי" — and the merchant matcher compares these strings, so
 * the brand suffix has to go. The h1 is the page's own name for the business
 * and is preferred; the title is the fallback, trimmed at its last separator.
 */
export function merchantName(markdown, metaTitle) {
  const h1 = /^#\s+(.+?)\s*$/m.exec(markdown ?? '');
  if (h1) return clean(h1[1]);
  const title = clean(metaTitle ?? '');
  // Split on the separators sites use between page name and brand, not on the
  // hyphens inside a name ("פארק המים - אילת" must survive intact).
  return title.split(/\s+[–—|]\s+/)[0].trim();
}

/**
 * One offer page -> one CollectedRecord, or null if the page is not an offer.
 *
 * Loud beats silent: a catalog index or an error page that slipped through
 * /map should be skipped here rather than spend a model call proving it has no
 * benefits on it.
 */
export function toRecord(url, page, { site, program, maxChars = 20_000, catalogPage = false }) {
  const markdown = page?.markdown ?? '';
  const sections = sectionsFromMarkdown(markdown);
  // A catalog page lists many businesses, so its h1 is not a merchant — it was
  // "תקנון אתר ומדיניות הגנת הפרטיות" on one and a single supplier's name on
  // another. Claiming either as `merchant_name` would point the matcher at the
  // wrong shop; the model reads the merchants out of the listing instead.
  const title = catalogPage ? '' : merchantName(markdown, page?.metadata?.title);

  const parts = [];
  if (title) parts.push(`בית העסק: ${title}`);
  const binding = sections[BINDING_TERMS_HEADING];
  if (binding) parts.push(`${BINDING_TERMS_HEADING}:\n${binding}`);
  for (const [key, body] of Object.entries(sections)) {
    if (key !== BINDING_TERMS_HEADING) parts.push(`${key}:\n${body}`);
  }
  const terms_text = parts.join('\n\n').slice(0, maxChars);

  // Offer vocabulary is the whole test. A catalog index or an error page has
  // none, and nav is already stripped, so a length floor adds nothing here — it
  // only drops terse-but-real offers ("20% הנחה לחברי מועדון" and little else).
  // Erring the other way is cheap: a stray page costs one model call, which the
  // content_hash cache never pays twice.
  const offerTerms = (terms_text.match(OFFER_TERMS) ?? []).length;
  if (offerTerms < 3) return null;

  return {
    site,
    category: program,
    offer_url: url,
    merchant_name: title || undefined,
    listing_headline: clean(page?.metadata?.description ?? '') || undefined,
    sections,
    terms_text,
    content_hash: createHash('sha256').update(terms_text).digest('hex'),
    // Terms live behind a link often enough to be worth flagging, not chasing.
    warning: binding ? undefined : 'no חשוב לדעת section — terms may be linked or absent',
  };
}

/** Offer detail URLs under the catalog root, minus the root itself. */
async function discover(root, limit) {
  const result = await firecrawl('/map', { url: root, limit });
  const links = (result.links ?? result.data?.links ?? []).map((l) =>
    typeof l === 'string' ? l : l.url,
  );
  const rootPath = new URL(root).pathname.replace(/\/$/, '');
  const seen = new Set();
  return links.filter((url) => {
    if (!url || seen.has(url)) return false;
    seen.add(url);
    const path = new URL(url).pathname.replace(/\/$/, '');
    // /map returns whatever the site links to, sitemaps and assets included.
    // Scraping those costs a page each and can never yield an offer.
    if (/\.(xml|pdf|jpe?g|png|gif|svg|webp|zip|css|js|ico)$/i.test(path)) return false;
    return path !== rootPath && path.length > rootPath.length;
  });
}

/**
 * Offer URLs for a program: the seeds file if there is one, otherwise /map.
 *
 * A seeds file is how a client-rendered catalog gets collected without a
 * renderer — see the transport note above.
 */
async function seedUrls(program) {
  const file = new URL(`./seeds/${program}.txt`, import.meta.url);
  const text = await readFile(file, 'utf8').catch(() => null);
  if (text === null) return null;
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

async function collect({ program, root, limit, concurrency, transport }) {
  const site = new URL(root).hostname.replace(/^www\./, '');
  const path = `collected/catalogs/${program}.jsonl`;

  await mkdir('collected/catalogs', { recursive: true });

  const seeds = await seedUrls(program);
  if (seeds) console.log(`${site}: ${seeds.length} seeded offer pages`);
  let urls = (seeds ?? (await discover(root, limit))).slice(0, limit);

  // Some catalogs are a single client-rendered page: the offers exist, but as
  // DOM, not as links, so /map finds nothing to crawl. top.style.co.il returns
  // 2 links and 634 offer terms in 40KB. Treat that as one dense page rather
  // than an empty catalog — `extractBenefits` already returns many benefits
  // from one page, which is exactly the shape super-pharm needs too.
  const singlePage = !seeds && urls.length < 3;
  if (singlePage) {
    console.log(`${site}: /map found ${urls.length} links — treating ${root} as a single-page catalog`);
    urls = [root];
  } else {
    console.log(`${site}: ${urls.length} offer pages under ${root}`);
  }
  console.log('');

  const records = [];
  let failures = 0;
  let cursor = 0;

  const worker = async () => {
    while (cursor < urls.length) {
      const index = cursor++;
      const url = urls[index];
      let record = null;
      try {
        // These pages are client-rendered, so a fixed wait is a race: the same
        // URL yielded a full terms block on one run and an empty shell on the
        // next, and a page that paints late is silently lost. One retry with a
        // longer wait recovers it. Re-scraping a page that genuinely has no
        // offer costs one call and happens rarely.
        for (const wait of [singlePage ? 8000 : 5000, 12_000]) {
          const page =
            transport === 'fetch'
              ? await fetchPage(url)
              : (
                  await firecrawl('/scrape', {
                    url,
                    formats: ['markdown'],
                    // A single-page catalog keeps its whole body: the offers are
                    // spread across the page, and main-content extraction on an
                    // SPA shell often returns the card that rendered first.
                    onlyMainContent: !singlePage,
                    waitFor: wait,
                  })
                )?.data ?? {};
          record = toRecord(url, page, {
            site,
            program,
            maxChars: singlePage ? 60_000 : 20_000,
            catalogPage: singlePage,
          });
          // Only the rendering transport benefits from waiting longer; a plain
          // fetch returns the same bytes however many times it is asked.
          if (record || transport === 'fetch') break;
        }
      } catch (error) {
        failures += 1;
        console.log(`  !! ${url} — ${error.message}`);
        continue;
      }
      if (record) records.push(record);
      console.log(
        `[${index + 1}/${urls.length}] ${record ? (record.warning ? 'no-terms' : 'ok      ') : 'skipped '} ${url}`,
      );
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  // A crawl cut short must never overwrite a good file: a partial run looks
  // like a smaller catalog, and writing it reads downstream as "these offers
  // were removed" — silently deleting real rows.
  const previous = await readFile(path, 'utf8').catch(() => '');
  const previousCount = previous.split('\n').filter(Boolean).length;
  if (previousCount && records.length < previousCount / 2) {
    console.error(
      `\nREFUSED: ${records.length} records vs ${previousCount} already on disk — ` +
        `treating this as a cut-short crawl. ${path} left untouched.`,
    );
    return { program, records: records.length, withTerms: 0, refused: true };
  }

  // Nothing collected is a broken run, not an empty catalog — and an empty file
  // written over a good one is the same silent deletion the guard above blocks.
  if (records.length === 0) {
    console.error(`\nREFUSED: nothing collected from ${root}. ${path} left untouched.`);
    return { program, records: 0, withTerms: 0, refused: true };
  }

  await writeFile(path, records.map((r) => JSON.stringify(r)).join('\n') + '\n');

  const withTerms = records.filter((r) => !r.warning).length;
  console.log(`\n${records.length} records -> ${path}`);
  console.log(`  ${withTerms} carry a ${BINDING_TERMS_HEADING} section`);
  if (failures) console.log(`  ${failures} pages failed`);
  console.log(`\nnext: npm run extract -- --collected ${path} --program ${program}`);
  return { program, records: records.length, withTerms, refused: false };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 ? args[i + 1] : undefined;
  };

  // Plain HTTP by default: it costs nothing and, for every catalog whose offer
  // pages are server-rendered, returns the same terms a renderer would.
  const transport = opt('transport') ?? 'fetch';
  if (transport === 'firecrawl' && !KEY) {
    console.error('FIRECRAWL_API_KEY is not set (needed only for --transport firecrawl)');
    process.exit(2);
  }

  const limit = Number(opt('limit') ?? 200);
  const concurrency = Number(opt('concurrency') ?? 3);

  // --all walks the inventory in firecrawl-sources.json. Only `open` sources
  // are collected: the guarded and blocked ones are recorded there so the gap
  // is visible, not so a script can retry them into a 403.
  if (args.includes('--all')) {
    const inventory = JSON.parse(
      await readFile(new URL('./firecrawl-sources.json', import.meta.url), 'utf8'),
    );
    // --top N takes the biggest catalogs first. Benefit count is the best proxy
    // for how much a source is worth: it is how many rows currently carry that
    // program's name with an aggregator's thin terms attached.
    const top = opt('top');
    let open = inventory
      .filter((s) => s.status === 'open' && s.root)
      .sort((a, b) => b.benefits - a.benefits);
    if (top) open = open.slice(0, Number(top));
    console.log(
      `${open.length} source${open.length === 1 ? '' : 's'} to collect` +
        `, ${open.reduce((n, s) => n + s.benefits, 0)} benefits behind them\n`,
    );

    const summary = [];
    for (const source of open) {
      console.log(`\n=== ${source.program_id} — ${source.name} ===`);
      try {
        summary.push(
          await collect({ program: source.program_id, root: source.root, limit, concurrency, transport }),
        );
      } catch (error) {
        console.error(`  !! ${source.program_id}: ${error.message}`);
        summary.push({ program: source.program_id, records: 0, withTerms: 0, refused: true });
      }
    }

    const ok = summary.filter((s) => !s.refused);
    console.log(`\n${ok.length}/${open.length} sources collected`);
    console.log(`${ok.reduce((n, s) => n + s.records, 0)} records, ` +
      `${ok.reduce((n, s) => n + s.withTerms, 0)} carrying ${BINDING_TERMS_HEADING}`);
    return;
  }

  const program = opt('program');
  const root = opt('root');
  if (!program || !root) {
    console.error(
      'usage: collect-firecrawl.mjs --program <id> --root <url> [--limit N] [--concurrency N]\n' +
        '       collect-firecrawl.mjs --all [--limit N] [--concurrency N]',
    );
    process.exit(2);
  }

  const result = await collect({ program, root, limit, concurrency, transport });
  if (result.refused) process.exit(1);
}

// pathToFileURL, not string surgery: on Windows argv[1] is a backslash path and
// a hand-built `file://` URL is one slash short of what import.meta.url gives.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
