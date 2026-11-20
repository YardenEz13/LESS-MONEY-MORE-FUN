import type { ImageSourcePropType } from 'react-native';
import type { Merchant, MerchantCategory } from '@sbr/core';

export type StampKey =
  | 'coffee'
  | 'food'
  | 'cinema'
  | 'fashion'
  | 'pharma'
  | 'supermarket'
  | 'attractions'
  | 'travel'
  | 'fuel';

const STAMPS: Record<StampKey, ImageSourcePropType> = {
  coffee: require('../../assets/stamps/coffee.png'),
  food: require('../../assets/stamps/food.png'),
  cinema: require('../../assets/stamps/cinema.png'),
  fashion: require('../../assets/stamps/fashion.png'),
  pharma: require('../../assets/stamps/pharma.png'),
  supermarket: require('../../assets/stamps/supermarket.png'),
  attractions: require('../../assets/stamps/attractions.png'),
  travel: require('../../assets/stamps/travel.png'),
  fuel: require('../../assets/stamps/fuel.png'),
};

/**
 * Specific trade phrases beat the coarser `MerchantCategory` enum so a cafe
 * gets the coffee cup rather than fork-and-spoon, and a hotel gets the plane
 * rather than the ferris wheel.
 */
const KEYWORD_RULES: ReadonlyArray<[RegExp, StampKey]> = [
  [/קפה|ארומה|לנדוור|רולדין|גרג|arcaffe|cofix|coffee|מאפי|קונדיטור|בייקרי/i, 'coffee'],
  [/קולנוע|סינמה|יס פלאנט|רב חן|cinema|movie|סינמטק/i, 'cinema'],
  [/מלון|מלונות|טיסה|טיסות|תעופה|נופש|תיירות|השכרת רכב|ישרוטל|פתאל|אל על|דן מלונות|hotel|travel|flight/i, 'travel'],
  [/דלק|תדלוק|פז|סונול|דור אלון|טן|yellow|fuel|מוסך/i, 'fuel'],
  [/סופר|מכולת|מינימרקט|רמי לוי|שופרסל|ויקטורי|יוחננוף|אושר עד|קרפור|טיב טעם|am:pm|מזון ומשקאות|grocery/i, 'supermarket'],
  [/פארם|בית מרקחת|תרופות|אופטיקה|משקפיים|קוסמטיקה|טיפוח|ביוטי|pharmacy|beauty/i, 'pharma'],
  [/אופנה|ביגוד|בגדים|הנעלה|נעליים|תכשיטים|קסטרו|פוקס|זארה|גולף|רנואר|terminal|fashion/i, 'fashion'],
  [/אטרקצ|פארק|ספא|מוזיאון|תיאטרון|הופע|באולינג|בריכה|לונה|כושר|ספורט|קאנטרי/i, 'attractions'],
  [/מסעד|פיצ|בורגר|המבורגר|סושי|שווארמה|פלאפל|גליד|גריל|אוכל|מזון מהיר|בר |^בר$/i, 'food'],
];

const CATEGORY_MAP: Partial<Record<MerchantCategory, StampKey>> = {
  fuel: 'fuel',
  grocery: 'supermarket',
  pharmacy: 'pharma',
  beauty: 'pharma',
  fashion: 'fashion',
  dining: 'food',
  leisure: 'attractions',
};

/** Resolve a woodblock category stamp for a merchant, or null when none fits cleanly. */
export function stampKeyForMerchant(
  merchant: Pick<Merchant, 'categories' | 'label'> | undefined,
  merchantName: string,
): StampKey | null {
  const haystack = `${merchant?.label ?? ''} ${merchantName}`.trim();
  if (haystack) {
    for (const [pattern, key] of KEYWORD_RULES) {
      if (pattern.test(haystack)) return key;
    }
  }
  if (merchant?.categories?.length) {
    for (const category of merchant.categories) {
      const mapped = CATEGORY_MAP[category];
      if (mapped) return mapped;
    }
  }
  return null;
}

export function stampForMerchant(
  merchant: Pick<Merchant, 'categories' | 'label'> | undefined,
  merchantName: string,
): ImageSourcePropType | null {
  const key = stampKeyForMerchant(merchant, merchantName);
  return key ? STAMPS[key] : null;
}
