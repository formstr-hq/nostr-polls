# 07 — Migration plan

Each step = one PR, shippable alone, parity checklist green. Verify visually on Android (Capacitor) at 360×800 and web at 1280×800, in light + dark, with presets Golden, Midnight, Cyberpunk at minimum.

1. **Tokens** — add `surface` palette, radius/typography scales to `buildTheme`; remove hard-coded `#000000`/white in `MuiButton`, `MuiAppBar`, `StyledAppBar`. Visual change should be near-zero. Add contrast unit test over `COLOR_PRESETS`.
2. **Shared primitives** — `SubFeedPills`, `BottomSheetMenu`, `FeedItemShell` (avatar/header/footer layout), skeleton rows.
3. **App shell** — `AppNav` (bottom nav / rail / sidebar) + new top bar + account drawer; delete rail popup logic and sidebar FAB; build Explore hub. Keep `SidePane/index.tsx` data (`feedOptions`, `MOBILE_SUB_ITEMS`) by extracting to `navConfig.ts`.
4. **Feed items** — note and poll items on `FeedItemShell`; action row; overflow menu consolidation.
5. **Composer** — full-screen sheet layout.
6. **Profile, Messages, Notifications** restyle.
7. **Music/Movies/Articles/Packs/Games** restyle (mini-player dock).
8. **Settings** regroup into drill-in pages (no setting removed).
9. **Desktop right column** (optional).

## Rules for agents implementing
- Read `02-principles.md` first. No hex literals; use theme.
- Do not change data-layer, routing, or storage keys.
- Screenshot before/after into the PR.
- Update `06-feature-parity.md` only to add items, never to delete.
