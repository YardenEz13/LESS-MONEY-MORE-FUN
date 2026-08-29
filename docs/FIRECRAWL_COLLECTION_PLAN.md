# Firecrawl collection plan — closing the conditions gap

The app promises the **conditions**, not the headline percentage. That promise
is currently backed by seventeen records.

This plan adds **Route B′** — Firecrawl in place of the manual Cowork browser
session — and uses it to collect the club catalogs that actually publish terms.
It changes nothing downstream: collection still stops at
`collected/*.jsonl`, and the confidence gate, the `content_hash` cache, the id
hashing and the review queue are all untouched. See
[`DATA_SOURCES.md`](DATA_SOURCES.md) for the routes this extends.

## The gap, in numbers

Measured against `data/benefits.json` on 2026-08-28:

| | |
|---|---:|
| benefits shipped | 2,763 |
| carrying a `min_spend` | **7** |
| carrying a `max_discount` | **3** |
| carrying a `valid_until` | 126 |
| sourced from easy.co.il | 2,731 (98.8%) |
| sourced from an official catalog | **17** |
| below the 0.85 gate, passed by hand | 2,733 |

The pipeline is healthy — link coverage is 100%, the gate works, the queue
works. The problem is upstream of all of it: **we collect from a source that
does not publish terms.** easy gives one structured line per deal
(`3.5% הנחה במעמד החיוב`) where the discount is the only fact present. The 2,733
low scores are honest; the terms genuinely are not there.

Tier-1 provenance before this plan:

| Program | Benefits | From its own site | From easy | Samples |
|---|---:|---:|---:|---:|
| חבר `hever` | 94 | 0 | 90 | 4 |
| Max `max` | 105 | **17** | 84 | 4 |
| ישראכרט `isracard` | 8 | 0 | 6 | 2 |
| כאל `cal` | 1 | 0 | 0 | 1 |
| שופרסל LIFE | 1 | 0 | 0 | 1 |
| סופר-פארם LIFESTYLE | 0 | 0 | 0 | 0 |

## What Firecrawl measured

Every Tier-1 source was put through Firecrawl before this plan was written,
rather than assumed:

| Target | Plain fetch | Firecrawl |
|---|---|---|
| `max.co.il/benefits` | 502 chars — fails `diagnose()` | 18,963 chars |
| max offer detail | never reached | 3,215 chars incl. the full `חשוב לדעת` block |
| max URL discovery | none | 80 offer URLs via `/map` |
| `super-pharm.co.il/sales` | configured, never collected | 63,289 chars, 2,993 offer terms |
| `benefits.isracard.co.il` | 106 chars — **wrong URL in config** | 92 offer pages via `/map` |
| `cal-online.co.il/benefits` | 1 sample row | 8,679 chars with `waitFor` + stealth |
| `shufersal.co.il` | never collected | serving a maintenance image |
| `hvr.co.il` | login wall | unchanged — cannot hold your session |

A single Max detail page returned a real `usage_limit`
(`ניתן להזמין עד 2 פריטים ללקוח בחודש`), an `exclusions` list of card types
(Hapoalim, FREE, DEBIT, Leumi, PEPPER) and an expiry rule — the exact fields
that are null across 2,440 shipped rows.

**One result was a plain bug.** `packages/extraction/sources.json` pointed
isracard at the corporate homepage; the catalog is on `benefits.isracard.co.il`.
A one-line fix that had been costing a whole card catalog.

## Who is guarded and who is not

All 74 programs were probed. The inventory of record is
[`scripts/firecrawl-sources.json`](../scripts/firecrawl-sources.json), which
carries a `status` per program and is what `--all` reads.

| Status | Count | Meaning |
|---|---:|---|
| `open` | 39 | reachable and offer-dense — **the first pass** |
| `needs_offer_urls` | 6 | reachable, but `/map` finds no offer URLs (see first-pass results) |
| `blocked` | 15 | 403 / WAF / empty shell — no route today |
| `guarded` | 5 | login wall — Route C, manual, never automated |
| `needs_url` | 5 | no official site found; a human has to name it |
| `thin` | 4 | reachable but the landing page carries no offers |

Verdicts come from the page's own text: offer vocabulary against sign-in cues.
A login wall still markets benefits in its chrome, so the test is offers
*relative* to sign-in furniture, not offers alone.

### The first pass — 39 open sources

These carry 1270 of the current benefits between them, all of which
are easy-sourced today and would gain real terms.

<!-- generated from scripts/firecrawl-sources.json -->

| Program | Benefits today | Source |
|---|---:|---|
| Max `max` | 105 | `max.co.il/benefits` |
| כ.א.ל Extra `calextra_discounts` | 100 | `cal-online.co.il/benefits` |
| מגיע לך יותר `magiayoter` | 100 | `yoter.co.il` |
| כרטיס אשראי קרנות `max_kranot` | 94 | `max.co.il/cards/kranot` |
| משקארד `meshekard` | 73 | `meshekard.co.il` |
| עדיף `adif_members` | 72 | `adif.org.il` |
| ויגן אקטיב `vegan_active_discounts` | 71 | `isracard.co.il/credit-cards/veganfriendly` |
| מועדון אגד `egged_driver_memebers` | 71 | `eggedclub.co.il` |
| Corporate `corporate_members` | 66 | `mycorporate.co.il` |
| P100 `p100_members` | 61 | `isracard.co.il/credit-cards/p100` |
| AMEX `discounts_american_express` | 60 | `rewards.americanexpress.co.il` |
| LifeStyle `life_style_members` | 53 | `lifestyle.style.co.il` |
| ויגן בונוס `vegan_bonus` | 46 | `business.vegan-friendly.com/he/va-terms-of-use` |
| max תמורה `max_tmura` | 43 | `max.co.il/cards/tmura` |
| Topcash `topcash` | 41 | `topcash.co.il` |
| מפתח דיסקונט `mafteach_discounts` | 39 | `discountbank.co.il/private/credit-cards/discount-key` |
| מועדון יותר `yoter` | 38 | `yoter.co.il` |
| מרכנתיל סמייל `mercantile_smile` | 22 | `mercantile.co.il/private/credit-cards/mercantile-smi` |
| קופונופש `cuponofesh` | 20 | `cpnclub.co.il` |
| Living Plus `living_plus_members` | 18 | `isracard.co.il/credit-cards/living` |
| רעות תקני לי `reut_buy_it_for_me` | 17 | `max.co.il/cards/reut-buy-it-for-me` |
| My MAX `my_max` | 13 | `max.co.il/benefits/lobby` |
| ארגון המורים `irgoon_hamorim_benefits` | 12 | `igm.org.il/site/pg/igm_allbenefits` |
| ישראכרט `isracard` | 8 | `benefits.isracard.co.il` |
| טפחות ישראכרט `tefahot_card` | 8 | `mizrahi-tefahot.co.il/hacartis` |
| Carrefour Club `carrefour_club` | 8 | `cal-online.co.il/cards/carrefour` |
| הייטקזון `hitechzone` | 6 | `htzone.co.il` |
| מועדון Dream Card `dream_card_club` | 3 | `dreamcard.co.il/dreamcard-vip` |
| כאל `cal` | 1 | `cal-online.co.il/benefits` |
| Cash כאל Pro `cal_cash_pro` | 1 | `cal-online.co.il/benefits` |
| מקס בק `max_back` | 0 | `max.co.il` |
| LIFESTYLE סופר-פארם `superpharm_lifestyle` | 0 | `super-pharm.co.il/sales` |
| Fly Card `fly_card` | 0 | `isracard.co.il/flycard/private` |
| דיינרס `diners_club` | 0 | `diners.co.il/benefits` |
| מועדון טוב פלוס `tov_plus_club` | 0 | `tovplus.org.il` |
| מגה לאן `megalean` | 0 | `megalean.co.il` |
| Poalim Wonder `poalim_wonder` | 0 | `bankhapoalim.co.il/he/Poalim-Wonder` |
| לשכת רו"ח `public_accountants_institute_members` | 0 | `isracard.co.il/credit-cards/hi-benefit` |
| הטבה לכוחות הביטחון `security_forces_benefit` | 0 | `mod.gov.il/%D7%9B%D7%AA%D7%91%D7%95%D7%AA-%D7%95%D7%` |

### Reachable, but the offers are not linkable (6)

Demoted from `open` after the first pass: `/map` enumerates no offer URLs and
the shell serves a default render. They need per-offer discovery, not a re-run.

| Program | Benefits | Source | What came back |
|---|---:|---|---|
| Mystyle `mystyle_discounts` | 100 | `my.style.co.il` | root renders the site terms-of-use document, not a catalog |
| יחד `yahad` | 94 | `ima.org.il/yahadclub/default.aspx` | single page yields 605 chars, no offers |
| ישראכרט TOP `isracard_top_members` | 85 | `top.style.co.il` | /map returns no offer URLs; scrape refused twice |
| לשכת סוכני הביטוח `insurance_association_members` | 74 | `isracard.co.il/credit-cards/insura` | club overview page; offers are not linked from it |
| iCard `i_card` | 73 | `icard.style.co.il` | SPA shell returns a generic default render — byte-identical to youngstyle |
| ישראכרט צעיר `youngstyle` | 72 | `young.style.co.il` | SPA shell returns a generic default render — byte-identical to i_card |

**A caveat that must not be lost.** The access verdicts are measured; some of
the *URL attributions* are not. Roots were found by search, and search
occasionally lands on a plausible page for the wrong product — three programs
initially resolved to isracard's `chever` card page, and one to a Google
redirect blob. Those were re-probed and corrected or demoted to `needs_url`.
The remaining risk is a root that looks right and is not; the collector's own
output makes this visible (a catalog whose merchant names have nothing to do
with the club), and every row still passes through review before shipping.

Two families are worth knowing: `*.style.co.il` (`my`, `top`, `icard`,
`lifestyle`, `young`) are all Isracard club sites, and `yoter.co.il` serves both
`magiayoter` and `yoter`. Shared roots are expected, not a bug — but they mean
benefit ids will hash onto different programs from the same pages, so the
per-program `--program` flag is what keeps them apart.

### Guarded — login walls, Route C

| Program | Benefits | Source | Why |
|---|---:|---|---|
| בהצדעה `behatsdaa` | 102 | `behatsdaa.org.il` | SPA returns only its accessibility widget on every path, plus sign-in cues |
| חבר `hever` | 94 | `hvr.co.il` | login wall; stays manual, never automated |
| ביחד בשבילך `histadrut_for_you` | 90 | `hist.org.il` | 3 sign-in cues, 3 offer terms |
| מועדון B Kef `bezeq_employees_association` | 75 | `b-kef.co.il` | 6 sign-in cues, 2 offer terms |
| כללית פנאי `clalit_fun` | 13 | `clalitr.co.il` | 10 sign-in cues, 5 offer terms |

374 benefits sit behind these. They stay manual by design — never store
credentials to automate a members' area.

### Blocked — no route today

| Program | Benefits | Source | Why |
|---|---:|---|---|
| אשמורת `ashmoret_membership` | 99 | `itu.org.il` | 0 chars — shell or block |
| הוט `club_hot_discounts` | 94 | `hot.co.il` | HTTP 403 |
| קרן השוטרים `shotrim` | 70 | `kranot.org.il` | HTTP 403 |
| קרנות הטבות `amit_kranot_benefits_card` | 54 | `kranot.org.il` | HTTP 403 |
| PowerCard `power_card` | 12 | `powercard.co.il` | HTTP 403 |
| שופרסל LIFE `shufersal_life` | 1 | `shufersal.co.il` | maintenance image — **re-probe, likely temporary** |
| לאומי בונוס `leumi_goodies` | 1 | `bonus.leumi.co.il` | 0 chars |
| דיגיתל `digitel_discounts` | 1 | `tel-aviv.gov.il` | HTTP 472 |
| רמי לוי `rami_levy_club` | 0 | `hamoadon.rami-levy.co.il` | 0 chars |
| פיס פלוס `pais_members` | 0 | `paisplus.co.il` | HTTP 571 |
| מועדון שלך `yours_club` | 0 | `yours.co.il` | HTTP 571 |
| שלך לגמלאי `your_club_for_pensioner` | 0 | `yoursg.co.il` | 0 chars |
| Friends Clube `friends_clube` | 0 | `friends4students.co.il` | 0 chars |
| מועדון שחר `shachar_club` | 0 | `m-shachar.org.il` | 0 chars |
| הטבת גמלאי `discount_for_senior_citizens` | 0 | `yoursg.co.il` | HTTP 571 |

A 403 is the site declining, and the answer is not a tighter loop. Stealth mode
is worth **one** try per domain; past that these need an approach that is not
scraping. `shufersal_life` is the exception worth re-checking soon — a
maintenance page is not a block.

### Needs a URL, and thin

`living_members` (76), `campus_card_members` (69), `mizrahi_tefahot_members`
(29), `mastercard_day` (13) and `student_group` (13) have no confirmed official
site; naming them is a five-minute human job that unlocks 200 benefits.
`tau` (45), `uniq_club` (44), `mevalim_club` and `student_discounts` resolve but
their landing pages carry no offers — the catalog is probably one level in, so
they need a root that is not the homepage.

## The plan

### 1. Fix the config bug — done

`sources.json` now points isracard at `benefits.isracard.co.il`. Re-probe
shufersal before wiring it.

### 2. The collector — done, and it no longer needs a paid API

[`scripts/collect-catalog.mjs`](../scripts/collect-catalog.mjs) reads offer URLs
from `scripts/seeds/<program>.txt`, fetches each page over plain HTTP, and emits
the existing `CollectedRecord` shape. It stops at raw text.

```bash
npm run collect:catalog -- --program max --root https://www.max.co.il/benefits
npm run collect:catalog -- --all --top 12         # the largest open sources
```

**Only the navigation is client-rendered.** `max.co.il/benefits` is an Angular
shell with zero offer links in its HTML — but every offer page under it is
server-rendered and answers a plain GET with its `חשוב לדעת` block intact
(90KB, terms present). Rendering was never needed for the half that carries the
product; only for *finding* the URLs.

So the two halves are separated, and that is what makes this free:

| Half | Needs a browser | How often | Where it lives |
|---|---|---|---|
| discovery | yes | rarely — offer URLs rotate monthly | `scripts/seeds/<program>.txt` |
| collection | **no** | every refresh | plain `fetch`, the default transport |

`--transport firecrawl` still exists for sites that render their offer *pages*
too. Seeds for those were harvested from the one paid pass, so that discovery
does not have to be bought twice.

**Result: 73 of 73 max offer pages, all 73 carrying binding terms** — against
24 records / 21 terms from the paid run, at no cost. The seed list is simply
more complete than `/map` was, and a server-rendered page has no render race to
lose to.

The load-bearing part is the markdown→sections split, and it is not the obvious
one. **These catalogs style their section labels with CSS rather than heading
elements**, so `חשוב לדעת` — the binding terms — arrives as a bare paragraph,
not `## חשוב לדעת`. A parser that only understands ATX headings finds no terms
on any page (the first live run scored 0 of 5). `collected.ts` then promotes
that section to the top of the model prompt, ahead of marketing copy, so a
truncated prompt loses the copy and keeps the conditions.

`scripts/collect-firecrawl.test.mjs` guards exactly that, against a fixture
copied from a real page. It is in `npm run test:scripts`.

### 3. Collect the open sources — first pass run

The twelve largest were collected on 2026-08-29 (`--top 12 --limit 30`):
**79 records, 36 carrying a `חשוב לדעת` block, zero residual page chrome.**

Collected data lives in `collected/catalogs/`: **133 records, 88 carrying
binding terms**, of which max alone contributes 73/73 from the free transport.

| Source | Records | With terms | Verdict |
|---|---:|---:|---|
| `max` | **73** | **73** | plain fetch, complete |
| `adif_members` | 18 | **14** | needs a renderer — page text is 6 chars over HTTP |
| `max_kranot` | 1 | **1** | one dense page, terms present |
| `magiayoter` | 23 | 0 | real offers, no published terms |
| `calextra_discounts` | 6 | 0 | real offers, no published terms |
| `meshekard` | 2 | 0 | thin |
| `mystyle_discounts` | 1 | 0 | renders the site's terms-of-use page |
| `i_card` / `youngstyle` | 1 each | 0 | **byte-identical generic render** |
| `yahad` | 1 | 0 | 605 chars, no offers |
| `insurance_association_members` | 1 | 0 | overview page, offers not linked |
| `isracard_top_members` | — | — | refused: `/map` finds no offer URLs |

**Three sources deliver the actual product**: 43 records, 36 with real binding
terms — against 17 official-source records before this. That is the win, and it
is narrower than the 45-source roster suggested.

**Six do not, and re-running will not change it.** They are single-page SPA
shells: `/map` enumerates no offer URLs, and the shell serves a default render.
Two different clubs (`i_card`, `youngstyle`) returned byte-identical content,
which is the clearest possible signal that the page is not the club's catalog.
They are now `needs_offer_urls` in the inventory rather than `open` — the
status change is the finding, and the next step for them is per-offer URL
discovery (their own search/category endpoints, or a browser session), not more
scraping of the root.

חבר and the other four guarded clubs stay Route C.

### 4. Extract, and mean it

Unlike easy, these pages carry terms, so the model call buys something. Expect
a real share to clear 0.85 on its own merits — the first benefits in this
catalog that ship without a human waving through a low score.

Then the documented order, unchanged: approve the queue →
`add-easy-merchants --write` → re-extract so ids rehash → `publish:catalog`.

### 5. Freshness

Replace the monthly manual session with a Firecrawl `/monitor` per catalog root,
goal *new or changed offer terms*. It runs cloud-side, so unlike the easy.co.il
tasks it does not depend on this laptop being awake, and unlike the disabled
cloud routine it does not need Israeli domains allowlisted in a sandbox that
refuses the CONNECT tunnel.

## What this plan deliberately does not do

- **Point Firecrawl at easy.co.il.** Coverage is already 100%. Paying a proxy
  pool to re-solve a solved problem, while abandoning the slow-and-honest
  posture the crawler was built around, buys nothing. The easy data is not
  wrong — it is thin, and thin is fixed upstream.
- **Use Firecrawl's JSON extraction mode.** It would return structured benefits
  directly and skip our schema, our scoring and our review queue. That gate is
  the one thing standing between a guess and someone at a till.
- **Automate the five guarded clubs.** Login walls, your credentials, and club
  terms that may forbid it.
- **Retry the blocked fifteen.** One stealth attempt per domain, then stop. A
  403 is the site declining.
- **Retrofit the 2,733 low-confidence easy rows.** They are correctly scored.
  Some gain terms when the same merchant appears in a Tier-1 catalog; the rest
  are honestly thin and should stay labelled that way.

## Risks

- **Terms behind PDFs.** Firecrawl scrapes public document URLs, so it is
  tractable — but it is a second fetch per offer. Add it where a page proves to
  need it, not speculatively.
- **cal-online needs stealth to render.** Default scrape returns a 1,849-char
  shell; `waitFor: 6000` plus stealth returns 8,679. It is the one source
  sensitive to Firecrawl options, so it breaks first if they change.
- **The review queue will still grow.** Better sources raise the average score;
  they do not empty the queue. A Tier-1 row at 0.7 is a page that half-rendered
  — a real signal — rather than an aggregator that never had terms.
- **Mis-attributed roots.** See the caveat above. Review catches it; the cost of
  missing it is wasted pages, not wrong data shipped.
- **Being a good citizen.** ~225 pages a month across four large commercial
  sites is unremarkable, unlike the 4,787-link easy sweep. The existing rules
  carry over: never tighten the loop on a refusal, never touch a CAPTCHA.

## Refreshing seeds without a paid API

`scripts/seeds/<program>.txt` is a plain list of offer URLs, one per line,
`#` for comments. It only needs refreshing when a catalog rotates.

For a client-rendered catalog, open its root in a browser and read the links
out of the rendered DOM:

```js
[...document.querySelectorAll('a[href*="/benefits/"]')]
  .map(a => new URL(a.getAttribute('href'), location.origin))
  .map(u => u.origin + u.pathname.replace(/\/$/, ''))
  .filter(u => u.split('/').length === 6)   // host/benefits/<category>/<slug>
  .filter((u, i, all) => all.indexOf(u) === i)
  .join('\n')
```

That is how the 73 max URLs were collected — more than `/map` ever returned.
Paste the output under the header comment and re-run the collector.

## Which sources plain HTTP can and cannot reach

Measured by fetching one known offer page per source:

| Source | Text over plain HTTP | Verdict |
|---|---:|---|
| `max`, `max_kranot` | 1,627 / 502 chars **with terms** | plain fetch ✅ |
| `mystyle_discounts` | 21,213 chars | fetchable |
| `calextra_discounts` | 9,384 chars | fetchable |
| `insurance_association_members` | 4,917 chars | fetchable |
| `yahad` | 2,853 chars | fetchable (beats the paid run's 605) |
| `i_card`, `youngstyle` | ~1,000 chars | fetchable, thin |
| `adif_members` | **6 chars** | renderer required |
| `meshekard` | **6 chars** | renderer required |
| `magiayoter` | **HTTP 403** | blocks plain fetch |

`magiayoter` refusing a Node `fetch` while answering a browser is the same
fingerprinting `scrape-easy.mjs` already works around by shelling out to curl —
that is the cheapest next step if it is worth reclaiming.
