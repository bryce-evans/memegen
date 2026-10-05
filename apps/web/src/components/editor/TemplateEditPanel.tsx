import { useState } from "react";
import { Link } from "react-router-dom";
import type { Template, TextLayer } from "@memegen/shared";
import { Alert, Button, Inline, LinkButton, Panel, Text, TextField } from "@memegen/ui";
import { updateTemplate } from "../../api.ts";
import { plural } from "../../format.ts";
import { useAction } from "../../useAction.ts";
import { ErrorView } from "../common.tsx";

/** What a save writes; equal snapshots mean nothing changed since the last save. */
const snapshot = (name: string, layers: TextLayer[]) => JSON.stringify({ name: name.trim(), layers });

/**
 * Side panel for editing an existing template (`?editTemplate=`): its name and default text boxes, saved with
 * `PATCH /api/templates/:id`. Only the author can save; memes already made from it keep their own text.
 */
export function TemplateEditPanel({ template, layers, canEdit }: { template: Template; layers: TextLayer[]; canEdit: boolean }) {
  const [name, setName] = useState(template.name);
  const [saved, setSaved] = useState(() => snapshot(template.name, template.defaultLayers));
  const { busy, error, run } = useAction();
  const dirty = snapshot(name, layers) !== saved;

  async function save() {
    const sent = snapshot(name, layers);
    const updated = await run(() => updateTemplate(template.id, { name: name.trim(), defaultLayers: layers }));
    if (updated) setSaved(sent);
  }

  if (!canEdit) {
    return (
      <Panel heading="Edit template" className="save-panel">
        <Alert tone="info">Only the author of this template can edit it.</Alert>
      </Panel>
    );
  }

  return (
    <Panel heading="Edit template" className="save-panel">
      <TextField
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        maxLength={120}
        disabled={busy}
        data-testid="template-name"
      />
      <Text size="sm" tone="muted">
        The {plural(layers.length, "text box", "text boxes")} and their placeholder text are the template's defaults. Memes
        already made from it keep their own text.
      </Text>
      <Inline className="save-actions">
        <Button variant="primary" disabled={busy || !dirty || !name.trim()} onClick={save} data-testid="template-update">
          {busy ? "Saving…" : "Save changes"}
        </Button>
        <LinkButton as={Link} to={`/create?template=${template.id}`} data-testid="template-use">
          Use template
        </LinkButton>
      </Inline>
      <Text size="sm" tone="muted" data-testid="template-status" data-dirty={dirty}>
        {dirty ? "Unsaved changes" : "All changes saved"}
      </Text>
      {error !== null && <ErrorView error={error} />}
    </Panel>
  );
}
