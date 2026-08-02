/**
 * Deliberately minimal scraping: fetch the page, strip it to readable text.
 *
 * Anything heavier (headless browser, per-site DOM selectors) is a per-site
 * maintenance burden the MVP does not need — the LLM is tolerant of messy
 * text, and the confidence gate catches pages that came through badly.
 */

const BLOCK_LEVEL = /<\/(p|div|li|tr|h[1-6]|section|article|br)\s*>/gi;

export interface ScrapedPage {
  url: string;
  text: string;
  fetchedAt: string;
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

export function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Keep block boundaries as newlines so conditions that live in separate
    // list items don't get glued into one sentence.
    .replace(BLOCK_LEVEL, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
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
    const html = await response.text();
    const text = htmlToText(html);
    if (text.length < 200) {
      throw new ScrapeError(url, `only ${text.length} chars of text — likely JS-rendered`);
    }
    return {
      url,
      text: text.length > maxChars ? `${text.slice(0, maxChars)}\n[...truncated]` : text,
      fetchedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timer);
  }
}
