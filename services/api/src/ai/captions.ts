import { AI_CAPTIONS_MAX, AI_PROMPT_MAX_LENGTH, aiCaptionSchema, TEXT_BOX_MIN, type AiCaption, type AiCaptionsResponse } from "@memegen/shared";
import { AiProviderError, type AiCaptionRequest } from "./types.ts";

/**
 * One instruction for every provider: the model reads the user's description, splits its meme text into captions and
 * decides where each goes, and pulls out any requested change to the image itself.
 */
export const CAPTION_SYSTEM_PROMPT = [
  "You turn a user's description of a meme into captions placed on an image, plus any change they want made to the image.",
  "The description holds the meme's text, and may also ask for a change to the picture itself (add, remove, or restyle something in it).",
  "Put such a change, in the user's words and without any caption text, in `modification`; if there is none, `modification` is null. Never turn it into a caption.",
  "Split the meme text into captions. Keep the user's words exactly; never invent, translate, or rephrase text.",
  "Split only on natural breaks: line breaks, or a setup and its punchline. Short text stays one caption.",
  "Parts may be labelled with a position, such as 'top text:' or 'bottom text:'. Place each such part there, leave the label out of its caption, and drop parts left empty.",
  "Place each caption where it reads well and does not cover the image's main subject (faces, the focal object).",
  "Coordinates are fractions of the image: x and y are the caption box's center (0,0 is the top-left corner, 1,1 the bottom-right); width and height are the box's size.",
  `Keep every box inside the image; width and height are at least ${TEXT_BOX_MIN}.`,
  "The request may list the template's own text boxes. Prefer them when they suit the captions; otherwise choose your own positions.",
  `Return at most ${AI_CAPTIONS_MAX} captions, in reading order, as JSON matching the schema. Captions may be empty only when there is a modification.`,
].join("\n");

/**
 * The user message: the request as one JSON object after a fixed label, so the text survives verbatim (line breaks
 * included) and the test stub can read it back.
 */
export function captionUserPrompt({ text, boxes, image }: Pick<AiCaptionRequest, "text" | "boxes" | "image">): string {
  const imageLine = image ? "The image is attached." : "No image is attached; place the captions for a typical meme layout.";
  return `${imageLine}\nRequest (JSON):\n${JSON.stringify({ text, boxes })}`;
}

const CAPTION_FIELDS = ["text", "x", "y", "width", "height"] as const;

/** JSON Schema for OpenAI structured outputs (strict mode: every property required, no extras). */
export const CAPTIONS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["captions", "modification"],
  properties: {
    captions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: CAPTION_FIELDS,
        properties: { text: { type: "string" }, x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" } },
      },
    },
    modification: { type: ["string", "null"] },
  },
} as const;

/** The same shape in Gemini's `responseSchema` (OpenAPI subset). */
export const CAPTIONS_GEMINI_SCHEMA = {
  type: "OBJECT",
  required: ["captions"],
  properties: {
    captions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: CAPTION_FIELDS,
        propertyOrdering: CAPTION_FIELDS,
        properties: { text: { type: "STRING" }, x: { type: "NUMBER" }, y: { type: "NUMBER" }, width: { type: "NUMBER" }, height: { type: "NUMBER" } },
      },
    },
    modification: { type: "STRING", nullable: true },
  },
} as const;

/** The model's JSON text, parsed; anything else counts as no captions. */
export function parseCaptionJson(content: string | null | undefined): unknown {
  if (!content) throw new AiProviderError(502, "returned no captions");
  try {
    return JSON.parse(content);
  } catch {
    throw new AiProviderError(502, "returned no captions");
  }
}

const clamp = (v: unknown, min: number, max: number) => (typeof v === "number" ? Math.min(max, Math.max(min, v)) : v);

/**
 * The one place model output becomes an `AiCaptionsResponse`: boxes clamped into the media, empty or malformed
 * captions dropped, at most `AI_CAPTIONS_MAX` kept; the modification trimmed and capped like a prompt, blank as null.
 * Neither captions nor a modification left is a provider failure.
 */
export function normalizePlacement(output: unknown): AiCaptionsResponse {
  const record = output && typeof output === "object" ? (output as Record<string, unknown>) : {};
  const list = Array.isArray(record.captions) ? (record.captions as unknown[]) : [];
  const captions: AiCaption[] = [];
  for (const item of list) {
    if (captions.length === AI_CAPTIONS_MAX) break;
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const parsed = aiCaptionSchema.safeParse({
      text: c.text,
      x: clamp(c.x, 0, 1),
      y: clamp(c.y, 0, 1),
      width: clamp(c.width, TEXT_BOX_MIN, 1),
      height: clamp(c.height, TEXT_BOX_MIN, 1),
    });
    if (parsed.success) captions.push(parsed.data);
  }
  const modification = typeof record.modification === "string" ? record.modification.trim().slice(0, AI_PROMPT_MAX_LENGTH) || null : null;
  if (!captions.length && !modification) throw new AiProviderError(502, "returned no captions");
  return { captions, modification };
}
