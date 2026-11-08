# data/

| File | What it is | Source of truth |
|---|---|---|
| `programs.json` | Clubs/cards a user can declare during onboarding | Hand-maintained |
| `merchants.json` | Merchant identity + domains (Share Extension) + mall presence | Hand-maintained |
| `venues.json` | Geofenced shopping complexes | Hand-maintained |
| `benefits.json` | **The catalog the app bundles.** Committed | `npm run publish:catalog` |
| `benefits.sample.json` | **Synthetic fixtures for development only** | Not real |
| `generated/benefits.json` | Pipeline output (git-ignored) | `npm run extract` |
| `generated/review-queue.json` | Low-confidence extractions awaiting a human | `npm run extract` |

## Adding a merchant

Extraction mints an `unmapped_<slug>` id for any merchant not listed here. Such
a benefit still appears in the list — it just cannot be surfaced *proactively*
until the merchant exists. Each field buys one specific capability:

`branches`, `label` and the enum `categories` are not hand-maintained — run
`npm run backfill:merchants -- --write` and they come from the easy.co.il
sidecar. It fills `categories` only when empty, so a hand-classified merchant is
never overruled by a regex table.

| Field | Buys | If you leave it empty |
|---|---|---|
| `name` | The match itself | Nothing works — must be **byte-identical** to the extracted `merchant_name`, since `resolveMerchantId` compares a normalised form of this string |
| `domains` | Share-sheet matching | Sharing a URL from that shop finds nothing |
| `venue_ids` | Geofence reminders | Walking into the mall reminds you of nothing |
| `categories` | Advisor intent ("איפה לתדלק") | Never returned for a category question |
| `label` | The line under the name on a card — the source's own words for the trade ("מכולת", "מוסך"), and the free text the advisor matches an errand against when no enum member fits | The card shows a bare business name, which for most of a 1057-merchant catalog tells the reader nothing |
| `branches[].city` | "מכולת · גבעתיים" on a card, and "the catalog does not reach here" instead of an empty list | A list with no location fix cannot say where anything is |

Then re-run the import so the benefit picks up the real merchant id — **benefit
ids are hashed from `merchant_id`**, so mapping a merchant changes the id and
the old `unmapped_*` row has to be rebuilt, not merged.

**Never guess a domain or a venue.** A wrong domain makes the share sheet
silently fail to match, which is harder to notice than no domain at all; a wrong
venue fires a reminder at a shop that isn't there. `domains` holds the
registrable domain — `url.ts` strips `www.` from both sides, so an apex that
doesn't serve HTTP is still correct.

```bash
npm run validate:data     # offline, in CI: shape and cross-references
npm run verify:catalog    # online, by hand: are these domains actually real
npm run verify:catalog -- --sources   # also check every source_url still 200s
```

The two are deliberately separate: a site being down for an hour should not fail
a build, and a check that cries wolf gets ignored.

## ⚠️ `benefits.sample.json` is fake

Every entry is invented to exercise a different condition shape (min spend, day
windows, hour windows that wrap midnight, channel restrictions, caps, vouchers,
stale data, low confidence). `source_url` points at `example.invalid` precisely
so it can never be mistaken for a scraped record. **Do not ship it to a device
you make real purchasing decisions with** — real benefits only come out of the
extraction pipeline, with a `source_url` you can open and re-read yourself.

## Venue coordinates

`venues.json` coordinates are approximate mall centroids and the radii are
first guesses. Before relying on geofencing, walk each site or check the
coordinates against Google Maps and tune `radius_m`: too small and the fence
never fires indoors, too large and it fires from the highway next door.

## Checking offers with Gemini (local)

`scripts/gemini-verify.mjs` re-reads each stale offer's source page with Gemini and
moves `last_verified_at` forward only when Gemini quotes the page word for word
(the script checks the quote and the offer's number itself). It deletes nothing.

1. Get a key at https://aistudio.google.com/apikey and put `GEMINI_API_KEY=...` in a
   git-ignored `.env` at the repo root (`apps/mobile/.env` also works).
2. Dry run, one mall first:  `npm run verify:gemini -- --venue azrieli_tlv --max 20`
3. Happy with `data/generated/verify-report.json`? Add `--write`, then
   `npm run validate:data && npm test`, and commit `data/benefits.json`.

easy.co.il answers 403 and the script respects that: those offers stay stale.
`npm run branches:osm` (dry run) adds chain branches from OpenStreetMap the same way.

### With your Gemini account in your own Chrome (no API key)

`scripts/gemini-chrome-verify.mjs` does the same check through the Gemini web app, in
a Chrome you control, and also reads JavaScript-rendered pages.

1. `npm install`
2. `powershell -File scripts/start-chrome-gemini.ps1` — opens Chrome with its own
   profile; log in to Google once (kept in `%LOCALAPPDATA%\lmmf-gemini-chrome`).
3. `node scripts/gemini-chrome-verify.mjs --probe` — shows which Gemini page
   selectors match today. If one says `-`, fix it in `SELECTORS` at the top of the script.
4. `npm run verify:chrome -- --venue azrieli_tlv --max 10`, read the report, then add `--write`.

It never solves captchas or blocks, and stops using a site after 3 refusals.
