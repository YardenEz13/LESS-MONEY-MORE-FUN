# Handoff: Less Money More Fun (for a long cloud session)

Written 2026-11-07. Paste this file as the first message of the cloud session, or have the session read it from the repo.

## What the project is

Expo SDK 54 / React Native 0.81 mobile app, Hebrew and RTL. It shows which club and credit-card benefits a person already holds, which ones they can use right now, and reminds them near a shop. Monorepo: `packages/core` (rules engine), `packages/extraction` (catalog pipeline), `apps/mobile` (the app), `data/` (shipped catalog JSON), `scripts/` (collect, link check, publish).

Important quirk: `apps/mobile` is NOT a root workspace, so root `npm run typecheck` skips it. Type check the app with `cd apps/mobile && npx tsc --noEmit`. Root `npm test` runs core (119) and extraction (59) tests.

## Where the work stands

Branch `green-torch/phone-app-savings-c5a071` (worktree under `.claude/worktrees/discount-sites-scraping-plan-af0080`).

**Pushed to GitHub** (last pushed commit `04f6769`): the first punch-ticket redesign, dark indigo version.
- `5ea9ddd` home screen rebuilt as a roll of punch tickets
- `d182075` every screen unified on the ticket design language
- `04f6769` one colour source (`stock` and `ticket` in `theme.ts`) and a deep indigo ground

**Uncommitted in the working tree** (all type-checked, 178 tests pass, web-checked at 375px):
- Light theme: paper ground `#F6F1E7`, ink text, same stocks. Flat "overprint" depth under tickets and buttons (`deepOf`, `stockDeep` in `theme.ts`), 3px press drop.
- Home: status strip (ready / need a step / clubs), bottom bar with one big mint "שאל" and two small bone buttons, bigger title and figure.
- Detail: huge cropped figure, 3-cell stats strip, numbered gate markers, "מצב קופה" / "מימשתי" / "השתק" footer.
- New `apps/mobile/src/screens/TillScreen.tsx` ("till mode": full-bleed stock, giant figure, verdict strip, redeem button) and its `till` route in `App.tsx`.
- New `brand/logo/`: the logo kit (see below).

Nothing above is tested on a real phone. A GitHub "ios unsigned" run (run 42405823475) built the earlier dark version; the light version has not been built for iPhone yet.

## Design decisions to keep

- One design language across all screens: `Panel` (dark/paper ticket with a tear-line top), `ListRow`, display block heads, one mint `PrimaryButton`, one outlined `GhostButton`, round gate marks. Pieces live in `apps/mobile/src/components/ui.tsx`, `Kit.tsx`, `Ticket.tsx`, `Gates.tsx`.
- Ink on every stock. A verdict is always a word as well as a colour.
- Flat fills only. Depth is a hard offset band, never a blur.
- All colours come from `stock` and `ticket` in `theme.ts`. Change the look there, not per screen.
- A real design canvas with the full mockups and sources: https://claude.ai/artifact/CNCXmqS8aSvSKfr2XtQfS4 (private). References were read on Mobbin's free tier: Starbucks, Snackpass, Apple Wallet, plus CRED NeoPOP.

## What is deliberately NOT built

- **Manual punching.** The canvas has a working punch interaction (tap a hole, it punches, a stamp appears). In the app the open circle only shows the step. Punching needs saved state that survives a restart and expires (a punched voucher from yesterday must not count today). Design it first: storage key, expiry rule, how the engine in `packages/core` consumes it.
- Wallet-style overlapped ticket stack (would hide verdicts and conditions).
- Trade tab row on Home (mock only; needs real filtering).
- Hebrew wordmark / lockup for the logo.

## Known problems

1. **Stale catalog.** Offers whose `last_verified_at` is older than 45 days (21 for the public club) are blocked as `stale_data`. With a 6-club test wallet, big malls show 4 to 10 live offers; a person with few clubs can see 0. The refresh path: `npm run validate:easy` (link check, HEAD requests) then `node scripts/sync-easy-proof.mjs`, then `npm run validate:data` and tests. On 2026-11-07 easy.co.il answered 403 to everything after 20 requests, so nothing was verified. Do not fake dates and do not bypass the block. Scheduled tasks run the link check daily at 06:30 and a catalog refresh twice a week.
2. **Venue picker counts only live offers**, so a place can read 0 while the "לא עכשיו" fold holds offers. Planned fix: show "0 now, N not now".
3. **iPhone test is unproven**: scroll feel, status bar, big system text, location reminder, safe areas, native RTL.
4. Earlier data issues: some combo figures rest on a ₪250 sample basket; `₪0` figures and shelf-price rows exist.

## The logo (status: concept chosen, kit exported, not wired into the app)

Skill: `logo-design`, installed globally at `C:\Users\yarde\.claude\skills\logo-design` (from https://github.com/kaankiziltug/logo-design-skill, MIT; scripts scanned, no network calls). Kit in `brand/logo/`:
- Chosen concept B, "Smile": a ticket whose punched holes make a smile. Master: `brand/logo/lmmf-symbol.svg`. Alternatives A (one big hole) and C (torn ticket) in `brand/logo/concepts/`, sheet at `concepts/concepts.png`.
- Colours: marigold `#F5C83E` ticket on ink `#14101F` tile for the app icon; one-colour black, white and mono variants exported.
- Web set: `favicon.ico`, 16/32/48 PNG, `apple-touch-icon.png`, `icon-192/512`, `maskable-512`, `site.webmanifest`, `head-snippet.html`. Test sheet: `test-sheet.png`.
- Checked: audit 100/100, readable at 16px, one-colour works. Not done: trademark search, Hebrew wordmark, real-phone check.
- Next step to wire it in: replace `apps/mobile/assets/icon.png` (referenced at `app.json` line 75) with a 1024px render of `lmmf-app-icon.svg`, add an adaptive icon and splash, and use `lmmf-favicon.svg` for the web build.

## Suggested order for the long session

1. Commit the uncommitted work in two commits: light redesign + till mode; logo kit. Push the branch.
2. Wire the logo into `app.json` (icon, adaptive icon, splash, web favicon) and rebuild.
3. Design and build manual punching (saved state with expiry), then add the bobbing hint, ring pulse and stamp from the canvas.
4. Fix the venue picker count; add real trade filtering if still wanted.
5. Run the "ios unsigned" workflow on the branch, sign with Sideloadly, and test the light build on a real iPhone, including the location reminder.
6. Re-run the link check on a day easy allows it, then sync proof and ship the catalog.

## Rules of the owner (apply to the cloud session too)

- Prose: caveman style, short declaratives (an owner hook sets this); code, commands and commit messages written normally. Ponytail: the smallest change that actually solves it; reuse before writing.
- Commit or push only when asked. Never bypass bot protection. No AI key may ship in the app.
- Do not use Chrome tools or the built-in browser unless the owner asks; use Obscura first (`C:\Users\yarde\Desktop\obscura\obscura.exe`) and say so before falling back.
- The owner is practising English: if their message has mistakes, end the reply with one line `English: <fixed message> (<one-sentence tip>)`.
- Do not use `--project-dir` with `eas build` (not a real flag); the owner's iPhone route is the GitHub "ios unsigned" workflow plus Sideloadly, not EAS.

## Useful commands

```bash
cd apps/mobile && npx tsc --noEmit        # type check the app
npm test                                  # core + extraction tests
npm --prefix apps/mobile run web -- --port 8082   # web build (the .claude/launch.json entry is sbr-web)
gh workflow run "ios unsigned" --ref green-torch/phone-app-savings-c5a071
```
