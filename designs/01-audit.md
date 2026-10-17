# 01 — Audit of the current app (v1.18.0)

Stack: React 18 + MUI 6 + Capacitor (Android primary, web secondary). Theme built in `src/styles/theme.ts`, presets in `src/styles/themes.ts`, appearance state in `src/contexts/AppearanceContext.tsx`. Shell in `src/App.tsx` (`AppContent`).

## Current shell
- `Header` (static AppBar, white/black): centered logo; right: search, notifications bell, DMs (badge), user menu.
- `NavSidebar` (`SidePane/index.tsx`): on desktop a labeled sidebar; on mobile a **52px icon rail on the left**, icons pinned to bottom, collapsible via a draggable FAB.
- 10 top-level feeds: Home, Polls, Topics, Notes, Articles, Music, Movies, Packs, Bookmarks, Games.
- Per-feed sub-modes (Following / Network / Global / Web of Trust / Reacted / Zapped / Interests / My topics / Discover / Local …) live in `MOBILE_SUB_ITEMS` and are reached by tapping the rail icon (popup menu) or via `SubNavContext`.
- `CreateFAB` bottom-right; `MiniPlayer` + `FloatingVideoPlayer` float.
- Content: `FeedsLayout` max 800px, centered.

## Identity ("the feel" to preserve)
- Playful, warm, rounded: pill buttons (`borderRadius: 50px`), friendly display fonts (Shantell Sans default brand font, Fredoka/Comfortaa/Raleway options; System is first-run default).
- Eight color presets + custom, each with light/dark primary + secondary; dark mode is OLED `#000`.
- Primary = brand/nav emphasis, secondary = accents (links, tabs, switches, sliders, FAB, spinners).
- Feels like a social feed of polls first, other Nostr kinds second.

## Pain points
1. **Nav discoverability.** 10 icons in a 52px rail, no labels on mobile; sub-modes hidden behind a popup. Thumb reach is poor (left edge).
2. **Header is dead weight** on mobile: logo-only center, four icons, takes ~56px + safe area on every screen.
3. **Hierarchy is flat.** Feed type, sub-mode, and content all look equal; users can't tell which feed/sub-mode they're in.
4. **Multiple hard-coded colors** (`#000000` button text in light mode, white/black AppBar) bypass tokens, so presets only partly apply.
5. **Two nav systems** (rail vs. sidebar) with different interaction models.
6. **Floating things compete**: sidebar-reopen FAB, Create FAB, MiniPlayer, floating video all want the bottom corners.
7. Settings is long and mixes appearance, network, notifications, AI, Blossom, moderation (`Header/*Settings.tsx`).

## What already works — keep
- Pill buttons, rounded avatars, warm light bg, OLED dark.
- Preset system and runtime font switching.
- Edge-to-edge chrome + safe-area handling (v1.18.0).
- Un-boxed feed (no card chrome around each item).
- Virtualized lists (react-virtuoso), pull-to-refresh, cached first paint.
