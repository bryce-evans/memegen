import { FONT_ACCEPT, type Asset } from "@memegen/shared";
import { Field, FileButton, Icon, Inline, SelectField } from "@memegen/ui";
import { uploadAsset } from "../../api.ts";
import { useAuth } from "../../auth.tsx";
import { useAction } from "../../useAction.ts";
import { ErrorView } from "../common.tsx";

export interface FontFieldProps {
  value: string | null;
  fonts: Asset[];
  onChange: (fontAssetId: string | null) => void;
  /** A signed-in user uploaded a font for this layer. */
  onUploaded: (font: Asset) => void;
}

/** Font picker plus upload (signed-in users). */
export function FontField({ value, fonts, onChange, onUploaded }: FontFieldProps) {
  const { user } = useAuth();
  const upload = useAction();

  async function uploadFont(file: File) {
    const font = await upload.run(async () => {
      const asset = await uploadAsset(file, file.name, file.name.replace(/\.[^.]+$/, ""));
      if (asset.kind !== "font") throw new Error(`${file.name} is not a font (detected ${asset.kind})`);
      return asset;
    });
    if (font) onUploaded(font);
  }

  return (
    <>
      <Field as="div" label="Font">
        <Inline wrap={false}>
          <SelectField
            aria-label="Font"
            className="font-select"
            data-testid="layer-font"
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value || null)}
          >
            <option value="">Sans-serif (fallback)</option>
            {fonts.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </SelectField>
          {user && (
            <FileButton
              icon={<Icon name="upload" />}
              data-testid="font-upload"
              accept={FONT_ACCEPT}
              disabled={upload.busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void uploadFont(file);
              }}
            >
              {upload.busy ? "Uploading…" : "Upload font"}
            </FileButton>
          )}
        </Inline>
      </Field>
      {upload.error !== null && <ErrorView error={upload.error} testId="editor-error" />}
    </>
  );
}
