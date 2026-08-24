import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Benefit, Merchant, Program, Venue } from '../src/types';

/**
 * The schemas are strict, the shipped JSON is hand-edited and script-edited,
 * and until now nothing checked one against the other.
 *
 * `validate:data` looks like it covers this and does not: it runs under plain
 * node, so it cannot import a TypeScript schema and hand-rolls its shape checks
 * instead. Adding `city` and `label` to `Merchant` therefore passed
 * `npm test`, `npm run typecheck` and `npm run validate:data` green, and the
 * first thing to actually parse the data with the real schema was the
 * extraction pipeline — which is a model-spend command, and a poor place to
 * discover that the catalog no longer loads.
 *
 * The app parses these four files at startup on purpose ("a malformed catalog
 * should fail loudly on a dogfood build"), so anything that fails here is a
 * white screen on a phone.
 */
const load = (name: string) =>
  JSON.parse(readFileSync(resolve(__dirname, '../../../data', name), 'utf8'));

describe('the shipped catalog parses with the schemas the app uses', () => {
  it.each([
    ['programs.json', Program],
    ['merchants.json', Merchant],
    ['venues.json', Venue],
    ['benefits.json', Benefit],
    ['benefits.sample.json', Benefit],
  ])('%s', (name, schema) => {
    const result = schema.array().safeParse(load(name));
    // Print the first few issues rather than zod's full dump: 1057 merchants
    // with one bad field each produced 4024 issues and a useless error.
    expect(
      result.success ? [] : result.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`),
    ).toEqual([]);
  });
});
