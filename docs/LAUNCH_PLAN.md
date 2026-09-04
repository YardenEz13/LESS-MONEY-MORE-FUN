# Two weeks to real users

## First: not a PWA

The question was whether a PWA would be the simpler way onto both phones. It
would be — for a different app. **No browser implements geofencing.** The W3C
Geofencing API was abandoned; Chrome never shipped it and WebKit opposed it. The
web Geolocation API only runs while the page is in the foreground, and iOS
suspends JavaScript in a backgrounded web app within seconds.

So a PWA can do the share-a-URL half and cannot do the walk-into-a-mall half at
all. That half is the product — it is `שלב 3` of the PRD and the reason the app
exists rather than being a spreadsheet. A PWA rewrite would be two weeks spent
deleting the feature this plan is trying to validate.

Expo already builds one codebase to both stores, already has background
geofencing working through `expo-location` + `expo-task-manager`, and is already
linked to an EAS project. **Nothing gets rewritten.** The work below is
distribution and evidence, not architecture.

The one real cost of staying native: no instant install from a link. That is
what TestFlight and Play closed testing replace, and it is a two-day cost paid
once, not a missing feature.

---

## What is actually blocking users today

Five things, in the order they will hurt:

1. **The catalog is a Gush Dan catalog.** 84% of branches sit in one metro area;
   Jerusalem had 18 businesses before the regional sweeps. A tester in Haifa
   installs, grants location, and correctly sees nothing.
2. **Nothing works in Expo Go.** `canGeofenceInBackground` is false there —
   Android has no background location in Expo Go at all. Every tester needs a
   real build, which means store distribution, which means review latency.
3. **You cannot see anyone's KPIs.** `events.ts` never leaves the device by
   design. The stats screen was built for an audience of one. With 30 testers
   you have no idea whether the notification fired, was opened, or was ignored.
4. **The 45-day staleness cliff.** Every benefit blocks past
   `staleDays`, and the catalog ships inside the JS bundle. A build that stops
   getting `ship:catalog` goes from 206 relevant benefits to 0 on every phone at
   once, about six weeks later.
5. **iOS has no Share Extension.** It needs a native target that does not exist
   yet. Android's intent filter works today.

---

## The shape of the fortnight

One person, so the long-latency items start early and run while you do
something else. Two things have external clocks you do not control — Apple's
Beta App Review and the `--cities` crawl — and both are started on day 1.

### Days 1–2 · Prove the core feature on real hardware

**Day 1 (morning).** Kick off the country crawl before anything else; it runs
about nine hours and will get your IP blocked partway through.

```bash
npm run scrape:easy -- --cities
```

Have `EASY_PROXY` ready — a phone hotspot is enough. The crawl stops itself
after three consecutive list failures rather than grinding, so check on it.

**Day 1 (afternoon).** A development build on your own iPhone and your own
Android. This is the first honest test of anything.

```bash
cd apps/mobile && npx eas build --profile development --platform all
```

**Day 2. Walk into a mall.** Not a simulator, not the debug button — physically
walk in, with the app killed, and see whether the push arrives. This is the
single highest-information hour of the whole two weeks, and everything after it
assumes it passed. Budget for it failing.

The three things most likely to be wrong: the ten mall coordinates are
hand-entered and unverified, the 3-minute dwell threshold may be too long for a
shop you walk straight through, and iOS caps monitoring at 20 regions silently.
Check `dwellMinutes` and the fence origin after the walk.

**Gate: if the geofence does not fire reliably by end of day 2, stop and fix
it.** Everything downstream is distribution for a feature that has to work.

### Days 3–4 · Close the gaps the walk exposed, then submit

**Day 3.** Fix what day 2 found. Deploy the advisor proxy so no build ever again
ships a Gemini key:

```bash
vercel deploy --prod          # with GEMINI_API_KEY in the environment
# then set EXPO_PUBLIC_ADVISOR_URL and rebuild
```

Publish the catalog the crawl produced, and check the coverage moved:

```bash
npm run publish:catalog -- --dry-run
npm run publish:catalog && npm run validate:data
npm run coverage:report
```

**Day 4 — the critical path starts here.** Submit to both beta channels. Do this
on day 4 rather than day 8, because Apple can reject and a rejection costs a
whole cycle.

- **iOS → TestFlight external testing.** Requires Beta App Review, typically
  1–2 days, and gives you a public invite link. Internal-only testing skips
  review entirely but caps at 100 App Store Connect users you have to add one by
  one — worth it only if the external review bounces.
- **Android → Play closed testing track.** Publishes in hours, not days.

Two policy realities to plan around rather than discover:

- Apple rejects background-location apps whose need for `Always` is not obvious
  from using them. Your justification is genuinely strong — write it out
  properly in the review notes, and say plainly that the app is useless without
  it.
- If your Play developer account is a personal one opened after Nov 2023, Google
  requires a closed test with **at least 12 testers running for 14 continuous
  days** before you may apply for production. That is this entire fortnight. If
  a public Play listing is the goal, the closed track has to open on day 4 at the
  latest — this is the single scheduling constraint most likely to cost you a
  month.

### Days 5–6 · Make the app survivable by someone who is not you

Review is pending; use the time on the things that make a stranger's first run
work.

- **Earn the `Always` grant.** It is the highest-friction permission on both
  platforms and realistic grant rates are well under half. The screen before the
  prompt has to say what the app will do with it, in one sentence, before the OS
  dialog appears. A denied grant is not fatal — `currentVenue()` still answers
  "what is near me" on foreground permission alone — but it silently turns the
  product into a lookup app, so the settings screen must say which mode the user
  is in.
- **Get the KPIs off the device.** The cheapest thing that works, and the only
  one consistent with the zero-auth promise: a "שלח לי את הסטטיסטיקות" button on
  the stats screen that opens the OS share sheet with the event JSON. No backend,
  no analytics SDK, no identity, and the user sees exactly what they are sending.
  Without this, day 14 has no data in it.
- **Decide iOS share now:** ship iOS geofence-only and keep the Share Extension
  Android-only for this round. Building a native iOS target inside the same two
  weeks that you are validating geofencing splits your attention across two
  unproven things.

### Days 7–9 · First ten users

**Recruit in Gush Dan first**, regardless of how the crawl went. The catalog is
strongest there, and the first ten testers should be evaluating the *idea*, not
your collection coverage. Haifa and Jerusalem testers come in the second wave,
once `coverage:report` says their cities are real.

Ten people, recruited personally, each of whom you can phone. Ask every one of
them the same two questions at the end of day 9:

1. Did a notification arrive somewhere you actually were?
2. Did you ever get to a till and find the condition was wrong?

Question 2 is KPI #2 and it is the one that kills the product if it goes wrong.
A single "I was embarrassed at the checkout" is worth more signal than fifty
installs.

**Day 9 also: close the proxy.** `api/advisor.ts` is an open endpoint with a key
behind it. Fine for ten people you know, not fine for a public link. Add a
device token or App Attest before the tester count grows.

### Days 10–12 · Second wave and the freshness discipline

- Widen to 25–40 testers. Include the cities the crawl added.
- **Ship the catalog at least once mid-test.** Not optional: `last_verified_at`
  ages whether or not anyone runs the pipeline, and testers who installed on day
  7 are watching a clock.

```bash
npm run ship:catalog     # validate:data, then eas update --branch production
```

Remember `runtimeVersion` is `appVersion` — bumping `version` in `app.json` cuts
existing installs off from updates. Bump it for native changes only, never for a
catalog refresh.

- Work the wrong-benefit reports daily. Every report is either a data bug you
  fix or a condition the extraction is misreading, and both are cheaper to fix
  at 40 users than at 400.

### Days 13–14 · Decide with numbers, not vibes

Collect the exported stats and compute the PRD's three metrics:

| Metric | Bar | Where it comes from |
|---|---|---|
| Ratio of Decision Impact | ≥ 30% | `computeKpis().decisionImpactRatio` |
| False positives on conditions | 0 | tester interviews + wrong-benefit reports |
| Week-1 retention | > 40% | testers still opening the app 7 days after install |

Then answer one question honestly: **did anyone save money they would otherwise
have missed?** That is `שלב 4` of the PRD and it is not a ratio — it is a story a
tester can tell you. If nobody has one after two weeks, the notification is
firing and nobody cares, and the next fortnight is about relevance rather than
distribution.

---

## What this plan deliberately does not do

- **No public store launch.** Two weeks gets you a beta with real users on real
  phones, which is what the validation step needs. A production listing with an
  unvalidated geofence is a rejection risk and a reputation risk for no gain.
- **No analytics SDK.** The privacy stance is the product's differentiator; a
  share-sheet export gets you the same numbers for 20 lines of code.
- **No auth, no accounts, no backend beyond the advisor proxy.** Zero-auth is
  the pitch. Do not spend the fortnight building the thing you promised not to.
- **No iOS Share Extension.** Deferred on purpose — see day 6.

## Costs

Apple Developer Program is $99/year and is required for TestFlight at all.
Google Play is a one-time $25. Gemini Flash for 40 testers asking a handful of
questions a day is small change, but the proxy is what stops it being someone
else's small change.
