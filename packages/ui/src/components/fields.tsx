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

type ControlAria = { id: string; "aria-describedby"?: string; "aria-invalid"?: true };
type LabelledProps = FieldLabelling & { id?: string; className?: string; "aria-describedby"?: string };
/** The control's own props: the field's props minus labelling, plus its id/ARIA wiring. */
type ControlProps<P> = Omit<P, keyof LabelledProps> & ControlAria;

/**
 * Takes a field's props, splits off label/description/error, and renders the control with its id and ARIA wiring.
 * With any labelling it wraps the control (`className` goes to the wrapper); otherwise the control gets `className`.
 */
function Labelled<P extends LabelledProps>({
  props,
  render,
}: {
  props: P;
  render: (control: ControlProps<P>, className: string | undefined) => ReactNode;
}) {
  const { label, description, error, className, id, ...rest } = props;
  const autoId = useId();
  const controlId = id ?? autoId;
  const control = { ...rest, id: controlId } as ControlProps<P>;
  if (label == null && description == null && error == null) return render(control, className);
  const descriptionId = description != null ? `${controlId}-description` : undefined;
  const errorId = error != null ? `${controlId}-error` : undefined;
  return (
    <div className={cx("ui-field", className)}>
      {label != null && (
        <label className="ui-field-label" htmlFor={controlId}>
          {label}
        </label>
      )}
      {render(
        {
          ...control,
          "aria-describedby": cx(props["aria-describedby"], descriptionId, errorId),
          "aria-invalid": error != null ? true : undefined,
        },
        undefined,
      )}
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

function TextFieldBase({ size = "md", ...props }: TextFieldProps) {
  return (
    <Labelled
      props={props}
      render={(input, className) => <input {...input} className={cx("ui-input", size === "sm" && "ui-input--sm", className)} />}
    />
  );
}

export const TextField = skinnable("TextField", TextFieldBase);

export interface TextAreaProps extends ComponentPropsWithRef<"textarea">, FieldLabelling {}

function TextAreaBase(props: TextAreaProps) {
  return <Labelled props={props} render={(textarea, className) => <textarea {...textarea} className={cx("ui-input", "ui-textarea", className)} />} />;
}

export const TextArea = skinnable("TextArea", TextAreaBase);

export interface SelectFieldProps extends Omit<ComponentPropsWithRef<"select">, "size">, FieldLabelling {
  size?: ControlSize;
}

/** Native `<select>` (so platform pickers and automation work) with a skinned frame and chevron. */
function SelectFieldBase({ size = "md", ...props }: SelectFieldProps) {
  return (
    <Labelled
      props={props}
      render={(select, className) => (
        <span className={cx("ui-select", size === "sm" && "ui-select--sm", className)}>
          <select {...select} className="ui-select-control" />
        </span>
      )}
    />
  );
}

export const SelectField = skinnable("SelectField", SelectFieldBase);

export interface SliderProps extends Omit<ComponentPropsWithRef<"input">, "type">, FieldLabelling {}

/** Native range input; exposes the filled fraction as `--ui-slider-fill` for the track. */
function SliderBase({ style, ...props }: SliderProps) {
  const min = Number(props.min ?? 0);
  const max = Number(props.max ?? 100);
  const value = Number(props.value ?? props.defaultValue ?? (min + max) / 2);
  const fill = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0;
  return (
    <Labelled
      props={props}
      render={(input, className) => (
        <input {...input} type="range" className={cx("ui-slider", className)} style={{ ...style, ["--ui-slider-fill" as string]: `${fill}%` }} />
      )}
    />
  );
}

export const Slider = skinnable("Slider", SliderBase);

export interface ColorFieldProps extends Omit<ComponentPropsWithRef<"input">, "type">, FieldLabelling {}

/** Native color input. */
function ColorFieldBase(props: ColorFieldProps) {
  return <Labelled props={props} render={(input, className) => <input {...input} type="color" className={cx("ui-color", className)} />} />;
}

export const ColorField = skinnable("ColorField", ColorFieldBase);
