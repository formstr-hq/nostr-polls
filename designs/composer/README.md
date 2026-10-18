# Composer redesign — mockups

Visual reference for redesigning the note and poll composer (`src/components/EventCreator/`). Start with `00-overview.png`. Each numbered PNG is one state, with numbered pins explained in the legend beside the phone.

Legend tags:
- **NEW** = small addition
- **REDESIGNED** = existing feature with a new layout
- **EXISTING** = same behavior, restyled

No existing composer feature is removed.

| File | State |
|---|---|
| 01–08 | Note: empty, writing, mention picker, disappearing (NIP-40), audience/private link, preview, AI proofread, private link after posting |
| 09–14 | Poll: empty + templates, writing options, answer type, voting ends, spam protection (PoW), preview |
| 15–16 | Dark mode (Golden preset, OLED black) |
| desktop-poll | ≥ 900px dialog with live preview pane |

Colors are the Golden preset from `src/styles/themes.ts`. Icons are the real `@mui/icons-material` Rounded set. The exact CSS (sizes, radii, spacing) is in `src/build.py`.

## Style directions (`styles/`)

`styles/00-style-directions.png` shows the same composer in three visual languages (Glass, Neumorphic, and our own **Sunlit Candy**), each in light and dark. There is also one image per style. The style CSS is in `src/styles.py` and layers on top of the base layout in `src/build.py`.

Regenerate with `python3 designs/composer/src/styles.py`, and the screens with `python3 designs/composer/src/build.py` (needs Google Chrome).
