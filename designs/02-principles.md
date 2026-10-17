# 02 — Design principles

1. **Same app, better bones.** A user of v1.18 must recognise it instantly: pill buttons, warm tint, brand font, preset colors, un-boxed feed.
2. **Thumb-first.** Primary navigation and the create action live in the bottom 30% of the screen on phones.
3. **Always know where you are.** Current feed and sub-mode are visible at all times without opening a menu.
4. **One shell, three sizes.** Same destinations on phone (bottom bar), tablet (rail), desktop (labeled sidebar). Only the presentation changes.
5. **Tokens or nothing.** No hex literals in components. Every color comes from the MUI theme (`primary`, `secondary`, `background`, `text`, `divider`, `action`) so all 8 presets + custom work in light and dark. Spacing from the 4px scale, radius from the radius scale.
6. **Content first.** Chrome hides on scroll down and returns on scroll up (reuse `useImmersiveScroll`). Never more than one persistent bar at the top and one at the bottom.
7. **Un-boxed by default.** Feed items are separated by hairline dividers, not cards. Cards are for embeds (link previews, quoted notes, poll options) only.
8. **Progressive disclosure.** Rare settings and secondary actions go in sheets/menus; frequent actions (react, reply, repost, zap, vote) are one tap.
9. **Accessible.** Touch targets ≥ 44dp. Text contrast ≥ 4.5:1 against `background.default` in every preset (validate secondary colors used as text; if failing, use `primary`/`text.primary` for text and keep the color for fills/icons). Respect `prefers-reduced-motion`. Every icon-only button has an `aria-label`.
10. **Offline/cached honesty.** Cached-first render stays; show a subtle "updating…" indicator in the top bar, not a blocking spinner.
