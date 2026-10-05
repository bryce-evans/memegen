import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Asset, TextLayer } from "@memegen/shared";
import { Button, Dialog, Inline, Panel, Text, TextField } from "@memegen/ui";
import { createTemplate } from "../../api.ts";
import { plural } from "../../format.ts";
import { useAction } from "../../useAction.ts";
import { ErrorView } from "../common.tsx";
import { TagField } from "../tagInputs.tsx";

/** "distracted-boyfriend_v2.jpg" → "distracted boyfriend v2". */
function nameFromFile(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim()
    .slice(0, 120);
}

/**
 * Template Editor's side panel: name and base tags for the uploaded media. Saving asks "Add new template?" first;
 * the placed text boxes (with their placeholder text) become the template's default layers.
 */
export function TemplateSavePanel({ asset, layers }: { asset: Asset; layers: TextLayer[] }) {
  const navigate = useNavigate();
  const [name, setName] = useState(() => nameFromFile(asset.filename));
  const [tags, setTags] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const { busy, error, run } = useAction();

  async function create() {
    const template = await run(() => createTemplate({ name: name.trim(), assetId: asset.id, defaultLayers: layers, tags }));
    if (template) navigate(`/create?template=${template.id}`);
    else setConfirming(false);
  }

  const boxes = plural(layers.length, "text box", "text boxes");
  return (
    <Panel heading="Save template" className="save-panel">
      <TextField
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        maxLength={120}
        disabled={busy}
        data-testid="template-name"
      />
      <TagField
        value={tags}
        onChange={setTags}
        testId="template-tags"
        description="Base tags always stay on the template; others can add more."
        disabled={busy}
        allowCreate
      />
      <Text size="sm" tone="muted">
        The {boxes} and their placeholder text become the template's defaults.
      </Text>
      <Inline className="save-actions">
        <Button variant="primary" disabled={busy || !name.trim()} onClick={() => setConfirming(true)} data-testid="template-save">
          Save template
        </Button>
      </Inline>
      {error !== null && <ErrorView error={error} />}
      <Dialog
        open={confirming}
        onClose={busy ? () => undefined : () => setConfirming(false)}
        heading="Add new template?"
        data-testid="template-confirm-dialog"
      >
        <Text>
          “{name.trim()}” with {boxes}
          {tags.length > 0 && <> and tags {tags.map((t) => `#${t}`).join(" ")}</>} will be added for everyone to use.
        </Text>
        <Inline>
          <Button variant="primary" disabled={busy} onClick={create} data-testid="template-confirm">
            {busy ? "Adding…" : "Add template"}
          </Button>
          <Button disabled={busy} onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </Inline>
      </Dialog>
    </Panel>
  );
}
