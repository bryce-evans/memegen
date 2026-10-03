import { useId, type ComponentPropsWithRef, type ReactNode } from "react";
import { cx, type ControlSize } from "../cx.ts";
import { skinnable } from "../skin.tsx";

/** Label/description/error shared by every labelled control. */
export interface FieldLabelling {
  label?: ReactNode;
  /** Help text under the control (linked via `aria-describedby`). */
  description?: ReactNode;
  /** Error text under the control; also sets `aria-invalid`. */
  error?: ReactNode;
}

export interface FieldProps extends Omit<ComponentPropsWithRef<"label">, "children">, FieldLabelling {
  /** `label` (default) makes the whole field focus its control on click; use `div` for groups of several controls. */
  as?: "label" | "div";
  children: ReactNode;
}

/** Label wrapper for any control(s): the label text above `children`. */
function FieldBase({ as = "label", label, description, error, className, children, ...rest }: FieldProps) {
  const As = as as "label";
  return (
    <As className={cx("ui-field", className)} {...rest}>
      {label != null && <span className="ui-field-label">{label}</span>}
      {children}
      {description != null && <span className="ui-field-description">{description}</span>}
      {error != null && <span className="ui-field-error">{error}</span>}
    </As>
  );
}

export const Field = skinnable("Field", FieldBase);

/**
 * Wraps a single control in label/description/error when any is given (`className` then goes to the wrapper);
 * otherwise renders the bare control (`className` on the control).
 */
function Labelled({
  id,
  labelling,
  className,
  render,
}: {
  id: string | undefined;
  labelling: FieldLabelling & { "aria-describedby"?: string };
  className: string | undefined;
  render: (aria: { id: string; className: string | undefined; "aria-describedby"?: string; "aria-invalid"?: true }) => ReactNode;
}) {
  const autoId = useId();
  const controlId = id ?? autoId;
  const { label, description, error } = labelling;
  if (label == null && description == null && error == null) {
    return render({ id: controlId, className, "aria-describedby": labelling["aria-describedby"] });
  }
  const descriptionId = description != null ? `${controlId}-description` : undefined;
  const errorId = error != null ? `${controlId}-error` : undefined;
  return (
    <div className={cx("ui-field", className)}>
      {label != null && (
        <label className="ui-field-label" htmlFor={controlId}>
          {label}
        </label>
      )}
      {render({
        id: controlId,
        className: undefined,
        "aria-describedby": cx(labelling["aria-describedby"], descriptionId, errorId),
        "aria-invalid": error != null ? true : undefined,
      })}
      {description != null && (
        <span id={descriptionId} className="ui-field-description">
          {description}
        </span>
      )}
      {error != null && (
        <span id={errorId} className="ui-field-error">
          {error}
        </span>
      )}
    </div>
  );
}

export interface TextFieldProps extends Omit<ComponentPropsWithRef<"input">, "size">, FieldLabelling {
  size?: ControlSize;
}

function TextFieldBase({ label, description, error, size = "md", className, id, ...input }: TextFieldProps) {
  return (
    <Labelled
      id={id}
      labelling={{ label, description, error, "aria-describedby": input["aria-describedby"] }}
      className={className}
      render={({ className: controlClass, ...aria }) => (
        <input {...input} {...aria} className={cx("ui-input", size === "sm" && "ui-input--sm", controlClass)} />
      )}
    />
  );
}

export const TextField = skinnable("TextField", TextFieldBase);

export interface TextAreaProps extends ComponentPropsWithRef<"textarea">, FieldLabelling {}

function TextAreaBase({ label, description, error, className, id, ...textarea }: TextAreaProps) {
  return (
    <Labelled
      id={id}
      labelling={{ label, description, error, "aria-describedby": textarea["aria-describedby"] }}
      className={className}
      render={({ className: controlClass, ...aria }) => (
        <textarea {...textarea} {...aria} className={cx("ui-input", "ui-textarea", controlClass)} />
      )}
    />
  );
}

export const TextArea = skinnable("TextArea", TextAreaBase);

export interface SelectFieldProps extends Omit<ComponentPropsWithRef<"select">, "size">, FieldLabelling {
  size?: ControlSize;
}

/** Native `<select>` (so platform pickers and automation work) with a skinned frame and chevron. */
function SelectFieldBase({ label, description, error, size = "md", className, id, ...select }: SelectFieldProps) {
  return (
    <Labelled
      id={id}
      labelling={{ label, description, error, "aria-describedby": select["aria-describedby"] }}
      className={className}
      render={({ className: controlClass, ...aria }) => (
        <span className={cx("ui-select", size === "sm" && "ui-select--sm", controlClass)}>
          <select {...select} {...aria} className="ui-select-control" />
        </span>
      )}
    />
  );
}

export const SelectField = skinnable("SelectField", SelectFieldBase);

export interface SliderProps extends Omit<ComponentPropsWithRef<"input">, "type">, FieldLabelling {}

/** Native range input; exposes the filled fraction as `--ui-slider-fill` for the track. */
function SliderBase({ label, description, error, className, id, style, ...input }: SliderProps) {
  const min = Number(input.min ?? 0);
  const max = Number(input.max ?? 100);
  const value = Number(input.value ?? input.defaultValue ?? (min + max) / 2);
  const fill = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0;
  return (
    <Labelled
      id={id}
      labelling={{ label, description, error, "aria-describedby": input["aria-describedby"] }}
      className={className}
      render={({ className: controlClass, ...aria }) => (
        <input
          {...input}
          {...aria}
          type="range"
          className={cx("ui-slider", controlClass)}
          style={{ ...style, ["--ui-slider-fill" as string]: `${fill}%` }}
        />
      )}
    />
  );
}

export const Slider = skinnable("Slider", SliderBase);

export interface ColorFieldProps extends Omit<ComponentPropsWithRef<"input">, "type">, FieldLabelling {}

/** Native color input. */
function ColorFieldBase({ label, description, error, className, id, ...input }: ColorFieldProps) {
  return (
    <Labelled
      id={id}
      labelling={{ label, description, error, "aria-describedby": input["aria-describedby"] }}
      className={className}
      render={({ className: controlClass, ...aria }) => (
        <input {...input} {...aria} type="color" className={cx("ui-color", controlClass)} />
      )}
    />
  );
}

export const ColorField = skinnable("ColorField", ColorFieldBase);
