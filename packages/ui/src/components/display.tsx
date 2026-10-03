import type { ComponentPropsWithRef, ElementType, HTMLAttributes, ReactNode, Ref } from "react";
import { cx, type LoosePolymorphicProps, type PolymorphicProps } from "../cx.ts";
import { skinnable } from "../skin.tsx";

export interface CardProps extends ComponentPropsWithRef<"article"> {
  /** Media slot (image/video, usually wrapped in a link); fills the card width. */
  media?: ReactNode;
  /** Action row under the body. */
  actions?: ReactNode;
  /** No surface or border: media on the page background, text underneath (gallery tiles). */
  borderless?: boolean;
}

function CardBase({ media, actions, borderless, className, children, ...rest }: CardProps) {
  return (
    <article className={cx("ui-card", borderless && "ui-card--borderless", className)} {...rest}>
      {media != null && <div className="ui-card-media">{media}</div>}
      <div className="ui-card-body">
        {children}
        {actions != null && <div className="ui-card-actions">{actions}</div>}
      </div>
    </article>
  );
}

export const Card = skinnable("Card", CardBase);

export type CardTitleOwnProps = { className?: string; children?: ReactNode };
export type CardTitleProps = LoosePolymorphicProps<CardTitleOwnProps>;

/** One-line, ellipsized card title; `as={Link}` or `as="button"` to make it interactive (default `h3`). */
function CardTitleBase({ as: As = "h3", className, ...rest }: CardTitleProps) {
  return <As className={cx("ui-card-title", className)} {...rest} />;
}

export const CardTitle = skinnable("CardTitle", CardTitleBase) as <C extends ElementType = "h3">(
  props: PolymorphicProps<C, CardTitleOwnProps>,
) => ReactNode;

export interface CardMetaProps extends ComponentPropsWithRef<"div"> {}

/** Small secondary line (author, time, counts). */
function CardMetaBase({ className, ...rest }: CardMetaProps) {
  return <div className={cx("ui-card-meta", className)} {...rest} />;
}

export const CardMeta = skinnable("CardMeta", CardMetaBase);

export interface MediaGridProps extends ComponentPropsWithRef<"div"> {}

/** Responsive grid of cards; skins pick density (and may lay it out as masonry columns). */
function MediaGridBase({ className, ...rest }: MediaGridProps) {
  return <div className={cx("ui-media-grid", className)} {...rest} />;
}

export const MediaGrid = skinnable("MediaGrid", MediaGridBase);

export type ChipOwnProps = {
  /** `suggest`: a dashed "add this" chip. */
  variant?: "default" | "suggest";
  /** Renders a remove button inside the chip. */
  onRemove?: () => void;
  /** Accessible name of the remove button. */
  removeLabel?: string;
  removeDisabled?: boolean;
  className?: string;
  children?: ReactNode;
};
export type ChipProps = LoosePolymorphicProps<ChipOwnProps>;

/** Compact tag; `as={Link}` makes it a link, `as="button"` an action (default `span`). */
function ChipBase({ as: As = "span", variant = "default", onRemove, removeLabel = "Remove", removeDisabled, className, children, ...rest }: ChipProps) {
  return (
    <As className={cx("ui-chip", variant === "suggest" && "ui-chip--suggest", onRemove && "ui-chip--removable", className)} {...rest}>
      {children}
      {onRemove && (
        <button type="button" className="ui-chip-remove" aria-label={removeLabel} disabled={removeDisabled} onClick={onRemove}>
          <svg viewBox="0 0 16 16" aria-hidden focusable="false">
            <path d="m4.5 4.5 7 7m0-7-7 7" />
          </svg>
        </button>
      )}
    </As>
  );
}

export const Chip = skinnable("Chip", ChipBase) as <C extends ElementType = "span">(props: PolymorphicProps<C, ChipOwnProps>) => ReactNode;

export interface ChipGroupProps extends ComponentPropsWithRef<"div"> {}

function ChipGroupBase({ className, ...rest }: ChipGroupProps) {
  return <div className={cx("ui-chip-group", className)} {...rest} />;
}

export const ChipGroup = skinnable("ChipGroup", ChipGroupBase);

export type Tone = "neutral" | "primary" | "info" | "success" | "warning" | "danger";

export interface BadgeProps extends ComponentPropsWithRef<"span"> {
  tone?: Tone;
}

function BadgeBase({ tone = "neutral", className, ...rest }: BadgeProps) {
  return <span className={cx("ui-badge", `ui-badge--${tone}`, className)} {...rest} />;
}

export const Badge = skinnable("Badge", BadgeBase);

export interface ProgressBarProps extends Omit<ComponentPropsWithRef<"progress">, "value" | "max"> {
  /** 0..1; `null` for indeterminate. */
  value: number | null;
}

function ProgressBarBase({ value, className, ...rest }: ProgressBarProps) {
  return <progress className={cx("ui-progress", className)} max={1} value={value ?? undefined} {...rest} />;
}

export const ProgressBar = skinnable("ProgressBar", ProgressBarBase);

export interface AlertProps extends ComponentPropsWithRef<"div"> {
  tone?: "error" | "info";
}

/** Inline message box. Errors are announced (`role="alert"`). */
function AlertBase({ tone = "info", className, ...rest }: AlertProps) {
  return <div role={tone === "error" ? "alert" : "status"} className={cx("ui-alert", `ui-alert--${tone}`, className)} {...rest} />;
}

export const Alert = skinnable("Alert", AlertBase);

export interface SpinnerProps extends ComponentPropsWithRef<"span"> {
  /** Visible text next to the spinner; without it the spinner is labelled "Loading". */
  label?: ReactNode;
}

function SpinnerBase({ label, className, ...rest }: SpinnerProps) {
  return (
    <span role="status" className={cx("ui-spinner", className)} aria-label={label == null ? "Loading" : undefined} {...rest}>
      <span className="ui-spinner-icon" aria-hidden />
      {label != null && <span className="ui-spinner-label">{label}</span>}
    </span>
  );
}

export const Spinner = skinnable("Spinner", SpinnerBase);

export interface EmptyStateProps extends Omit<ComponentPropsWithRef<"div">, "title"> {
  title: ReactNode;
  description?: ReactNode;
  /** Optional call to action. */
  action?: ReactNode;
  icon?: ReactNode;
}

function EmptyStateBase({ title, description, action, icon, className, ...rest }: EmptyStateProps) {
  return (
    <div className={cx("ui-empty", className)} {...rest}>
      {icon != null && (
        <span className="ui-empty-icon" aria-hidden>
          {icon}
        </span>
      )}
      <p className="ui-empty-title">{title}</p>
      {description != null && <p className="ui-empty-description">{description}</p>}
      {action}
    </div>
  );
}

export const EmptyState = skinnable("EmptyState", EmptyStateBase);

export interface PanelProps extends ComponentPropsWithRef<"section"> {
  heading?: ReactNode;
  /** Controls at the right of the heading. */
  headingActions?: ReactNode;
  /** `inset`: a nested, lighter group inside another panel. */
  variant?: "default" | "inset";
}

/** Surface for tool areas (editor panels, forms). Labelled by its heading when there is one. */
function PanelBase({ heading, headingActions, variant = "default", className, children, ...rest }: PanelProps) {
  const H = variant === "inset" ? "h4" : "h3";
  return (
    <section className={cx("ui-panel", variant === "inset" && "ui-panel--inset", className)} {...rest}>
      {(heading != null || headingActions != null) && (
        <div className="ui-panel-head">
          {heading != null && <H className="ui-panel-title">{heading}</H>}
          {headingActions}
        </div>
      )}
      {children}
    </section>
  );
}

export const Panel = skinnable("Panel", PanelBase);

export interface TextProps extends HTMLAttributes<HTMLElement> {
  as?: "p" | "span" | "div";
  tone?: "default" | "muted" | "danger";
  size?: "sm" | "md";
  /** Tabular numerals. */
  numeric?: boolean;
  ref?: Ref<HTMLElement>;
}

function TextBase({ as: As = "p", tone = "default", size = "md", numeric, className, ...rest }: TextProps) {
  return (
    <As
      className={cx("ui-text", tone !== "default" && `ui-text--${tone}`, size === "sm" && "ui-text--sm", numeric && "ui-text--numeric", className)}
      {...(rest as HTMLAttributes<HTMLDivElement>)}
    />
  );
}

export const Text = skinnable("Text", TextBase);

export interface WordmarkProps extends Omit<ComponentPropsWithRef<"span">, "children"> {
  /** Product name; each letter is its own element so skins can color them individually. */
  text: string;
}

function WordmarkBase({ text, className, ...rest }: WordmarkProps) {
  return (
    <span className={cx("ui-wordmark", className)} aria-label={text} role="img" {...rest}>
      {[...text].map((ch, i) => (
        <span key={i} className="ui-wordmark-letter" aria-hidden>
          {ch}
        </span>
      ))}
    </span>
  );
}

export const Wordmark = skinnable("Wordmark", WordmarkBase);
