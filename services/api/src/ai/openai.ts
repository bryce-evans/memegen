import { EDIT_JSON_SCHEMA, editSystemPrompt, editUserPrompt, parseEditJson } from "./quickEdit.ts";
import { AiProviderError, providerError, type AiEditCall, type AiImageProvider, type AiImageRequest } from "./types.ts";

interface ChatCompletionResponse {
  choices?: { message?: { content?: string | null; refusal?: string | null } }[];
}

/**
 * OpenAI: GPT Image edits at `POST {baseUrl}/images/edits` (multipart; GPT image models always answer with base64),
 * and Quick Creator edits at `POST {baseUrl}/chat/completions` with a strict JSON schema.
 */
export class OpenAiProvider implements AiImageProvider {
  readonly id = "openai";
  readonly label = "OpenAI";
  readonly baseUrl: string;
  readonly imageModel: string;
  readonly textModel: string;

  constructor({ baseUrl, imageModel, textModel }: { baseUrl: string; imageModel: string; textModel: string }) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.imageModel = imageModel;
    this.textModel = textModel;
  }

  async edit({ apiKey, prompt, image, model, signal }: AiImageRequest): Promise<Uint8Array<ArrayBuffer>> {
    const form = new FormData();
    form.set("model", model ?? this.imageModel);
    form.set("prompt", prompt);
    form.set("image", new Blob([image.data], { type: image.mime }), `background${image.ext}`);
    const res = await fetch(`${this.baseUrl}/images/edits`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
      signal,
    });
    if (!res.ok) throw await providerError(res);
    const body = (await res.json()) as { data?: { b64_json?: string }[] };
    const b64 = body.data?.[0]?.b64_json;
    if (!b64) throw new AiProviderError(502, "returned no image");
    return Buffer.from(b64, "base64");
  }

  async quickEdit({ apiKey, request, image, model, signal }: AiEditCall): Promise<unknown> {
    const content: unknown[] = [{ type: "text", text: editUserPrompt({ request, image }) }];
    if (image) content.push({ type: "image_url", image_url: { url: `data:${image.mime};base64,${Buffer.from(image.data).toString("base64")}` } });
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: model ?? this.textModel,
        messages: [
          { role: "system", content: editSystemPrompt() },
          { role: "user", content },
        ],
        response_format: { type: "json_schema", json_schema: { name: "quick_creator_edit", strict: true, schema: EDIT_JSON_SCHEMA } },
      }),
      signal,
    });
    if (!res.ok) throw await providerError(res);
    const body = (await res.json()) as ChatCompletionResponse;
    const message = body.choices?.[0]?.message;
    if (message?.refusal) throw new AiProviderError(422, message.refusal);
    return parseEditJson(message?.content);
  }
}
