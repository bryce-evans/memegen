# @memegen/ui

Skinnable React components and design tokens for the memegen web app. One component API, seven looks:

| id | Looks like |
|---|---|
| `default` | memegen's dark, yellow-accent UI |
| `apple` | Apple HIG (SF stack, translucent toolbar, segmented controls, source-list sidebar); light only |
| `matte` | Material Design 3-inspired (tonal palette, pill buttons, nav-rail indicator, state layers) |
| `google` | Google's internal Memegen, circa 2012 ("Kennedy": Arial 13px, jfk-buttons, red CREATE MEME) |
| `studio` | A light creative-studio look (rounder, black CTA pills, blue selection, gradient wordmark) |
| `spectrum` | Real Adobe Spectrum 2, styled like Firefly: `@spectrum-css/tokens` values, dark, pill buttons, accent-blue "new" action, raised content sheet |
| `painted` | `spectrum` in Spectrum 2 light over a fixed watercolor wash with paper grain: tall frosted header (50% white + blur), translucent white surfaces instead of grays, black primary buttons and white ones for the rest, large painted-ink wordmark on a swatch of brush strokes (on the sign-in card its warm and cool under-lights drift gently, like a sign lit from below) |

`matte` and `studio` are light-first and follow `prefers-color-scheme: dark`; `default` and `spectrum` are dark; `apple` and `google` are light only. `painted` is light with a dark variant (`Skin.dark`): `spectrum--dark`, a flat #282828 page with a faint wash, and a darker wordmark swatch behind brighter letters.

`spectrum` puts Spectrum's token classes (`spectrum spectrum--dark spectrum--medium`) on `<html>` through `Skin.rootClassName`, so `--spectrum-*` properties exist only while it is active. Its font stack prefers Adobe Clean (licensed through Adobe Fonts, so never bundled; used when installed) and falls back to the bundled Source Sans 3 (OFL, `@fontsource-variable/source-sans-3`). `painted` uses `spectrum--light` instead and shares every `spectrum.css` rule (its selectors match both ids); `painted.css` loads after it and overrides only what differs. Its wordmark prefers Radlush Extra Bold (commercial, never bundled; matched through a `local()` `@font-face` when installed) and falls back to the bundled Archivo at 900 (OFL, `@fontsource-variable/archivo`).

`useSkinFavicon(letter)` keeps the page favicon in step with the skin: the letter drawn on a canvas in the skin's wordmark style (font, weight, case, color or gradient) over its page background.

## Setup

```tsx
import "@memegen/ui/styles.css"; // tokens + components + every skin
import { SkinProvider, SkinSwitcher } from "@memegen/ui";

<SkinProvider>
  <SkinSwitcher data-testid="skin-select" />
  <App />
</SkinProvider>;
```

`SkinProvider` picks the skin from `?skin=<id>`, then `localStorage["memegen.skin"]`, then `fallback` (`"default"`); it persists every change to that key and sets `data-skin="<id>"` on `<html>`. Pass `locked="<id>"` to pin one skin instead: no URL or storage lookup, nothing persisted, `setSkin` ignored (the memegen app runs locked to `default`). `useSkin()` returns `{ skin, setSkin, skins, definition, layout, dark, hasDark, setDark }`. Dark mode starts off and is never stored here (the app decides where to keep it); `setDark(true)` shows the active skin's dark variant when it has one (`hasDark`): `data-theme="dark"` on `<html>`, and `Skin.dark.rootClassName` in place of `rootClassName`. Skins scope their dark CSS to `:root[data-skin="<id>"][data-theme="dark"]`.

## How skins work

1. **Tokens.** `src/tokens.css` defines every design decision as a custom property on `:root` (the default skin): color roles (`--ui-color-bg`, `-surface`, `-surface-raised`, `-text`, `-text-muted`, `-primary`, `-on-primary`, `-tonal`, `-danger`, `-success`, `-warning`, `-info`, `-border`, `-separator`, `-focus-ring`, `-link`, `-overlay`, `-media-bg`…; `--ui-color-tooltip-bg`, which must stay opaque since tooltips float over photos, so skins with translucent surfaces set a solid one; badge tiers `--ui-color-tier-bronze`/`-silver`/`-gold`/`-platinum`/`-diamond`, the same in every skin), state layers (`--ui-color-state-hover/press`), typography, shape (`--ui-radius-*`), spacing (`--ui-space-1…8`), elevation (`--ui-shadow-*`), control sizes, motion, and layout (`--ui-sidebar-width`, `--ui-grid-min`…). The shell's column gap and inline padding are tokens too (`--ui-shell-gap`, `--ui-shell-padding-start`/`-end`, and `--ui-main-padding-inline` inside `<main>`): on wide screens the header lays out on the same columns, so the wordmark sits left-aligned over the side column (at `--ui-wordmark-size`, shrunk only as needed to fit the column) and the search (`--ui-radius-search`) starts where the main content does. Skins set these tokens rather than the shell's, main's, or header's inline padding or the wordmark's `font-size`.
2. **Components** (`src/components.css`) read only tokens.
3. **Skins** (`src/skins/<id>.css`) override tokens under `:root[data-skin="<id>"]`, plus component tweaks scoped the same way where tokens are not enough (Apple's raised segmented thumb, Google's gradient jfk-buttons, Studio's masonry gallery…). Skins here style only `.ui-*` classes; an app that offers several skins puts per-skin tweaks to its own markup in the app, same scoping. Buttons are skinned through variables: `.ui-button` and its hover read `--ui-button-bg`, `-fg`, `-border`, `-hover-bg`, `-hover-border`, and variants/states (`--primary`, `--quiet`, `--danger`, `[aria-pressed]`, toned pressed) in `components.css` and in skins only reassign them (Google keeps its own `--g-*` gradient set).
4. **Layout hints** (`Skin.layout`) let a skin move app controls without duplicating them: `filters: "sidebar" | "header"` (sort/period beside the page title). The app reads them via `useSkin().layout`.
5. **Component overrides** (`Skin.components`) replace any component for one skin (below).

App CSS should also use tokens only, so it follows every skin.

## Components

Every component extends its root element's native props (so `data-testid`, `aria-*`, handlers and `ref` pass through) and merges `className`. Polymorphic ones take `as` (e.g. react-router's `Link`/`NavLink`).

| Component | Renders | Own props |
|---|---|---|
| `AppShell` | header + side column + `<main>`; on narrow screens (≤ 760px) the side column is a row above the main area | `header`, `sidebar` |
| `Header` | sticky `<header>`; on narrow screens one row: the wordmark's first letter, the search, and an account `Dropdown` holding the actions | `brand`, `center` (search); children = right-hand actions; `accountLabel` (default "Account"), `accountButtonProps` (e.g. `data-testid`) |
| `Dropdown` | toggle button + panel (a disclosure, not an ARIA menu); outside click, Escape, or choosing a link/button inside closes it | `label` (button text, or with `icon` the icon button's name), `icon`, `align` (`start`/`end`), `buttonProps` |
| `Wordmark` | product name, one span per letter | `text` |
| `Sidebar`, `SidebarSection` | `<aside>`; titled group (`div`/`nav`/`section`) | `heading`, `as` |
| `NavList`, `NavItem` | vertical nav; item (`as`, default `a`) | `active`, `icon`, `trailing` (NavLink's `aria-current="page"` also marks active) |
| `PageHeader` | `h1`/`h2` + controls row | `title`, `level`, `actions`, `titleProps` |
| `Stack`, `Inline` | flex column / row | `gap`, `align`, `justify`, `wrap` |
| `Button` | `<button type=button>` | `variant` (`primary`/`special`/`secondary`/`quiet`/`danger`; `special` is the fixed brand gradient, stops `--ui-color-special-start`/`-mid`/`-end`, the same in every skin; on hover it slides 35% of the way toward red → orange → `--ui-color-special-hover-end` yellow), `size` (`sm`/`md`), `pressed` → `aria-pressed`, `tone` (`warning`/`info`: color of the pressed state, kept by every skin; a pressed toned button also fills its `Icon`), `icon` |
| `IconButton` | icon-only `<button>` | `label` (aria-label + tooltip) |
| `LinkButton` | button-looking link (`as`, default `a`) | `variant`, `size`, `icon` |
| `FileButton` | `<label>` styled as a button around a hidden native `<input type=file>` | all input props (incl. `data-testid`) go to the input; `variant`, `size`, `icon` |
| `SegmentedControl` | `role=group` of `aria-pressed` buttons | `options[{ value, label, testId }]`, `value`, `onChange`, `orientation`, `size` |
| `Field` | `<label>` (or `div`) around any control | `label`, `description`, `error`, `as` |
| `TextField`, `TextArea` | `<input>`, `<textarea>` | `label`, `description`, `error`, `size` |
| `SelectField` | native `<select>` + skinned chevron | `label`, `description`, `error`, `size` |
| `Slider` | native `<input type=range>` (filled track) | `label`, … |
| `Checkbox` | native `<input type=checkbox>` with its label beside it (`accent-color` primary) | `label`; input props (`checked`, `onChange`, `data-testid`…) go to the input |
| `ColorField` | native `<input type=color>` | `label`, … |
| `Card`, `CardTitle`, `CardMeta`, `MediaGrid` | `<article>` with media/body/actions slots; grid | `media`, `actions`, `borderless`; `CardTitle` is polymorphic |
| `Chip`, `ChipGroup` | tag chip (`as`, default `span`) | `variant` (`default`/`suggest`), `onRemove`, `removeLabel` |
| `Badge` | status pill | `tone` (`neutral`/`primary`/`info`/`success`/`warning`/`danger`) |
| `ProgressBar` | native `<progress>` | `value` (0..1, `null` = indeterminate) |
| `FrameThumb` | timeline frame `<button>` around its picture (canvas/img) | `current` → `aria-current`, `keyframe` (mark), `dimmed`; border width `--ui-frame-thumb-border` (part of the cell size) |
| `Alert` | `role=alert` (danger) / `status` (info) box | `tone` (`danger`/`info`) |
| `Callout` | tinted box with an accent edge (not a live region) | `tone` (as `Badge`) |
| `Table` | `<table>` with ruled rows, muted headers (`aria-sort` marks the sorted column), tabular figures | table props |
| `StatGroup`, `Stat` | `<dl>` row of stat tiles; one labelled figure | `label`, `value`, `hint` (label tooltip), `valueProps` (on the `<dd>`) |
| `Spinner`, `EmptyState` | loading row; empty placeholder | `label`; `title`, `description`, `action`, `icon` |
| `Panel` | titled surface (`section`) | `heading`, `headingActions`, `variant` (`default`/`inset`/`flush`: the surface only, no padding or margin) |
| `Dialog` | modal native `<dialog>` (`showModal`: inert page, focus kept inside, Escape closes) | `open`, `onClose` (Escape, close button, backdrop), `heading`, `closeLabel` |
| `Text` | `p`/`span`/`div` | `tone`, `size`, `numeric` |
| `Icon` | stroke SVG (`--ui-icon-stroke`; solid parts `ui-icon-solid`) | `name`, `label`, `tooltip` (hover text shown at once above the icon, `role=tooltip`; the accessible name when there's no `label`), `gradient` (orange → yellow, `--ui-color-special-end` → `--ui-color-special-hover-end`, the same in every skin) |
| `SkinSwitcher` | native `<select>` of registered skins | select props |

`useNarrowScreen()` is true at the narrow-screen breakpoint (≤ 760px, the same width as the CSS), for apps that render different content there.

## Overriding a component for one skin

`Skin.components` maps a component name (`ComponentOverrides`) to a replacement that receives exactly the original's props. Every exported component checks the active skin and renders the override if there is one. Example: use a third-party Material button for the `matte` skin only.

```tsx
import { Button as MuiButton } from "@mui/material";
import { getSkin, registerSkin, type ButtonProps } from "@memegen/ui";

function MuiSkinButton({ variant = "secondary", size = "md", pressed, icon, className, children, ...rest }: ButtonProps) {
  return (
    <MuiButton
      {...rest} // keeps data-testid, aria-*, onClick, disabled, type…
      className={className}
      variant={variant === "primary" ? "contained" : variant === "quiet" ? "text" : "outlined"}
      color={variant === "danger" ? "error" : "primary"}
      size={size === "sm" ? "small" : "medium"}
      startIcon={icon}
      aria-pressed={pressed}
    >
      {children}
    </MuiButton>
  );
}

// Keep the built-in definition (label, layout hints), add the override.
registerSkin({ ...getSkin("matte")!, components: { Button: MuiSkinButton } });
```

Replacements must forward `data-testid`, `aria-*` and event props to the element the user interacts with, and keep native controls native where the app relies on them (`<select>`, `<input type=file>`).

## Adding a skin

```ts
declare module "@memegen/ui" {
  interface CustomSkinIds {
    brand: true;
  }
}
registerSkin({ id: "brand", label: "Brand", layout: { filters: "header" } });
```

Then add `skins/brand.css` with `:root[data-skin="brand"] { --ui-color-primary: …; }` (and component tweaks) and import it after `components.css`. Registered skins appear in `SkinSwitcher` automatically.
