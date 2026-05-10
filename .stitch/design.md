# Stormlantern Design System

Stormlantern is a financial-tech-leaning brand. The aesthetic is **precise, low-shadow, small-radius** — closer to Linear/Stripe than to consumer SaaS. Borders carry structure (1 px lines), shadows are reserved for genuine layer separation. Type is tight at display sizes; spacing is tight overall. The brand colour is teal; orange is reserved for interactive affordances and is **never** used to signal warnings.

This document is the source of truth for any UI generated for Stormlantern products. When generating screens, prefer the primitives listed under "Component primitives" before introducing new shapes, and always reference colours, spacing, type, and radii by their token names below.

---

## Brand identity

- **Wordmark:** STORMLANTERN, all caps, split-weight (`STORM` weight 800 + `LANTERN` weight 400). Tight letter-spacing.
- **Lockup:** teal panel · white inset on the left containing the teal lantern silhouette · white wordmark on the teal panel. Dark variant inverts only the inset (becomes near-black `#06181a`) and flips the lantern to white. The outer panel stays brand teal in both modes.
- **No tagline.** Ever.

---

## Palette

All colours expressed as `--sl-color-*` tokens. Shades are 11-step (50–900) for primary/neutral, 5-step for accent, 2-step (500/100) for semantic.

### Primary — Teal (brand)

`--sl-color-teal-50  #e8f3f3`
`--sl-color-teal-100 #c9e2e2`
`--sl-color-teal-200 #97c5c6`
`--sl-color-teal-300 #64a5a6`
`--sl-color-teal-400 #338384`
**`--sl-color-teal-500 #006566`** ← brand teal (header bands, brand mark)
`--sl-color-teal-600 #00585a`
`--sl-color-teal-700 #00484a`
`--sl-color-teal-800 #00373a`
`--sl-color-teal-900 #002628`

### Accent — Orange (interactive only, single-purpose)

`--sl-color-orange-100 #ffe2cc` (tint surface)
`--sl-color-orange-300 #ffa055` (hover/disabled)
**`--sl-color-orange-500 #FB7600`** ← primary affordance (CTAs, focus rings, active tab indicator, "in-progress" pills)
`--sl-color-orange-700 #b35400`
`--sl-color-orange-900 #703500`

**Restricted use.** Accent orange is never on warning pills, never on metric numbers (those keep semantic green/red), never on body backgrounds.

### Neutral — Grayscale

`--sl-color-gray-0   #ffffff`
`--sl-color-gray-50  #fafaf7`
`--sl-color-gray-100 #f0f0ee`
`--sl-color-gray-200 #e0e0dd` (line/divider, light)
`--sl-color-gray-300 #c7c7c4`
`--sl-color-gray-400 #a3a3a0`
`--sl-color-gray-500 #787878` (muted body)
`--sl-color-gray-600 #5e5e5e`
`--sl-color-gray-700 #444444` (body)
`--sl-color-gray-800 #2a2a2a`
`--sl-color-gray-900 #0d0d0d` (ink)

### Tinted dark — dark-mode neutrals (slight teal cast)

`--sl-color-tinted-600 #1f4346` (line/divider, dark)
`--sl-color-tinted-700 #163336` (elevated surface, dark)
`--sl-color-tinted-800 #0e2528` (surface bg, dark)
`--sl-color-tinted-900 #06181a` (body bg, dark)

The slight teal cast in dark mode keeps the brand identity present without saturated chrome.

### Semantic (financial signals; independent of brand)

- **Gain:** `--sl-color-green-500 #1a7a3e` / `--sl-color-green-100 #def0e3`
- **Loss:** `--sl-color-red-500 #b3271f`   / `--sl-color-red-100 #f3dad7`
- **Warn:** `--sl-color-amber-500 #b58400` / `--sl-color-amber-100 #f5e6b3`

Amber for warnings is deliberately NOT brand orange — warn pills must not visually collide with in-progress pills.

### Semantic surface tokens (resolve light/dark via `[data-theme]`)

- `--sl-color-ink`     – primary headings (gray-900 light / gray-50 dark)
- `--sl-color-body`    – body text (gray-700 light / gray-200 dark)
- `--sl-color-muted`   – secondary text (gray-500 light / gray-400 dark)
- `--sl-color-line`    – borders (gray-200 light / tinted-600 dark)
- `--sl-color-surface` – body bg (gray-0 light / tinted-900 dark)
- `--sl-color-paper`   – elevated bg (gray-50 light / tinted-800 dark)
- `--sl-color-accent`  – orange-500 in both modes

---

## Typography

- **Display + body:** **Geist** (Vercel, OFL, variable axis 100–900). `--sl-font-family-body`, `--sl-font-family-display`.
- **Mono:** **Geist Mono**. `--sl-font-family-mono`.

### Sizes (1.25 ratio scale)

`--sl-font-size-xs   11px`
`--sl-font-size-sm   13px`
`--sl-font-size-md   16px` (default body)
`--sl-font-size-lg   18px`
`--sl-font-size-xl   22px`
`--sl-font-size-2xl  28px`
`--sl-font-size-3xl  36px`
`--sl-font-size-4xl  48px`
`--sl-font-size-5xl  60px`

### Weights

`--sl-font-weight-regular  400`
`--sl-font-weight-medium   500`
`--sl-font-weight-semibold 600`
`--sl-font-weight-bold     700`
`--sl-font-weight-heavy    800`

### Line-height + letter-spacing

`--sl-font-line-height-tight  1.15` (display)
`--sl-font-line-height-snug   1.35`
`--sl-font-line-height-normal 1.5`
`--sl-font-line-height-loose  1.65` (prose)

`--sl-font-letter-spacing-tight -0.02em` (display sizes)
`--sl-font-letter-spacing-snug  -0.01em`
`--sl-font-letter-spacing-normal 0`

---

## Spacing (4px base)

`--sl-space-0   0`
`--sl-space-1   4px`
`--sl-space-2   8px`
`--sl-space-3   12px`
`--sl-space-4   16px`
`--sl-space-5   20px`
`--sl-space-6   24px`
`--sl-space-8   32px`
`--sl-space-10  40px`
`--sl-space-12  48px`
`--sl-space-16  64px`
`--sl-space-20  80px`
`--sl-space-24  96px`

---

## Radii (small, on purpose)

`--sl-radius-xs   2px` (inputs)
`--sl-radius-sm   3px`
`--sl-radius-md   4px` (cards, buttons — max for surfaces)
`--sl-radius-lg   6px`
`--sl-radius-full 999px` (pills only)

**Hard rule:** ≤ 4 px on any non-pill surface. No big rounded cards, no bubble buttons.

---

## Shadows (low elevation by design)

`--sl-shadow-none  none`
`--sl-shadow-sm    0 1px 2px rgb(0 0 0 / 0.04)`
`--sl-shadow-md    0 2px 8px rgb(0 0 0 / 0.06)`
`--sl-shadow-lg    0 8px 24px rgb(0 0 0 / 0.08)`

**Hard rule:** 1 px borders carry structure. Shadows are for genuine layer separation only (modal vs page; toast vs viewport). Don't lean on shadows for hover states or "depth".

---

## Motion

- Duration presets: `instant 0`, `fast 120ms`, `normal 200ms`, `slow 260ms`.
- Standard easing: `cubic-bezier(0.2, 0, 0.2, 1)`.
- 120–200 ms is the sweet spot for most UI affordances.

---

## Modes (light + dark)

Driven by `[data-theme="light"|"dark"]` on `<html>`, with `prefers-color-scheme` as the fallback when no attribute is set. Tinted-dark variants (slight teal cast in grays) are used in dark mode so the surface reads as "Stormlantern dark", not generic.

Brand colours (teal / orange / semantic) are mode-stable. Surface, line, body, ink, muted, paper resolve through the semantic tokens above.

---

## Component primitives

Every component is a vanilla custom element prefixed `sl-`. Shadow-DOM internals consume `--sl-*` tokens from the cascade. Generated UI should use these primitives where applicable; *don't* re-create shapes that already exist as primitives.

### `<sl-button variant size type disabled loading>`
Form-associated button.
- **variant:** `primary` (teal, default), `ghost` (text-only), `danger` (red).
- **size:** `sm`, `md` (default).
- **loading:** shows spinner, disables submit. Auto-reflects from `<form data-loading>` if present.

### `<sl-card>`
Container with three slots: default (body), `header`, `actions`. Surface = `--sl-color-paper`, 1 px line, radius `md`, shadow `sm`.

### `<sl-badge variant>`
Inline pill label. Variants: `neutral`, `accent` (orange — for in-progress only), `success` (green), `warn` (amber), `danger` (red).

### `<sl-status variant>`
Indicator: dot + label. Variants: `idle`, `progress` (orange), `success`, `warn`, `error`. For row-level status; not interactive.

### `<sl-tabs orientation>`
ARIA-compliant tab strip. `orientation: horizontal` (default) or `vertical`. Active indicator is an orange underline on the active tab.

### `<sl-table density>`
Light-DOM wrapper around a native `<table>`. `density: comfortable` (default) or `compact`. Header row uses `--sl-color-paper`; rows separated by `--sl-color-line`.

### `<sl-kv-list>`
Two-column key/value list. Useful for entity detail pages. Keys muted, values ink.

### `<sl-alert variant>`
Inline banner. Variants: `info` (teal), `success`, `warn` (amber), `danger`. Border + tinted background; never floats over content.

### `<sl-input label helper error type required>`
Form-associated input. Built-in label, helper text, error state.

### `<sl-dialog>`
Modal overlay. Trap-focus. Backdrop is `rgb(0 0 0 / 0.4)`; dialog surface is `--sl-color-surface`, radius `md`, shadow `lg`.

### `<sl-toast variant>`
Auto-dismissing notification, top-right. Variants match `sl-alert`. Shadow `lg`.

---

## Article / prose conventions (for blog content)

- `.prose` wrapper with `max-width: 68ch`.
- Body: `--sl-font-family-body`, `--sl-font-size-md`, `--sl-font-line-height-loose`.
- Headings: `--sl-font-family-display`, `--sl-color-ink`, tight line-height, snug letter-spacing.
- Inline `code`: mono, `--sl-color-paper` bg, 1 px `--sl-color-line` border, radius `xs`.
- Block code: theme-bound (github-light / github-dark), radius `md`, mono font.
- Links: `--sl-color-accent` with subtle 40 %-alpha underline, 2 px offset.

---

## Aesthetic guardrails (reject if Stitch drifts toward these)

- Big rounded cards (radii > 4 px on surfaces).
- Heavy shadows or "elevation"-style depth.
- Gradient buttons or gradient hero backgrounds.
- Accent orange used as warning colour.
- Non-Geist fonts.
- Generic purple/blue SaaS palette overriding teal.
- "Friendly" pastel tints in dark mode (tinted-dark stays subtle).

When in doubt, prefer fewer shapes, tighter spacing, and 1-px lines over fills.
