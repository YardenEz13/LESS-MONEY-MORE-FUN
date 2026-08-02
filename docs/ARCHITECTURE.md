# Architecture

What exists, why it's shaped this way, and where the sharp edges are.

## Shape

```
data/*.json ──────────────┐
                          │
packages/extraction  ─────┤   scrape → LLM (strict schema) → confidence gate
  sources.json            │              │              │
  src/scrape.ts           │        data/generated/   review-queue.json
  src/extract.ts          │        benefits.json     (npm run review)
  src/store.ts            │
                          ▼
packages/core ─── evaluateBenefit / rankBenefits / geo / url / format
                          ▲
apps/mobile ──────────────┘   onboarding · home · detail · share · settings · stats
```

`packages/core` is the only place that decides whether a benefit applies. The
pipeline, the geofence handler, the share resolver, and every screen all call
into it, so there is exactly one definition of "eligible" to get right.

## The decisions that shaped it

### Conditions are the interface, so the engine reports every one of them

`evaluateBenefit` returns a `gates` array: one entry per stated condition, each
carrying the verdict the engine reached — `met`, `pending`, or `blocked` — plus
a chip-sized label and a full sentence. `blockers` and `requirements` say what
went wrong; gates say what was *checked*, including the checks that passed.

The UI needs the passes. "7 conditions, 2 on you, 2 already satisfied" is a
useful thing to read at a till; a list of caveats with no denominator is not.

A pending gate also carries `actionable`: true when the user can still change
the outcome before paying (top up the basket, issue a voucher), false for
caveats they can only note (no stacking, excluded categories, a discount cap).
`actionsRequired` is the actionable subset, and it — not `status` — is what the
list screen counts. Counting caveats made every benefit look conditional and
the "ready now" figure sat permanently at zero, which is how the distinction
was found: by looking at the screen.

### An unknown condition is never resolved in the benefit's favour

`evaluateBenefit` returns one of three states, not a boolean:

| status | meaning |
|---|---|
| `eligible` | every stated condition is known and satisfied right now |
| `conditional` | nothing is violated, but the user must still satisfy or verify something |
| `blocked` | a stated condition is violated right now |

A benefit with `min_spend: 150` and an unknown cart is `conditional` with the
requirement spelled out — never `eligible`. A T&C that says nothing about
stacking produces `stacking_unknown`, not "stacks: yes". This is the whole
mechanism behind KPI #2: the app is allowed to be vague, it is not allowed to
be wrong.

### The catalog can go stale, so staleness is a condition

`last_verified_at` is not decoration. Past 14 days a benefit carries an
"unverified recently" note; past 45 days it stops being surfaced at all. A
committed JSON bundle ages whether or not anyone re-runs the pipeline, and an
expired benefit shown confidently costs the user a trip.

### Two gates guard the same failure

Low-confidence extractions are held back twice — once in the pipeline
(`partitionByConfidence` routes them to the review queue instead of the store)
and once at read time (`evaluateBenefit` blocks `confidence_score < 0.85`
unless `reviewed_by_human`). The second gate is redundant by design: it means a
hand-edited catalog file cannot bypass the first one.

### Geofences are malls, not shops

Ten venues, 200–300 m radii. Fencing individual street-level stores was
rejected in the PRD for notification volume, and the same reasoning applies to
the notification gate itself: entering a fence is necessary but not sufficient.
`shouldNotifyForVenue` additionally requires 3 minutes of dwell (GPS drift
re-fires enter events constantly), a 12-hour per-venue cooldown, non-quiet
hours, and at least one benefit to actually name.

### Channel is context, not a guess

A geofence entry leaves `channel` unset — standing in a mall says nothing about
whether you'll buy at the till or on your phone, so an online-only benefit
shows as `conditional` with "תקף באונליין בלבד". A share-sheet resolution pins
`channel: 'online'`, so an in-store-only benefit is genuinely blocked and never
shown. Same engine, different context.

### Weekday numbering is 1=Sunday

Israeli T&C say "א׳-ה׳". `valid_days: [1,2,3,4,5]` means Sunday–Thursday
throughout: schema, prompt, engine, and UI. All day/hour comparisons resolve
through `Asia/Jerusalem` via `Intl`, never `Date#getDay` — a phone in another
timezone must not change which benefits apply.

### Zero-auth is enforced by absence

The profile is a list of club ids in `AsyncStorage`. There is no account, no
server, and no network write path in the app at all. If a sync feature ever
lands, that's the property it has to argue with.

## The look

The design system lives in `apps/mobile/src/theme.ts` under the name "Ledger".
It takes its cues from the artifact that already answers this app's question
honestly — a printed receipt: ink on warm paper, hairline rules, figures given
room, conditions never demoted to grey small print. The accent is a deep
teal-green rather than promotional red, because the app never sells a deal; it
tells you what you already hold. Rubik carries headlines and every figure,
Heebo does the reading work; both are bundled, so first launch needs no network.

The one device the app is built around is the **condition strip**: each stated
condition as a chip in one of four tones — satisfied (mint ✓), do this (amber
!), note (quiet grey •), violated (clay ✕). It is the gate model rendered
directly, and it is why a card can show its own terms without a paragraph.

## Known gaps

- **iOS Share Extension is not implemented.** The resolver and UI are done and
  reachable via the `sbr://share?url=...` scheme; the native target is
  described in `SHARE_EXTENSION.md`.
- **The bundled `benefits.sample.json` is synthetic.** Real data comes from
  `npm run extract`. See `data/README.md`.
- **Scraping is fetch + regex-to-text.** JS-rendered catalogs return too little
  text and fail loudly rather than silently producing an empty extraction.
- **Venue coordinates are unverified** mall centroids with guessed radii.
- **The store is JSON files.** No database yet; the schema in `packages/core`
  is what a real one would be built from.
