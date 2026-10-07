import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Template } from "@memegen/shared";
import { Button, Dialog, Inline, Panel, Text, TextField } from "@memegen/ui";
import { useAction } from "../../useAction.ts";
import { ErrorView } from "../common.tsx";
import { TagField } from "../tagInputs.tsx";

/** "distracted-boyfriend_v2.jpg" → "distracted boyfriend v2". */
export function nameFromFile(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim()
    .slice(0, 120);
}

export interface TemplateSavePanelProps {
  defaultName: string;
  /** What the template holds, for the confirm dialog ("2 text boxes", "3 panels"). */
  what: string;
  /** Which parts become the template's defaults. */
  note: string;
  /** False while the defaults can't be saved yet (e.g. no panels). */
  ready: boolean;
  /** Writes the template (e.g. `POST /api/templates`). */
  create: (name: string, tags: string[]) => Promise<Template>;
}

/**
 * Template Editor's side panel: name and base tags for a new template. Saving asks "Add new template?" first, then
 * opens the new template in the editor.
 */
export function TemplateSavePanel({ defaultName, what, note, ready, create: write }: TemplateSavePanelProps) {
  const navigate = useNavigate();
  const [name, setName] = useState(defaultName);
  const [tags, setTags] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const { busy, error, run } = useAction();

  async function create() {
    const template = await run(() => write(name.trim(), tags));
    if (template) navigate(`/create?template=${template.id}`);
    else setConfirming(false);
  }

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
        {note}
      </Text>
      <Inline className="save-actions">
        <Button variant="primary" disabled={busy || !ready || !name.trim()} onClick={() => setConfirming(true)} data-testid="template-save">
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
          “{name.trim()}” with {what}
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
