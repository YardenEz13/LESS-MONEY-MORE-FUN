/**
 * Deliberately minimal scraping: fetch the page, strip it to readable text.
 *
 * Anything heavier (headless browser, per-site DOM selectors) is a per-site
 * maintenance burden the MVP does not need — the LLM is tolerant of messy
 * text, and the confidence gate catches pages that came through badly.
 *
 * "Messy" is not the same as "wrong", though, and Israeli retail punishes the
 * three assumptions a naive fetch makes. Every rule below was written against a
 * page that actually broke:
 *
 *   - Not every page is UTF-8. hvr.co.il still serves windows-1255; decoded as
 *     UTF-8 it yields zero Hebrew characters and 2088 replacement marks, so the
 *     whole source reached the model as mojibake.
 *   - Not every entity is decimal. cal-online.co.il emits its Hebrew as hex
 *     character references (`&#x5D4;`), which a `&#(\d+);` rule leaves as
 *     literal text — an entire benefits page of `&#x5E2;&#x5D5;...`.
 *   - Not every 200 is a page. max.co.il answers /benefits with 425KB of
 *     Angular and 502 characters of prose, which cleared the old 200-char
 *     floor and sent near-empty junk to the model instead of failing loudly.
 */

const BLOCK_LEVEL = /<\/(p|div|li|tr|h[1-6]|section|article|br)\s*>/gi;

/** The handful of named entities that actually show up in Hebrew retail HTML. */
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", shy: '',
  ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', bull: '•',
  middot: '·', deg: '°', times: '×', trade: '™', reg: '®', copy: '©',
  euro: '€', pound: '£', agorot: '₪', ils: '₪',
};

/**
 * Offer vocabulary. Used only to tell "we fetched the right page" from "we
 * fetched the corporate homepage" — a benefits page with none of these words
 * is a page we misidentified, not a program with nothing on offer.
 */
const OFFER_TERMS =
  /הנחה|הנחות|מבצע|מבצעים|הטבה|הטבות|קופון|שובר|זיכוי|קאשבק|החזר|מועדון|%|₪/g;

export interface PageQuality {
  htmlChars: number;
  textChars: number;
  /** text ÷ html. A single-page-app ships megabytes of script and no prose. */
  textRatio: number;
  offerTerms: number;
  charset: string;
}

export interface ScrapedPage {
  url: string;
  text: string;
  fetchedAt: string;
  quality: PageQuality;
}

export class ScrapeError extends Error {
  constructor(
    readonly url: string,
    message: string,
  ) {
    super(`${url}: ${message}`);
    this.name = 'ScrapeError';
  }
}

export function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z][a-z0-9]*);/gi, (whole, name: string) => {
      const hit = NAMED_ENTITIES[name.toLowerCase()];
      return hit === undefined ? whole : hit;
    });
}

/**
 * Which encoding the bytes are actually in: the Content-Type header wins, then
 * a `<meta charset>` in the head, then UTF-8. The meta sniff reads the head as
 * latin1 because the declaration itself is always ASCII.
 */
export function detectCharset(contentType: string | null, bytes: Uint8Array): string {
  const fromHeader = contentType?.match(/charset=["']?\s*([\w-]+)/i)?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  const head = Buffer.from(bytes.subarray(0, 4096)).toString('latin1');
  const fromMeta = head.match(/<meta[^>]+charset=["']?\s*([\w-]+)/i)?.[1];
  return (fromMeta ?? 'utf-8').toLowerCase();
}

export function decodeBytes(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    // An encoding label Node doesn't know is not worth failing the run over.
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/**
 * Pull the readable strings out of any JSON-LD blocks.
 *
 * Israeli retail leans on schema.org for offers — isracard.co.il carries five
 * blocks, super-pharm two — and that markup survives client-side rendering
 * intact, so it is often the only structured description of an offer in the
 * initial HTML.
 */
export function extractJsonLd(html: string, maxChars = 4_000): string {
  const blocks = html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  const seen = new Set<string>();

  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      const value = node.trim();
      // Skip URLs and machine ids — they carry no offer meaning for the model.
      if (value.length > 2 && value.length < 400 && !/^(https?:|\/|#|\{)/.test(value)) {
        seen.add(value);
      }
    } else if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (key.startsWith('@')) continue;
        walk(value);
      }
    }
  };

  for (const [, body] of blocks) {
    try {
      walk(JSON.parse(decodeEntities(body!.trim())));
    } catch {
      // A malformed block is not a reason to lose the rest of the page.
    }
  }

  const joined = [...seen].join(' · ');
  return joined.length > maxChars ? `${joined.slice(0, maxChars)}…` : joined;
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      // Keep block boundaries as newlines so conditions that live in separate
      // list items don't get glued into one sentence.
      .replace(BLOCK_LEVEL, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t ]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

export function assessPage(html: string, text: string, charset: string): PageQuality {
  return {
    htmlChars: html.length,
    textChars: text.length,
    textRatio: html.length === 0 ? 0 : text.length / html.length,
    offerTerms: (text.match(OFFER_TERMS) ?? []).length,
    charset,
  };
}

/**
 * Why this page is not worth extracting from, or null if it is.
 *
 * Loud beats silent: a page that arrives empty should fail the source, not
 * spend a model call proving there are no benefits on it.
 */
export function diagnose(quality: PageQuality): string | null {
  const { htmlChars, textChars, textRatio, offerTerms } = quality;
  if (textChars < 800) {
    return `only ${textChars} chars of text — likely JS-rendered or an error page`;
  }
  if (htmlChars > 200_000 && textRatio < 0.01 && textChars < 5_000) {
    return `${htmlChars} chars of HTML but only ${textChars} of text — a client-rendered shell`;
  }
  if (offerTerms < 3) {
    return `no offer vocabulary in ${textChars} chars — wrong page for this program`;
  }
  return null;
}

export async function scrapePage(
  url: string,
  options: { timeoutMs?: number; maxChars?: number } = {},
): Promise<ScrapedPage> {
  const { timeoutMs = 20_000, maxChars = 60_000 } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Identify the crawler honestly; a benefits catalog operator who wants
        // us gone should be able to see who we are and block us.
        'user-agent': 'SmartBenefitsRecall/0.1 (personal MVP; contact via repo)',
        'accept-language': 'he-IL,he;q=0.9,en;q=0.5',
      },
    });
    if (!response.ok) {
      throw new ScrapeError(url, `HTTP ${response.status}`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const charset = detectCharset(response.headers.get('content-type'), bytes);
    const html = decodeBytes(bytes, charset);

    // Structured offers first: they are the densest, least noisy part of the
    // page, and putting them up top keeps them inside the truncation window.
    const structured = extractJsonLd(html);
    const body = htmlToText(html);
    const text = structured ? `${structured}\n\n${body}` : body;

    const quality = assessPage(html, text, charset);
    const problem = diagnose(quality);
    if (problem) throw new ScrapeError(url, problem);

    return {
      url,
      text: text.length > maxChars ? `${text.slice(0, maxChars)}\n[...truncated]` : text,
      fetchedAt: new Date().toISOString(),
      quality,
    };
  } finally {
    clearTimeout(timer);
  }
}
