import { describe, expect, it } from 'vitest';
import { Benefit, Merchant } from '@sbr/core';
import { htmlToText } from '../src/scrape';
import {
  benefitId,
  mergeBenefits,
  partitionByConfidence,
  resolveMerchantId,
  toBenefit,
} from '../src/store';
import { ExtractionResult } from '../src/schema';

const merchants = [
  Merchant.parse({ id: 'super_pharm', name: 'סופר-פארם', domains: [], venue_ids: [] }),
  Merchant.parse({ id: 'ksp', name: 'KSP', domains: [], venue_ids: [] }),
];

const extracted = {
  merchant_name: 'סופר פארם',
  type: 'percent' as const,
  value: 10,
  valid_from: null,
  valid_until: null,
  confidence_score: 0.93,
  confidence_reason: 'כל התנאים כתובים במפורש',
  conditions: {
    min_spend: 100,
    max_discount: 50,
    valid_days: [1, 2, 3, 4, 5],
    valid_hours: null,
    channel: 'in_store' as const,
    stacks_with_club: false,
    exclusions: ['תרופות מרשם'],
    usage_limit: 'פעם אחת בחודש',
    requires_voucher: false,
    raw_text_summary: 'בקנייה מעל ₪100 בימים א׳-ה׳',
  },
};

const context = {
  programId: 'hever',
  sourceUrl: 'https://example.com/benefits',
  merchants,
  now: new Date('2026-08-02T10:00:00Z'),
};

describe('resolveMerchantId', () => {
  it('matches despite hyphen and spacing differences', () => {
    expect(resolveMerchantId('סופר פארם', merchants)).toBe('super_pharm');
    expect(resolveMerchantId('  סופר-פארם ', merchants)).toBe('super_pharm');
    expect(resolveMerchantId('ksp', merchants)).toBe('ksp');
  });

  it('marks unknown merchants so they can be triaged later', () => {
    expect(resolveMerchantId('חנות חדשה', merchants)).toMatch(/^unmapped_/);
  });
});

describe('benefitId', () => {
  it('is stable for the same offer and distinct across offers', () => {
    const base = { programId: 'hever', merchantId: 'super_pharm', type: 'percent', value: 10 };
    expect(benefitId(base)).toBe(benefitId({ ...base }));
    expect(benefitId(base)).not.toBe(benefitId({ ...base, value: 15 }));
    expect(benefitId(base)).not.toBe(benefitId({ ...base, programId: 'max' }));
  });
});

describe('toBenefit', () => {
  it('produces a record that satisfies the core schema', () => {
    const benefit = toBenefit(extracted, context);
    expect(() => Benefit.parse(benefit)).not.toThrow();
    expect(benefit.merchant_id).toBe('super_pharm');
    expect(benefit.last_verified_at).toBe('2026-08-02T10:00:00.000Z');
    // A fresh extraction is never pre-approved, whatever the model claimed.
    expect(benefit.reviewed_by_human).toBe(false);
  });
});

describe('partitionByConfidence', () => {
  it('routes low-confidence extractions to the review queue', () => {
    const confident = { benefit: toBenefit(extracted, context), reason: 'clear' };
    const shaky = {
      benefit: toBenefit({ ...extracted, value: 25, confidence_score: 0.4 }, context),
      reason: 'התנאים לא ברורים',
    };
    const { publish, review } = partitionByConfidence([confident, shaky]);
    expect(publish.map((b) => b.confidence_score)).toEqual([0.93]);
    expect(review).toHaveLength(1);
    expect(review[0]?.reason).toBe('התנאים לא ברורים');
  });
});

describe('mergeBenefits', () => {
  it('keeps a human approval when the terms are unchanged', () => {
    const approved = { ...toBenefit(extracted, context), reviewed_by_human: true };
    const rescraped = toBenefit(extracted, { ...context, now: new Date('2026-08-09T10:00:00Z') });
    const merged = mergeBenefits([approved], [rescraped]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.reviewed_by_human).toBe(true);
    expect(merged[0]?.last_verified_at).toBe('2026-08-09T10:00:00.000Z');
  });

  it('lets the review CLI publish an approval for a benefit not yet in the store', () => {
    const justApproved = { ...toBenefit(extracted, context), reviewed_by_human: true };
    const merged = mergeBenefits([], [justApproved]);
    expect(merged[0]?.reviewed_by_human).toBe(true);
  });

  it('drops the approval when the terms changed', () => {
    const approved = { ...toBenefit(extracted, context), reviewed_by_human: true };
    const changed = toBenefit(
      { ...extracted, conditions: { ...extracted.conditions, min_spend: 250 } },
      context,
    );
    const merged = mergeBenefits([approved], [changed]);
    expect(merged[0]?.reviewed_by_human).toBe(false);
    expect(merged[0]?.conditions.min_spend).toBe(250);
  });
});

describe('ExtractionResult schema', () => {
  it('rejects an out-of-range weekday', () => {
    const bad = {
      page_summary: 'x',
      benefits: [{ ...extracted, conditions: { ...extracted.conditions, valid_days: [0] } }],
    };
    expect(() => ExtractionResult.parse(bad)).toThrow();
  });

  it('rejects a malformed time window', () => {
    const bad = {
      page_summary: 'x',
      benefits: [
        {
          ...extracted,
          conditions: { ...extracted.conditions, valid_hours: { from: '8am', to: '12pm' } },
        },
      ],
    };
    expect(() => ExtractionResult.parse(bad)).toThrow();
  });

  it('accepts a fully-null condition set', () => {
    const sparse = {
      page_summary: 'x',
      benefits: [
        {
          ...extracted,
          conditions: {
            min_spend: null,
            max_discount: null,
            valid_days: null,
            valid_hours: null,
            channel: null,
            stacks_with_club: null,
            exclusions: null,
            usage_limit: null,
            requires_voucher: null,
            raw_text_summary: 'הטבה ללא תנאים מפורשים',
          },
        },
      ],
    };
    expect(() => ExtractionResult.parse(sparse)).not.toThrow();
  });
});

describe('htmlToText', () => {
  it('strips scripts and styles and keeps block boundaries', () => {
    const text = htmlToText(
      '<style>.a{color:red}</style><script>var x=1</script><ul><li>מעל ₪100</li><li>ימים א׳-ה׳</li></ul>',
    );
    expect(text).not.toContain('color:red');
    expect(text).not.toContain('var x');
    expect(text.split('\n')).toEqual(['מעל ₪100', 'ימים א׳-ה׳']);
  });

  it('decodes the entities that show up in Hebrew catalog markup', () => {
    expect(htmlToText('<p>עד&nbsp;₪50 &amp; עוד</p>')).toBe('עד ₪50 & עוד');
  });
});
