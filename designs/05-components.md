# 05 — Component specs

All components consume theme tokens only (see `03-tokens.md`). File locations are current; keep them unless noted.

## Top bar (`Header/index.tsx`, rewrite)
52dp + status-bar inset. bg `background.default`, bottom hairline appears only after scrolling. Left: 32dp avatar → drawer. Title: `title` style, current feed name. Right: search, bell (`NotificationBell`), DMs with badge. Icons 24dp in 44dp targets. Badge uses `primary` bg.

## Bottom nav / rail / sidebar (`SidePane/index.tsx`, rewrite as `AppNav`)
One component, three presentations by breakpoint, fed by one `destinations` array (id, label, icon, route, match). Active indicator: pill, `alpha(primary,.12)`, 56×32 behind the icon (bottom nav) or full-row (sidebar). Badges for DMs/notifications on the destinations that own them.

## Sub-feed pills (new, wraps `SubNavContext`)
Horizontal scroll, 8dp gap, 36dp height, `pill` radius. Selected: filled `primary` bg + `primary.contrastText`; unselected: transparent + 1px `divider` border + `text.primary`. Snap-scroll the selected one into view.

## Post item — note (`Notes/`, `Feed/NotesFeed`)
```
[av 40] Display name · @nip05 ✓ · 3h            ⋯
        Body text (16/24), links in secondary color
        ┌ media (radius sm, max-h 360, tap → zoom) ┐
        ┌ quoted note / link preview (card, 1px divider, radius md) ┐
        💬 12   🔁 4   ♥ 31   ⚡ 2.1k      🔖  ↗
────────────────────────────────────────────────── (divider)
```
- Action row evenly spaced, 44dp targets, counts in `caption`, icons `text.secondary`; active state uses `primary` (like) / `secondary` (zap) / `success` (repost).
- "⋯" menu holds: translate, share, copy ID, view JSON, report, mute, broadcast, relay sources (all existing items from Common/*).
- Client chip (`ClientChip`) moves to the overflow menu to cut meta noise.
- Thread view keeps `note-depth-context` indentation, with a 2dp left connector line in `divider` color instead of nested boxes.

## Poll item (`PollResponse`, `PollResults`, `Feed/PollFeed`)
Same header/footer as a note. Question in `title`. Options as full-width pill rows, 48dp:
- Unvoted: 1px `divider` outline, label left.
- Voted/results: pill fills left→right with `alpha(primary,.18)` proportional to votes; winner fill `alpha(primary,.32)`; percent right, bold; user's choice gets a check icon.
- Footer: total votes · time left · "Results" link. Vote button only for multi-choice polls (`Submit`, filled pill, primary).
- Poll types and NIP behaviors unchanged.

## Composer (`EventCreator/`)
Full-screen sheet on phone. Top: ✕ · draft status ("Saved") · filled pill **Post** (disabled until valid). Segmented control: Note | Poll | (others existing). Audience chip (existing `AudienceMenu`) beneath text. Bottom toolbar above keyboard: media, emoji (`EmojiPickerButton`), mention, options (`OptionsCard` → sheet), enhancements. Preview toggles in-place (existing `NotePreview`/`PollPreview`). Drafts autosave unchanged.

## Profile (`Profile/`)
Banner 120dp (collapses on scroll), 72dp avatar overlapping banner, name `title-lg`, nip05 badge, bio `body`, stats row (Following/Followers), Follow pill + DM + zap icon buttons. Tabs (secondary indicator): Notes · Polls · Articles · Ratings.

## Messages (`Messages/`)
Conversation list: avatar, name, last message (1 line, `text.secondary`), time, unread dot in `primary`. Chat: bubbles radius 20 (tail corner 6); mine = `alpha(primary,.16)` bg + `text.primary`, theirs = `surface`. Input: pill field + send icon button.

## Music (`Music/`)
Cards un-boxed: 56dp art, title, artist, play. `MiniPlayer` dock above bottom nav: art, title, play/pause, next; swipe up → full player sheet with the scrubber (secondary slider). Playlist strip stays horizontal.

## Sheets, menus, dialogs
Menus → bottom sheets on phone (`radius lg` top, drag handle, 48dp rows with leading icons), popovers on desktop. Dialogs full-screen on phone if they contain forms.

## Buttons
Filled (primary), tonal (`alpha(primary,.12)` bg), outlined (divider border), text. All `pill`. Text/outlined colors come from `text.primary` in light mode and `primary.main` in dark — **fix** the current hard-coded black.

## Empty / error / loading
Loading: skeleton rows matching post layout (shimmer 1.2s; none under reduced-motion). Empty: logo mark 64dp, `title`, `body-sm` hint, one pill action. Error (`FeedError`): inline row with retry; never a full-screen blocker when cached content exists.

## Settings (`Settings/SettingsScreen.tsx`)
Grouped list with section headers, drill-in pages: **Appearance** (theme presets as swatch grid, custom colors, font, light/dark/system), **Network** (relays, relay health), **Notifications**, **Moderation**, **Media** (Blossom), **AI**, **General**, **About/Feedback**. Each row: icon, title, current value, chevron. Search at top.
