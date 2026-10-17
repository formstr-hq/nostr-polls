# Screens — summary wireframes

## Thread / note detail (`note/:eventId`)
Back arrow top bar titled "Post". Root note large (body 18/28), full timestamp + client, stats row (Likes · Reposts · Zaps, each tappable → `ProfileListDialog`), action row, then replies with connector lines. Sticky reply field above bottom nav: avatar + pill "Write a reply…".

## Poll response / results (`respond/:eventId`, `result/:eventId`)
Poll item at full width; below, tabs (Results · Voters · Comments). Results bars per Poll item spec. Voters list = avatar rows with chosen option chip.

## Profile (`profile/:npub`)
See component spec. Own profile adds "Edit profile" outlined pill; others show Follow, DM, Zap.

## Notifications
Grouped by Today / Earlier. Row: type icon badge on avatar (♥ ⚡ 🔁 💬 @), one-line summary, timestamp, preview of target in `text.secondary`. Unread rows have `alpha(primary,.06)` bg.

## Messages
List → chat as in components. New conversation: full-screen search (`ContactSearchDialog`) with recent contacts.

## Settings
Grouped drill-in list (see components). Appearance page: live preview card at top (a mini post + poll rendered with the selected preset), swatch grid of the 8 presets + "Custom" tile, font list rendered in each font, mode segmented control (Light / Dark / System).

## Games
2×2 tile grid with best score; game screens full-bleed, bottom nav hidden, close ✕ top-left; leaderboard as bottom sheet.

## Movies / Music
Movies: poster grid 3-col phone, rating overlay; detail: backdrop, rate (stars), reviews. Music: see components; Local tab lists on-device tracks with download state.

## Login / onboarding
Centered logo + display tagline, stacked pill buttons: Sign in with extension / Android signer / QR (NIP-46) / nsec / Create account. Secondary text link: "Browse without account".
