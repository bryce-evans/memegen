import { AI_EDIT_FONTS_MAX, aiEditTarget, aiImageUpdate, applyAiEdit, layerLabels, type AiEditRequest, type Layer, type PanelSet, type Template } from "@memegen/shared";
import { fetchAssetBlob, generateAiImage, listFonts, requestAiEdit } from "../../api.ts";
import type { AiSettings } from "../../aiSettings.ts";
import { templateLayers, templatePanels } from "../../memeDraft.ts";

export interface DraftImage { blob: Blob; prompt: string }
export type CreatorContent =
  | { kind: "media"; layers: Layer[]; image: DraftImage | null }
  | { kind: "panels"; panels: PanelSet };
export type CreatorDraft = CreatorContent & { updates: number };

export function initialDraft(template: Template, fontId: string | null): CreatorDraft {
  return template.kind === "multi"
    ? { kind: "panels", panels: templatePanels(template), updates: 0 }
    : { kind: "media", layers: templateLayers(template, fontId), image: null, updates: 0 };
}

/** Panels expose their caption cells, not a flattened cover's top/bottom boxes. */
export function draftTarget(draft: CreatorContent): Pick<AiEditRequest, "boxes"> {
  if (draft.kind === "media") return aiEditTarget(draft.layers, layerLabels(draft.layers));
  const { panels, layout, mirror } = draft.panels;
  return { boxes: panels.map((panel, index) => ({
    id: panel.id, label: `Panel ${index + 1}`, text: panel.text, fontId: null,
    x: layout === "horizontal" ? (index + 0.5) / panels.length : mirror ? 0.75 : 0.25,
    y: layout === "vertical" ? (index + 0.5) / panels.length : mirror ? 0.8 : 0.2,
  })) };
}

export async function updateDraft(from: Template, current: CreatorDraft, directions: string, settings: AiSettings, signal: AbortSignal, progress: (step: string) => void): Promise<CreatorDraft> {
  const { text: agent, image: generator } = settings;
  if (!agent) throw new Error("Add an Agent Provider in your profile's API Keys tab.");
  const image = current.kind === "media"
    ? current.image?.blob ?? (from.asset.kind === "image" ? await fetchAssetBlob(from.asset, signal) : null)
    : null;
  const fonts = current.kind === "media" ? (await listFonts()).items : [];
  progress("Asking the agent…");
  const edit = await requestAiEdit({
    provider: agent.provider, model: agent.model,
    request: { directions, ...draftTarget(current), fonts: fonts.slice(0, AI_EDIT_FONTS_MAX).map((f) => ({ id: f.id, name: f.name })), canUpdateImage: current.kind === "media" && generator !== null },
  }, image, agent.apiKey, signal);
  const updates = current.updates + 1;
  if (current.kind === "panels") {
    const texts = new Map(edit.actions.flatMap((a) => a.action === "ADD_TEXT" ? [[a.position, a.text] as const] : []));
    return { kind: "panels", panels: { ...current.panels, panels: current.panels.panels.map((panel) => texts.has(panel.id) ? { ...panel, text: texts.get(panel.id)! } : panel) }, updates };
  }
  const layers = applyAiEdit(current.layers, edit);
  const prompt = aiImageUpdate(edit);
  if (!prompt || !image || !generator) return { ...current, layers, updates };
  progress("Editing the image…");
  const blob = await generateAiImage({ provider: generator.provider, prompt, model: generator.model }, image, generator.apiKey, signal);
  return { kind: "media", layers, image: { blob, prompt }, updates };
}
