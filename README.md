# Kindred Lists

One link. No duplicates. No surprise spoiled.

Kindred Lists is a family wishlist app: one link, no account to view or
claim, secret reservations so no one buys the same gift twice, Secret Santa
with exclusions, child lists kept by a parent, and a budget per person.

Pillars: **Privacy · Ease · Accessibility.** No account, no ads, no
analytics, no tracking.

## This folder — static version

Plain, self-contained web source. No build step, no backend, no dependencies.

- `index.html` — the app shell and all screens
- `styles.css` — warm, family-first styling, large tap targets, high contrast
- `app.js` — lists, gifts, claims, Secret Santa, budgets, My giving
- `README.md` — this file

Open `index.html` directly in a browser, or serve the folder:

```sh
python3 -m http.server 8000 --directory .
```

then open <http://localhost:8000/>.

## What it does

- **Lists per person**, including child lists kept by a parent
  (example data ships with Alex, Kevin, and Baby — edit or delete any of it).
- **Add a gift from any store** — link, price, size/details, how-much-wanted,
  and family-only visibility (hide a gift from co-workers / others).
- **Owner view vs Family & gifters view** — owners add/edit and never see
  who claimed what; gifters reserve under their name and see what's taken.
- **Secret Santa draw** — keep-apart exclusions, no self-draws, no repeat
  of last year's pair, tap-to-reveal private matches.
- **Budget per person** — a live bar that fills as gifts are claimed,
  and flags when a list goes over budget.
- **My giving** — everything you've reserved across lists, with
  reserved / bought totals, mark-as-bought, and release.
- **Reset demo data** — restores the example Alex / Kevin / Baby lists.

## Storage — read this first

This static version stores data in the browser only (`localStorage`, key
`kindred-lists-v1`). Lists survive closing the tab **on that device**, and
do **not** sync across devices yet. The in-app notice says this plainly.

Sync is a later step (CloudKit / backend). GitHub Pages, where this folder
can be hosted as a static site, is static-only — it cannot sync claims
between family members by itself.

## Design rules followed

- Large tap targets (48–52 px minimum), whole-box actionable list rows.
- One back button, and it goes back one screen.
- VoiceOver labels on lists, items, budget progress, and Secret Santa reveals.
- Dynamic Type friendly (relative sizing, no fixed tiny text) and high contrast,
  with a dark-mode palette.
- Options only where they earn their complexity — no cards, invites, AI
  finder, or discovery feed.

## Name

**Kindred Lists.** Plain "Kindred" is taken on the App Store (Kindred Home
Swapping, Kindred Content App, Kindred: Family Care Circle, Kindred Beat,
and others). A web search for the exact name "Kindred Lists" found no app
with that name — promising, but only an App Store Connect claim proves
availability for iOS.
