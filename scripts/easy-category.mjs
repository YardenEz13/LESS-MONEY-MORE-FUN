/**
 * easy.co.il's free-text Hebrew category -> the app's closed errand vocabulary.
 *
 * Shared by `backfill-merchants.mjs` and `add-easy-merchants.mjs` so a merchant
 * added today and a merchant backfilled tomorrow classify identically. It used
 * to be copied into both, and a copy that drifts puts the same shop in two
 * categories depending on which script last touched it.
 *
 * Only entries confident enough to answer "where do I buy X". Anything absent
 * yields `[]`: a merchant with no category still lists, still geofences and
 * still shows its `label` — it just never surfaces for a category question.
 * Guessing here would answer "where do I get petrol" with a bookshop, so the
 * long tail (מוסך, מכללה, משכנתאות, שירות הדברה) is deliberately unmapped
 * rather than forced into the nearest enum member.
 *
 * Order matters: the first hit wins. `books` sits above `beauty` because
 * מספרה and ספרים share a root.
 */
const CATEGORY = [
  // Tested first, and deliberately map to nothing: a course *about* a trade is
  // not a place to run that errand. Without this, "לימודי צילום" classifies as
  // electronics and a photography course answers "where do I buy a camera".
  [/^(לימודי|קורס|בית ספר|מכללה)/, null],
  // A workshop is an outing whatever its subject, so this outranks the subject
  // rules below — otherwise "סדנת יין ואלכוהול" lands in grocery.
  [/סדנ/, 'leisure'],
  [/דלק|תדלוק|תחנת דלק/, 'fuel'],
  [
    // `רשת מזון(?! מהיר)` keeps Victory in grocery without dragging a burger
    // chain in with it, and `יין` is fenced by lookaround because it is a
    // substring of בני**יין** — an unfenced one filed a builders' merchant
    // under wine.
    /סופרמרקט|מכולת|מרכול|מיני ?מרקט|רשת מזון(?! מהיר)|ירקות|פירות|מאפי|קצבי|אטליז|מעדני|דגים|(?<![א-ת])יין(?![א-ת])|אלכוהול|תבלינים|חנות נוחות|כלבו/,
    'grocery',
  ],
  [/בית מרקחת|פארם|תוספי מזון|רוקח/, 'pharmacy'],
  [
    /אופנה|בגדים|נעליים|תיקים|הלבשה|תכשיט|מזוודות|סנדלר|כובע|הנעלה|אופטיקה|משקפיים|שעונים/,
    'fashion',
  ],
  [/חשמל|מחשבים|סלולר|אלקטרוניקה|ציוד היקפי|קונסולות|מצלמ|צילום/, 'electronics'],
  [
    /מסעד|קפה|פיצרי|פיצה|המבורגר|בורגר|סושי|בר |פאב|קייטרינג|מקום לאכול|גריל|שווארמה|פלאפל|חומוס|סביח|גלידרי|גלידות|ארטיק|קונדיטורי|מאפה|בייקרי|קרפ|בורקס|סנדוויץ|ביסטרו|שוקולד|ממתקים|בית אוכל|מזון מהיר/,
    'dining',
  ],
  [
    /רהיט|עיצוב הבית|כלי בית|עשה זאת בעצמך|מטבח|הום סטיילינג|תאורה|מנורות|וילונות|מצעים|מרפד|טמבורי|צבע|כלי עבודה|גינון|חומרי בניין/,
    'home',
  ],
  [
    /קולנוע|סינמטק|תיאטרון|מופע|בילוי|ספורט|כושר|מלון|נופש|פארק|טיולים|תיירות|מטיילים|צימר|ספא|סדנ|צעצוע|בריכה|מוזיאון|אטרקצי|לוח אירועים|כרטיסים/,
    'leisure',
  ],
  [/ספרים|ספרי /, 'books'],
  [/קוסמטיק|איפור|יופי|מספר|טיפוח|ציפורניים|קעקוע|עיצוב שיער|לק ג|פדיקור|מניקור/, 'beauty'],
];

/** `[]` for anything the table is not confident about — never a guess. */
export const categoriesFor = (easyCategory) => {
  if (!easyCategory) return [];
  const hit = CATEGORY.find(([re]) => re.test(easyCategory));
  return hit?.[1] ? [hit[1]] : [];
};
