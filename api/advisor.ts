/**
 * The advisor's key holder. Deploy anywhere that runs a fetch handler; the
 * device calls this instead of Gemini and carries no key at all.
 *
 *   vercel deploy --prod        # with GEMINI_API_KEY set in the environment
 *   EXPO_PUBLIC_ADVISOR_URL=https://<deployment>/api/advisor
 *
 * It forwards the request body verbatim rather than rebuilding the payload.
 * That is the point: the prompt, the schema and the model choice stay in
 * `apps/mobile/src/services/advisor.ts`, where they can be changed with an
 * `eas update` instead of a redeploy, and this file never has to be kept in
 * step with them. What it adds is the key, a size limit and a hard cap on which
 * upstream it will talk to.
 *
 * What it deliberately does NOT do: authenticate callers. An open endpoint with
 * a key behind it is a quota someone else can spend, and the only reason that
 * is acceptable today is that the audience is a closed test group. Before the
 * store listing this needs a device token or an app-attest check — see
 * `docs/LAUNCH_PLAN.md`, day 9.
 */

const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent';

/**
 * A ranked catalog slice with 25 offers and their conditions runs to a few tens
 * of KB. 256KB is comfortably above any legitimate request and well below the
 * size someone would use to burn tokens through us.
 */
const MAX_BODY_BYTES = 256 * 1024;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  });

export default async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return json(405, { error: 'POST only' });

  const apiKey = process.env.GEMINI_API_KEY;
  // A missing key is an operator error, not a user error, and it must not read
  // as "the model had nothing to say".
  if (!apiKey) return json(500, { error: 'GEMINI_API_KEY is not set on the server' });

  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return json(413, { error: 'payload too large' });

  let upstream: Response;
  try {
    upstream = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body,
    });
  } catch {
    return json(502, { error: 'upstream unreachable' });
  }

  // Status and body pass through untouched: the client already distinguishes a
  // network failure from an upstream error code, and rewriting either here
  // would hide which one happened.
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { 'content-type': 'application/json', ...CORS },
  });
}

export const config = { runtime: 'edge' };
