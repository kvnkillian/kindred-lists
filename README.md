# Kindred Lists

One link. No duplicates. No surprise spoiled.

Kindred Lists is a family wishlist app: one link, no account to view or
claim, secret reservations so no one buys the same gift twice, Secret Santa
with exclusions, child lists kept by a parent, and a budget per person.

Pillars: **Privacy · Ease · Accessibility.** No account, no ads, no
analytics, no tracking.

## This folder

Plain, self-contained web source. No build step, no npm, no backend of
our own — sync comes from Firebase (see below).

- `index.html` — the app shell and all screens
- `styles.css` — warm, family-first styling, large tap targets, high contrast
- `app.js` — lists, gifts, claims, Secret Santa, budgets, My giving (ES module)
- `firestore.rules` — Firestore security rules (publish once, see below)
- `README.md` — this file

Open `index.html` directly in a browser, or serve the folder:

```sh
python3 -m http.server 8000 --directory .
```

then open <http://localhost:8000/>.

## What it does

- **Lists per person**, including child lists kept by a parent
  (example data seeds itself on first load: Alex, Kevin, and Baby — edit
  or delete any of it).
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
- **Live sync** — reserve on one device and it shows as Taken on every
  other device within seconds. Works offline too (changes sync when
  you're back online).

## Sync — Firebase (project: kindred-lists)

The live site is static (GitHub Pages), so sync comes from Firebase:

- **Project:** `kindred-lists` (Spark plan — free, no card)
- **Auth:** Anonymous — the app signs in silently in the background.
  No account, no password, nothing to type. **Auto clean-up stays OFF:**
  it deletes anonymous accounts older than 30 days, which would orphan
  reservations whose claimer hasn't opened the app in a month.
- **Database:** Cloud Firestore, production mode, location `nam5`.
- **Web app:** "Kindred Lists Web" — its public client config is in
  `app.js` (`FIREBASE_CONFIG`). That config is public by design; security
  comes from the rules, not from hiding it.

### Publish the rules (required — do this before sharing the link)

Firebase console > Build > Firestore Database > Rules tab > paste the
whole of `firestore.rules` > Publish. **Do not leave the database in
test mode** — test mode lets anyone read and write everything, including
claimer names.

### How secret claims hold

- A claim lives in its own document (`families/{familyId}/claims/{itemId}`)
  with the claimer's name. Rules let **only the claimer** read that
  document — not the list owner, not other gifters.
- The item itself carries only `taken: true/false`, never a name. Owners
  see "Reserved — name hidden"; other gifters see "Taken".
- Claiming runs in a Firestore transaction: read the item, abort if it's
  already taken, then write the claim and flip `taken` atomically — so
  two gifters racing the same gift can't both win.

### Family links

One link per family. The family id comes from the URL:

```
https://kvnkillian.github.io/kindred-lists/?family=killian-christmas-2026
```

No `?family=` means the default family, `killian-christmas-2026`.
Anyone with the link can view lists and reserve — that is the point —
so share it only with family. A different `?family=` value is a
completely separate set of lists.

### If Firebase can't be reached

The app falls back to the original on-device mode (`localStorage`, key
`kindred-lists-v1`) and says so in the UI: "Stored on this device only."
Lists made in that mode do not sync. Reload once you're back online and
it reconnects.

## Privacy note

List data lives in Kevin's Firebase project (Google) — lists, gifts, and
reservations, plus the anonymous ids the app signs in with. No accounts,
no email addresses, no ads, no analytics, no tracking. The Firebase
client config in `app.js` identifies the project; it is not a secret and
cannot by itself read or change data — the rules decide that.

Known limits, stated plainly in the app and in `firestore.rules`:
only the browser that created a list can edit or delete it; the Secret
Santa draw is readable by anyone with the family link (tap-to-reveal is
a UI courtesy, not encryption).

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
