# data/

| File | What it is | Source of truth |
|---|---|---|
| `programs.json` | Clubs/cards a user can declare during onboarding | Hand-maintained |
| `merchants.json` | Merchant identity + domains (Share Extension) + mall presence | Hand-maintained |
| `venues.json` | Geofenced shopping complexes | Hand-maintained |
| `benefits.sample.json` | **Synthetic fixtures for development only** | Not real |
| `generated/benefits.json` | Pipeline output (git-ignored) | `npm run extract` |
| `generated/review-queue.json` | Low-confidence extractions awaiting a human | `npm run extract` |

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
