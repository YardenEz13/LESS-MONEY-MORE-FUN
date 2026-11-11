# Prompt for Fable 5.2: better deal finding + "watch this item" alerts

Paste everything below the line as the first message of a fresh session on this repo.

---

You are working in the `less-money-more-fun` repo (Expo / React Native app, Hebrew and RTL, plus a TypeScript monorepo). Read `PRODUCT.md`, `HANDOFF.md`, `docs/ARCHITECTURE.md`, `docs/DATA_SOURCES.md` and `packages/core/src/{types,matching,geo,combos}.ts` before you design anything. Then do the two jobs below.

## Where the app is today

- The app tells a person which club, credit-card and retail-club benefits they already hold, and reminds them near a shop. Matching runs on the phone. Zero login. Nothing about the person leaves the device without a clear reason.
- The catalog (`data/benefits.json`, `merchants.json`, `venues.json`, `programs.json`) ships inside the app and updates over the air. Source tiers are in `docs/DATA_SOURCES.md`: official club catalogs (carry the conditions), easy.co.il (wide coverage of small local businesses, with coordinates, but almost no terms).
- Location today: geofences on about ten malls (`Venue`) plus per-shop fences built from `Merchant.branches` (`geo.ts`: `nearestFences`, `SHOP_FENCE_PREFIX`). A reminder fires after a 3-minute stay, with quiet hours 22:00 to 08:00 and a 12-hour cooldown per place.
- A `Benefit` is a *membership* offer ("10% for Max holders at merchant X"). The app has **no concept of a product, a price, or a sale on a specific item**. That gap is the heart of both jobs.
- Known weak spots: stale catalog (`stale_data` blocks after 45 days, 21 for the public club), many shops carry only a headline percent with null conditions, the venue picker hides offers that are "not now", and only malls and the shops already in the catalog can trigger a reminder.

## Job 1: a better algorithm for finding discounts

Goal: when a person stands in a big mall **or in front of a random street shop** (say a standalone Adidas store with no mall around it), the app surfaces the best offer they can actually use, with the conditions judged, and says how old each fact is.

Work through these, in this order. Propose before you build.

1. **Audit first.** Write a short report (in the scratchpad, not the repo) on what the current pipeline misses. Use the real data: how many merchants have branches, how many chains have an offer in the catalog but no branch coordinates, how many offers are `public` versus club-only, how many are blocked by freshness, how many have all-null conditions. Quote numbers you measured. Do not guess or round them up.
2. **Street shops.** Design how a shop that is not in a mall gets found and matched:
   - Chain-level offers should apply to every branch of the chain (a sitewide Adidas sale, a club deal valid "in all stores") without a human typing branch ids. Keep the distinction between "valid in all stores", "valid in listed stores only", and "online only" explicit in the data. Never let an online-only sale appear as a store offer.
   - Branch discovery from official store locators and public listings. Respect robots.txt and each site's terms. **Never bypass bot protection** (the owner's standing rule). If a source blocks us, record it in `docs/DATA_SOURCES.md` and move on.
   - Geofence budget: iOS allows about 20 regions per app. Design a rolling window (significant-location-change or a coarse refresh, then register only the nearest relevant fences, favouring shops where this person holds a usable benefit). Prove with tests that the selection is stable and does not thrash.
   - A shop with no known offer must stay silent. Principle 3: stay quiet unless the reminder is useful.
3. **Ranking.** Replace "highest headline percent wins" with expected net saving: value, times whether the person holds the program, times whether the conditions pass now (days, hours, min spend, voucher, exclusions), minus effort (a voucher to fetch first), discounted by freshness and by extraction confidence. Reuse `evaluateBenefit`, `estimateSaving`, `rankBenefits`, `findCombos`. Extend them, do not rewrite them. Keep the answer-first display: verdict word before reasoning.
4. **Real-discount check.** A "50% off" on a price that was raised last week is not a saving. Where we have a price history for an item (see Job 2), compare the sale price with the item's own recent history and label the offer honestly ("lowest in 90 days", "same as last month", "no history yet"). With no history, say so. Never claim a saving the data does not support.
5. **Dedupe and conflict.** The same offer arrives from several sources (official catalog, easy, mall sale). Merge by `offerKey`, keep the strongest source for conditions, keep every source URL, and surface a disagreement ("source A says 10%, source B says 15%") instead of silently picking one.
6. **Evaluation harness.** Build a small fixture set of realistic situations (big mall with six clubs held, street Adidas with one club, a shop with a stale offer, a shop with only an online coupon) and assert the expected top result and expected silence. Every ranking change must be justified by a fixture, not by a feeling.

## Job 2: tell the app what I want to buy, get alerted on a discount

Feature: the person adds an item they want ("Adidas Samba OG, black, size 42", or "a white shirt from Zara"), and the app notifies them when it goes on sale, at a shop near them or online.

Design questions you must answer in a short design note **before writing code**, recommending one option for each:

1. **How does a person add an item?** Reuse the existing share-sheet path (`shareIntent.ts`, `url.ts`, `docs/SHARE_EXTENSION.md`): share a product page URL and the app resolves merchant, name, current price. Also allow free text with merchant and size. Keep it two taps.
2. **Where do prices come from?** Be concrete. Options to weigh: (a) a server-side crawler that publishes a static, public price feed the device matches locally, (b) the device fetching the product page itself in a background task, (c) official affiliate or retailer feeds where they exist. State what each can and cannot reach, what it costs, and how it behaves when a site blocks us. Prefer public feeds and official APIs. No bot-protection bypass.
3. **How does it stay inside the privacy principle?** "Nothing about the person leaves the phone without a clear reason." A watchlist is personal. The preferred shape is: the watchlist stays on the device, the server publishes a feed of public prices for products that *anyone* watches, and the phone matches locally. If tracking an arbitrary item needs the server to know the item, then the only thing sent is the product URL or key plus a push token, behind an explicit opt-in screen that says exactly that in Hebrew, with a one-tap delete. Flag this tradeoff for the owner in plain words. Do not quietly weaken the principle.
4. **What counts as a discount worth a ping?** Define it: price dropped by at least X% or Y shekels versus the item's own tracked baseline (not versus a crossed-out "was" price on the page), the size and colour in the watch is in stock, and combined with any club benefit the person holds (reuse the engine: "₪40 off, plus your Max card brings it to ₪..."). One notification per drop, a cooldown, quiet hours 22:00 to 08:00 as today, and a hard cap per day so the feature never becomes noise.
5. **Local plus online.** If the item is on sale at a branch within walking distance, say which branch and how far. If only online, say online. Use `Merchant.branches` and `nearestBranch`. Stock per branch is usually unknown: say "may be in stock" or "stock unknown", never "in stock" without evidence.
6. **State and expiry.** Persist the watchlist on the device (see `state/profile.ts`), survive a restart, let the person pause, edit size or colour, set a target price, and remove an item. Expire watches after a period and ask once before dropping them. Store price observations with timestamp and source so the history in Job 1 step 4 can use them.

Then build it: a `WatchItem` and `PricePoint` schema in `packages/core` (zod, strict, same style as `Benefit`), the matching logic in core with tests, the feed or fetch path, the notification path in `apps/mobile/src/services/notifications.ts`, and a screen in the existing punch-ticket design language (`Panel`, `ListRow`, one mint `PrimaryButton`, Hebrew RTL, readable one-handed at a till, verdict as a word as well as a colour). Add an empty state, an "alert sent" state and an error state. All three must work on a small screen with large system text.

## Non-negotiable rules

- Never promise a saving the terms do not support. Say how old every fact is. Older rows are shown as older, never renewed by hand. Do not fake `last_verified_at`.
- No AI key may ship in the app. Any model call goes through a server (see `api/advisor.ts`).
- No invented customers, testimonials, savings totals or store listings. Use only measured numbers.
- Never bypass bot protection. Never scrape a site that forbids it. Record blocked sources instead.
- Hebrew RTL first. Accessibility rules in `PRODUCT.md` apply.
- `apps/mobile` is **not** a root workspace. Type check it with `cd apps/mobile && npx tsc --noEmit`. Root `npm test`, `npm run typecheck` and `npm run validate:data` must also pass. Report any failure with its real output.
- Smallest change that actually solves it. Reuse before writing. No speculative abstractions.
- Location reminders and push notifications are not proven on a real phone. Say so in your final report. Do not claim they work.

## How to work

1. Read the files above. Write the audit (Job 1 step 1) and the design note (Job 2 questions) first, and stop to show me both, with your recommended choice for each open question and the one decision only I can make (the privacy tradeoff in Job 2 question 3).
2. After I answer, build in small commits on the branch you are given: schema, core logic with tests, data and feed, app wiring, screen. Commit when a slice is green, not before.
3. For each slice, show the failing test first, then the passing run. For UI, run the web build at 375px width and look at it before you say it works.
4. End with a report: what changed, what you measured, what is proven, what is not (real-phone location, real push delivery), and what I should decide next.
