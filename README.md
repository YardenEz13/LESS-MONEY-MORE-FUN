# Smart Benefits Recall (MVP)

תזכורת בזמן אמת על הטבות, הנחות וגיפטקארדים שכבר יש לך — בלי חשבון, בלי ת״ז,
בלי חיבור לכרטיס האשראי.

Zero-auth contextual recall for Israeli club benefits. You declare which clubs
and cards you hold; the app reminds you when you walk into a mall or share a
shopping URL — and shows the conditions, not just the headline percentage.

Built from [`docs/PRD.md`](docs/PRD.md). The design decisions live in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Layout

| Path | What it is |
|---|---|
| `packages/core` | The condition engine — evaluation, ranking, geofence gating, share-URL resolution. Every other package calls into it. |
| `packages/extraction` | Scraper → Claude extraction with a strict JSON schema → confidence gate → JSON store + review queue. |
| `apps/mobile` | Expo app: onboarding, benefit list, condition detail, share result, settings, KPI readout. |
| `data/` | Programs, merchants, venues, and a **synthetic** sample catalog. See `data/README.md`. |

## Getting started

```bash
npm install                # workspaces: core + extraction
npm test                   # 46 tests across core and extraction
npm run typecheck
npm run validate:data
```

### Run the extraction pipeline

```bash
# Dry run against local fixtures — no network, no model call
npm run extract -- --offline --scrape-only

# Real run (needs GEMINI_API_KEY; GEMINI_MODEL overrides the default flash model)
npm run extract
npm run -w @sbr/extraction review    # work the low-confidence queue
```

Output lands in `data/generated/` (git-ignored): `benefits.json` for anything
that cleared the confidence gate, `review-queue.json` for anything that didn't.

### Crawl the country, not one city

easy.co.il ranks a list by distance from wherever you ask, and caps a query at
100 businesses however wide the radius. One query per list is therefore one
*city's* worth of that list — which is why the first crawl came back with 2258
Tel Aviv businesses, 18 in Jerusalem and 16 in Haifa. Nothing was wrong with it;
it was run from one point.

```bash
npm run scrape:easy -- --cities                     # all 42 points, ~9h
npm run scrape:easy -- --cities חיפה,ירושלים         # a sitting at a time, ~14min per city
npm run backfill:merchants -- --write               # branches, cities, categories, labels
```

easy blocks the JSON endpoint per IP once a crawl gets greedy, and a blocked
crawl stops itself after three consecutive list failures rather than grinding
through the rest. The block is on the address, so any different egress clears
it — set `EASY_PROXY` to a VPN, a phone hotspot or a paid pool:

```bash
EASY_PROXY=http://user:pass@host:port npm run scrape:easy -- --cities חיפה
```

Offers union with what is already collected, so chunked runs accumulate instead
of overwriting each other. Retraction is `verify:catalog`'s job, plus the
freshness policy: an offer that stops being re-found keeps its old
`last_verified_at` and ages out on its own.

One list crawled from four extra points took Jerusalem from 18 businesses to
102, Haifa 16 to 93, Beer Sheva 10 to 94. There are 74 lists.

### Collect with a browser, extract separately

Client-rendered catalogs (max.co.il ships 425KB of Angular and 502 chars of
text) need a real browser. Collection and extraction are split so the expensive
half can be re-run without re-crawling — see
[`docs/COWORK_SCRAPE_PROMPT.md`](docs/COWORK_SCRAPE_PROMPT.md).

```bash
# a collector wrote one raw offer page per line
npm run extract -- --collected path/to/max.jsonl --program max --limit 25
npm run extract -- --collected path/to/max.jsonl --program max --all
```

Offers are keyed by the collector's `content_hash`, so a re-crawl only pays the
model for pages whose text actually changed. `--limit` defaults to 25 because a
first run against an 800-offer catalog should be a choice, not a typo.

### Getting a benefit onto a phone

```bash
npm run publish:catalog -- --dry-run   # what would change
npm run publish:catalog                # merge into data/benefits.json
```

`data/benefits.json` is the catalog the app bundles and is **committed**, so a
fresh clone builds without ever running the pipeline. Promotion is a separate
step on purpose: it is the last point a human sees what is about to appear at a
till, and it refuses to publish anything still in the review queue.

### Run the app

```bash
cd apps/mobile
npm install
npm start
```

The app is not part of the npm workspace — Metro reaches `@sbr/core` and
`data/` through `metro.config.js` + the Babel module-resolver aliases.

## What it actually does

**Condition-awareness over headline numbers.** The engine reports every stated
condition with its verdict — satisfied, up to you, or violated — so a card can
show its own terms instead of burying them. An unstated condition is never
resolved in the benefit's favour: `min_spend: 150` with an unknown basket shows
as "בקנייה מעל ₪150", not as a promise, and a T&C silent on stacking says so.

**Two gates before anything reaches a phone.** Low-confidence extractions go to
a human review queue instead of the store, and the client refuses to display
them even if they somehow appear in the catalog.

**Staleness is a condition.** Past 14 days a benefit is flagged as unverified;
past 45 it stops being surfaced. Committed JSON ages whether or not you re-run
the pipeline.

**Wherever you are, not ten malls.** Places are matched by branch coordinate,
so a shop on a high street counts the same as one inside a complex. The OS will
only monitor 20 regions at once, so the app arms the nearest 20 to where you
were and re-picks them when you have moved — plus a 3-minute dwell threshold, a
12-hour per-place cooldown, and quiet hours, because a geofence enter event on
its own is mostly GPS drift.

## The look

"מערכת ההנחות" — a scoreboard meeting port signage. Three laws: flat fill only
(no gradient, glass, glow or soft shadow), 90° corners with elevation from
lines rather than shadows, and hierarchy from weight, size and rule rather than
letter-spacing. Deep green for money kept, a near-black plate under every
figure that matters, and one hairline doing the work a drop shadow usually does.

The type is Karantina — condensed, for headlines and figures only — over Noto
Sans Hebrew for body, interface and the Latin brand names. Every figure carries
`tabular-nums lining-nums` and LTR bidi isolation, so a price keeps its order
inside a Hebrew sentence and a column of them actually lines up.

The signature device is the condition strip: each term as a flat chip in one of
four tones — satisfied, do this, note, violated. Tokens are semantic
(`--color-surface-plate`, never a brand or source name), so a re-skin is three
swaps: the urgent accent, the display face, the hero texture. The green, the
structure, the 8-grid and the figures on the plate are the system. Tokens live
in `apps/mobile/src/theme.ts`; details in `docs/ARCHITECTURE.md`.

## Status

Phases 1–3 of the PRD are built. Phase 4 is the 30-day personal validation run;
the stats screen exists to make its KPIs readable without a backend.

Known gaps — iOS Share Extension needs a native target (Android works today,
`docs/SHARE_EXTENSION.md`), and the ten mall coordinates are still hand-entered
and unverified. Branch coordinates come from the collector and cover 1038 of
1057 merchants; the 19 without one can be listed but never fenced.

The catalog is still a Gush Dan catalog until a `--cities` crawl has been run —
the app now says so on an empty list rather than implying there are no deals
today. 472 of 1057 merchants have no `categories` and so answer no category
question, though all but 19 now carry the source's own `label` for what they
are. Details in `docs/ARCHITECTURE.md`.
