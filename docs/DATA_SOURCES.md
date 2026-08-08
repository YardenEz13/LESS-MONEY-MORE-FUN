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

`npm run scrape:easy` walks **every** discount list on the site — the slugs are
discovered from the `/list/Discounts` hub at run time, not hardcoded, because
easy adds and retires clubs constantly and a fixed list silently stops covering
the site the first time they do. Last full run: 96 lists, 4787 deals, 3919
distinct businesses, zero failures.

`PROGRAMS` in the script maps a slug to a program id. A slug that is not in it
is still crawled and still validated — it just cannot be handed to `extract`
until someone adds the program, because benefit ids hash the program id. Worth
adding programs for: `Leumi-Goodies`, `Fly-Card`, `Diners-Club`,
`Discounts-American-Express`, `Mizrahi-Tefahot-Members`, `Rami-Levy-Club`.

What easy gives us that officials don't: thousands of *small local businesses*
("3.5% הנחה במעמד החיוב" at a print shop), each with address + coordinates —
exactly what the geofence feature needs, and the reason `mine-merchants.mjs`
exists. What it doesn't give: full terms. Of 262 deals sampled, 4 carried any
condition text at all, so extraction of easy data yields mostly-null conditions
and honest low confidence. **Mine it for merchants; get conditions from Tier 1.**

### Proving the deals are real

```bash
node scripts/validate-easy.mjs     # after every scrape
```

Every record's `offer_url` is `easy.co.il/page/<bizid>`, and
`/n/jsons/bizpage?bizid=N` answers whether that id is alive: the business JSON,
or HTTP **410** when it is gone. That is a stronger check than fetching the HTML
page, which returns a soft shell for anything.

- passes → the record gains `verified_at`, and a `merchant_name` easy has since
  changed is corrected to match
- 410 → the record is **removed**; a deal you cannot open is worse than no deal
- network failure → the record is left exactly as it was and counted as
  `unreachable`. A Cloudflare bad day is not evidence a business closed, and
  must never be allowed to empty the catalog

The script exits non-zero if *nothing* verified, because a run where the check
itself is broken must not be read as a clean bill of health.

Known limits of the scraper (deliberate):
- Results are geo-ranked around easy's default location; each list caps at
  ~100 businesses. Pass `--lat/--lng/--rad` to sweep other cities — coverage
  outside Gush Dan is the biggest known gap.
- Cloudflare tolerates a slow crawl (2–3s spacing, curl transport) and
  challenges bursts. The script retries with backoff; if a whole run 403s,
  wait ten minutes, don't tighten the loop.
- A crawl cut short never overwrites a good file — see the guard test in
  `scripts/scrape-easy.test.mjs`.

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
| weekly | `npm run scrape:easy` then `node scripts/validate-easy.mjs` | changed/new/removed easy deals, and any whose business has since been delisted |
| weekly | `npm run verify:catalog -- --sources` | dead domains, source pages that stopped 200ing → candidates for removal |
| monthly | Cowork session per Tier-1 catalog (Max rotates monthly; חבר needs your login) | condition changes the aggregator can't see |
| after any import | `npm run -w @sbr/extraction review`, then `npm run publish:catalog` | low-confidence rows never ship un-reviewed |

Staleness rule: the app already treats old `last_verified_at` as a trust
signal. A benefit whose source URL 404s twice in a row gets deleted, not
patched — the source *is* the record.

**Scheduling: the weekly refresh runs locally**, as Windows scheduled task
`LessMoneyMoreFun weekly refresh` — Sundays 06:00, running
`scripts/weekly-refresh.ps1` against this repo — it crawls, then validates every
link, and takes roughly 50 minutes (the task's limit is 3h). It is set
`StartWhenAvailable`,
so a run missed because the machine was off fires when it next wakes instead of
being skipped. It appends to `data/generated/weekly-refresh.log` (git-ignored),
ending in one of:

```
RESULT: no changes
RESULT: CHANGED         (followed by the modified files)
RESULT: FAILED (exit N) - existing catalog left untouched
```

It deliberately stops after refreshing the JSONL: extraction costs money and
judgement, so `npm run extract` stays a keyboard decision. Inspect, remove, or
retime it with `Get-ScheduledTask`/`Unregister-ScheduledTask`.

A cloud routine also exists — `trig_01AEToRq65jECsxYHChuokTR` at
https://claude.ai/code/routines — but it is **disabled**, because the cloud
sandbox cannot reach easy.co.il:

```
curl -sS https://easy.co.il/list/MAX
curl: (56) CONNECT tunnel failed, response 403
```

The environment's outbound proxy refuses the CONNECT tunnel, so the request
never reaches the site (issue #1 has the full run report). This is network
policy, not rate-limiting — retries and delays cannot help, and the same block
applies to `verify:catalog --sources`, which also has to reach Israeli retail
domains. The routine is left in place, disabled, so it can be re-enabled the
moment easy.co.il is allowlisted for that environment — at which point it
becomes the better home for this job, since it does not depend on one laptop
being awake.

Note the cloud sandbox also has no `ANTHROPIC_API_KEY`, so even with egress it
could only collect; extraction stays a local step either way.

**How to read it, once it can run.** The run is unattended, so it always leaves
exactly one visible artifact, and you never have to open a cloud transcript to
know what happened:

| You see | It means |
|---|---|
| a PR | deals changed — read the before/after headlines, then extract locally |
| an issue titled `weekly refresh FAILED: …` | the run broke; body carries the failing command and its real output |
| nothing | healthy, nothing changed |

That mapping only works because failures are loud. If you ever find the routine
has been quiet for weeks, check that it is still enabled rather than assuming
the catalog is stable — silence from a *disabled* routine looks identical to
silence from a healthy one, and that is the one ambiguity this design cannot
close from inside. It is disabled right now, so that caveat is live.

Route B can be scheduled once the Cowork chat is saved as a skill; route C stays
manual by design — never store credentials to automate it.
