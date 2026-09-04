import * as Location from 'expo-location';
import {
  hiddenBenefitIds,
  nearbyCandidates,
  rankBenefits,
  type Coordinates,
  type Evaluation,
  type NearbyCandidate,
  type UserProfile,
} from '@sbr/core';
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
 * PRIVACY: the club list never leaves the device. It is the identifying part —
 * חבר implies IDF service, הייטקזון implies the industry — and the Gemini free
 * tier is covered by terms under which Google trains on what it receives and
 * human reviewers may read it. So clubs travel as per-request aliases, catalog
 * ids travel as ordinals (every id is prefixed with its program), and club
 * names are redacted out of the terms text before it is sent.
 *
 * What still leaves the device: the user's question verbatim, merchant names,
 * a city and a distance. No client-side change can redact a free-text question,
 * so the screen stays opt-in per question and the settings screen says so.
 */

const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent';

/**
 * Expo inlines `EXPO_PUBLIC_*` into the bundle, which means a key set here
 * ships inside the app and can be read out of it — fine for a dogfood build on
 * your own phone, not fine the moment someone else installs it. Anyone can pull
 * the string out of the bundle and spend the quota, and rotating it costs a
 * store release.
 *
 * So the key has a second home: set `EXPO_PUBLIC_ADVISOR_URL` and the device
 * sends the same payload to `api/advisor.ts` instead, which holds the key
 * server-side. Nothing about the request shape changes — the proxy forwards it
 * verbatim — which is why this is a one-line switch rather than a second
 * client.
 *
 * The proxy wins when both are set, because a build that has one should never
 * quietly fall back to shipping the other.
 */
const PROXY_URL = process.env.EXPO_PUBLIC_ADVISOR_URL;
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
      description: 'המספר הסידורי (שדה id) של ההטבה המומלצת מתוך הרשימה, או מחרוזת ריקה אם אין התאמה.',
    },
    runner_up_id: {
      type: 'string',
      description: 'המספר הסידורי של חלופה שנייה מתוך הרשימה, או מחרוזת ריקה.',
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
5. ענה בעברית, קצר, בלי שיווק ובלי סימני קריאה.
6. מרחק הוא חלק מהתשובה, לא הערת שוליים. הטבה של 15% במרחק 40 ק״מ אינה עדיפה על 6% במרחק 400 מטר עבור מישהו שרוצה לתדלק עכשיו. אם distance_km ריק — אל תניח שזה קרוב, פשוט אל תבטיח מרחק.
7. כשאתה ממליץ על משהו שיש לו distance_km — ציין את המרחק או את העיר בתשובה, כדי שאפשר יהיה להחליט אם ללכת לשם.
8. השעה והיום שנמסרו לך הם עכשיו. שים לב לשבת ולשעות סגירה: אל תשלח מישהו לחנות בשעה שהיא כמעט בוודאות סגורה בלי לומר זאת ב-caveat.`;

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
function describe(
  { evaluation, distanceM, city }: NearbyCandidate,
  ordinal: string,
  clubLabels: ReadonlyMap<string, string>,
  redact: (text: string) => string,
) {
  const { benefit, gates } = evaluation;
  const merchant = merchantsById.get(benefit.merchant_id);
  return {
    // A position in this request, never the catalog id. Every one of the 3071
    // ids is prefixed with its program — `max_cinema_city_1acfab36fd54` — so
    // sending the real id would hand over the club list in full even with the
    // `club` field aliased.
    id: ordinal,
    // Null rather than a large number when we cannot place the shop: "unknown
    // distance" and "far away" are different answers, and rule 6 leans on the
    // difference. One decimal, because a model given 0.43871 will quote it.
    distance_km: distanceM == null ? null : Math.round(distanceM / 100) / 10,
    city,
    merchant: benefit.merchant_name,
    categories: merchant?.categories ?? [],
    // The source's own Hebrew for the trade, alongside the enum. 574 distinct
    // values against ten enum members: "מוסך" and "מכבסה" have no enum home and
    // never will, but a model reading Hebrew can match them to "where do I get
    // the car serviced" perfectly well. The enum stays because it is what the
    // engine filters on; this is what makes the long tail answerable at all.
    trade: merchant?.label ?? null,
    // An index, never the club's name. See `clubTokens`.
    club: clubLabels.get(benefit.program_id) ?? 'מועדון',
    offer: `${benefit.value}${benefit.type === 'percent' || benefit.type === 'cashback' ? '%' : ' ₪'}`,
    estimated_saving_ils: Math.round(evaluation.estimatedSavingIls),
    is_estimate: evaluation.isEstimate,
    ready_now: evaluation.actionsRequired.length === 0,
    // 62 rows name their club inside the summary, and a gate detail can quote
    // it too, so both go through the redactor rather than only the `club` field.
    terms: redact(benefit.conditions.raw_text_summary),
    conditions: gates.map((gate) => redact(`${gate.label}: ${gate.detail} [${gate.state}]`)),
  };
}

/**
 * A per-request alias for each club in the payload — "מועדון 1", "מועדון 2".
 *
 * The club list is the identifying half of this request. חבר implies IDF
 * service, הייטקזון implies the industry, and a Gemini free-tier call is
 * covered by terms under which Google trains on what it receives and human
 * reviewers may read it — the same terms that say not to send personal
 * information. The model does not need the names: it only has to tell two
 * clubs apart well enough to explain why one offer beats another, and an index
 * does that. The real name is restored on the device before anything is shown.
 *
 * Merchant, city and distance still travel. "Someone near Ramat Gan asked about
 * fuel" is not the identifying part; the membership list is.
 */
function clubTokens(candidates: readonly NearbyCandidate[]): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const { evaluation } of candidates) {
    const programId = evaluation.benefit.program_id;
    if (!tokens.has(programId)) tokens.set(programId, `מועדון ${tokens.size + 1}`);
  }
  return tokens;
}

/**
 * Replace every known club name in free text with that club's alias.
 *
 * The aliasing is worthless if the name walks out inside a terms string — and
 * it does: 62 catalogued summaries name their own club, and gate details quote
 * them too. Longest name first, so a club whose name contains another's is
 * replaced whole rather than leaving a fragment behind.
 */
function clubRedactor(clubLabels: ReadonlyMap<string, string>): (text: string) => string {
  const replacements = Object.entries(programNames)
    .filter(([, name]) => name)
    .map(([programId, name]) => [name, clubLabels.get(programId) ?? 'מועדון'] as const)
    .sort((a, b) => b[0].length - a[0].length);
  return (text) => {
    let out = text;
    for (const [name, alias] of replacements) out = out.split(name).join(alias);
    return out;
  };
}

/**
 * Put the real club names back into prose the model wrote about aliases.
 *
 * Longest token first, or replacing "מועדון 1" would corrupt "מועדון 10" into
 * the first club's name followed by a stray zero.
 */
function restoreClubNames(text: string, clubLabels: ReadonlyMap<string, string>): string {
  const byLongestToken = [...clubLabels].sort((a, b) => b[1].length - a[1].length);
  let out = text;
  for (const [programId, token] of byLongestToken) {
    out = out.split(token).join(programNames[programId] ?? programId);
  }
  return out;
}

export function isAdvisorConfigured(): boolean {
  const configured = PROXY_URL ?? API_KEY;
  return typeof configured === 'string' && configured.length > 0;
}

/**
 * How far out "near me" reaches when the advisor picks what to consider.
 *
 * Wider than the home screen's 500m walking radius on purpose: the questions
 * this screen gets — where to fuel up, where to do the Shabbat shop — are asked
 * about a car journey, not a walk. Fifteen kilometres is most of a metropolitan
 * area in Israel and still excludes the next city, which is the line that makes
 * a Haifa answer stop being a Tel Aviv answer.
 */
const ADVISOR_RADIUS_M = 15_000;

/** How many evaluated offers the model gets to choose between. */
const CANDIDATE_LIMIT = 25;

/**
 * Where the phone last knew it was, or null.
 *
 * Deliberately the cached fix and the `get` permission call — never `request`,
 * never `getCurrentPositionAsync`. Asking a question must not raise a
 * permission dialog out of nowhere, and must not sit on a GPS wait indoors
 * before the answer starts. A fix from earlier in the day is precise enough to
 * decide which city's offers to consider, which is all it is used for.
 *
 * Null is an ordinary outcome — permission refused, no fix yet, web build — and
 * it degrades to the national ranking the advisor used before location existed.
 */
async function cachedPosition(): Promise<Coordinates | null> {
  try {
    const { granted } = await Location.getForegroundPermissionsAsync();
    if (!granted) return null;
    const last = await Location.getLastKnownPositionAsync();
    return last ? { lat: last.coords.latitude, lng: last.coords.longitude } : null;
  } catch {
    return null;
  }
}

export async function askAdvisor(
  question: string,
  profile: UserProfile,
  options: {
    signal?: AbortSignal;
    /**
     * Override the position. Pass `null` to answer nationally on purpose;
     * omit it entirely to use the phone's cached fix.
     */
    here?: Coordinates | null;
  } = {},
): Promise<AdvisorAnswer> {
  if (!isAdvisorConfigured()) {
    throw new AdvisorError('העוזר לא מוגדר — נדרש EXPO_PUBLIC_ADVISOR_URL או EXPO_PUBLIC_GEMINI_API_KEY');
  }

  // The engine runs first and on every question: the model only ever chooses
  // among offers that are usable right now, for clubs this user actually holds.
  const now = new Date();
  const ranked = rankBenefits(benefits, {
    now,
    ownedProgramIds: ownedProgramIds(profile.program_ids),
    mutedBenefitIds: hiddenBenefitIds(profile),
  });
  if (ranked.length === 0) {
    return { answer: 'אין כרגע הטבות פעילות במועדונים שסימנת.' };
  }

  // Location is fetched, never demanded: a null position costs the answer its
  // distances and nothing else.
  const here = options.here !== undefined ? options.here : await cachedPosition();
  const candidates = nearbyCandidates({
    ranked,
    merchantsById,
    position: here,
    radiusM: ADVISOR_RADIUS_M,
    limit: CANDIDATE_LIMIT,
  });

  const clubLabels = clubTokens(candidates);
  const redact = clubRedactor(clubLabels);
  // The guard's index. Keyed by position in this request, so an id the model
  // invents cannot resolve and an id from outside the candidate set cannot either.
  const byOrdinal = new Map<string, Evaluation>(
    candidates.map((candidate, index) => [String(index + 1), candidate.evaluation]),
  );
  // The model was answering "which is the best deal" as if it were asked on a
  // Tuesday afternoon from a Tel Aviv office. Both halves of that are now
  // stated: Shabbat and closing time are the single largest reason a correct
  // Israeli recommendation is still useless by the time you act on it.
  const whenLine = new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(now);
  const whereLine = here
    ? `המשתמש נמצא עכשיו באזור הזה, והרשימה מסודרת כך שכל מה שבטווח ${ADVISOR_RADIUS_M / 1000} ק״מ ממנו מופיע לפני מה שרחוק יותר.`
    : 'אין נתוני מיקום — כל שדות distance_km ריקים, ואסור להתייחס למרחק בתשובה.';

  const payload = {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `עכשיו: ${whenLine}\n${whereLine}\n\nהשאלה: ${question}\n\nההטבות הזמינות למשתמש, מדורגות על ידי המנוע (בתוך כל קבוצה — קרוב ואז רחוק — הראשון הוא הטוב ביותר):\n${JSON.stringify(
              candidates.map((candidate, index) =>
                describe(candidate, String(index + 1), clubLabels, redact),
              ),
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
    response = await fetch(PROXY_URL ?? GEMINI_ENDPOINT, {
      method: 'POST',
      // The key goes in a header, never the query string — a URL lands in logs
      // and proxies in a way a header does not.
      headers: PROXY_URL
        ? { 'content-type': 'application/json' }
        : { 'content-type': 'application/json', 'x-goog-api-key': API_KEY! },
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
  const best = parsed.best_benefit_id ? byOrdinal.get(parsed.best_benefit_id) : undefined;
  const runnerUp = parsed.runner_up_id ? byOrdinal.get(parsed.runner_up_id) : undefined;

  const answer = parsed.answer?.trim();
  const caveat = parsed.caveat?.trim();
  return {
    answer: answer ? restoreClubNames(answer, clubLabels) : 'לא הצלחתי לנסח תשובה על סמך ההטבות שלך.',
    best,
    runnerUp: runnerUp && runnerUp !== best ? runnerUp : undefined,
    caveat: caveat ? restoreClubNames(caveat, clubLabels) : undefined,
  };
}
