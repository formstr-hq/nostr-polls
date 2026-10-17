# 03 — Design tokens

Machine-readable copy: `tokens.json`. Implement by extending `buildTheme()` in `src/styles/theme.ts`; do **not** fork presets — presets keep supplying `primary`, `secondary`, `background`.

## Color roles (derived from the preset)
| Role | MUI path | Use |
|---|---|---|
| Brand | `primary.main` | Active nav item, selected chips, unread dot, primary buttons (filled) |
| Accent | `secondary.main` | Links, in-page tabs underline, switches, sliders, FAB, progress |
| Canvas | `background.default` | Screen bg (light: preset `lightBg`; dark: `#000`) |
| Surface | `background.paper` → **change** | Light: `#ffffff`; dark: `#0f0f10` (raised sheets, menus, inputs). Today paper == default, which kills layering |
| Text | `text.primary / secondary / disabled` | Standard |
| Divider | `divider` | Hairlines between feed items: 1px, 12% opacity |
| Tint-brand | `alpha(primary.main, .12)` | Active nav pill bg, selected row |
| Tint-accent | `alpha(secondary.main, .12)` | Link hover, tab hover |
| Danger/ok/warn | `error / success / warning` | Zap/Report/Delete, confirmations |

Fix: replace hard-coded `#000000` button text (`MuiButton text/outlined` in light mode) with `text.primary`; AppBar bg becomes `background.default` (not pure white/black) so it follows the preset tint.

## Typography
Family: from `getFontPreset()` — unchanged, user-selectable.
| Style | Size/Line | Weight | Use |
|---|---|---|---|
| display | 28/34 | 700 | Empty states, onboarding |
| title-lg | 22/28 | 700 | Screen title (profile name, article title) |
| title | 18/24 | 600 | Section headers, top-bar title |
| body | 16/24 | 400 | Post text, article body (article: 17/28) |
| body-sm | 14/20 | 400 | Meta, secondary text, comments |
| label | 14/20 | 600 | Buttons, tabs, chips |
| caption | 12/16 | 500 | Timestamps, counts, badges |
Display fonts (Shantell etc.) have large x-height — keep sizes, drop weight 700→600 for them if headings look heavy.

## Spacing (4px base)
`0, 4, 8, 12, 16, 20, 24, 32, 48`. Screen horizontal padding: 16 (phone), 24 (≥600). Feed item padding: 12 vertical, 16 horizontal. Gap avatar→content: 12.

## Radius
| Token | px | Use |
|---|---|---|
| xs | 6 | Inline code, small tags |
| sm | 12 | Media thumbnails, embeds, inputs |
| md | 16 | Cards, menus, popovers |
| lg | 24 | Bottom sheets (top corners), dialogs |
| pill | 999 | Buttons, chips, search field, nav active indicator, poll option bars |
Pill buttons are the signature — keep.

## Elevation
Prefer tone over shadow. Levels: 0 canvas; 1 surface + 1px divider (menus, inputs); 2 sheet/dialog (`0 8px 24px rgba(0,0,0,.18)` light, none in dark — use a lighter surface `#161618` instead); FAB uses level 2.

## Motion
| Token | Value |
|---|---|
| fast | 120ms ease-out (press, toggle) |
| base | 200ms cubic-bezier(.2,0,0,1) (bar hide/show, sheet) |
| slow | 320ms cubic-bezier(.2,0,0,1) (page transitions) |
Press feedback: scale .97 + tint. Disable all when `prefers-reduced-motion`.

## Layout
Breakpoints (MUI defaults): xs 0, sm 600, md 900, lg 1200.
| Width | Shell |
|---|---|
| < 600 | top bar + bottom nav, single column full-bleed |
| 600–899 | icon rail (72) + content (max 640) |
| ≥ 900 | labeled sidebar (240) + content (max 640) + optional right column (320: search, who-to-follow, trends) at ≥ 1200 |
Reading column max-width: 640 (was 800) for feed; articles 680.
