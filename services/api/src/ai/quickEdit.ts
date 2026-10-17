import {
  AI_EDIT_SPEC,
  AI_PROMPT_MAX_LENGTH,
  TEXT_MAX_LENGTH,
  type AiAddText,
  type AiEdit,
  type AiEditRequest,
  type AiUpdateImage,
} from "@memegen/shared";
import { AiProviderError, type AiEditCall } from "./types.ts";

/** The `quick-creator/2` system prompt, the same for every request and provider: task, actions, rules, format. */
export function editSystemPrompt(): string {
  return `You are the meme-making agent behind memegen's Quick Creator, answering spec ${AI_EDIT_SPEC}.

# Task
The user picked a meme template and described the meme they want. Turn their directions into actions on that template. You only fill in the template: you never add, remove, move, or resize text boxes, and you never change timing.

# Input
The user message says whether the template's image is attached, then holds the request as JSON:
- \`directions\`: what the user wants, in their words.
- \`boxes\`: the template's text boxes, in order. Each has an \`id\`, a \`label\` (its name in the editor, such as "Top text"), its current \`text\`, its \`fontId\` (null: the default font), and \`x\`/\`y\`: its center as fractions of the image from the top-left (for the "Top section" box, the white caption band above the image, of that band). Positions only tell you where a box sits.
- \`fonts\`: the fonts you may pick, by \`id\` and \`name\`.
- \`canUpdateImage\`: whether UPDATE_IMAGE is available.

# Actions
UPDATE_IMAGE(prompt) — optional, at most once.
- Changes the template's picture itself with an image model: adding, removing, or restyling something in it.
- \`prompt\`: that change only, in the user's words where they gave them. Never put caption text in it: captions are drawn on top afterwards.
- Use it only when the directions ask to change the picture and \`canUpdateImage\` is true. Otherwise leave it out and do the rest.

ADD_TEXT(text, position?, style?) — one or more.
- Sets the text of one of the template's boxes.
- \`text\`: the box's new text, written as it should read. "" blanks the box. Line breaks are allowed.
- \`position\`: the \`id\` of a box from \`boxes\`; null puts the text in the next box not yet given text, in \`boxes\` order. Each box at most once. Only the listed boxes exist: text for any other box is dropped.
- \`style\`: \`{"fontId": <an id from fonts>}\` to change the box's font, or null to keep it. Only pick a font when the directions ask for one.

# Rules
- Directions may label parts with a box's label, such as "top text: …" or "bottom text: …". Put each part in that box, without the label.
- When the user gives the text, keep their words exactly. Write your own only when they ask you to (for example "make it about Mondays"): short and punchy, the way the template is used.
- Boxes you don't ADD_TEXT keep their current text. Give text to every box the meme needs.
- Give at least one ADD_TEXT whenever \`boxes\` is not empty.

# Response format
Answer one JSON object matching the schema, and nothing else: {"actions": [...]}. Order: the UPDATE_IMAGE (if any) first, then the ADD_TEXTs.
- {"action": "UPDATE_IMAGE", "prompt": "<the change to the picture>"}
- {"action": "ADD_TEXT", "text": "<text>", "position": "<box id>" or null, "style": {"fontId": "<font id>"} or null}

Example, for boxes "top" (Top text) and "bottom" (Bottom text) and the directions "Top text: me at 9am\\nBottom text: me at 9:05\\nmake the dog wear sunglasses":
{"actions": [{"action": "UPDATE_IMAGE", "prompt": "make the dog wear sunglasses"}, {"action": "ADD_TEXT", "text": "me at 9am", "position": "top", "style": null}, {"action": "ADD_TEXT", "text": "me at 9:05", "position": "bottom", "style": null}]}`;
}

/**
 * The user message: whether the image is attached, then the request as one JSON object after a fixed label, so the
 * text survives verbatim (line breaks included) and the test stub can read it back. `canUpdateImage` is what the
 * API will accept: the client's flag, and only with the image.
 */
export function editUserPrompt({ request, image }: Pick<AiEditCall, "request" | "image">): string {
  const imageLine = image ? "The image is attached." : "No image is attached, so UPDATE_IMAGE is not available.";
  return `${imageLine}\nRequest (JSON):\n${JSON.stringify({ spec: AI_EDIT_SPEC, ...request, canUpdateImage: request.canUpdateImage && image !== undefined })}`;
}

const nullable = (schema: object) => ({ anyOf: [schema, { type: "null" }] });

/** JSON Schema for OpenAI strict mode and Anthropic structured outputs: every property required, no extras. */
export const EDIT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["actions"],
  properties: {
    actions: {
      type: "array",
      items: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["action", "prompt"],
            properties: { action: { type: "string", enum: ["UPDATE_IMAGE"] }, prompt: { type: "string" } },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["action", "text", "position", "style"],
            properties: {
              action: { type: "string", enum: ["ADD_TEXT"] },
              text: { type: "string" },
              position: nullable({ type: "string" }),
              style: nullable({ type: "object", additionalProperties: false, required: ["fontId"], properties: { fontId: { type: "string" } } }),
            },
          },
        ],
      },
    },
  },
} as const;

/** The same shape in Gemini's `responseSchema` (OpenAPI subset). */
export const EDIT_GEMINI_SCHEMA = {
  type: "OBJECT",
  required: ["actions"],
  properties: {
    actions: {
      type: "ARRAY",
      items: {
        anyOf: [
          {
            type: "OBJECT",
            required: ["action", "prompt"],
            propertyOrdering: ["action", "prompt"],
            properties: { action: { type: "STRING", enum: ["UPDATE_IMAGE"] }, prompt: { type: "STRING" } },
          },
          {
            type: "OBJECT",
            required: ["action", "text"],
            propertyOrdering: ["action", "text", "position", "style"],
            properties: {
              action: { type: "STRING", enum: ["ADD_TEXT"] },
              text: { type: "STRING" },
              position: { type: "STRING", nullable: true },
              style: { type: "OBJECT", nullable: true, required: ["fontId"], properties: { fontId: { type: "STRING" } } },
            },
          },
        ],
      },
    },
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
 * The one place model output becomes an `AiEdit`, checked against the request: `[UPDATE_IMAGE?, ...ADD_TEXT]`.
 * The first non-blank `UPDATE_IMAGE`, trimmed and capped like a prompt, and only when the request allows it and the
 * image is attached. `ADD_TEXT` without a position takes the next box not yet given text; each box takes its first
 * `ADD_TEXT` only, unknown positions and unlisted fonts are dropped, and so is text that changes nothing. Unknown
 * actions are ignored. An answer with no actions is valid (the directions may match the template as it is); output
 * that isn't a JSON object is a provider failure.
 */
export function normalizeEdit(output: unknown, request: AiEditRequest, hasImage: boolean): AiEdit {
  if (!output || typeof output !== "object" || Array.isArray(output)) throw new AiProviderError(502, "returned no edit");
  const answer = record(output);
  const canUpdateImage = request.canUpdateImage && hasImage;
  const boxesById = new Map(request.boxes.map((b) => [b.id, b]));
  const fonts = new Set(request.fonts.map((f) => f.id));
  const filled = new Set<string>();
  let update: AiUpdateImage | null = null;
  const texts: AiAddText[] = [];
  for (const item of Array.isArray(answer.actions) ? answer.actions : []) {
    const action = record(item);
    if (action.action === "UPDATE_IMAGE") {
      const prompt = typeof action.prompt === "string" ? action.prompt.trim().slice(0, AI_PROMPT_MAX_LENGTH) : "";
      if (canUpdateImage && !update && prompt) update = { action: "UPDATE_IMAGE", prompt };
      continue;
    }
    if (action.action !== "ADD_TEXT") continue;
    const newText = text(action.text);
    if (newText === null) continue;
    const box = typeof action.position === "string" ? boxesById.get(action.position) : request.boxes.find((b) => !filled.has(b.id));
    if (!box || filled.has(box.id)) continue;
    filled.add(box.id);
    const rawFont = record(action.style).fontId;
    const fontId = typeof rawFont === "string" && fonts.has(rawFont) && rawFont !== box.fontId ? rawFont : null;
    if (newText === box.text && fontId === null) continue;
    texts.push({ action: "ADD_TEXT", text: newText, position: box.id, style: fontId === null ? null : { fontId } });
  }
  return { actions: update ? [update, ...texts] : texts };
}
