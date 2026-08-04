# Collecting חבר and Max benefits with Claude Cowork

The fetch pipeline cannot reach these two, and the reasons are different:

| Source | Why the scraper fails | What a browser fixes |
|---|---|---|
| `max.co.il/benefits` | Angular SPA — 425KB of HTML, 502 chars of text, no JSON-LD, no embedded state | Chrome runs the JS, so the offers exist in the DOM |
| `hvr.co.il` | Login wall — the public page is an ID/password form, no offers behind it | Reads the pages **you** are already logged into |

Both need **Claude in Chrome** enabled in Cowork.

## Before you start

**Log into חבר yourself, in your own Chrome, first.** The prompt below never
asks Claude for credentials and you should never give them — it reads a session
you already opened. If you are not logged in, it will report that and stop
rather than guess at benefits.

Check the club's terms if you plan to run this repeatedly; reading your own
member benefits by hand is one thing, a recurring automated crawl is another.

## The prompt

Paste this into Cowork. Replace the bracketed line for the source you want.

---

Use Claude in Chrome for this task.

**Start from:** `https://www.max.co.il/benefits`
*(for the other source: `https://www.hvr.co.il/` — I am already logged in; if you
land on a login form, stop and tell me instead of continuing)*

You are reading a benefits catalog for an Israeli discount-recall app. I need
every offer on the page, with its **conditions** — the conditions are the
product, not the headline percentage.

**Walk the catalog properly.** Wait for the page to finish rendering before
reading. Expand every "read more"/"תנאים"/"לפרטים" control, open each offer's
detail view if the terms live there, and page through pagination or infinite
scroll until no new offers appear. Tell me how many pages/scrolls you covered.

**For each offer, return exactly these fields:**

- `merchant_name` — the business name exactly as written on the page
- `type` — one of `percent`, `fixed`, `bogo`, `cashback`, `gift_card`
- `value` — percent number for `percent`/`cashback`; shekel amount for
  `fixed`/`gift_card`; `0` for `bogo`
- `valid_from`, `valid_until` — ISO 8601, or `null` if the page does not say
- `confidence_score` — 0 to 1, how sure you are this was read correctly
- `confidence_reason` — one short sentence: what was clear, what was not
- `conditions` — an object with **all** of these keys, `null` where the page is
  silent:
  - `min_spend` — minimum purchase in shekels
  - `max_discount` — discount ceiling in shekels
  - `valid_days` — array, 1=Sunday … 7=Saturday
  - `valid_hours` — `{ "from": "HH:MM", "to": "HH:MM" }`
  - `channel` — `in_store`, `online`, or `both`
  - `stacks_with_club` — boolean
  - `exclusions` — array of excluded categories/products
  - `usage_limit` — e.g. `"פעם אחת בחודש"`
  - `requires_voucher` — boolean, does a code/voucher have to be issued first
  - `raw_text_summary` — **required**, never null: the terms in Hebrew, as close
    to the page's own wording as you can

**The rules that matter most:**

1. **Never infer a condition that is not written.** If the page does not mention
   a minimum spend, `min_spend` is `null` — not `0`. If it says nothing about
   stacking, `stacks_with_club` is `null` — not `true`. "Not stated" and "no
   limit" are different facts and I need to keep them different.
2. **Keep Hebrew as Hebrew.** Do not translate merchant names or terms.
3. **Score honestly.** If a discount is legible but its terms are behind a PDF
   you could not open, say so in `confidence_reason` and score it low — anything
   under 0.85 is routed to human review instead of to users, which is the
   correct outcome for a guess.
4. **Do not fill gaps from memory.** If you know this chain usually runs 10%,
   that is irrelevant — only what is on the page counts.

**Return one JSON object, nothing else:**

```json
{
  "page_summary": "משפט אחד בעברית שמתאר מה נמצא בעמוד",
  "benefits": [ { "merchant_name": "...", "type": "percent", "value": 10, "...": "..." } ]
}
```

If the page yields no readable offers, return `"benefits": []` and say why in
`page_summary`. An empty array is a useful result; an invented one is not.

---

## Importing the result

Save the JSON, then run it through the **same confidence gate** as the automated
pipeline — nothing here bypasses review:

```bash
npm run extract -- --import collected/max.json --program max --source-url https://www.max.co.il/benefits
```

For חבר, use `--program hever --source-url https://www.hvr.co.il/`.

Anything scoring below the threshold lands in `data/generated/review-queue.json`
and stays out of the app until approved:

```bash
npm run -w @sbr/extraction review
```

Benefit ids are derived from program + merchant + type + value, so re-importing
an updated run **updates** those rows rather than duplicating them.

## Making it repeatable

Cowork can save a working chat as a skill, and `/schedule` can re-run it. Worth
doing for Max, whose catalog rotates. Re-check the output after a site redesign —
a browser agent fails differently from a fetch: it returns confident, well-formed
JSON about the wrong part of the page, which the confidence gate cannot catch.
