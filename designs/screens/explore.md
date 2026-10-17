# Screen — Explore (new client-side hub)

Purpose: one bottom-nav slot for the six secondary feeds so the bar stays at five.
Implementation: a component rendered when the Explore tab is pressed and no secondary feed is active; links to existing routes. No new route required; if one is wanted use `/explore` and keep the old `/feeds/*` paths.

```
┌──────────────────────────────┐
│ Explore               🔍 🔔 ✉│
├──────────────────────────────┤
│ ┌──────────┐ ┌──────────┐    │
│ │ #  Topics│ │ 📖Articles│   │  2-col grid, tiles 96dp, radius md,
│ └──────────┘ └──────────┘    │  bg alpha(primary,.08), icon in primary
│ ┌──────────┐ ┌──────────┐    │
│ │ ♪  Music │ │ 🎬 Movies │   │
│ └──────────┘ └──────────┘    │
│ ┌──────────┐ ┌──────────┐    │
│ │ 👥 Packs │ │ 🎮 Games  │   │
│ └──────────┘ └──────────┘    │
│ Trending topics  (chips…)    │
└──────────────────────────────┘
```
Tile shows a live hint line (e.g. "Now playing", "3 new packs") when cheap to compute; otherwise omitted.
