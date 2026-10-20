import { useEffect, useRef, useState, type ComponentPropsWithRef, type ReactNode } from "react";
import { cx } from "../cx.ts";
import { skinnable } from "../skin.tsx";

/** Space between the anchor and its tooltip, and the least kept between the tooltip and the window's edges, in px. */
const GAP = 4;
const EDGE = 8;

export interface TooltipProps extends Omit<ComponentPropsWithRef<"span">, "content"> {
  /** What the tooltip says. */
  content: ReactNode;
  /** The tooltip's id, so the anchored element can point at it (`aria-describedby` / `aria-labelledby`). */
  tooltipId?: string;
}

/**
 * Hover (or keyboard focus) tooltip around `children`: shown at once (no native-title delay), on an opaque
 * `--ui-color-tooltip-bg` so it reads over photos. It opens as a manual popover in the top layer, so no clipping
 * ancestor (a card, a scroller) cuts it off: centered above the anchor, kept inside the window, below the anchor when
 * there's no room above, and following the anchor while the page scrolls.
 */
function TooltipBase({ content, tooltipId, className, children, ...rest }: TooltipProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  // One function for the component's life, so the scroll listener `show` adds is the one `hide` removes.
  const [place] = useState(() => () => {
    const a = anchor.current;
    const t = tip.current;
    if (!a || !t) return;
    const r = a.getBoundingClientRect();
    const left = Math.max(EDGE, Math.min(r.left + r.width / 2 - t.offsetWidth / 2, window.innerWidth - t.offsetWidth - EDGE));
    const above = r.top - GAP - t.offsetHeight;
    t.style.left = `${left}px`;
    t.style.top = `${above >= EDGE ? above : r.bottom + GAP}px`;
  });
  useEffect(() => () => window.removeEventListener("scroll", place, true), [place]);

  function show() {
    const t = tip.current;
    if (!t || t.matches(":popover-open")) return;
    t.showPopover();
    place();
    window.addEventListener("scroll", place, true);
  }

  function hide() {
    if (tip.current?.matches(":popover-open")) tip.current.hidePopover();
    window.removeEventListener("scroll", place, true);
  }

  return (
    <span
      ref={anchor}
      className={cx("ui-tooltip-anchor", className)}
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocus={show}
      onBlur={hide}
      {...rest}
    >
      {children}
      <span ref={tip} popover="manual" role="tooltip" id={tooltipId} className="ui-tooltip">
        {content}
      </span>
    </span>
  );
}

export const Tooltip = skinnable("Tooltip", TooltipBase);
