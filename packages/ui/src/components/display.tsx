import { useEffect, useId, useRef, type ComponentPropsWithRef, type ReactNode } from "react";
import { cx, type LoosePolymorphicProps } from "../cx.ts";
import { skinnable, skinnablePolymorphic } from "../skin.tsx";
import { Icon } from "./Icon.tsx";

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

export const CardTitle = skinnablePolymorphic<"h3", CardTitleOwnProps>("CardTitle", CardTitleBase);

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
          <Icon name="close" />
        </button>
      )}
    </As>
  );
}

export const Chip = skinnablePolymorphic<"span", ChipOwnProps>("Chip", ChipBase);

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
  tone?: Extract<Tone, "danger" | "info">;
}

/** Inline message box. Danger messages are announced (`role="alert"`). */
function AlertBase({ tone = "info", className, ...rest }: AlertProps) {
  return <div role={tone === "danger" ? "alert" : "status"} className={cx("ui-alert", `ui-alert--${tone}`, className)} {...rest} />;
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
  /**
   * `inset`: a nested, lighter group inside another panel. `flush`: the panel surface with no padding or margin,
   * for boxes that lay out their own content (an editor stage, a timeline strip).
   */
  variant?: "default" | "inset" | "flush";
}

/** Surface for tool areas (editor panels, forms). Labelled by its heading when there is one. */
function PanelBase({ heading, headingActions, variant = "default", className, children, ...rest }: PanelProps) {
  const H = variant === "inset" ? "h4" : "h3";
  return (
    <section className={cx("ui-panel", variant !== "default" && `ui-panel--${variant}`, className)} {...rest}>
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

export interface DialogProps extends Omit<ComponentPropsWithRef<"dialog">, "open" | "ref"> {
  open: boolean;
  /** Escape, the close button, or a backdrop click. */
  onClose: () => void;
  heading?: ReactNode;
  /** Accessible name for the close button. */
  closeLabel?: string;
}

/**
 * Modal over the page: a native `<dialog>` opened with `showModal()`, so the page behind is inert, focus stays
 * inside, and Escape closes it. Labelled by its heading.
 */
function DialogBase({ open, onClose, heading, closeLabel = "Close", className, children, ...rest }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={cx("ui-dialog", className)}
      aria-labelledby={heading != null ? titleId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onCloseRef.current();
      }}
      onClick={(e) => {
        // Clicks on the dialog element itself (not its content) land on the backdrop.
        if (e.target === e.currentTarget) onCloseRef.current();
      }}
      {...rest}
    >
      <div className="ui-dialog-body">
        <div className="ui-dialog-head">
          {heading != null && (
            <h2 id={titleId} className="ui-dialog-title">
              {heading}
            </h2>
          )}
          <button type="button" className="ui-dialog-close" aria-label={closeLabel} onClick={() => onCloseRef.current()}>
            <Icon name="close" />
          </button>
        </div>
        {open && children}
      </div>
    </dialog>
  );
}

export const Dialog = skinnable("Dialog", DialogBase);

export interface TextProps extends ComponentPropsWithRef<"p"> {
  as?: "p" | "span" | "div";
  tone?: "default" | "muted" | "danger";
  size?: "sm" | "md";
  /** Tabular numerals. */
  numeric?: boolean;
}

function TextBase({ as = "p", tone = "default", size = "md", numeric, className, ...rest }: TextProps) {
  const As = as as "p";
  return (
    <As
      className={cx("ui-text", tone !== "default" && `ui-text--${tone}`, size === "sm" && "ui-text--sm", numeric && "ui-text--numeric", className)}
      {...rest}
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
