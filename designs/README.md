# Pollerama redesign — design reference

Audience: AI coding agents and humans implementing the redesign. Read in order.

| File | What it covers |
|---|---|
| `01-audit.md` | What the app is today, what works, what hurts |
| `02-principles.md` | Rules every change must follow (incl. "keep the feel") |
| `03-tokens.md` + `tokens.json` | Color, type, spacing, radius, elevation, motion — single source of truth |
| `04-navigation.md` | New app shell: top bar, bottom nav, side rail, sub-feed tabs |
| `05-components.md` | Component specs (post card, poll card, composer, mini-player, …) |
| `screens/*.md` | Per-screen wireframes and behavior |
| `06-feature-parity.md` | Checklist: every existing feature and where it lives after the redesign |
| `07-migration-plan.md` | Ordered, independently shippable PRs |

## Status
Proposal only. No source code was changed. Implement via `07-migration-plan.md`; each step must keep `06-feature-parity.md` fully green.

## Scope rule
Redesign = **layout, hierarchy, density, consistency**. Not allowed: removing a feature, a feed, a theme preset, a font option, or a setting; changing Nostr/data-layer behavior; changing routes (deep links and `nevent`/`naddr` URLs stay valid).
