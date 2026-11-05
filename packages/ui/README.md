# @memegen/ui

Skinnable React components and design tokens for the memegen web app. One component API, three looks:

| id | Looks like |
|---|---|
| `painted` | Default: Spectrum 2 light over a watercolor wash, translucent surfaces, painted-ink wordmark, and colorful gradient standout actions |
| `basic` | The original dark, yellow-accent UI |
| `google` | Material-inspired Google palette: flat blue actions, neutral surfaces, rounded controls, four-color sans-serif wordmark, and red Create action |

Basic is dark; Google is light only. Painted is light with a dark variant (`Skin.dark`): `spectrum--dark`, a flat #282828 page with a faint wash, and a darker wordmark swatch behind brighter letters.

Painted dark-mode downvotes use `#4c73ff`, including votes over image scrims, to stay legible against dark surfaces.

Painted puts Spectrum's token classes (`spectrum spectrum--light spectrum--medium`, or `spectrum--dark` in dark mode) on `<html>` through `Skin.rootClassName`. Its shared Spectrum-based rules live in `painted-base.css`; `painted.css` adds the wash and wordmark. Spectrum is not a separate skin. The font stack prefers Adobe Clean (licensed, never bundled) and falls back to bundled Source Sans 3 (OFL). The wordmark prefers locally installed Radlush Extra Bold (commercial, never bundled) and falls back to bundled Archivo at 900 (OFL).

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

`SkinProvider` picks the skin from `?skin=<id>`, then `localStorage["memegen.skin"]`, then `fallback` (`"painted"`); it persists changes and sets `data-skin` on `<html>`. Removed or unknown IDs fall back to Painted. Pass `locked="<id>"` to ignore URL/storage choices and disable switching (production is locked to Painted). `useSkin()` returns `{ skin, setSkin, skins, definition, layout, dark, hasDark, setDark }`. Dark mode starts off; the app owns its persistence. `setDark(true)` applies the skin's dark variant when available, setting `data-theme="dark"` and using `Skin.dark.rootClassName`.

## How skins work

1. **Tokens.** `src/tokens.css` defines Basic's base palette and shared typography, spacing, shapes, elevation, controls, motion, and layout on `:root`; skins override these properties. Components and app styles consume tokens rather than hard-coded values. Tooltip colors remain opaque over media; badge-tier colors are shared across skins. Shell padding, column gaps, main padding, wordmark size, and search radius are tokens too, keeping header and content columns aligned.
2. **Components** (`src/components.css`) read only tokens.
3. **Skins** override tokens under `:root[data-skin="<id>"]`, with scoped component tweaks where tokens are insufficient. They style only `.ui-*`; feature-specific skin rules belong in the app. Shared buttons read `--ui-button-bg`, `-fg`, `-border`, `-hover-bg`, and `-hover-border`. `special` also receives primary styling, with a gradient override only in Painted.
4. **Layout hints** (`Skin.layout`) place filters in `"sidebar"` or `"header"`. Web defaults meme cards to below-image details for Google and hover details otherwise; an explicit per-user layout preference wins. Google votes are gray outlines, filled gray when selected, without colored pills. Its below-image mobile feed uses full-width cards so captions and votes remain visible.
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
| `Button` | `<button type=button>` | `variant` (`primary`/`special`/`secondary`/`quiet`/`danger`; `special` uses Painted's brand gradient and normal primary styling elsewhere; Painted's hover slides the gradient toward red/orange/yellow), `size` (`sm`/`md`), `pressed` → `aria-pressed`, `tone` (`warning`/`info`: pressed color and filled icon) |
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
| `LineChart` | responsive SVG count plots with a shared scale, labeled series, and expandable daily values | `label`, `axisLabel`, `series[{key,label}]`, `data[{label,values}]`; null values are gaps, not zeros; date labels are displayed verbatim |
| `Spinner`, `EmptyState` | loading row; empty placeholder | `label`; `title`, `description`, `action`, `icon` |
| `Panel` | titled surface (`section`) | `heading`, `headingActions`, `variant` (`default`/`inset`/`flush`: the surface only, no padding or margin) |
| `Dialog` | modal native `<dialog>` (`showModal`: inert page, focus kept inside, Escape closes) | `open`, `onClose` (Escape, close button, backdrop), `heading`, `closeLabel` |
| `Text` | `p`/`span`/`div` | `tone`, `size`, `numeric` |
| `Icon` | stroke SVG (`--ui-icon-stroke`; solid parts `ui-icon-solid`) | `name`, `label`, `tooltip` (a `Tooltip` around the icon; the accessible name when there's no `label`), `gradient` (orange → yellow, `--ui-color-special-end` → `--ui-color-special-hover-end`, the same in every skin) |
| `Tooltip` | `<span>` around its children plus a `role=tooltip` manual popover in the top layer, shown at once on hover or focus: centered above (below when there's no room), kept inside the window, following the anchor on scroll, never clipped by a card or scroller | `content`, `tooltipId` (for the anchored element's `aria-describedby`/`aria-labelledby`) |
| `SkinSwitcher` | native `<select>` of registered skins | select props |

`useNarrowScreen()` is true at the narrow-screen breakpoint (≤ 760px, the same width as the CSS), for apps that render different content there.

## Overriding a component for one skin

`Skin.components` maps a component name (`ComponentOverrides`) to a replacement receiving the original props. Every exported component checks the active skin for an override. Example: use a third-party Material button for Google.

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
registerSkin({ ...getSkin("google")!, components: { Button: MuiSkinButton } });
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
