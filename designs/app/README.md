# Color Block — app-wide mockups

The chosen visual direction. Start with `00-overview.png`. Each numbered PNG is one screen in light and dark (Golden preset) with a short spec.

**System rules**
- **The block**: a solid slab of the theme color with a rounded bottom. It always holds whatever is in focus: the feed name and sub-feeds, the post being read, the profile, the conversation, or the thing being written. Text on it flips between ink and white for contrast.
- **Slabs**: content sits on rounded slabs (white in light mode, #141414 in dark) on a neutral page (#f2f2ef in light, OLED black in dark).
- **Ink**: the nav dock and secondary controls are near-black. The selected nav item uses the bright accent.
- **Create**: a rounded-square button in the block color, next to the nav dock.
- **Color model**: users pick either an 8-color single-color preset (as today) or a 3-color palette (notes, polls, selection). See `12-presets.png` and `13-palettes.png`. Light/dark stays a separate choice.

Composer details live in `../composer/`. Regenerate with `python3 designs/app/src/app.py` (needs Google Chrome).
