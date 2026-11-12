import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ExportAbortedError, type ExportResult } from "@memegen/render";
import { MAX_TAGS, MEME_TITLE_MAX_LENGTH, type Meme, type Template, type UploadLimits, type User, type Visibility } from "@memegen/shared";
import { Alert, Button, Icon, Inline, Panel, ProgressBar, SelectField, Text, TextField } from "@memegen/ui";
import { useBackGuard } from "../../backHotkeys.ts";
import { downloadBlob, fileSlug } from "../../media.ts";
import { publishMeme, type MemeContent, type MemeTarget } from "../../publishMeme.ts";
import { useAction } from "../../useAction.ts";
import { ErrorView } from "../common.tsx";
import { TagField } from "../tagInputs.tsx";

/** Reports a render step ("Loading fonts", "Rendering") and its 0..1 progress, or null when indeterminate. */
export type RenderProgress = (step: string, value: number | null) => void;

export interface SavePanelProps {
  /** Render the meme in the browser (the editor's own exporter). */
  render: (signal: AbortSignal, progress: RenderProgress) => Promise<ExportResult>;
  /** What the meme stores: its layers, or a multi-panel meme's panels (with no layers). */
  content: MemeContent;
  limits: UploadLimits;
  /** False when neither owner nor admin: only Download is offered. */
  canSave: boolean;
  /** Re-editing an existing meme (PATCH), or creating a new one from a template. */
  target: MemeTarget;
  /** The template's tags: pre-filled on a new meme (the user may remove them) and offered as one-click tags. */
  templateTags: string[];
  initialTitle?: string;
}

/** Saving policy and initial tags for the editor's source. */
export function memeSaveProps(
  source: { kind: "template"; template: Template } | { kind: "meme"; meme: Meme },
  user: User,
): Pick<SavePanelProps, "canSave" | "target" | "templateTags"> {
  return source.kind === "meme"
    ? { canSave: source.meme.owner.id === user.id || user.isAdmin, target: { editing: source.meme }, templateTags: [] }
    : { canSave: true, target: { templateId: source.template.id }, templateTags: source.template.tags };
}

interface Progress {
  step: string;
  /** 0..1, or null when indeterminate. */
  value: number | null;
}

export function SavePanel(props: SavePanelProps) {
  const { render: renderMeme, content, limits, canSave, target, templateTags } = props;
  const editingMeme = "editing" in target ? target.editing : null;
  const navigate = useNavigate();
  // New memes start untitled unless continuing an explicitly titled Quick Creator draft.
  const [title, setTitle] = useState(editingMeme?.title ?? props.initialTitle ?? "");
  const untitled = title.trim() === "";
  const [visibility, setVisibility] = useState<Visibility>(editingMeme?.visibility ?? "public");
  const [tags, setTags] = useState<string[]>(editingMeme?.tags ?? templateTags.slice(0, MAX_TAGS));
  const [progress, setProgress] = useState<Progress | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Leaving the editor aborts an export/upload in flight, so a save that still finishes doesn't navigate away from
  // wherever the user went.
  const { busy, error, run, cancel } = useAction();

  /** Render the meme in the browser, reporting progress. */
  async function render(signal: AbortSignal) {
    setNotice(null);
    setProgress(null);
    const out = await renderMeme(signal, (step, value) => setProgress({ step, value }));
    if (signal.aborted) throw new ExportAbortedError();
    return out;
  }

  const download = () =>
    run(async (signal) => {
      const out = await render(signal);
      const filename = `${fileSlug(title)}${out.extension}`;
      downloadBlob(out.blob, filename);
      setNotice(`Downloaded ${filename}.`);
    });

  const save = (post: boolean) =>
    run(async (signal) => {
      const out = await render(signal);
      const meme = await publishMeme({
        output: out, content, target, title, visibility, tags, post, limits, signal,
        progress: (step) => setProgress({ step, value: null }),
      });
      if (!signal.aborted) navigate(`/m/${meme.id}`);
    });

  const alreadyPosted = editingMeme !== null && editingMeme.postedAt !== null;
  // Going back by hotkey from a meme you could still publish (new, or your own draft) asks first.
  useBackGuard(canSave && !alreadyPosted ? "Leave the editor? This meme isn't published, and unsaved changes will be lost." : null);

  return (
    <Panel heading={editingMeme && canSave ? "Save changes" : "Save"} className="save-panel">
      <TextField
        label="Title (required)"
        value={title}
        maxLength={MEME_TITLE_MAX_LENGTH}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Add a title"
        required
        disabled={busy}
        data-testid="meme-title"
      />
      {canSave && (
        <>
          <SelectField
            label="Visibility"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as Visibility)}
            disabled={busy}
            data-testid="meme-visibility"
          >
            <option value="public">Public</option>
            <option value="unlisted">Unlisted (anyone with the link)</option>
          </SelectField>
          <TagField value={tags} onChange={setTags} suggestions={templateTags} testId="meme-tags" disabled={busy} />
        </>
      )}
      <Inline className="save-actions">
        <Button disabled={busy} onClick={download} icon={<Icon name="down" />} data-testid="download-export">
          Download
        </Button>
        {canSave &&
          (alreadyPosted ? (
            <Button variant="primary" disabled={busy || untitled} onClick={() => save(false)} data-testid="save-draft">
              Save changes
            </Button>
          ) : (
            <>
              <Button disabled={busy || untitled} onClick={() => save(false)} data-testid="save-draft">
                Save draft
              </Button>
              <Button variant="primary" disabled={busy || untitled} onClick={() => save(true)} data-testid="post-meme">
                Post
              </Button>
            </>
          ))}
      </Inline>

      {busy && progress && (
        <div className="export-progress" data-testid="export-progress">
          <Text as="span" size="sm" numeric>
            {progress.step}
            {progress.value !== null && ` ${Math.round(progress.value * 100)}%`}…
          </Text>
          <ProgressBar value={progress.value} aria-label={progress.step} />
          <Button
            size="sm"
            variant="quiet"
            onClick={() => {
              cancel();
              setNotice("Canceled.");
            }}
          >
            Cancel
          </Button>
        </div>
      )}
      {notice && <Text tone="muted">{notice}</Text>}
      {error !== null && <ErrorView error={error} testId="editor-error" />}

      {!canSave && <Alert tone="info">Only the owner or an admin can save changes to this meme.</Alert>}
    </Panel>
  );
}
