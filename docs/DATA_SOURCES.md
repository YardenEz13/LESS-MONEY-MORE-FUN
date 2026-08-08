# Data sources — coverage and freshness plan

Every benefit in the app came from one of three collection routes. The route
determines the tooling, the cost, and how often it can re-run:

| Route | Tooling | Cost per run | Can be scheduled |
|---|---|---|---|
| **A. Plain fetch / JSON API** | `scripts/scrape-easy.mjs`, `@sbr/extraction` scraper | free | yes |
| **B. Browser (JS-rendered)** | Cowork + Claude in Chrome, prompt in `COWORK_SCRAPE_PROMPT.md` | manual session | via saved skill + `/schedule` |
| **C. Browser behind login** | same, but *you* log in first | manual session | no — needs your session |

All three routes converge on the same pipeline — nothing bypasses the
confidence gate:

```
collect → collected/*.jsonl → npm run extract -- --collected <file> --program <id>
        → ≥0.85 published to data/generated/benefits.json
        → <0.85 data/generated/review-queue.json (npm run -w @sbr/extraction review)
        → npm run publish:catalog → data/benefits.json (what the app bundles)
```

## Source inventory

### Tier 1 — program-official catalogs (source of truth for conditions)

| Program | URL | Route | Status |
|---|---|---|---|
| Max | max.co.il/benefits | B (Angular SPA) | done once — rotates monthly |
| חבר | hvr.co.il | C (login wall) | prompt ready |
| ישראכרט | isracard.co.il | A/B | in `sources.json` |
| כאל | cal-online.co.il/benefits | A/B | in `sources.json` |
| שופרסל LIFE | shufersal.co.il | A/B | in `sources.json` |
| סופר-פארם LIFESTYLE | super-pharm.co.il/sales | A/B | in `sources.json` |

Official catalogs carry the *conditions* (min spend, exclusions, caps) — the
product. An aggregator can never replace them, only widen merchant coverage.

### Tier 2 — easy.co.il (aggregator; widest merchant coverage)

`npm run scrape:easy` walks easy's internal `bizlist` JSON API. Per-program
lists currently mapped (see `LISTS` in the script): `MAX`→max,
`Cal-Discount`→cal, `Isracard-Discounts`→isracard, `Isracard-Chever`→hever.

What easy gives us that officials don't: hundreds of *small local businesses*
("3.5% הנחה במעמד החיוב" at a print shop), each with address + coordinates —
exactly what the geofence feature needs. What it doesn't give: full terms. The
one-line deal text goes through extraction like any page; expect mostly-null
conditions and honest confidence scores.

Unmapped easy lists worth adding **after** their program exists in
`programs.json`: `Leumi-Goodies`, `Fly-Card`, `Diners-Club`,
`CampusCard-Members`, `max-Kranot`, `Special-Offers`, `SMB-Vouchers`.
The full menu of ~180 list slugs is on https://easy.co.il/list/Discounts.

Known limits of the scraper (deliberate):
- Results are geo-ranked around easy's default location; each list caps at
  ~100 businesses. Pass `--lat/--lng/--rad` to sweep other cities.
- Cloudflare tolerates a slow crawl (2–3s spacing, curl transport) and
  challenges bursts. The script retries with backoff; if a whole run 403s,
  wait ten minutes, don't tighten the loop.

### Tier 3 — candidates, not yet wired

- Club sites without a scrape route yet: hitechzone.co.il, בהצדעה, קרנות
  השוטרים (login walls → route C).
- Coupon/deal sites (groo, kupon, baligam): mostly one-off vouchers, not
  card-linked benefits — different product shape, skip until the app wants
  vouchers.
- Merchant sites themselves ("10% למועדון X" banners): unbounded crawl, poor
  yield. Only via targeted requests, never a broad crawl.

## Freshness plan

Each benefit already carries `last_verified_at`, `valid_until`, `source_url`,
`confidence_score` — freshness is enforced with what exists, no new machinery:

| Cadence | What runs | What it catches |
|---|---|---|
| every PR (CI) | `npm run validate:data` | shape breaks, dangling ids |
| weekly | `npm run scrape:easy` + `npm run extract -- --collected ... --all` re-runs | changed/new/removed easy deals — `content_hash` means unchanged offers cost zero model calls |
| weekly | `npm run verify:catalog -- --sources` | dead domains, source pages that stopped 200ing → candidates for removal |
| monthly | Cowork session per Tier-1 catalog (Max rotates monthly; חבר needs your login) | condition changes the aggregator can't see |
| after any import | `npm run -w @sbr/extraction review`, then `npm run publish:catalog` | low-confidence rows never ship un-reviewed |

Staleness rule: the app already treats old `last_verified_at` as a trust
signal. A benefit whose source URL 404s twice in a row gets deleted, not
patched — the source *is* the record.

Scheduling: the weekly pair is `/schedule`-able as a cloud agent (route A needs
no browser). Route B can be scheduled once the Cowork chat is saved as a skill;
route C stays manual by design — never store credentials to automate it.
