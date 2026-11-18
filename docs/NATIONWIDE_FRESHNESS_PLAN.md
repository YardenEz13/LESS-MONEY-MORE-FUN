# Plan: fresher, nationwide, in-store discounts

Written 2026-11-18. Numbers come from `data/benefits.json` (4,780 rows), `merchants.json` (1,067) and `scripts/status.mjs` on that day.

## Where it stands

| Fact | Number |
|---|---|
| Rows the app blocks as `stale_data` (>45 days, >21 for public) | **3,535 of 4,780 (74%)** |
| Of those, from easy.co.il | 2,714. **Every** easy row is stale |
| Rows older than 90 days | 11 |
| Merchants with branch coordinates | 1,049, in 162 cities |
| Branches in Tel Aviv alone | 1,141. Next: Ramat Gan 157, Jerusalem 127, Haifa 118 |
| Rows marked `in_store` or `both` | 709. `online`: 993. **No channel: 3,078** |
| Rows with `google_place_id` | 0 |

Root cause: not the algorithm. easy.co.il answers **403 (Cloudflare challenge)** to `scrape-easy.mjs` and the link check. The weekly refresh failed on 2026-11-15 and before. The daily link check proved 0%. With no re-verification, `last_verified_at` stops moving and the engine hides the row. That is correct behaviour: do not fake dates and do not bypass the challenge.

Geofencing is already nationwide: `geofencing.ts` arms the nearest 20 usable shops (`shop:<merchantId>`, 150 m) from the last position, and re-arms when the user moves. Reach is limited by **data** (which branches exist and are fresh), not by the fence code.

## 1. Freshness: verify from the source that grants the benefit

Order of trust: the club or card's own page, then a second source, then easy.co.il.

1. ~~Re-home easy rows to official pages.~~ Measured 2026-11-18: only 2 of 2,714 easy rows share `program_id` + `merchant_id` with a fresh official row, 0 with the same value. Dead end.
1a. **Done 2026-11-18:** official collectors were silently failing too. adif, meshekard, egged, dreamcard and lifestyle offer pages are client-rendered, so plain HTTP returned a shell, every page was "skipped", the collector refused to overwrite, and the old September `collected_at` kept being re-extracted. `collect-catalog.mjs` now falls back to a local Obscura render (`--dump html`) when fetch yields no record. adif: 0 → 12 records (all with `חשוב לדעת`), meshekard 2, dreamcard 1. egged and lifestyle still render nothing.
2. **Add official collectors for the easy-only clubs.** Biggest by row count: adif (218), magiayoter (136), behatsdaa (101), mystyle (100), ashmoret (99), club_hot (94), yahad (94), hever (90), histadrut (90), meshekard (89). Each has a public benefits page. Add each to `firecrawl-sources.json` / `collect-catalog.mjs`, same path the official catalogs use.
3. **Respect easy.co.il.** Keep it as a discovery source when it answers. Back off a whole week on a 403, not 60/180/420 s, and do not fail the whole weekly run on it: the official refresh must still ship.
4. **Freshness per source, not one clock.** A club page re-read today is fresh today. Record which source verified each row (already in `verification.checks`) and let the engine trust `verification.checked_at` when `seen_in_recrawl` passed on an official host.

## 2. Physical stores across the whole country

1. **Fill `channel`.** 3,078 rows have none, so the app cannot tell "walk in" from "code online". Classify from the source text (`בחנות`, `בסניפים`, `קוד קופון`, `באתר`). Rows that stay unknown are not used for location reminders.
2. **In-store first in ranking.** When the user is at a place, rank `in_store`/`both` above unknown, and drop `online` from geofence reminders.
3. **Branch coverage outside the centre.** Count fresh in-store rows per city. Cities with branches but 0 fresh in-store rows (likely the periphery: Eilat, Beersheba, the north) become the next collection targets: national chains first (supermarkets, pharmacies, fuel, fashion), since one chain covers every city.
4. **Branch lists from the chain, not easy.** For national chains, read the store locator on the chain's own site for branches and coordinates. Store `source` and `checked_at` per branch. A closed branch fires a reminder at nothing.
5. **Malls nationwide.** `venues.json` has 10 malls, all centre plus Haifa and Beersheba. Add the large malls in each district by hand (the README forbids guessing a venue), with radius checked on a map.

## 3. Better matching ("algorithm")

Only after 1 and 2. A good ranker on stale data still shows nothing.

- Score = value for this user × confidence × freshness × in-store fit × distance. Most pieces exist in `rankBenefits`; add the channel and distance terms.
- Prefer the best single offer per merchant and per card; fold duplicates from several sources into one row with the strongest proof.
- Learn from the user's own `מימשתי`/`השתק` taps: down-rank merchants they mute, up-rank trades they redeem.

## 4. Untested for a long time: verify, then delete

Rule, applied by a script, never by hand:

| Age of last real verification | Action |
|---|---|
| ≤ 45 days | Shown |
| 46–90 days | Hidden (current engine). Queue for re-verification from an official source |
| > 90 days and failed every re-verification attempt | Remove with `scripts/unpublish.mjs` and log the reason |
| Source page returns 404/410 twice, a week apart | Remove at once |

Today that means: **11 rows** qualify for removal (>90 days). The 3,524 rows at 61–90 days are queued, not deleted: most belong to clubs whose pages simply have not been re-read.

## Order of work

1. Weekly refresh: stop failing on easy 403; official catalogs still ship. (Small, unblocks everything.)
2. Cross-match easy rows against official catalogs (section 1.1). Measure how many come back fresh.
3. Official collectors for the 10 easy-only clubs.
4. `channel` classification and in-store ranking.
5. Per-city coverage report, then national-chain branch locators.
6. The verify-or-delete script, with counts printed before it removes anything.
