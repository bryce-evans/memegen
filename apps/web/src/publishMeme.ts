import { ExportAbortedError, type ExportResult } from "@memegen/render";
import { limitViolations, type Layer, type Meme, type PanelSet, type UploadLimits, type Visibility } from "@memegen/shared";
import { ApiError, createMeme, postMeme, updateMeme, uploadAsset } from "./api.ts";
import { fileSlug } from "./media.ts";

export type MemeTarget = { editing: Meme } | { templateId: string };
export type MemeContent = { layers: Layer[]; panels: PanelSet | null };

/** Persist an already-rendered draft. Rendering and navigation belong to each creator. */
export async function publishMeme({ output, content, target, title, visibility, tags, post, limits, signal, progress }: {
  output: ExportResult;
  content: MemeContent;
  target: MemeTarget;
  title: string;
  visibility: Visibility;
  tags: string[];
  post: boolean;
  limits: UploadLimits;
  signal: AbortSignal;
  progress: (step: string) => void;
}): Promise<Meme> {
  if (signal.aborted) throw new ExportAbortedError();
  const tooBig = limitViolations(output.blob.size, null, limits);
  if (tooBig.length) throw new ApiError(413, "the rendered meme is over the upload limit", tooBig);
  progress("Uploading");
  const uploaded = await uploadAsset(output.blob, `${fileSlug(title)}${output.extension}`, undefined, signal);
  if (signal.aborted) throw new ExportAbortedError();
  progress("Saving");
  const common = { title: title.trim(), visibility, ...content, outputAssetId: uploaded.id, tags };
  if (!("editing" in target)) return createMeme({ ...common, templateId: target.templateId, post });
  const meme = await updateMeme(target.editing.id, common);
  return post && meme.postedAt === null ? postMeme(meme.id) : meme;
}
