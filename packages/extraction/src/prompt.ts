/**
 * The extraction prompt is in Hebrew because the source material is: Israeli
 * T&C text leans on phrasing ("אינו כולל", "בכפוף לתקנון", "בסניפים
 * המשתתפים") whose force is easier to preserve when the instructions and the
 * text share a language.
 *
 * The whole prompt is built around one rule: an unstated condition must come
 * back as null. A benefit that looks better than it is costs the user a
 * wasted trip to the till, which is the single failure KPI #2 forbids.
 *
 * Rules 9 and 10 were both earned by reviewing real output.
 *
 * Rule 10: a model read "בתאריך 4.8" — a day and month with no year — and
 * returned `valid_until: 2024-08-04`, two years in the past. An invented year
 * does not make a benefit look better, it makes a live benefit look expired,
 * so it is dropped silently with no error anywhere. A later run did the same
 * with "תקף לחודש יולי", so the rule names both shapes.
 *
 * Rule 9 is the costlier one. 35 of 408 published benefits overstated their
 * saving, because `value` on a fixed/gift_card benefit means "money saved" and
 * the catalog is full of offers that state a *price* instead. A ₪200 voucher
 * sold for ₪159 came back as value 200 — a five-fold overstatement of a saving
 * that is really ₪41 — and "פיצה משפחתית ב-95 ש״ח" came back as ₪95 saved on a
 * meal costing ₪95. The voucher case is arithmetic the source supports, so the
 * rule asks for the difference. The bundle case is not: no original price is
 * stated, nothing can be computed, and the honest answer is a low score and a
 * human. Both are the same failure the whole prompt exists to prevent — a
 * benefit that looks better than it is, which costs the user a wasted trip.
 */
export const EXTRACTION_SYSTEM_PROMPT = `אתה מחלץ הטבות מתוך עמודי הטבות ותקנונים ציבוריים בעברית.

המשימה: להחזיר את ההטבות שמופיעות בטקסט, עם התנאים המדויקים שלהן.

כללי ברזל:
1. אל תמציא תנאים. אם התקנון לא אומר משהו — החזר null לשדה הזה. null פירושו "לא נכתב", לא "אין הגבלה".
2. אל תשלים מידע מהידע הכללי שלך על בית העסק או על המועדון. רק מה שכתוב בטקסט.
3. אם אותה הטבה מופיעה כמה פעמים — החזר אותה פעם אחת.
4. אם הטקסט מתאר כמה בתי עסק, החזר רשומה נפרדת לכל בית עסק.
5. טקסט שיווקי כללי ("שווה לבדוק", "מבצעים חמים") הוא לא הטבה. אל תחזיר אותו.
6. ימים: 1=ראשון, 2=שני, 3=שלישי, 4=רביעי, 5=חמישי, 6=שישי, 7=שבת. "בימי חול" בישראל = [1,2,3,4,5].
7. שעות בפורמט HH:MM בשעון ישראל.
8. סכומים במספרים בלבד, ללא סימן ₪ וללא פסיקים.
9. השדה value ב-fixed וב-gift_card הוא **הסכום שנחסך**, לא המחיר ששולם.
   - שובר שנמכר במחיר: "שובר בשווי 200₪ ב-159₪" — החיסכון הוא ההפרש, 41. אל תחזיר 200 ואל תחזיר 159.
   - מוצר או ארוחה במחיר קבוע בלי שהתקנון מציין את המחיר הרגיל: "פיצה משפחתית ב-95 ש״ח" — אי אפשר לדעת כמה נחסך. החזר confidence_score מתחת ל-0.85 כדי שאדם יבדוק, ואל תחזיר את המחיר כאילו הוא הנחה.
10. תאריכים: אל תשלים שנה שלא כתובה. "בתאריך 4.8" או "תקף לחודש יולי" בלי שנה — החזר null ל-valid_until וכתוב את התאריך כלשונו ב-raw_text_summary. שנה שהומצאה הופכת הטבה תקפה לפגת-תוקף, והיא נעלמת מהמשתמש בלי שאיש יראה שגיאה.

לגבי confidence_score — זה השדה שקובע אם ההטבה מוצגת למשתמש או נשלחת לבדיקה ידנית:
- 0.9 ומעלה: כל התנאים כתובים במפורש ובבירור בטקסט.
- 0.7-0.9: ההטבה ברורה אבל חלק מהתנאים מנוסחים בעמימות או מפנים לתקנון שלא נמצא בטקסט.
- מתחת ל-0.7: לא הצלחת לקבוע בביטחון את ההטבה או את התנאים המרכזיים שלה.
עדיף ציון נמוך על ניחוש. הטבה שנשלחת לבדיקה ידנית עולה לנו דקה של עבודה; הטבה שגויה שמוצגת למשתמש עולה לו נסיעה לחנות.

ב-raw_text_summary כתוב את התנאים בעברית, קרוב ככל האפשר לניסוח המקורי בתקנון — זה מה שהמשתמש רואה כשהוא רוצה לדעת למה סמכנו על ההטבה.`;

export function buildExtractionUserMessage(input: {
  programName: string;
  sourceUrl: string;
  pageText: string;
}): string {
  return `מועדון: ${input.programName}
מקור: ${input.sourceUrl}

הטקסט מהעמוד:
---
${input.pageText}
---

חלץ את ההטבות.`;
}
