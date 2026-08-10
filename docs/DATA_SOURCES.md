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
is still crawled and still validated — it just cannot be handed to `extract`,
because benefit ids hash the program id. 72 of the 96 slugs are mapped; the
unmapped remainder are deal-type lists (Happy Hour, Brunch) and local trade
campaigns, which are not memberships anyone holds. See
`scripts/add-easy-programs.mjs`.

What easy gives us that officials don't: thousands of *small local businesses*
("3.5% הנחה במעמד החיוב" at a print shop), each with address + coordinates —
exactly what the geofence feature needs, and the reason `mine-merchants.mjs`
exists. What it doesn't give: full terms. Of 262 deals sampled, 4 carried any
condition text at all, so extraction of easy data yields mostly-null conditions
and honest low confidence. **Mine it for merchants; get conditions from Tier 1.**

### Proving the deals are real

```bash
npm run validate:easy     # after every scrape
```

A `HEAD` on the record's own `offer_url` is the whole check: easy answers **200**
for a live business and **404** for one that is gone, and sends no body either
way. It tests exactly the URL the app will open rather than a proxy for it.

- 200 → the record gains `verified_at`
- 404 → the record is **removed**; a deal you cannot open is worse than no deal
- anything else → left exactly as it was and counted as `unproven`. A refusal is
  the network talking, not evidence a business closed, and must never be
  allowed to empty the catalog

**Why not `/n/jsons/bizpage`,** which also answers this and returns 410: easy
rate-limits the JSON API hard. A pass of ~2300 per-id calls got 70% of itself
403'd and then locked us out of the whole JSON API for hours — while ordinary
page requests kept working throughout. The validator also does not correct
renamed businesses; the crawler rewrites `merchant_name` from `bizlist` every
run, so that would be a second, slower source for something already fresh.

The run is **incremental and checkpointed**: settled links are skipped and
verdicts are flushed to `collected/easy/.verified-cache.json` (git-ignored) as
they land, so a pass that gets throttled resumes rather than restarting. Twenty
refusals in a row aborts it. It prints `COVERAGE: N%`, and exits non-zero if
*nothing* verified — a run where the check itself is broken must not read as a
clean bill of health.

### easy rate-limits, and that is the binding constraint

Past a few thousand requests in a day easy answers **429** and redirects to
`/captcha`. Coverage reached **100% (4787/4787)** on 2026-08-09, but only across
many passes spread over a day — a single sitting cannot get there, and a fresh
crawl that adds records will drop it again until the daily task catches up.
Unproven is never the same as dead: nothing is deleted on a refusal.

The budget refills with **time**, not with patience inside a run — slowing
individual requests buys nothing, and six passes 25 minutes apart added one
record. So this is a quota, and there is no clever way around it:

- **Do not raise the request rate.** Every speed-up made it worse; the 2–3s
  crawl cadence is the one that survives 96 lists untouched.
- **Do not attempt the CAPTCHA.** Ever.
- **Do not retry in a tight loop.** Once easy starts refusing, it stays refusing
  for hours, and continuing to probe is both useless and rude.

Coverage converges **a slice per day**, via the
`LessMoneyMoreFun daily link check` scheduled task (07:30, running
`scripts/daily-linkcheck.ps1`), which clears roughly 500 links per pass and
skips whatever is already settled — so it absorbs new records from a weekly
crawl on its own. Watch the `COVERAGE:` line in
`data/generated/link-check.log`. A rate-limited pass exits non-zero and that is
normal — it means the day's budget ran out, not that anything is wrong.

If coverage ever needs to be complete in one sitting, the honest fix is a
residential-proxy pool or an agreement with easy — not a tighter loop.

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
| **daily** | `npm run validate:easy` (scheduled task) | delisted businesses, and the slice of unproven links that fits in easy's daily budget |
| weekly | `npm run scrape:easy` then `npm run validate:easy` | changed/new/removed easy deals |
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

## Extracting easy's deals

```bash
npm run extract:easy                      # fills the cache for every mapped list
npm run extract -- --collected collected/easy/<slug>.jsonl --program <id> --all
```

`scripts/extract-easy.mjs` writes the **same cache** the model-backed pipeline
uses (`data/generated/extraction-cache.json`, keyed by `content_hash`), so the
second command is a pure cache hit: no API calls, and the confidence gate, id
hashing, merchant resolution and review queue all still run. Nothing bypasses
review.

**Why a parser instead of the model.** easy publishes no terms. Its deal text is
one structured line — `3.5% הנחה במעמד החיוב` — where the discount is the only
fact present and every condition is absent. A model call there is paying per
page to read a percentage, and it adds variance without adding information.
Real terms come from the Tier-1 card catalogs, and those *do* go through the
model. Of 262 easy deals sampled, 4 carried any condition text at all.

**Nothing auto-publishes, by design.** Confidence tops out at 0.8, below the
0.85 gate, because easy is an aggregator: a legible `5% הנחה` may still omit a
minimum spend the merchant enforces. The deal is clear; the terms are unknown,
not absent. So all 4085 extracted benefits sit in
`data/generated/review-queue.json` awaiting `npm run -w @sbr/extraction review`.
That queue is the deliverable — approving it is a human judgement, and inflating
the scores to make the number look better would defeat the one gate protecting
someone standing at a till.

**Programs.** `scripts/add-easy-programs.mjs` mints a `data/programs.json` entry
per discount list, since benefit ids hash the program id and an unmapped list is
simply unextractable. Names come from easy's own hub titles, never invented;
categories are inferred from the title and the weak ones are printed for a human
to check. Deal-type lists (Happy Hour, Brunch) and local trade campaigns are
excluded — they are not memberships anyone holds.

Onboarding shows only programs that have at least one shipped benefit, so the
generated long tail stays out of the user's way until review lets it through.

### Order matters: merchants before publish, not after

`scripts/add-easy-merchants.mjs` mints a merchant per easy business that has a
benefit but no record — 1144 of them, of which 78 sit inside a tracked mall and
so gain a geofence. Names are copied byte-for-byte (the matcher compares them),
`domains` stays empty (easy exposes no website, and a wrong domain makes the
share sheet match the wrong shop), and `venue_ids` is measured from the
business's own coordinates.

Run it **as part of publishing, not before**. Two rules pull in opposite
directions and only line up at that moment:

- Benefit ids hash `merchant_id`, so mapping a merchant *after* publishing
  rebuilds its rows instead of updating them.
- `validate:data` fails a merchant with no domain, no venue and no *shipped*
  benefit — "nothing can reach it". Merchants added while their benefits still
  sit in review trip exactly that, and it is right to: they are unreachable
  until the benefits ship.

So the sequence is: approve the queue → `add-easy-merchants --write` →
re-run extraction so ids rehash onto the real merchants → `publish:catalog`.
Adding them earlier leaves `validate:data` red for as long as review takes.
