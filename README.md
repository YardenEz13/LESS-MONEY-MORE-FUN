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

# Real run (needs ANTHROPIC_API_KEY, or an `ant auth login` profile)
npm run extract
npm run -w @sbr/extraction review    # work the low-confidence queue
```

Output lands in `data/generated/` (git-ignored): `benefits.json` for anything
that cleared the confidence gate, `review-queue.json` for anything that didn't.

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

### Collecting outside Gush Dan

easy.co.il geo-ranks its results, so a plain `npm run scrape:easy` returns the
region its own default location sits in — which is why the catalog was 84% Gush
Dan, with 16 branches in Haifa and 10 in Be'er Sheva. Anchor the crawl somewhere
else to add that region:

```bash
node scripts/scrape-easy.mjs --lat 32.7940 --lng 34.9896 --rad 15   # חיפה
node scripts/scrape-easy.mjs --lat 31.7683 --lng 35.2137 --rad 15   # ירושלים
node scripts/scrape-easy.mjs --lat 31.2530 --lng 34.7915 --rad 15   # באר שבע
node scripts/scrape-easy.mjs --lat 31.8014 --lng 34.6435 --rad 15   # אשדוד
node scripts/scrape-easy.mjs --lat 32.3215 --lng 34.8532 --rad 15   # נתניה
```

Roughly 20 minutes per city across all ~90 lists. A run with coordinates
**merges** into what is already collected, so cities accumulate and the order
you run them in does not matter. A run **without** coordinates still replaces,
because that is the only way a business that closed ever leaves the file — so
run the unscoped crawl first and the regional sweeps after it, never the other
way around.

### Getting a benefit onto a phone

```bash
npm run publish:catalog -- --dry-run   # what would change
npm run publish:catalog                # merge into data/benefits.json
```

`data/benefits.json` is the catalog the app bundles and is **committed**, so a
fresh clone builds without ever running the pipeline. Promotion is a separate
step on purpose: it is the last point a human sees what is about to appear at a
till, and it refuses to publish anything still in the review queue.

Then push it to phones already in the field:

```bash
npm run ship:catalog     # validate:data, then eas update --branch production
```

**Why this is not optional.** Every benefit carries `last_verified_at`, and past
45 days `evaluateBenefit` blocks it. The catalog ships inside the JS bundle, so
a build that stops receiving updates crosses that line all at once — 206
relevant benefits become 0, on every phone, about six weeks after the last
publish. `eas update` replaces the bundle, and the catalog rides along with it;
without it, refreshing data costs a full store release.

Two things follow from that. `runtimeVersion` is `appVersion`, so bumping
`version` in `app.json` deliberately cuts existing installs off from further
updates — bump it for native changes only, never for a catalog refresh. And the
home screen names the failure rather than showing a blank list, so a phone that
did fall behind says so instead of looking empty (`catalogIsStale`).

First run on a machine needs an Expo account once, to create the project and
write `updates.url` into `app.json`:

```bash
cd apps/mobile && npx eas update:configure
```

`npm run ship:catalog` is deliberately not wired into `weekly-refresh.ps1`: that
script refreshes collected data and stops, because pushing to phones costs money
and judgement and stays a decision made at a keyboard.

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
1057 merchants; the 19 without one can be listed but never fenced. Details in
`docs/ARCHITECTURE.md`.
