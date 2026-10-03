import { SelectField, type SelectFieldProps } from "./fields.tsx";
import { skinnable, useSkin, type SkinId } from "../skin.tsx";

export interface SkinSwitcherProps extends Omit<SelectFieldProps, "value" | "defaultValue" | "onChange" | "children"> {}

/** Native `<select>` of every registered skin; changing it switches and persists the skin. */
function SkinSwitcherBase({ size = "sm", ...rest }: SkinSwitcherProps) {
  const { skin, setSkin, skins } = useSkin();
  return (
    <SelectField aria-label="Skin" {...rest} size={size} value={skin} onChange={(e) => setSkin(e.target.value as SkinId)}>
      {skins.map((s) => (
        <option key={s.id} value={s.id}>
          {s.label}
        </option>
      ))}
    </SelectField>
  );
}

export const SkinSwitcher = skinnable("SkinSwitcher", SkinSwitcherBase);
