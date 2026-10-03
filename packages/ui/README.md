# @memegen/ui

Skinnable React components and design tokens for the memegen web app. One component API, five looks:

| id | Looks like |
|---|---|
| `default` | memegen's dark, yellow-accent UI |
| `apple` | Apple HIG (SF stack, translucent toolbar, segmented controls, source-list sidebar) |
| `material` | Material Design 3 (tonal palette, pill buttons, nav-rail indicator, state layers) |
| `google` | Google's internal Memegen, circa 2012 ("Kennedy": Arial 13px, jfk-buttons, red CREATE MEME) |
| `spectrum` | Adobe Spectrum 2 / Firefly (Adobe Clean stack, rounder, black CTA pills, blue selection) |

`apple`, `material` and `spectrum` are light-first and follow `prefers-color-scheme: dark`; `default` is dark; `google` is light only.

## Setup

```tsx
import "@memegen/ui/styles.css"; // tokens + components + every skin
import { SkinProvider, SkinSwitcher } from "@memegen/ui";

<SkinProvider>
  <SkinSwitcher data-testid="skin-select" />
  <App />
</SkinProvider>;
```

`SkinProvider` picks the skin from `?skin=<id>`, then `localStorage["memegen.skin"]`, then `"default"`; it persists every change to that key and sets `data-skin="<id>"` on `<html>`. `useSkin()` returns `{ skin, setSkin, skins, definition, layout }`.

## How skins work

1. **Tokens.** `src/tokens.css` defines every design decision as a custom property on `:root` (the default skin): color roles (`--ui-color-bg`, `-surface`, `-surface-raised`, `-text`, `-text-muted`, `-primary`, `-on-primary`, `-tonal`, `-danger`, `-success`, `-warning`, `-info`, `-border`, `-separator`, `-focus-ring`, `-link`, `-overlay`, `-media-bg`…), state layers (`--ui-state-hover/press`), typography, shape (`--ui-radius-*`), spacing (`--ui-space-1…8`), elevation (`--ui-shadow-*`), control sizes, motion, and layout (`--ui-sidebar-width`, `--ui-grid-min`…).
2. **Components** (`src/components.css`) read only tokens.
3. **Skins** (`src/skins/<id>.css`) override tokens under `:root[data-skin="<id>"]`, plus component tweaks scoped the same way where tokens are not enough (Apple's raised segmented thumb, Google's gradient jfk-buttons, Spectrum's masonry gallery…).
4. **Layout hints** (`Skin.layout`) let a skin move app controls without duplicating them: `search: "sidebar" | "header"`, `filters: "sidebar" | "header"` (sort/period beside the page title), `sidebarAction: boolean` (a primary "Create" button atop the sidebar). The app reads them via `useSkin().layout`.
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
| `Button` | `<button type=button>` | `variant` (`primary`/`secondary`/`quiet`/`danger`), `size` (`sm`/`md`), `pressed` → `aria-pressed`, `icon` |
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
| `Alert` | `role=alert` (error) / `status` (info) box | `tone` |
| `Spinner`, `EmptyState` | loading row; empty placeholder | `label`; `title`, `description`, `action`, `icon` |
| `Panel` | titled surface (`section`) | `heading`, `headingActions`, `variant` (`default`/`inset`) |
| `Text` | `p`/`span`/`div` | `tone`, `size`, `numeric` |
| `Icon` | stroke SVG (`--ui-icon-stroke`) | `name`, `label` |
| `SkinSwitcher` | native `<select>` of registered skins | select props |

## Overriding a component for one skin

`Skin.components` maps a component name (`ComponentOverrides`) to a replacement that receives exactly the original's props. Every exported component checks the active skin and renders the override if there is one. Example: use a third-party Material button for the `material` skin only.

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
registerSkin({ ...getSkin("material")!, components: { Button: MuiSkinButton } });
```

Replacements must forward `data-testid`, `aria-*` and event props to the element the user interacts with, and keep native controls native where the app relies on them (`<select>`, `<input type=file>`).

## Adding a skin

```ts
declare module "@memegen/ui" {
  interface CustomSkinIds {
    brand: true;
  }
}
registerSkin({ id: "brand", label: "Brand", layout: { search: "header" } });
```

Then add `skins/brand.css` with `:root[data-skin="brand"] { --ui-color-primary: …; }` (and component tweaks) and import it after `components.css`. Registered skins appear in `SkinSwitcher` automatically.
