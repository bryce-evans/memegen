import type { Asset } from "@memegen/shared";
import { Field, SelectField } from "@memegen/ui";

export interface FontFieldProps {
  value: string | null;
  fonts: Asset[];
  onChange: (font: string | null) => void;
  /** What "no font asset" draws in (the top section's text is Arial). */
  fallbackLabel?: string;
}

/** Select a stored font or a built-in Arial system-font option. */
export function FontField({ value, fonts, onChange, fallbackLabel = "Sans-serif (fallback)" }: FontFieldProps) {
  return (
    <Field as="div" label="Font">
      <SelectField
        aria-label="Font"
        className="font-select"
        data-testid="layer-font"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">{fallbackLabel}</option>
        <option value="arial">Arial</option>
        <option value="arial-bold">Arial Bold</option>
        {fonts.filter((f) => !/^kalam(?:\s|$)/i.test(f.name) || f.id === value).map((f) => (
          <option key={f.id} value={f.id} data-testid="font-option" disabled={/^kalam(?:\s|$)/i.test(f.name)}>
            {f.name}
          </option>
        ))}
      </SelectField>
    </Field>
  );
}
