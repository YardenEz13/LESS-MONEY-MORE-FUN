import { rankBenefits, type Evaluation, type UserProfile } from '@sbr/core';
import { benefits, merchantsById, ownedProgramIds, programNames } from './catalog';

/**
 * The AI advisor: "איפה הכי משתלם לתדלק?" → a recommendation drawn from the
 * benefits this user actually holds.
 *
 * The division of labour is the whole design:
 *
 *   - `@sbr/core` decides. It evaluates every condition, drops what is blocked
 *     right now, and ranks by readiness → saving → freshness. That verdict is
 *     authoritative and the model cannot overturn it.
 *   - Gemini reads and writes. It picks which of the *already-evaluated*
 *     candidates answers the question and phrases it in Hebrew.
 *
 * It is tempting to just hand the model the catalog and ask which deal is best.
 * That would break the one promise this app makes — that a stated condition is
 * never resolved in the benefit's favour. A model asked to compare offers will
 * happily average away a `min_spend` it does not like the look of. So it never
 * sees a raw benefit, only an evaluation with the gates already resolved, and
 * anything it returns is checked against the ids we sent before it is shown.
 *
 * PRIVACY: this sends the user's held clubs and matching benefits to Google.
 * That is a deliberate product decision, not an oversight — the club list is
 * identifying (חבר implies IDF service, הייטקזון implies the industry). The
 * settings screen says so plainly, and the advisor is opt-in per question.
 */

const ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent';

/**
 * Expo inlines `EXPO_PUBLIC_*` into the bundle, which means this key ships
 * inside the app and can be read out of it. Acceptable for a personal dogfood
 * build; before this reaches anyone else the call belongs behind a proxy that
 * holds the key, with the device sending only the question.
 */
const API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY;

/** What the model is allowed to return. Ids are checked against what we sent. */
const RESPONSE_SCHEMA = {
  type: 'object',
  required: ['answer', 'best_benefit_id'],
  properties: {
    answer: {
      type: 'string',
      description: 'תשובה בעברית, שני משפטים לכל היותר, בגוף שני.',
    },
    best_benefit_id: {
      type: 'string',
      description: 'המזהה של ההטבה המומלצת מתוך הרשימה שסופקה, או מחרוזת ריקה אם אין התאמה.',
    },
    runner_up_id: {
      type: 'string',
      description: 'מזהה חלופה שנייה מתוך הרשימה, או מחרוזת ריקה.',
    },
    caveat: {
      type: 'string',
      description: 'התנאי היחיד שהכי חשוב לדעת עליו מראש, או מחרוזת ריקה.',
    },
  },
} as const;

const SYSTEM_INSTRUCTION = `אתה עוזר שעונה על שאלות לגבי הטבות והנחות שכבר יש למשתמש בישראל.

חוקים מוחלטים:
1. מותר לך להמליץ אך ורק על הטבה מתוך הרשימה שסופקה לך. אל תמציא הטבות, בתי עסק, אחוזים או תנאים.
2. הרשימה כבר דורגה על ידי מנוע התנאים, והדירוג שלו קובע. אם אתה ממליץ על משהו שאינו הראשון ברשימה — הסבר במשפט למה.
3. אל תפתור תנאי לטובת ההטבה. אם כתוב "לא צוין", זה לא אומר "אין הגבלה".
4. אם שום הטבה ברשימה לא רלוונטית לשאלה — החזר best_benefit_id ריק ואמור זאת בפשטות.
5. ענה בעברית, קצר, בלי שיווק ובלי סימני קריאה.`;

export interface AdvisorAnswer {
  answer: string;
  best?: Evaluation;
  runnerUp?: Evaluation;
  caveat?: string;
}

export class AdvisorError extends Error {}

/**
 * Flatten an evaluation to the facts the model may reason over. Everything here
 * is already decided — the gates carry the engine's verdict, not raw T&C text.
 */
function describe(evaluation: Evaluation) {
  const { benefit, gates } = evaluation;
  const merchant = merchantsById.get(benefit.merchant_id);
  return {
    id: benefit.id,
    merchant: benefit.merchant_name,
    categories: merchant?.categories ?? [],
    // The source's own Hebrew for the trade, alongside the enum. 574 distinct
    // values against ten enum members: "מוסך" and "מכבסה" have no enum home and
    // never will, but a model reading Hebrew can match them to "where do I get
    // the car serviced" perfectly well. The enum stays because it is what the
    // engine filters on; this is what makes the long tail answerable at all.
    trade: merchant?.label ?? null,
    club: programNames[benefit.program_id] ?? benefit.program_id,
    offer: `${benefit.value}${benefit.type === 'percent' || benefit.type === 'cashback' ? '%' : ' ₪'}`,
    estimated_saving_ils: Math.round(evaluation.estimatedSavingIls),
    is_estimate: evaluation.isEstimate,
    ready_now: evaluation.actionsRequired.length === 0,
    terms: benefit.conditions.raw_text_summary,
    conditions: gates.map((gate) => `${gate.label}: ${gate.detail} [${gate.state}]`),
  };
}

export function isAdvisorConfigured(): boolean {
  return typeof API_KEY === 'string' && API_KEY.length > 0;
}

export async function askAdvisor(
  question: string,
  profile: UserProfile,
  options: { signal?: AbortSignal } = {},
): Promise<AdvisorAnswer> {
  if (!isAdvisorConfigured()) {
    throw new AdvisorError('לא הוגדר מפתח API — הגדירו EXPO_PUBLIC_GEMINI_API_KEY');
  }

  // The engine runs first and on every question: the model only ever chooses
  // among offers that are usable right now, for clubs this user actually holds.
  const ranked = rankBenefits(benefits, {
    now: new Date(),
    ownedProgramIds: ownedProgramIds(profile.program_ids),
    mutedBenefitIds: profile.muted_benefit_ids,
  });
  if (ranked.length === 0) {
    return { answer: 'אין כרגע הטבות פעילות במועדונים שסימנת.' };
  }

  const byId = new Map(ranked.map((evaluation) => [evaluation.benefit.id, evaluation]));
  const payload = {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `השאלה: ${question}\n\nההטבות הזמינות למשתמש, מדורגות (הראשונה היא הטובה ביותר לפי המנוע):\n${JSON.stringify(
              ranked.slice(0, 25).map(describe),
              null,
              1,
            )}`,
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.2,
    },
  };

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      // The key goes in a header, never the query string — a URL lands in logs
      // and proxies in a way a header does not.
      headers: { 'content-type': 'application/json', 'x-goog-api-key': API_KEY! },
      body: JSON.stringify(payload),
      signal: options.signal,
    });
  } catch {
    throw new AdvisorError('אין חיבור לרשת — ההטבות עדיין ברשימה, רק בלי הסבר');
  }
  if (!response.ok) {
    throw new AdvisorError(`שירות ה-AI החזיר שגיאה (${response.status})`);
  }

  const body = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const raw = body.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new AdvisorError('שירות ה-AI לא החזיר תשובה');

  let parsed: { answer?: string; best_benefit_id?: string; runner_up_id?: string; caveat?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AdvisorError('שירות ה-AI החזיר תשובה בפורמט לא צפוי');
  }

  // The guard: a recommendation is only shown if it points at a benefit we
  // actually supplied. An invented id is dropped rather than rendered.
  const best = parsed.best_benefit_id ? byId.get(parsed.best_benefit_id) : undefined;
  const runnerUp = parsed.runner_up_id ? byId.get(parsed.runner_up_id) : undefined;

  return {
    answer: parsed.answer?.trim() || 'לא הצלחתי לנסח תשובה על סמך ההטבות שלך.',
    best,
    runnerUp: runnerUp && runnerUp !== best ? runnerUp : undefined,
    caveat: parsed.caveat?.trim() || undefined,
  };
}
