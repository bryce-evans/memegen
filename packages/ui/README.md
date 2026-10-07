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
| `painted` | `spectrum` in Spectrum 2 light over a fixed watercolor wash with paper grain: tall frosted header (50% white + blur), translucent white surfaces instead of grays, black buttons, large painted-ink wordmark on a swatch of brush strokes |

`matte` and `studio` are light-first and follow `prefers-color-scheme: dark`; `default` and `spectrum` are dark; `apple`, `google`, and `painted` are light only.

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

`SkinProvider` picks the skin from `?skin=<id>`, then `localStorage["memegen.skin"]`, then `fallback` (`"default"`); it persists every change to that key and sets `data-skin="<id>"` on `<html>`. Pass `locked="<id>"` to pin one skin instead: no URL or storage lookup, nothing persisted, `setSkin` ignored (the memegen app runs locked to `default`). `useSkin()` returns `{ skin, setSkin, skins, definition, layout }`.

## How skins work

1. **Tokens.** `src/tokens.css` defines every design decision as a custom property on `:root` (the default skin): color roles (`--ui-color-bg`, `-surface`, `-surface-raised`, `-text`, `-text-muted`, `-primary`, `-on-primary`, `-tonal`, `-danger`, `-success`, `-warning`, `-info`, `-border`, `-separator`, `-focus-ring`, `-link`, `-overlay`, `-media-bg`…), state layers (`--ui-color-state-hover/press`), typography, shape (`--ui-radius-*`), spacing (`--ui-space-1…8`), elevation (`--ui-shadow-*`), control sizes, motion, and layout (`--ui-sidebar-width`, `--ui-grid-min`…).
2. **Components** (`src/components.css`) read only tokens.
3. **Skins** (`src/skins/<id>.css`) override tokens under `:root[data-skin="<id>"]`, plus component tweaks scoped the same way where tokens are not enough (Apple's raised segmented thumb, Google's gradient jfk-buttons, Studio's masonry gallery…). Skins here style only `.ui-*` classes; an app that offers several skins puts per-skin tweaks to its own markup in the app, same scoping. Buttons are skinned through variables: `.ui-button` and its hover read `--ui-button-bg`, `-fg`, `-border`, `-hover-bg`, `-hover-border`, and variants/states (`--primary`, `--quiet`, `--danger`, `[aria-pressed]`, toned pressed) in `components.css` and in skins only reassign them (Google keeps its own `--g-*` gradient set).
4. **Layout hints** (`Skin.layout`) let a skin move app controls without duplicating them: `filters: "sidebar" | "header"` (sort/period beside the page title). The app reads them via `useSkin().layout`.
5. **Component overrides** (`Skin.components`) replace any component for one skin (below).

App CSS should also use tokens only, so it follows every skin.

## Components

Every component extends its root element's native props (so `data-testid`, `aria-*`, handlers and `ref` pass through) and merges `className`. Polymorphic ones take `as` (e.g. react-router's `Link`/`NavLink`).

| Component | Renders | Own props |
|---|---|---|
| `AppShell` | header + side column + `<main>` | `header`, `sidebar` |
| `Header` | sticky `<header>` | `brand`, `center` (search); children = right-hand actions |
| `Wordmark` | product name, one span per letter | `text` |
| `Sidebar`, `SidebarSection` | `<aside>`; titled group (`div`/`nav`/`section`) | `heading`, `as` |
| `NavList`, `NavItem` | vertical nav; item (`as`, default `a`) | `active`, `icon`, `trailing` (NavLink's `aria-current="page"` also marks active) |
| `PageHeader` | `h1`/`h2` + controls row | `title`, `level`, `actions`, `titleProps` |
| `Stack`, `Inline` | flex column / row | `gap`, `align`, `justify`, `wrap` |
| `Button` | `<button type=button>` | `variant` (`primary`/`secondary`/`quiet`/`danger`), `size` (`sm`/`md`), `pressed` → `aria-pressed`, `tone` (`warning`/`info`: color of the pressed state, kept by every skin), `icon` |
| `IconButton` | icon-only `<button>` | `label` (aria-label + tooltip) |
| `LinkButton` | button-looking link (`as`, default `a`) | `variant`, `size`, `icon` |
| `FileButton` | `<label>` styled as a button around a hidden native `<input type=file>` | all input props (incl. `data-testid`) go to the input; `variant`, `size`, `icon` |
| `SegmentedControl` | `role=group` of `aria-pressed` buttons | `options[{ value, label, testId }]`, `value`, `onChange`, `orientation`, `size` |
| `Field` | `<label>` (or `div`) around any control | `label`, `description`, `error`, `as` |
| `TextField`, `TextArea` | `<input>`, `<textarea>` | `label`, `description`, `error`, `size` |
| `SelectField` | native `<select>` + skinned chevron | `label`, `description`, `error`, `size` |
| `Slider` | native `<input type=range>` (filled track) | `label`, … |
| `ColorField` | native `<input type=color>` | `label`, … |
| `Card`, `CardTitle`, `CardMeta`, `MediaGrid` | `<article>` with media/body/actions slots; grid | `media`, `actions`, `borderless`; `CardTitle` is polymorphic |
| `Chip`, `ChipGroup` | tag chip (`as`, default `span`) | `variant` (`default`/`suggest`), `onRemove`, `removeLabel` |
| `Badge` | status pill | `tone` (`neutral`/`primary`/`info`/`success`/`warning`/`danger`) |
| `ProgressBar` | native `<progress>` | `value` (0..1, `null` = indeterminate) |
| `Alert` | `role=alert` (danger) / `status` (info) box | `tone` (`danger`/`info`) |
| `Spinner`, `EmptyState` | loading row; empty placeholder | `label`; `title`, `description`, `action`, `icon` |
| `Panel` | titled surface (`section`) | `heading`, `headingActions`, `variant` (`default`/`inset`/`flush`: the surface only, no padding or margin) |
| `Dialog` | modal native `<dialog>` (`showModal`: inert page, focus kept inside, Escape closes) | `open`, `onClose` (Escape, close button, backdrop), `heading`, `closeLabel` |
| `Text` | `p`/`span`/`div` | `tone`, `size`, `numeric` |
| `Icon` | stroke SVG (`--ui-icon-stroke`) | `name`, `label` |
| `SkinSwitcher` | native `<select>` of registered skins | select props |

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
