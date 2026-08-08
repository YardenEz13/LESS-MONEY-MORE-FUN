import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPageText, readCollected, type CollectedRecord } from '../src/collected';

const record = (over: Partial<CollectedRecord> = {}): CollectedRecord => ({
  site: 'max',
  offer_url: 'https://www.max.co.il/benefits/movies/x',
  merchant_name: 'סינמה סיטי',
  listing_headline: '1+1 החל מ-50 ₪',
  sections: {
    'איך זה עובד?': 'מציגים את הכרטיס בקופה',
    'חשוב לדעת': 'בקנייה מעל ₪100, לא כולל סופ״ש',
  },
  terms_text: 'טקסט מלא של העמוד עם כל הפרטים',
  content_hash: 'sha256:abc',
  ...over,
});

describe('buildPageText', () => {
  it('leads with the binding terms, ahead of other sections', () => {
    const text = buildPageText(record());
    expect(text.indexOf('חשוב לדעת')).toBeLessThan(text.indexOf('איך זה עובד?'));
  });

  it('keeps the full body even when sections were found', () => {
    // The section split is heuristic; a heading the collector didn't know about
    // would otherwise drop its terms silently.
    expect(buildPageText(record())).toContain('טקסט מלא של העמוד עם כל הפרטים');
  });

  it('includes the merchant and the listing headline as context', () => {
    const text = buildPageText(record());
    expect(text).toContain('סינמה סיטי');
    expect(text).toContain('1+1 החל מ-50 ₪');
  });

  it('works when the page had no recognised sections at all', () => {
    const text = buildPageText(record({ sections: {} }));
    expect(text).toContain('טקסט מלא של העמוד');
  });
});

describe('readCollected', () => {
  const write = async (lines: string) => {
    const dir = await mkdtemp(join(tmpdir(), 'sbr-collected-'));
    const file = join(dir, 'max.jsonl');
    await writeFile(file, lines, 'utf8');
    return file;
  };

  it('deduplicates an offer that appeared under two categories', async () => {
    const a = JSON.stringify(record({ category: 'movies' }));
    const b = JSON.stringify(record({ category: 'attractions' }));
    expect(await readCollected(await write(`${a}\n${b}\n`))).toHaveLength(1);
  });

  it('survives the truncated final line of an interrupted crawl', async () => {
    const good = JSON.stringify(record());
    const file = await write(`${good}\n{"offer_url": "https://x", "terms_`);
    expect(await readCollected(file)).toHaveLength(1);
  });

  it('skips records missing the fields extraction depends on', async () => {
    const noText = JSON.stringify({ offer_url: 'https://y', content_hash: 'h' });
    const file = await write(`${noText}\n${JSON.stringify(record())}\n`);
    const out = await readCollected(file);
    expect(out).toHaveLength(1);
    expect(out[0]!.offer_url).toBe(record().offer_url);
  });
});
