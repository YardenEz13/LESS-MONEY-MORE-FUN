/** A wrong branch fires a reminder at a shop that is not there: matching must be exact. */
import assert from 'node:assert/strict';
import { elementMatches, newBranches, overpassQuery } from './osm-branches.mjs';

const wanted = ['סופר-פארם', 'Super-Pharm'];
assert.ok(elementMatches({ brand: 'Super-Pharm' }, wanted));
assert.ok(elementMatches({ 'name:he': 'סופר-פארם' }, wanted));
assert.ok(!elementMatches({ name: 'סופר-פארם דיזנגוף בע"מ משרדים' }, wanted), 'no fuzzy matching');
assert.ok(!elementMatches({ name: 'Super Market' }, wanted));
assert.ok(!elementMatches(undefined, wanted));

const existing = [{ lat: 32.0, lng: 34.8, city: 'x' }];
const els = [
  { lat: 32.00001, lon: 34.80001, tags: { brand: 'Super-Pharm' } }, // same branch, within 75m
  { lat: 32.1, lon: 34.9, tags: { brand: 'Super-Pharm', 'addr:city': 'הרצליה' } }, // new
  { center: { lat: 32.1, lon: 34.90005 }, tags: { name: 'סופר-פארם' } }, // duplicate of the new one
  { lat: 31.5, lon: 34.5, tags: { name: 'Pharmacy Other' } }, // wrong chain
  { tags: { brand: 'Super-Pharm' } }, // no coordinates
];
const fresh = newBranches(els, wanted, existing);
assert.equal(fresh.length, 1);
assert.deepEqual(fresh[0], { lat: 32.1, lng: 34.9, city: 'הרצליה' });
assert.match(overpassQuery(['a"b']), /a\\"b/);
console.log('osm-branches: ok');
