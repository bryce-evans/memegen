import { useId, type ComponentPropsWithRef, type CSSProperties, type ReactNode } from "react";
import { cx } from "../cx.ts";
import { skinnable } from "../skin.tsx";
import { Tooltip } from "./Tooltip.tsx";

/**
 * Stroke icons on a 24px grid; stroke width comes from `--ui-icon-stroke` so skins can go thin or chunky. Solid parts
 * carry `ui-icon-solid` (filled in the icon's paint, no stroke).
 */
const PATHS = {
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <circle cx="9" cy="10" r="1.75" />
      <path d="m20.5 16-5-5-9 8.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  chevron: <path d="m7 10 5 5 5-5" />,
  edit: <path d="M15.5 5.5l3 3M4.5 19.5l1-4L15.5 5.5l3 3-10 10z" />,
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.75" />
      <path d="M4.5 20c.8-3.6 3.8-5.5 7.5-5.5s6.7 1.9 7.5 5.5" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 5 5" />
    </>
  ),
  tag: (
    <>
      <path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1 1 0 0 1 0 1.4l-7.3 7.3a1 1 0 0 1-1.4 0z" />
      <circle cx="8" cy="8" r="1.25" />
    </>
  ),
  team: (
    <>
      <circle cx="9" cy="9" r="3" />
      <path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5" />
      <circle cx="16.5" cy="8" r="2.5" />
      <path d="M16 13.2c2.4 0 4 1.3 4.5 4" />
    </>
  ),
  flame: <path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.4 2.3-5.4 3.6-7.8.4 1.6 1.2 2.6 2.3 3.2C11.6 6.8 13 4.4 15.4 3c-.2 2.7.6 4.5 2 6.3 1 1.3 1.6 2.9 1.6 4.9C19 18.2 16.1 21 12 21z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  star: <path d="m12 3.8 2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.7l-5.1 2.7 1-5.6-4.1-4 5.7-.8z" />,
  chart: <path d="M4 19.5h16M6 15l4-5 3.5 3 5-6.5" />,
  upload: <path d="M12 15.5V4.5m-4.5 4.5L12 4.5 16.5 9M5 15.5v2.5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2.5" />,
  play: <path d="M8 5.5v13l10.5-6.5z" />,
  pause: <path d="M8.5 5.5v13M15.5 5.5v13" />,
  prev: <path d="M17.5 6v12L9 12zM6.5 6v12" />,
  next: <path d="M6.5 6v12L15 12zM17.5 6v12" />,
  close: <path d="M6.5 6.5l11 11m0-11-11 11" />,
  up: <path d="M12 19V5m-6 6 6-6 6 6" />,
  down: <path d="M12 5v14m-6-6 6 6 6-6" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  /** Two chain links: a link to share. */
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
    </>
  ),
  /** Curved double-headed arrow: swap two things' places. */
  swap: <path d="M4 16a8 8 0 0 1 16 0M1 13l3 3 3-3M17 13l3 3 3-3" />,
  sparkle: <path d="M12 3.5c.6 4.2 2.6 6.4 7 7.5-4.4 1.1-6.4 3.3-7 7.5-.6-4.2-2.6-6.4-7-7.5 4.4-1.1 6.4-3.3 7-7.5z" />,
  /** A solid square over the edge of another: several panels (a multi-panel template). */
  panels: (
    <>
      <rect className="ui-icon-solid" x="3" y="3" width="13.5" height="13.5" rx="3.25" />
      <path d="M20 8v8.25a4.25 4.25 0 0 1-4.25 4.25H8" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export interface IconProps extends Omit<ComponentPropsWithRef<"svg">, "children"> {
  name: IconName;
  /** Accessible name; omit for decorative icons (hidden from assistive tech). */
  label?: string;
  /**
   * Paint it in the brand gradient's warm end, orange to yellow (`--ui-color-special-end` →
   * `--ui-color-special-hover-end`), the same in every skin, instead of the current text color.
   */
  gradient?: boolean;
  /**
   * Hover tooltip, shown at once (no native-title delay) above the icon; also the accessible name when `label` is
   * omitted. The icon is then wrapped in a `Tooltip`.
   */
  tooltip?: string;
}

function IconBase({ name, label, gradient = false, tooltip, className, style, ...rest }: IconProps) {
  const id = useId();
  const gradientId = `ui-icon-gradient${id}`;
  const tooltipId = `ui-tooltip${id}`;
  const paint = gradient ? ({ "--ui-icon-paint": `url(#${gradientId})` } as CSSProperties) : undefined;
  const named = Boolean(label ?? tooltip);
  const svg = (
    <svg
      viewBox="0 0 24 24"
      className={cx("ui-icon", className)}
      style={paint ? { ...paint, ...style } : style}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={named ? "img" : undefined}
      aria-label={label}
      aria-labelledby={label === undefined && tooltip ? tooltipId : undefined}
      aria-hidden={named ? undefined : true}
      focusable="false"
      {...rest}
    >
      {gradient && (
        <defs>
          <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1="3" y1="21" x2="21" y2="3">
            <stop offset="0" style={{ stopColor: "var(--ui-color-special-end)" }} />
            <stop offset="1" style={{ stopColor: "var(--ui-color-special-hover-end)" }} />
          </linearGradient>
        </defs>
      )}
      {PATHS[name]}
    </svg>
  );
  if (!tooltip) return svg;
  return (
    <Tooltip content={tooltip} tooltipId={tooltipId}>
      {svg}
    </Tooltip>
  );
}

export const Icon = skinnable("Icon", IconBase);
