import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentPropsWithRef,
  type MouseEvent,
  type ReactNode,
} from "react";
import { cx, type LoosePolymorphicProps } from "../cx.ts";
import { skinnable, skinnablePolymorphic } from "../skin.tsx";
import { Button, IconButton, type ButtonProps } from "./buttons.tsx";
import { Icon } from "./Icon.tsx";

/** The narrow-screen breakpoint; `components.css` uses the same width. */
const NARROW_QUERY = "(max-width: 760px)";

function subscribeNarrow(onChange: () => void) {
  const query = window.matchMedia(NARROW_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Whether the window is at the narrow-screen breakpoint (≤ 760px), where the shell stacks into one column. */
export function useNarrowScreen(): boolean {
  return useSyncExternalStore(subscribeNarrow, () => window.matchMedia(NARROW_QUERY).matches);
}

/** Extra props for a dropdown's toggle button (e.g. `data-testid`). */
export type DropdownButtonProps = Omit<ButtonProps, "children" | "onClick" | "aria-expanded" | "aria-controls"> & {
  [key: `data-${string}`]: string | undefined;
};

export interface DropdownProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  /** The button's text, or with `icon` its accessible name (and tooltip). */
  label: string;
  /** Makes the button icon-only. */
  icon?: ReactNode;
  /** Panel edge lined up with the button's: `start` (default) or `end`. */
  align?: "start" | "end";
  buttonProps?: DropdownButtonProps;
  /** Panel content. */
  children?: ReactNode;
}

/**
 * A toggle button and the panel it drops down (a disclosure, not an ARIA menu). Clicking outside or pressing Escape
 * closes the panel, and so does choosing a link or button inside it.
 */
function DropdownBase({ label, icon, align = "start", buttonProps, className, children, ...rest }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  const toggle = {
    ...buttonProps,
    ref: buttonRef,
    "aria-expanded": open,
    "aria-controls": panelId,
    onClick: () => setOpen((o) => !o),
  };
  return (
    <div ref={rootRef} className={cx("ui-dropdown", className)} data-open={open || undefined} {...rest}>
      {icon ? (
        <IconButton {...toggle} label={label}>
          {icon}
        </IconButton>
      ) : (
        <Button {...toggle}>
          {label}
          <Icon name="chevron" className="ui-dropdown-chevron" />
        </Button>
      )}
      <div
        id={panelId}
        className="ui-dropdown-panel"
        data-align={align}
        onClick={(e: MouseEvent) => {
          if ((e.target as Element).closest("a[href], button")) setOpen(false);
        }}
      >
        {children}
      </div>
    </div>
  );
}

export const Dropdown = skinnable("Dropdown", DropdownBase);

export interface AppShellProps extends ComponentPropsWithRef<"div"> {
  header?: ReactNode;
  /** Side column (usually a `Sidebar`); a row above the main area on narrow screens. */
  sidebar?: ReactNode;
}

/** Page frame: header on top, then side column + `<main>`. */
function AppShellBase({ header, sidebar, className, children, ...rest }: AppShellProps) {
  return (
    <div className={cx("ui-app", className)} {...rest}>
      {header}
      <div className={cx("ui-shell", !sidebar && "ui-shell--no-sidebar")}>
        {sidebar}
        <main className="ui-main">{children}</main>
      </div>
    </div>
  );
}

export const AppShell = skinnable("AppShell", AppShellBase);

export interface HeaderProps extends ComponentPropsWithRef<"header"> {
  /** Left: logo/wordmark link; on narrow screens a wordmark shows its first letter only. */
  brand?: ReactNode;
  /** Middle: usually a search field; grows to fill. */
  center?: ReactNode;
  /** Accessible name of the narrow-screen button that drops down the actions (`children`). */
  accountLabel?: string;
  accountButtonProps?: DropdownButtonProps;
}

/**
 * Publishes the brand's wordmark width in ems (`--ui-wordmark-em-w`) on the brand slot, so CSS can shrink it to fit
 * the slot. The ratio holds at any font size, so it is re-measured only when the wordmark's box changes for another
 * reason (web font load, skin switch).
 */
function useWordmarkShape(brand: ReactNode) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const slot = ref.current;
    const mark = slot?.querySelector<HTMLElement>(".ui-wordmark");
    if (!slot || !mark) return;
    const measure = () => {
      const em = parseFloat(getComputedStyle(mark).fontSize);
      if (!em) return;
      const w = (mark.offsetWidth / em).toFixed(3);
      if (slot.style.getPropertyValue("--ui-wordmark-em-w") !== w) slot.style.setProperty("--ui-wordmark-em-w", w);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(mark);
    return () => observer.disconnect();
  }, [brand]);
  return ref;
}

/** Sticky top bar; `children` go to the right-hand actions area (on narrow screens, an account dropdown). */
function HeaderBase({ brand, center, accountLabel = "Account", accountButtonProps, className, children, ...rest }: HeaderProps) {
  const brandRef = useWordmarkShape(brand);
  const narrow = useNarrowScreen();
  return (
    <header className={cx("ui-header", className)} {...rest}>
      {brand != null && (
        <div ref={brandRef} className="ui-header-brand">
          {brand}
        </div>
      )}
      {center != null && <div className="ui-header-center">{center}</div>}
      {narrow ? (
        <Dropdown
          className="ui-header-account"
          label={accountLabel}
          icon={<Icon name="user" />}
          align="end"
          buttonProps={{ variant: "quiet", ...accountButtonProps }}
        >
          {children}
        </Dropdown>
      ) : (
        <div className="ui-header-actions">{children}</div>
      )}
    </header>
  );
}

export const Header = skinnable("Header", HeaderBase);

export interface SidebarProps extends ComponentPropsWithRef<"aside"> {}

function SidebarBase({ className, ...rest }: SidebarProps) {
  return <aside className={cx("ui-sidebar", className)} {...rest} />;
}

export const Sidebar = skinnable("Sidebar", SidebarBase);

export interface SidebarSectionProps extends Omit<ComponentPropsWithRef<"div">, "title"> {
  /** Small section heading. */
  heading?: ReactNode;
  /** `nav` for link lists (give it an `aria-label`). */
  as?: "div" | "nav" | "section";
}

function SidebarSectionBase({ as: As = "div", heading, className, children, ...rest }: SidebarSectionProps) {
  return (
    <As className={cx("ui-sidebar-section", className)} {...rest}>
      {heading != null && <h4 className="ui-sidebar-heading">{heading}</h4>}
      {children}
    </As>
  );
}

export const SidebarSection = skinnable("SidebarSection", SidebarSectionBase);

export interface NavListProps extends ComponentPropsWithRef<"div"> {}

/** Vertical list of `NavItem`s (wraps into a row on narrow screens). */
function NavListBase({ className, ...rest }: NavListProps) {
  return <div className={cx("ui-nav-list", className)} {...rest} />;
}

export const NavList = skinnable("NavList", NavListBase);

export type NavItemOwnProps = {
  /** Highlights the item. Router `NavLink`s mark themselves (`aria-current="page"`), so leave this unset for them. */
  active?: boolean;
  /** Leading icon. */
  icon?: ReactNode;
  /** Trailing content, e.g. a count. */
  trailing?: ReactNode;
  className?: string;
  children?: ReactNode;
};
export type NavItemProps = LoosePolymorphicProps<NavItemOwnProps>;

/** Side-nav entry; `as={NavLink}` / `as={Link}` / `as="button"` (default `a`). */
function NavItemBase({ as: As = "a", active, icon, trailing, className, children, ...rest }: NavItemProps) {
  return (
    <As className={cx("ui-nav-item", active && "is-active", className)} aria-current={active ? "page" : undefined} {...rest}>
      {icon != null && (
        <span className="ui-nav-item-icon" aria-hidden>
          {icon}
        </span>
      )}
      <span className="ui-nav-item-label">{children}</span>
      {trailing != null && <span className="ui-nav-item-trailing">{trailing}</span>}
    </As>
  );
}

export const NavItem = skinnablePolymorphic<"a", NavItemOwnProps>("NavItem", NavItemBase);

export interface PageHeaderProps extends Omit<ComponentPropsWithRef<"div">, "title"> {
  title: ReactNode;
  /** Heading level; 1 for page titles (default), 2 for sections. */
  level?: 1 | 2;
  /** Controls shown beside the title (view toggles, actions). */
  actions?: ReactNode;
  /** Forwarded to the heading element (e.g. `{ "data-testid": "page-title" }`). */
  titleProps?: ComponentPropsWithRef<"h1"> & { [data: `data-${string}`]: string | undefined };
}

function PageHeaderBase({ title, level = 1, actions, titleProps, className, ...rest }: PageHeaderProps) {
  const H = level === 1 ? "h1" : "h2";
  return (
    <div className={cx("ui-page-header", `ui-page-header--${level === 1 ? "page" : "section"}`, className)} {...rest}>
      <H {...titleProps} className={cx("ui-page-title", titleProps?.className)}>
        {title}
      </H>
      {actions != null && <div className="ui-page-header-actions">{actions}</div>}
    </div>
  );
}

export const PageHeader = skinnable("PageHeader", PageHeaderBase);

type Gap = "none" | "xs" | "sm" | "md" | "lg" | "xl";

export interface StackProps extends ComponentPropsWithRef<"div"> {
  gap?: Gap;
  align?: "start" | "center" | "end" | "stretch";
}

/** Vertical flex column. */
function StackBase({ gap = "md", align = "stretch", className, ...rest }: StackProps) {
  return <div className={cx("ui-stack", className)} data-gap={gap} data-align={align} {...rest} />;
}

export const Stack = skinnable("Stack", StackBase);

export interface InlineProps extends ComponentPropsWithRef<"div"> {
  gap?: Gap;
  align?: "start" | "center" | "end" | "baseline" | "stretch";
  justify?: "start" | "center" | "end" | "between";
  /** Defaults to wrapping. */
  wrap?: boolean;
}

/** Horizontal flex row. */
function InlineBase({ gap = "sm", align = "center", justify = "start", wrap = true, className, ...rest }: InlineProps) {
  return (
    <div
      className={cx("ui-inline", !wrap && "ui-inline--nowrap", className)}
      data-gap={gap}
      data-align={align}
      data-justify={justify}
      {...rest}
    />
  );
}

export const Inline = skinnable("Inline", InlineBase);
