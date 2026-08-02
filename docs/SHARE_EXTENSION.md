# Share Extension

## What works today

The resolver, the UI, and the logging are done and exercised by tests:

- `resolveMerchantFromShare` pulls a URL out of arbitrary shared text, matches
  it against `data/merchants.json` (subdomains match; the most specific domain
  wins; lookalikes like `notksp.co.il` do not match).
- `resolveShare` ranks the user's benefits for that merchant with
  `channel: 'online'` pinned.
- `ShareResultScreen` renders the three outcomes: a match, a known merchant with
  no applicable benefit, and an unknown site.

## Android — works with the config in `app.json`

`app.json` registers a `SEND` / `text/plain` intent filter, so the app appears
in the system share sheet from Chrome. The shared text arrives through
`Linking`, which `subscribeToShares` already handles both cold-start and
warm-start.

Test it by sharing a KSP or Terminal X product page from Chrome.

## iOS — needs a native target

iOS Share Extensions are a separate app extension target; Expo cannot add one
from `app.json` alone. Two ways forward:

**1. Shortcut first (zero native code).** Create a Shortcut with a "Receive
URLs from Share Sheet" input that opens `sbr://share?url=[Input]`. It appears
in the share sheet, it exercises the exact same resolver, and it is enough for
the 30-day validation run. This is what the scheme in `app.json` is for.

**2. Real extension (config plugin).** Add a share-extension config plugin,
create the `ShareViewController` target, and write the shared URL to an App
Group container that the main app reads on launch. Budget a day, and don't
spend it before the Shortcut has shown the flow is worth keeping.

## When a share doesn't resolve

The most common cause is a merchant missing from `data/merchants.json`, not a
bug in the resolver. The stats screen counts `share_unmatched` for exactly this
reason — a rising count is a list of domains to add, and it is the cheapest
improvement available to this app.
