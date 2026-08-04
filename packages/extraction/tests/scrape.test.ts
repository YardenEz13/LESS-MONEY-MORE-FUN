import { describe, expect, it } from 'vitest';
import {
  assessPage,
  decodeBytes,
  decodeEntities,
  detectCharset,
  diagnose,
  extractJsonLd,
  htmlToText,
} from '../src/scrape';

/** "הנחה" as windows-1255 bytes — the encoding hvr.co.il actually serves. */
const HEBREW_CP1255 = Uint8Array.from([0xe4, 0xf0, 0xe7, 0xe4]);

describe('decodeEntities', () => {
  it('decodes hex references, which cal-online uses for all of its Hebrew', () => {
    expect(decodeEntities('&#x5D4;&#x5E0;&#x5D7;&#x5D4;')).toBe('הנחה');
  });

  it('still decodes decimal references and named entities', () => {
    expect(decodeEntities('&#1492;&#1504;&#1495;&#1492;')).toBe('הנחה');
    expect(decodeEntities('20&nbsp;%&amp;more')).toBe('20 %&more');
  });

  it('leaves an unknown entity alone rather than eating it', () => {
    expect(decodeEntities('a &notarealentity; b')).toBe('a &notarealentity; b');
  });
});

describe('charset handling', () => {
  it('prefers the Content-Type header', () => {
    expect(detectCharset('text/html; charset=windows-1255', new Uint8Array())).toBe(
      'windows-1255',
    );
  });

  it('falls back to a meta charset when the header is silent', () => {
    const html = Buffer.from('<html><head><meta charset="windows-1255">', 'latin1');
    expect(detectCharset(null, html)).toBe('windows-1255');
  });

  it('defaults to utf-8 when nothing is declared', () => {
    expect(detectCharset(null, Buffer.from('<html><body>hi'))).toBe('utf-8');
  });

  it('decodes windows-1255 as Hebrew, where utf-8 yields replacement chars', () => {
    expect(decodeBytes(HEBREW_CP1255, 'windows-1255')).toBe('הנחה');
    expect(decodeBytes(HEBREW_CP1255, 'utf-8')).toContain('�');
  });

  it('survives an encoding label Node does not know', () => {
    expect(() => decodeBytes(HEBREW_CP1255, 'not-a-charset')).not.toThrow();
  });
});

describe('extractJsonLd', () => {
  const html = `
    <script type="application/ld+json">
      {"@type":"Offer","name":"20% הנחה","url":"https://x.co.il/a",
       "seller":{"@type":"Org","name":"סופר-פארם"}}
    </script>`;

  it('pulls readable offer strings out of schema.org markup', () => {
    const out = extractJsonLd(html);
    expect(out).toContain('20% הנחה');
    expect(out).toContain('סופר-פארם');
  });

  it('drops URLs and @-keys, which carry no offer meaning', () => {
    expect(extractJsonLd(html)).not.toContain('https://x.co.il/a');
    expect(extractJsonLd(html)).not.toContain('Offer');
  });

  it('ignores a malformed block instead of losing the whole page', () => {
    expect(() =>
      extractJsonLd('<script type="application/ld+json">{ not json </script>'),
    ).not.toThrow();
  });
});

describe('htmlToText', () => {
  it('keeps block boundaries so separate conditions do not merge', () => {
    expect(htmlToText('<li>בקנייה מעל 300</li><li>לא כולל אאוטלט</li>')).toBe(
      'בקנייה מעל 300\nלא כולל אאוטלט',
    );
  });

  it('drops script and style bodies', () => {
    expect(htmlToText('<style>.a{color:red}</style><p>הנחה</p><script>var x=1</script>')).toBe(
      'הנחה',
    );
  });
});

describe('diagnose', () => {
  const good = 'הנחה 20% במבצע לחברי מועדון, שובר בקנייה מעל ₪300. '.repeat(40);

  it('accepts a page with real prose and offer vocabulary', () => {
    expect(diagnose(assessPage('<html>'.padEnd(20_000, 'x'), good, 'utf-8'))).toBeNull();
  });

  it('rejects the near-empty page max.co.il returns for /benefits', () => {
    // 425KB of Angular, ~500 chars of prose — this cleared the old 200 floor.
    const quality = assessPage('x'.repeat(425_000), 'הנחה '.repeat(100), 'utf-8');
    expect(diagnose(quality)).toMatch(/likely JS-rendered|client-rendered shell/);
  });

  it('rejects a client-rendered shell that scrapes just past the text floor', () => {
    const quality = assessPage('x'.repeat(682_000), `${good.slice(0, 2800)}`, 'utf-8');
    expect(diagnose(quality)).toContain('client-rendered shell');
  });

  it('rejects the right site but the wrong page', () => {
    const corporate = 'About our company and investor relations. '.repeat(60);
    expect(diagnose(assessPage('x'.repeat(20_000), corporate, 'utf-8'))).toContain(
      'no offer vocabulary',
    );
  });
});
