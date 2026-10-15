# Zero — Color & Design Token System

All tokens defined in `app/globals.css` using the `oklch()` color space. Light theme is the default; dark theme overrides apply under `.dark`.

This doc describes the **Acid Ink v2** palette and the role-token layer added on top of it. The role tokens are how you re-skin without grepping the codebase.

---

## How re-theming works

Three layers, smallest blast radius first:

1. **Role tokens** — high-leverage knobs. Change one value, every component that picks the matching role flips. (`--radius-pill`, `--font-weight-action`, `.surface-brand`, `.surface-card`.)
2. **Semantic palette** — `--primary`, `--positive`, `--negative`, `--warning`, `--info`, `--badge-*`, `--sidebar-*`. Change a hex and everything using that token shifts.
3. **Component overrides** — only for one-offs (destructive button, link variant). Avoid; prefer adding a role token instead.

When you want a new look, work top-down: tweak the role tokens first, then nudge the palette, only then touch a component.

---

## Role tokens — change once, propagate everywhere

| Token | Today | Effect of changing |
|---|---|---|
| `--radius-pill` | `9999px` | Every pill-shaped UI (buttons, badges, filter chips, available pill, assign-input). Set to `12px` and the app softens from fully-rounded to lozenge. |
| `--font-weight-action` | `700` (bold) | Button base, badge recipe, primary filter pill, available pill. Drop to `600` for a calmer UI; bump to `800` for louder. |
| `--height-pill` | `2.5rem` | Default Button height; matches inactive filter pill height. Available as a CSS var; not yet wired through every consumer. |

### Surface roles (CSS recipes)

The two interactive shells. Components apply the class, not the underlying tokens.

| Class | Recipe | Use |
|---|---|---|
| `.surface-brand` | solid `--primary` fill + `--primary-foreground` text, no border | The loud one — Button `default` variant, active filter pill. Keep it rare so it stays loud. |
| `.surface-card` | `--card` bg + `--foreground/80` text + `--border/60` border; hover deepens to full foreground/border | The quiet one — Button `outline` / `secondary` variants, inactive filter pill, assign-input cell. |

The third shell is **tinted**, handled by the badge recipe below (one `--b-fg` swap per intent).

---

## Brand

| Token | Light | Dark | Use |
|---|---|---|---|
| `--primary` | `oklch(0.86 0.21 128)` acid lime | `oklch(0.88 0.22 128)` | Active filter, default Button, Z mark, focus ring base |
| `--primary-foreground` | `oklch(0.15 0.03 140)` near-black green | `oklch(0.15 0.04 140)` | Text on `--primary` surfaces |
| `--ring` | matches `--primary` | matches `--primary` | Focus rings |

**Important:** the brand hue is now **lime (128)**, not the prior green (155). When picking accents, reach for `--primary` (lime) for interactive emphasis; reach for `--positive` (hue 138) for financial positives. Don't swap them.

---

## Budget state (semantic)

Meaning-bearing money colors. Always use the token, never a raw hex/oklch.

| Token | Light | Dark | Meaning |
|---|---|---|---|
| `--positive` | `oklch(0.49 0.17 134)` green | `oklch(0.82 0.21 132)` | Positive balances, surplus in transfer plan |
| `--negative` | `oklch(0.52 0.22 27)` red | `oklch(0.68 0.21 27)` | Overspent, negative available, "not enough" |
| `--warning` | `oklch(0.64 0.16 72)` amber | `oklch(0.80 0.16 78)` | Underfunded categories, due-soon, uncategorized banner |
| `--info` | `oklch(0.50 0.18 268)` violet | `oklch(0.70 0.16 268)` | Buffer pill, transfer amounts, neutral facts |

> The negative/positive/warning families are **darker in light mode** than they look in raw isolation — they're tuned to pass 4.5:1 against the `/10` and `/15` tints the app uses for backgrounds.

---

## Badge intent palette

The six intents in the badge recipe. Each maps onto a `.badge-{intent}` class; the recipe in `globals.css` does the rest (`color-mix` for tint + border).

| Token | Light | Dark | Used by |
|---|---|---|---|
| `--badge-neutral` | `oklch(0.42 0.012 130)` | `oklch(0.74 0.012 135)` | Type labels (CHECKING), counts, `$0.00`, "Ready to assign" |
| `--badge-positive` | `oklch(0.46 0.17 138)` | `oklch(0.82 0.21 132)` | On-track goals, surplus, "$1,500 goal" |
| `--badge-negative` | `oklch(0.50 0.21 27)` | `oklch(0.70 0.21 27)` | Overspent, debt, schedule "Missed" |
| `--badge-warning` | `oklch(0.52 0.15 70)` | `oklch(0.82 0.16 80)` | Underfunded, uncategorized, schedule "Due" |
| `--badge-info` | `oklch(0.50 0.18 270)` | `oklch(0.72 0.16 270)` | Buffer, transfer, schedule "Upcoming" |

`.badge-solid` is brand emphasis: solid `--primary` fill on the same recipe. The ONLY solid badge. Use sparingly (Ready-to-Assign hero, active selected state).

### Where each intent shows up

| Intent | Component / location |
|---|---|
| `neutral` | Account / asset type chips, count badges (groups, hidden categories), schedule "Completed" / "Scheduled", any unset money chip ($0.00) |
| `positive` | Target chip when on-track, schedule "Paid" |
| `negative` | Filter pill `Overspent`, schedule "Missed" |
| `warning` | `Uncategorized` chip in transactions, target chip when underfunded, schedule "Due" |
| `info` | `Buffer` chip on a category, schedule "Upcoming" |
| `brand` (solid) | Active selected filter, Ready-to-Assign hero |

---

## Surfaces (background scale)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` | `oklch(0.962 0.010 100)` cream | `oklch(0.145 0.006 150)` near-black | App background |
| `--card` | `oklch(1 0 0)` pure white | `oklch(0.19 0.008 150)` | Cards, white pills, popovers, content rows (budget/tx/holdings) |
| `--popover` | matches `--card` | matches `--card` | Popover/dropdown surfaces |
| `--accent` | `oklch(0.95 0.014 124)` | `oklch(0.225 0.012 150)` | Header bg (`bg-accent/40`), hover targets in dark sidebar |
| `--muted` | matches `--accent` | matches `--accent` | Muted surfaces |
| `--secondary` | matches `--accent` | matches `--accent` | Reserved — currently aliased; surface-card is the right shell for "calm Button" |
| `--border` | `oklch(0.90 0.010 110)` | `oklch(0.275 0.010 150)` | All borders |
| `--input` | matches `--border` | matches `--border` | Form input backgrounds |
| `--destructive` | `oklch(0.52 0.22 27)` red | `oklch(0.68 0.21 27)` red | Destructive button, delete confirms |

`--foreground` is `oklch(0.16 0.012 140)` near-black (green-tinted) in light, `oklch(0.96 0.010 130)` near-white in dark.

---

## Sidebar

Always dark-themed regardless of app theme — sidebar is its own surface system.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--sidebar` | `oklch(0.165 0.018 150)` near-black green | `oklch(0.105 0.005 150)` | Sidebar background |
| `--sidebar-foreground` | `oklch(0.97 0.018 130)` near-white | `oklch(0.96 0.010 130)` | Sidebar text |
| `--sidebar-foreground-muted` | `oklch(0.70 0.018 130)` | `oklch(0.64 0.010 130)` | Section labels, account balances |
| `--sidebar-foreground-negative` | `oklch(0.74 0.18 27)` red | matches light | Negative balances (credit card debt) |
| `--sidebar-primary` | matches `--primary` lime | matches `--primary` | Active item accents |
| `--sidebar-primary-foreground` | matches `--primary-foreground` | matches | Text on `--sidebar-primary` |
| `--sidebar-accent` | `oklch(0.24 0.03 150)` | `oklch(0.205 0.014 150)` | Selected sidebar item bg |
| `--sidebar-border` | matches `--sidebar-accent` | matches `--sidebar-accent` | Dividers |
| `--sidebar-ring` | matches `--primary` | matches `--primary` | Focus rings inside sidebar |

> Muted and negative sidebar tokens pass WCAG 4.5:1 against both `--sidebar` and `--sidebar-accent` in both themes — they replace the prior `text-sidebar-foreground/35`-style opacity overlays which failed contrast.

---

## Charts

Five-slot palette for Recharts on the Insights page. Each slot is a distinct hue.

| Token | Light | Dark | Hue |
|---|---|---|---|
| `--chart-1` | `oklch(0.74 0.20 128)` | `oklch(0.85 0.22 128)` | Lime (brand) |
| `--chart-2` | `oklch(0.55 0.18 265)` | `oklch(0.66 0.18 265)` | Violet |
| `--chart-3` | `oklch(0.60 0.21 25)` | `oklch(0.68 0.21 25)` | Red |
| `--chart-4` | `oklch(0.72 0.16 72)` | `oklch(0.82 0.16 78)` | Amber |
| `--chart-5` | `oklch(0.60 0.13 200)` | `oklch(0.72 0.14 200)` | Teal |

---

## Layout & typography utilities

| Utility | Defined where | Use |
|---|---|---|
| `page-title` | `globals.css` `@utility` | 32px / weight 800 / `-0.02em` tracking. Every page header h1 + the `<div>` labels in `MonthSelector` / `YearSelector`. Don't re-roll. |
| `--spacing-toolbar` | `globals.css` `@theme inline` | 44px filter bar / toolbar height. Available as `h-toolbar`. |
| `rounded-pill` | generated from `--radius-pill` | The default pill shape. Prefer this over `rounded-full` so future re-skins propagate. |
| `font-action` | generated from `--font-weight-action` | The default action weight. Prefer over `font-bold`. |

---

## Quick reference — when to reach for which

- **Loud branded action** → `.surface-brand` + `font-action` (Button `default`, active filter pill, badge `solid`).
- **Calm secondary action** → `.surface-card` (Button `outline`/`secondary`, inactive filter pill, assign-input cell).
- **Tinted status chip** → `<Badge intent="…">` — picks the right `--badge-*` token + `color-mix` recipe.
- **Money is positive** → `--positive` (hue 134).
- **Money is negative / destructive** → `--negative` / `--destructive` (hue 27).
- **Needs attention but not bad** → `--warning` (hue 72).
- **Informational** → `--info` (hue 268).
- **Charts** → cycle `--chart-1` … `--chart-5`.

When in doubt, render money through `<Currency>` from `components/shared/currency.tsx` — it picks the right token and handles the superscript-cents treatment automatically.
