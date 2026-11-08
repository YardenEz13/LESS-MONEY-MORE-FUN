import assert from 'node:assert/strict';
import { buildPrompt, parseAnswer } from './gemini-chrome-verify.mjs';

assert.deepEqual(parseAnswer('```json\n{"verdict":"unclear","evidence":""}\n```'), { verdict: 'unclear', evidence: '' });
assert.deepEqual(parseAnswer('Sure! {"verdict":"still_offered","evidence":"abc def ghi"} hope it helps'), { verdict: 'still_offered', evidence: 'abc def ghi' });
assert.equal(parseAnswer('no json here'), null);
assert.equal(parseAnswer('{broken'), null);
assert.equal(parseAnswer(undefined), null);
const p = buildPrompt({ merchant_name: 'שלמה', program_id: 'max', type: 'percent', value: 18, conditions: { raw_text_summary: 's' } }, 'PAGE');
assert.match(p, /exact, contiguous quote/);
assert.match(p, /Merchant: שלמה/);
assert.match(p, /--- PAGE TEXT ---\nPAGE$/);
console.log('gemini-chrome-verify: ok');
