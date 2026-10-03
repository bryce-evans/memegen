import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ensureLayerFonts, exportMeme, ExportAbortedError, type DecodedMedia } from "@memegen/render";
import { limitViolations, type Meme, type Template, type TextLayer, type UploadLimits, type Visibility } from "@memegen/shared";
import { Alert, Button, Field, Icon, Inline, Panel, ProgressBar, SelectField, Text, TextField } from "@memegen/ui";
import { ApiError, createMeme, createTemplate, fontUrl, postMeme, updateMeme, uploadAsset } from "../../api.ts";
import { useAuth } from "../../auth.tsx";
import { downloadBlob, fileSlug } from "../../media.ts";
import { ErrorView, SignInPrompt } from "../common.tsx";
import { TagInput } from "../tags.tsx";

export interface SavePanelProps {
  media: DecodedMedia;
  layers: TextLayer[];
  limits: UploadLimits;
  /** False when re-editing someone else's meme: only Download is offered. */
  canSave: boolean;
  /** Set when re-editing an existing meme (PATCH instead of create). */
  editingMeme: Meme | null;
  templateId: string | null;
  defaultTitle: string;
  /** Offered as one-click tags (e.g. the template's); never applied automatically. */
  suggestedTags: string[];
  /** Source asset id, uploading the local file first if needed. */
  getSourceAssetId: (signal?: AbortSignal) => Promise<string>;
}

interface Progress {
  step: string;
  /** 0..1, or null when indeterminate. */
  value: number | null;
}

export function SavePanel(props: SavePanelProps) {
  const { media, layers, limits, canSave, editingMeme, templateId, defaultTitle, suggestedTags, getSourceAssetId } = props;
  const { user } = useAuth();
  const navigate = useNavigate();
  const [title, setTitle] = useState(editingMeme?.title ?? defaultTitle);
  const [visibility, setVisibility] = useState<Visibility>(editingMeme?.visibility ?? "public");
  const [tags, setTags] = useState<string[]>(editingMeme?.tags ?? []);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState(defaultTitle);
  const [savedTemplate, setSavedTemplate] = useState<Template | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const busy = progress !== null;
  const saving = user !== null && canSave;

  async function run(task: (signal: AbortSignal) => Promise<void>) {
    const ac = new AbortController();
    abortRef.current = ac;
    setError(null);
    setNotice(null);
    setSavedTemplate(null);
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
      if (editingMeme) {
        meme = await updateMeme(editingMeme.id, common);
        if (post && meme.postedAt === null) meme = await postMeme(meme.id);
      } else if (templateId) {
        meme = await createMeme({ ...common, templateId, post });
      } else {
        meme = await createMeme({ ...common, sourceAssetId: await getSourceAssetId(signal), post });
      }
      navigate(`/m/${meme.id}`);
    });

  const saveTemplate = () =>
    run(async (signal) => {
      setProgress({ step: "Saving template", value: null });
      const assetId = await getSourceAssetId(signal);
      const name = templateName.trim() || title.trim() || "Untitled template";
      setSavedTemplate(await createTemplate({ name, assetId, defaultLayers: layers, tags }));
    });

  const alreadyPosted = editingMeme !== null && editingMeme.postedAt !== null;

  return (
    <Panel heading={editingMeme && saving ? "Save changes" : "Save"} className="save-panel">
      <TextField
        label="Title"
        value={title}
        maxLength={200}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Untitled"
        disabled={busy}
        data-testid="meme-title"
      />
      {saving && (
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
          <Field as="div" label="Tags">
            <TagInput value={tags} onChange={setTags} suggestions={suggestedTags} testId="meme-tags" disabled={busy} />
          </Field>
        </>
      )}
      <Inline className="save-actions">
        <Button disabled={busy} onClick={download} icon={<Icon name="down" />} data-testid="download-export">
          Download
        </Button>
        {saving &&
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

      {!user && <SignInPrompt action="save or post memes" />}
      {user && !canSave && <Alert tone="info">Only the owner can save changes to this meme.</Alert>}

      {saving && (
        <Panel variant="inset" heading="Save as template" className="save-template">
          <TextField
            label="Template name"
            value={templateName}
            maxLength={120}
            placeholder={title.trim() || "Untitled template"}
            onChange={(e) => setTemplateName(e.target.value)}
            disabled={busy}
          />
          <Button disabled={busy} onClick={saveTemplate} data-testid="save-as-template">
            Save as template
          </Button>
          {savedTemplate && (
            <Text>
              Saved template “{savedTemplate.name}”. <Link to={`/create?template=${savedTemplate.id}`}>Open it</Link>
            </Text>
          )}
        </Panel>
      )}
    </Panel>
  );
}
