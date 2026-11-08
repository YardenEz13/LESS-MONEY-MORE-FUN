import { describe, expect, it } from 'vitest';
import { evaluateBenefit } from '../src/matching';
import { applyPunches, localDayKey, pruneExpired, punchedCodes, togglePunch } from '../src/punches';
import type { Benefit } from '../src/types';

const NOW = new Date('2026-08-04T10:00:00.000Z'); // 13:00 Israel

const voucher = {
  id: 'v1',
  program_id: 'cal',
  merchant_id: 'castro',
  merchant_name: 'קסטרו',
  google_place_id: null,
  type: 'percent',
  value: 30,
  conditions: {
    min_spend: null, max_discount: null, valid_days: null, valid_hours: null, channel: null,
    stacks_with_club: true, exclusions: null, usage_limit: null,
    requires_voucher: 'שובר באתר', raw_text_summary: 'x',
  },
  valid_from: null, valid_until: null, source_url: 'https://example.invalid/v1',
  last_verified_at: NOW.toISOString(), confidence_score: 0.95, reviewed_by_human: true,
} as unknown as Benefit;

const evaluation = () => evaluateBenefit(voucher, { now: NOW, ownedProgramIds: ['cal'] });

describe('manual punching', () => {
  it('a voucher step is outstanding until punched', () => {
    expect(evaluation().actionsRequired.map((g) => g.code)).toContain('voucher');
  });

  it('punching a step clears it from actionsRequired and marks the gate met', () => {
    const e = applyPunches(evaluation(), new Set(['voucher']));
    expect(e.actionsRequired.map((g) => g.code)).not.toContain('voucher');
    expect(e.gates.find((g) => g.code === 'voucher')?.state).toBe('met');
  });

  it('does not touch status, blockers, or non-actionable gates', () => {
    const base = evaluation();
    const e = applyPunches(base, new Set(base.gates.map((g) => g.code)));
    expect(e.status).toBe(base.status);
    expect(e.blockers).toEqual(base.blockers);
    for (const g of base.gates.filter((g) => !g.actionable || g.state !== 'pending')) {
      expect(e.gates.find((x) => x.code === g.code)?.state).toBe(g.state);
    }
  });

  it('expires at local midnight, not UTC midnight', () => {
    const p = togglePunch({}, 'v1', 'voucher', NOW);
    const before = new Date('2026-08-04T20:59:00.000Z'); // 23:59 Israel
    const after = new Date('2026-08-04T21:01:00.000Z'); // 00:01 next day
    expect(punchedCodes(p, 'v1', before).has('voucher')).toBe(true);
    expect(punchedCodes(p, 'v1', after).size).toBe(0);
    expect(pruneExpired(p, after)).toEqual({});
    expect(pruneExpired(p, before)).toBe(p);
  });

  it('toggles off again and removes empty entries', () => {
    const on = togglePunch({}, 'v1', 'voucher', NOW);
    expect(togglePunch(on, 'v1', 'voucher', NOW)).toEqual({});
  });

  it('formats the day key on the Israel calendar', () => {
    expect(localDayKey(new Date('2026-08-04T21:30:00.000Z'))).toBe('2026-08-05');
  });
});
