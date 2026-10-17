import { EDIT_JSON_SCHEMA, editSystemPrompt, editUserPrompt, parseEditJson } from "./quickEdit.ts";
import { AiProviderError, providerError, type AiEditCall, type AiProvider } from "./types.ts";

/** The Messages API version the request and response shapes follow. */
const ANTHROPIC_VERSION = "2023-06-01";
/** Output cap for one edit; the answer is a short JSON object. */
const MAX_TOKENS = 4096;

interface MessagesResponse {
  stop_reason?: string | null;
  content?: { type: string; text?: string }[];
}

/**
 * Anthropic Claude: Quick Creator edits at `POST {baseUrl}/messages` with structured outputs (`output_config.format`,
 * the same JSON schema as OpenAI's strict mode). Text only: Claude doesn't generate images, so it can be a user's
 * Agent Provider but never their Image Generator.
 */
export class AnthropicProvider implements AiProvider {
  readonly id = "anthropic";
  readonly label = "Claude";
  readonly baseUrl: string;
  readonly textModel: string;

  constructor({ baseUrl, textModel }: { baseUrl: string; textModel: string }) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.textModel = textModel;
  }

  async quickEdit({ apiKey, request, image, model, signal }: AiEditCall): Promise<unknown> {
    const content: unknown[] = [{ type: "text", text: editUserPrompt({ request, image }) }];
    if (image) content.push({ type: "image", source: { type: "base64", media_type: image.mime, data: Buffer.from(image.data).toString("base64") } });
    const res = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
      body: JSON.stringify({
        model: model ?? this.textModel,
        max_tokens: MAX_TOKENS,
        system: editSystemPrompt(),
        messages: [{ role: "user", content }],
        output_config: { format: { type: "json_schema", schema: EDIT_JSON_SCHEMA } },
      }),
      signal,
    });
    if (!res.ok) throw await providerError(res);
    const body = (await res.json()) as MessagesResponse;
    const text = body.content?.find((b) => b.type === "text")?.text;
    // A refusal's text takes precedence over the schema, so it's the reason, not an edit.
    if (body.stop_reason === "refusal") throw new AiProviderError(422, text?.trim() || "declined the request");
    return parseEditJson(text);
  }
}
