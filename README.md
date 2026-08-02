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

**Malls, not shops.** Ten geofenced complexes, plus a 3-minute dwell threshold,
a 12-hour per-venue cooldown, and quiet hours — because a geofence enter event
on its own is mostly GPS drift.

## The look

"Ledger" — ink on warm paper, deep teal for money kept. The type is two Hebrew
revivals with actual provenance rather than the default product sans: Frank
Ruhl Libre, the face Hebrew fine print was set in, for our voice and every
figure; Miriam Libre, the squarish face of official forms, for names and
markers. The signature device is the condition strip: each term as a chip in
one of four tones — satisfied, do this, note, violated. Details in
`docs/ARCHITECTURE.md`.

## Status

Phases 1–3 of the PRD are built. Phase 4 is the 30-day personal validation run;
the stats screen exists to make its KPIs readable without a backend.

Known gaps — iOS Share Extension needs a native target (Android works today,
`docs/SHARE_EXTENSION.md`), the bundled catalog is synthetic, and the venue
coordinates are unverified. Details in `docs/ARCHITECTURE.md`.
