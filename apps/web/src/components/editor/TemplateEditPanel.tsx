import { useState } from "react";
import { Link } from "react-router-dom";
import type { Template } from "@memegen/shared";
import { Alert, Button, Inline, LinkButton, Panel, Text, TextField } from "@memegen/ui";
import { useAction } from "../../useAction.ts";
import { ErrorView } from "../common.tsx";

/** What a save writes; equal snapshots mean nothing changed since the last save. */
const snapshot = (name: string, content: unknown) => JSON.stringify({ name: name.trim(), content });

export interface TemplateEditPanelProps {
  template: Template;
  canEdit: boolean;
  /** The defaults as stored when the editor opened, and as currently edited (compared for "Unsaved changes"). */
  initialContent: unknown;
  content: unknown;
  /** Which parts are the template's defaults. */
  note: string;
  /** False while the defaults can't be saved (e.g. no panels). */
  ready: boolean;
  /** Writes the name and current defaults (`PATCH /api/templates/:id`). */
  save: (name: string) => Promise<Template>;
}

/**
 * Side panel for editing an existing template (`?editTemplate=`): its name and defaults. Only the author can save;
 * memes already made from it keep their own content.
 */
export function TemplateEditPanel({ template, canEdit, initialContent, content, note, ready, save: write }: TemplateEditPanelProps) {
  const [name, setName] = useState(template.name);
  const [saved, setSaved] = useState(() => snapshot(template.name, initialContent));
  const { busy, error, run } = useAction();
  const dirty = snapshot(name, content) !== saved;

  async function save() {
    const sent = snapshot(name, content);
    const updated = await run(() => write(name.trim()));
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
        {note}
      </Text>
      <Inline className="save-actions">
        <Button variant="primary" disabled={busy || !dirty || !ready || !name.trim()} onClick={save} data-testid="template-update">
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
