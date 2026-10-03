import type { ComponentPropsWithRef, ElementType, ReactNode } from "react";
import { cx, type LoosePolymorphicProps, type PolymorphicProps } from "../cx.ts";
import { skinnable } from "../skin.tsx";

export interface AppShellProps extends ComponentPropsWithRef<"div"> {
  header?: ReactNode;
  /** Side column (usually a `Sidebar`); stacks above the main area on narrow screens. */
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
  /** Left: logo/wordmark link. */
  brand?: ReactNode;
  /** Middle: usually a search field; grows to fill. */
  center?: ReactNode;
}

/** Sticky top bar; `children` go to the right-hand actions area. */
function HeaderBase({ brand, center, className, children, ...rest }: HeaderProps) {
  return (
    <header className={cx("ui-header", className)} {...rest}>
      {brand != null && <div className="ui-header-brand">{brand}</div>}
      {center != null && <div className="ui-header-center">{center}</div>}
      <div className="ui-header-actions">{children}</div>
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

export const NavItem = skinnable("NavItem", NavItemBase) as <C extends ElementType = "a">(
  props: PolymorphicProps<C, NavItemOwnProps>,
) => ReactNode;

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
