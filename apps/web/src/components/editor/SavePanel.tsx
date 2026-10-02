import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ensureLayerFonts, exportMeme, ExportAbortedError, type DecodedMedia } from "@memegen/render";
import { limitViolations, type Meme, type Template, type TextLayer, type UploadLimits, type Visibility } from "@memegen/shared";
import { ApiError, createMeme, createTemplate, fontUrl, postMeme, updateMeme, uploadAsset } from "../../api.ts";
import { useAuth } from "../../auth.tsx";
import { ErrorView, SignInPrompt } from "../common.tsx";
import { TagInput } from "../tags.tsx";

export interface SavePanelProps {
  media: DecodedMedia;
  layers: TextLayer[];
  limits: UploadLimits;
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
  const { media, layers, limits, editingMeme, templateId, defaultTitle, suggestedTags, getSourceAssetId } = props;
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

  if (!user) {
    return (
      <div className="panel">
        <h3>Save</h3>
        <SignInPrompt action="save or post memes" />
      </div>
    );
  }

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

  const save = (post: boolean) =>
    run(async (signal) => {
      setProgress({ step: "Loading fonts", value: null });
      await ensureLayerFonts(layers, fontUrl);
      setProgress({ step: "Rendering", value: 0 });
      const out = await exportMeme(media, layers, {
        signal,
        onProgress: (value) => setProgress({ step: "Rendering", value }),
      });
      if (signal.aborted) throw new ExportAbortedError();
      const tooBig = limitViolations(out.blob.size, null, limits);
      if (tooBig.length) throw new ApiError(413, "the rendered meme is over the upload limit", tooBig);

      setProgress({ step: "Uploading", value: null });
      const base = title.trim().replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "meme";
      const output = await uploadAsset(out.blob, `${base}${out.extension}`, undefined, signal);

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
    <div className="panel save-panel">
      <h3>{editingMeme ? "Save changes" : "Save"}</h3>
      <label className="field">
        <span>Title</span>
        <input
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled"
          disabled={busy}
          data-testid="meme-title"
        />
      </label>
      <label className="field">
        <span>Visibility</span>
        <select value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)} disabled={busy} data-testid="meme-visibility">
          <option value="public">Public</option>
          <option value="private">Private (only you)</option>
        </select>
      </label>
      <div className="field">
        <span>Tags</span>
        <TagInput value={tags} onChange={setTags} suggestions={suggestedTags} testId="meme-tags" disabled={busy} />
      </div>
      <div className="actions">
        {alreadyPosted ? (
          <button type="button" className="primary" disabled={busy} onClick={() => save(false)} data-testid="save-draft">
            Save changes
          </button>
        ) : (
          <>
            <button type="button" disabled={busy} onClick={() => save(false)} data-testid="save-draft">
              Save draft
            </button>
            <button type="button" className="primary" disabled={busy} onClick={() => save(true)} data-testid="post-meme">
              Post
            </button>
          </>
        )}
      </div>

      {progress && (
        <div className="progress" data-testid="export-progress">
          <span>
            {progress.step}
            {progress.value !== null && ` ${Math.round(progress.value * 100)}%`}…
          </span>
          <progress max={1} value={progress.value ?? undefined} />
          <button type="button" onClick={() => abortRef.current?.abort()}>
            Cancel
          </button>
        </div>
      )}
      {notice && <p className="muted">{notice}</p>}
      {error !== null && <ErrorView error={error} testId="editor-error" />}

      <div className="save-template">
        <h4>Save as template</h4>
        <label className="field">
          <span>Template name</span>
          <input
            value={templateName}
            maxLength={120}
            placeholder={title.trim() || "Untitled template"}
            onChange={(e) => setTemplateName(e.target.value)}
            disabled={busy}
          />
        </label>
        <button type="button" disabled={busy} onClick={saveTemplate} data-testid="save-as-template">
          Save as template
        </button>
        {savedTemplate && (
          <p>
            Saved template “{savedTemplate.name}”. <Link to={`/create?template=${savedTemplate.id}`}>Open it</Link>
          </p>
        )}
      </div>
    </div>
  );
}
