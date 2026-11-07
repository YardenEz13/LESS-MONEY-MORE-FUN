# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

The owner first, then friends. Israelis who already hold credit cards, workplace clubs and retail clubs, and who forget those benefits at the moment of paying. Typical scene: standing in or near a shop with a phone, seconds before paying.

## Product Purpose

Shows which benefits a person already has, where they can use them, and what they must do first. It reminds them near a shop that has a usable benefit. Success means real money kept at a real till.

## Positioning

Zero login. It never asks for bank or card credentials: the person picks the clubs they hold, and matching runs on the phone. A benefit is shown with its conditions judged, so "you can use this now" differs from "you still have to do something" and from "the terms say no".

## Operating Context

Native Expo app in Hebrew, right to left, with a location reminder after a 3-minute stay, quiet hours 22:00 to 08:00 and a 12-hour cooldown per place. The catalog ships inside the app and updates over the air. A public website is planned to explain and show the app.

## Capabilities and Constraints

- Screens that must keep working: onboarding, home, benefit detail, share, settings, stats, advisor.
- Advisor stays off unless its server is deployed. No AI key may ship in the app.
- iPhone install uses a free Apple ID, so the signature lasts 7 days. Android installs from an APK.
- Automatic location reminders are not yet proven on a real phone.
- Catalog facts come from public sources and carry a verification date. Older rows are shown as older, never renewed by hand.

## Brand Commitments

- Name in repo: less-money-more-fun. Final public Hebrew name is undecided.
- Keep the Hebrew faces EFT OffSet and EFT Artzisraeli (`apps/mobile/assets`). Confirm their licence covers website use before they ship on the web.
- The football look is being replaced.

## Evidence on Hand

Real catalog in `data/benefits.json`, real clubs and merchants, and real app screens. There are no customers, testimonials, press, savings totals or store listings. Never invent any of them.

## Product Principles

1. Never promise a saving the terms do not support.
2. Show the answer before the reasoning.
3. Stay quiet unless the reminder is useful.
4. Nothing about the person leaves the phone without a clear reason.
5. Say how old a fact is.

## Accessibility & Inclusion

Hebrew right-to-left first. Readable outdoors at a till, one-handed. Meaning never relies on colour alone. Respect reduced motion and large text.
