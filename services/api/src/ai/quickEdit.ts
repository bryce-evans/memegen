import { AI_EDIT_SPEC, AI_PROMPT_MAX_LENGTH, TEXT_MAX_LENGTH, type AiEdit, type AiEditBoxChange, type AiEditRequest } from "@memegen/shared";
import { AiProviderError, type AiEditCall } from "./types.ts";

/** The `quick-creator/1` rules for every provider. */
export function editSystemPrompt(): string {
  return [
    `You are a meme-making agent answering spec ${AI_EDIT_SPEC}. The request lists a meme template's text boxes; you rewrite them following the user's directions.`,
    "You may change only: each listed box's text, each listed box's font (an id from `fonts`), the top section's text, and the image itself (as an edit prompt).",
    "You cannot add, remove, move, or resize boxes, and you cannot change timing. Boxes' x/y (center, fractions of the image) only tell you where each box sits.",
    "`boxes`: one entry per box you change, by its `id`. `text`: its new text (\"\" blanks the box) or null to keep it. `fontId`: a font id from `fonts` or null to keep it. Leave unchanged boxes out.",
    "Directions may label parts with a box's label, such as 'top text:' or 'bottom text:'. Put each part in that box, without the label. Keep the user's words exactly when they give the text; write your own only when they ask you to.",
    "`topSection`: the white band of text above the image (its current text is in the request, null when there is none). Answer its new text to add or rewrite it, \"\" to remove it, or null to leave it.",
    "`imageEdit`: when the directions ask to change the picture itself (add, remove, or restyle something in it), a prompt describing that change, in the user's words and without any caption text; otherwise null. It must be null when no image is attached.",
    "Answer JSON matching the schema, and nothing else.",
  ].join("\n");
}

/**
 * The user message: the request as one JSON object after a fixed label, so the text survives verbatim (line breaks
 * included) and the test stub can read it back.
 */
export function editUserPrompt({ request, image }: Pick<AiEditCall, "request" | "image">): string {
  const imageLine = image ? "The image is attached." : "No image is attached, so `imageEdit` must be null.";
  return `${imageLine}\nRequest (JSON):\n${JSON.stringify({ spec: AI_EDIT_SPEC, ...request })}`;
}

const BOX_FIELDS = ["id", "text", "fontId"] as const;
const EDIT_FIELDS = ["boxes", "topSection", "imageEdit"] as const;

/** JSON Schema for OpenAI strict mode and Anthropic structured outputs: every property required, no extras. */
export const EDIT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: EDIT_FIELDS,
  properties: {
    boxes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: BOX_FIELDS,
        properties: { id: { type: "string" }, text: { type: ["string", "null"] }, fontId: { type: ["string", "null"] } },
      },
    },
    topSection: { type: ["string", "null"] },
    imageEdit: { type: ["string", "null"] },
  },
} as const;

/** The same shape in Gemini's `responseSchema` (OpenAPI subset). */
export const EDIT_GEMINI_SCHEMA = {
  type: "OBJECT",
  required: ["boxes"],
  propertyOrdering: EDIT_FIELDS,
  properties: {
    boxes: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["id"],
        propertyOrdering: BOX_FIELDS,
        properties: { id: { type: "STRING" }, text: { type: "STRING", nullable: true }, fontId: { type: "STRING", nullable: true } },
      },
    },
    topSection: { type: "STRING", nullable: true },
    imageEdit: { type: "STRING", nullable: true },
  },
} as const;

/** The model's JSON text, parsed; anything else counts as no answer. */
export function parseEditJson(content: string | null | undefined): unknown {
  if (!content) throw new AiProviderError(502, "returned no edit");
  try {
    return JSON.parse(content);
  } catch {
    throw new AiProviderError(502, "returned no edit");
  }
}

const record = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const text = (v: unknown): string | null => (typeof v === "string" ? v.trim().slice(0, TEXT_MAX_LENGTH) : null);

/**
 * The one place model output becomes an `AiEdit`, checked against the request: only requested box ids (first answer
 * per box), only listed fonts, changes that change nothing dropped; removing a top section that isn't there is no
 * change; `imageEdit` trimmed and capped like a prompt, and null without an image. An answer with no changes is valid
 * (the directions may match the template as it is); output that isn't a JSON object is a provider failure.
 */
export function normalizeEdit(output: unknown, request: AiEditRequest, hasImage: boolean): AiEdit {
  if (!output || typeof output !== "object" || Array.isArray(output)) throw new AiProviderError(502, "returned no edit");
  const answer = record(output);
  const boxesById = new Map(request.boxes.map((b) => [b.id, b]));
  const fonts = new Set(request.fonts.map((f) => f.id));
  const seen = new Set<string>();
  const boxes: AiEditBoxChange[] = [];
  for (const item of Array.isArray(answer.boxes) ? answer.boxes : []) {
    const { id, text: rawText, fontId: rawFont } = record(item);
    const box = typeof id === "string" ? boxesById.get(id) : undefined;
    if (!box || seen.has(box.id)) continue;
    seen.add(box.id);
    const newText = text(rawText);
    const fontId = typeof rawFont === "string" && fonts.has(rawFont) && rawFont !== box.fontId ? rawFont : null;
    const change = { id: box.id, text: newText === box.text ? null : newText, fontId };
    if (change.text !== null || change.fontId !== null) boxes.push(change);
  }
  let topSection = text(answer.topSection);
  if (topSection === request.topSection || (topSection === "" && request.topSection === null)) topSection = null;
  const imageEdit = hasImage && typeof answer.imageEdit === "string" ? answer.imageEdit.trim().slice(0, AI_PROMPT_MAX_LENGTH) || null : null;
  return { boxes, topSection, imageEdit };
}
