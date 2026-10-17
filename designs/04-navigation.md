# 04 — Navigation & app shell

Routes are unchanged (`/feeds/*`, `/messages`, `/settings`, …). Only the chrome that links to them changes. Replaces `Header`, `NavSidebar` (both modes), and the sidebar-reopen FAB in `AppContent` (`src/App.tsx`).

## Phone (< 600)
```
┌──────────────────────────────┐
│ ◉ Polls            🔍  🔔  ✉ │  Top bar 52dp: avatar(opens drawer) · screen title · search · bell · DMs
├──────────────────────────────┤
│ (Global)(Following)(WoT)  →  │  Sub-feed pills, horizontally scrollable, sticky
├──────────────────────────────┤
│                              │
│        feed content          │  full-bleed, hairline dividers
│                              │
│                         ( + )│  Create FAB, 16dp above bottom nav, secondary color
├──────────────────────────────┤
│ 🏠    🗳     📝    🧭     🔖 │  Bottom nav 56dp + safe-area inset
│Home  Polls  Notes Explore Saved
└──────────────────────────────┘
```
- **Bottom nav (5):** Home · Polls · Notes · Explore · Saved. Active item = primary-tint pill behind icon + primary label; inactive = `text.secondary`. Labels always visible.
- **Explore** is a hub screen (see `screens/explore.md`) with a grid of the remaining feeds: Topics, Articles, Music, Movies, Packs, Games. Tapping routes to the existing `/feeds/<x>`. While inside any of them, the Explore tab stays highlighted and the top bar shows a back arrow + that feed's name.
- **Saved** = `/feeds/bookmarks`; Drafts and Private notes reachable from its overflow menu.
- **Top-bar avatar** opens the account drawer (replaces `UserMenu`): accounts switcher, Profile, Contacts, Drafts, Settings, Log out, plus the logo/wordmark at top. Logo (`PolleramaLogo`) lives in the drawer header and on empty states; tapping the screen title scrolls to top.
- **Hide on scroll:** top bar and bottom nav translate out on scroll down, return on scroll up (existing `useImmersiveScroll`). Sub-feed pills stay pinned.
- **Sub-feed pills** are generated from the existing `MOBILE_SUB_ITEMS` / `SubNavContext` data; persisted in the same localStorage keys (`FEED_STORAGE_KEYS`) so behavior is identical. Remove the rail popup menu.
- **Create FAB:** same `CreateFAB` actions (poll, note, article, …) as a speed-dial; hides while scrolling down, never overlaps MiniPlayer (see below). The draggable-corner behavior is dropped on phone for the FAB (position fixed bottom-right); `DraggableCorner` remains for the floating video player.
- **Mini-player:** docks directly above bottom nav, full width, 56dp; FAB shifts up by its height while a track plays.

## Tablet (600–899)
72dp icon rail on the left, same 5 destinations with labels under icons, Create button at the rail top, avatar at rail bottom. Top bar loses avatar/title duplication (title only). No bottom nav.

## Desktop (≥ 900)
```
┌────────┬───────────────────────────┬──────────┐
│ logo   │ Polls     [Global|Foll|WoT]│ 🔍 search│
│ Home   ├───────────────────────────┤ Who to   │
│ Polls  │                           │ follow   │
│ Notes  │      feed (640)           │ Trending │
│ Explore│                           │ topics   │
│ Saved  │                           │          │
│ Msgs   │                           │          │
│ Notifs │                           │          │
│ [Create]                           │          │
│ ◉ me   │                           │          │
└────────┴───────────────────────────┴──────────┘
```
- Sidebar 240dp, labeled, **all** feeds listed flat (Explore items expanded: Topics, Articles, Music, Movies, Packs, Games) since there's room. Messages and Notifications get rows with badges here.
- `Ctrl/⌘+K` opens search (keep existing `SearchModal`).
- Right column (≥ 1200): search field, `WhoToFollow` (exists), trending topics (from `TopicsFeed` data). Optional; sidebar+feed ships first.

## State to preserve
`pollerama:lastFeed`, per-feed sub-mode keys, `pollerama:sidebarOpen` (desktop only; collapses sidebar to rail), unread DM badge, notification bell badge, unseen-update banner (`UpdateBanner`, sits under top bar).
