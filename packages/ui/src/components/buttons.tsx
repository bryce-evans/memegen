import type { ComponentPropsWithRef, ReactNode } from "react";
import { cx, type ControlSize, type LoosePolymorphicProps } from "../cx.ts";
import { skinnable, skinnablePolymorphic } from "../skin.tsx";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

interface ButtonLook {
  /** `primary`: the one main action; `secondary`: default; `quiet`: no chrome until hover; `danger`: destructive. */
  variant?: ButtonVariant;
  size?: ControlSize;
  /** Leading icon (decorative). */
  icon?: ReactNode;
}

const buttonClass = ({ variant = "secondary", size = "md" }: ButtonLook, ...extra: (string | false | undefined)[]) =>
  cx("ui-button", `ui-button--${variant}`, size === "sm" && "ui-button--sm", ...extra);

const iconSlot = (icon: ReactNode) =>
  icon ? (
    <span className="ui-button-icon" aria-hidden>
      {icon}
    </span>
  ) : null;

export interface ButtonProps extends ComponentPropsWithRef<"button">, ButtonLook {
  /** Toggle state; renders `aria-pressed`. */
  pressed?: boolean;
  /** Color of the pressed state (e.g. an upvote or a favorite), kept by every skin over its generic pressed look. */
  tone?: "warning" | "info";
}

function ButtonBase({ variant, size, icon, pressed, tone, className, type = "button", children, ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClass({ variant, size }, tone && `ui-button--tone-${tone}`, className)}
      {...rest}
      aria-pressed={pressed ?? rest["aria-pressed"]}
    >
      {iconSlot(icon)}
      {children}
    </button>
  );
}

export const Button = skinnable("Button", ButtonBase);

export interface IconButtonProps extends Omit<ButtonProps, "icon" | "aria-label"> {
  /** Accessible name (also the default tooltip). */
  label: string;
}

function IconButtonBase({ label, title, className, ...rest }: IconButtonProps) {
  return <ButtonBase {...rest} aria-label={label} title={title ?? label} className={cx("ui-icon-button", className)} />;
}

export const IconButton = skinnable("IconButton", IconButtonBase);

export type LinkButtonOwnProps = ButtonLook & { className?: string; children?: ReactNode };
export type LinkButtonProps = LoosePolymorphicProps<LinkButtonOwnProps>;

/** Button-looking link; pass `as={Link}` for router links. */
function LinkButtonBase({ as: As = "a", variant, size, icon, className, children, ...rest }: LinkButtonProps) {
  return (
    <As className={buttonClass({ variant, size }, className)} {...rest}>
      {iconSlot(icon)}
      {children}
    </As>
  );
}

export const LinkButton = skinnablePolymorphic<"a", LinkButtonOwnProps>("LinkButton", LinkButtonBase);

export interface FileButtonProps extends Omit<ComponentPropsWithRef<"input">, "type" | "size" | "children">, ButtonLook {
  /** Button text. */
  children: ReactNode;
}

/**
 * A button-styled `<label>` around a visually hidden `<input type="file">`. Every native prop (including
 * `data-testid`, `accept`, `disabled`, `onChange`) goes to the input; `className` styles the label.
 */
function FileButtonBase({ variant, size, icon, className, children, disabled, ...input }: FileButtonProps) {
  return (
    <label className={buttonClass({ variant, size }, "ui-file-button", disabled && "is-disabled", className)}>
      {iconSlot(icon)}
      {children}
      <input type="file" className="ui-visually-hidden" disabled={disabled} {...input} />
    </label>
  );
}

export const FileButton = skinnable("FileButton", FileButtonBase);

export interface SegmentedOption<V extends string = string> {
  value: V;
  label: ReactNode;
  /** Rendered as the option button's `data-testid`. */
  testId?: string;
  title?: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<V extends string = string>
  extends Omit<ComponentPropsWithRef<"div">, "onChange" | "defaultValue"> {
  options: readonly SegmentedOption<V>[];
  value: V;
  onChange: (value: V) => void;
  /** Names the group for assistive tech. */
  "aria-label": string;
  size?: ControlSize;
  orientation?: "horizontal" | "vertical";
}

/** One-of-many toggle row (`role="group"` of `aria-pressed` buttons). */
function SegmentedControlBase({
  options,
  value,
  onChange,
  size = "md",
  orientation = "horizontal",
  className,
  ...rest
}: SegmentedControlProps) {
  return (
    <div
      role="group"
      className={cx("ui-segmented", size === "sm" && "ui-segmented--sm", orientation === "vertical" && "ui-segmented--vertical", className)}
      {...rest}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="ui-segmented-option"
          aria-pressed={o.value === value}
          data-testid={o.testId}
          title={o.title}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const SegmentedControl = skinnable("SegmentedControl", SegmentedControlBase) as <V extends string>(
  props: SegmentedControlProps<V>,
) => ReactNode;
