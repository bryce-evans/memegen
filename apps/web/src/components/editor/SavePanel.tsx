import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ensureLayerFonts, exportMeme, ExportAbortedError, type DecodedMedia } from "@memegen/render";
import { limitViolations, stillExportSize, type Meme, type TextLayer, type UploadLimits, type Visibility } from "@memegen/shared";
import { Alert, Button, Icon, Inline, Panel, ProgressBar, SelectField, Text, TextField } from "@memegen/ui";
import { ApiError, createMeme, fontUrl, postMeme, updateMeme, uploadAsset } from "../../api.ts";
import { downloadBlob, fileSlug } from "../../media.ts";
import { ErrorView } from "../common.tsx";
import { TagField } from "../tagInputs.tsx";

export interface SavePanelProps {
  media: DecodedMedia;
  layers: TextLayer[];
  limits: UploadLimits;
  /** False when re-editing someone else's meme: only Download is offered. */
  canSave: boolean;
  /** Re-editing an existing meme (PATCH), or creating a new one from a template. */
  target: { editing: Meme } | { templateId: string };
  defaultTitle: string;
  /** Offered as one-click tags (e.g. the template's); never applied automatically. */
  suggestedTags: string[];
}

interface Progress {
  step: string;
  /** 0..1, or null when indeterminate. */
  value: number | null;
}

export function SavePanel(props: SavePanelProps) {
  const { media, layers, limits, canSave, target, defaultTitle, suggestedTags } = props;
  const editingMeme = "editing" in target ? target.editing : null;
  const navigate = useNavigate();
  const [title, setTitle] = useState(editingMeme?.title ?? defaultTitle);
  const [visibility, setVisibility] = useState<Visibility>(editingMeme?.visibility ?? "public");
  const [tags, setTags] = useState<string[]>(editingMeme?.tags ?? []);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const busy = progress !== null;

  // Leaving the editor cancels an export/upload in flight; a save that still finishes must not navigate away from
  // wherever the user went.
  const left = useRef(false);
  useEffect(() => {
    left.current = false;
    return () => {
      left.current = true;
      abortRef.current?.abort();
    };
  }, []);

  async function run(task: (signal: AbortSignal) => Promise<void>) {
    const ac = new AbortController();
    abortRef.current = ac;
    setError(null);
    setNotice(null);
    try {
      await task(ac.signal);
    } catch (err) {
      const aborted = err instanceof ExportAbortedError || (err instanceof DOMException && err.name === "AbortError");
      if (aborted) setNotice("Canceled.");
      else setError(err);
    } finally {
      abortRef.current = null;
      setProgress(null);
    }
  }

  /** Render the meme in the browser, reporting progress. */
  async function render(signal: AbortSignal) {
    setProgress({ step: "Loading fonts", value: null });
    await ensureLayerFonts(layers, fontUrl);
    setProgress({ step: "Rendering", value: 0 });
    const out = await exportMeme(media, layers, {
      signal,
      onProgress: (value) => setProgress({ step: "Rendering", value }),
      stillSize: stillExportSize(media.width, media.height, limits),
    });
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
      const tooBig = limitViolations(out.blob.size, null, limits);
      if (tooBig.length) throw new ApiError(413, "the rendered meme is over the upload limit", tooBig);

      setProgress({ step: "Uploading", value: null });
      const output = await uploadAsset(out.blob, `${fileSlug(title)}${out.extension}`, undefined, signal);

      setProgress({ step: "Saving", value: null });
      const common = { title: title.trim(), visibility, layers, outputAssetId: output.id, tags };
      let meme: Meme;
      if ("editing" in target) {
        meme = await updateMeme(target.editing.id, common);
        if (post && meme.postedAt === null) meme = await postMeme(meme.id);
      } else {
        meme = await createMeme({ ...common, templateId: target.templateId, post });
      }
      if (!left.current) navigate(`/m/${meme.id}`);
    });

  const alreadyPosted = editingMeme !== null && editingMeme.postedAt !== null;

  return (
    <Panel heading={editingMeme && canSave ? "Save changes" : "Save"} className="save-panel">
      <TextField
        label="Title"
        value={title}
        maxLength={200}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Untitled"
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
            <option value="private">Private (only you)</option>
          </SelectField>
          <TagField value={tags} onChange={setTags} suggestions={suggestedTags} testId="meme-tags" disabled={busy} allowCreate />
        </>
      )}
      <Inline className="save-actions">
        <Button disabled={busy} onClick={download} icon={<Icon name="down" />} data-testid="download-export">
          Download
        </Button>
        {canSave &&
          (alreadyPosted ? (
            <Button variant="primary" disabled={busy} onClick={() => save(false)} data-testid="save-draft">
              Save changes
            </Button>
          ) : (
            <>
              <Button disabled={busy} onClick={() => save(false)} data-testid="save-draft">
                Save draft
              </Button>
              <Button variant="primary" disabled={busy} onClick={() => save(true)} data-testid="post-meme">
                Post
              </Button>
            </>
          ))}
      </Inline>

      {progress && (
        <div className="export-progress" data-testid="export-progress">
          <Text as="span" size="sm" numeric>
            {progress.step}
            {progress.value !== null && ` ${Math.round(progress.value * 100)}%`}…
          </Text>
          <ProgressBar value={progress.value} aria-label={progress.step} />
          <Button size="sm" variant="quiet" onClick={() => abortRef.current?.abort()}>
            Cancel
          </Button>
        </div>
      )}
      {notice && <Text tone="muted">{notice}</Text>}
      {error !== null && <ErrorView error={error} testId="editor-error" />}

      {!canSave && <Alert tone="info">Only the owner can save changes to this meme.</Alert>}
    </Panel>
  );
}
