import { AiProviderError, providerError, type AiImageProvider, type AiImageRequest } from "./types.ts";

/** OpenAI GPT Image: `POST {baseUrl}/images/edits` (multipart); GPT image models always answer with base64. */
export class OpenAiImageProvider implements AiImageProvider {
  readonly id = "openai";
  readonly label = "OpenAI";
  readonly baseUrl: string;
  readonly model: string;

  constructor({ baseUrl, model }: { baseUrl: string; model: string }) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.model = model;
  }

  async edit({ apiKey, prompt, image, signal }: AiImageRequest): Promise<Uint8Array<ArrayBuffer>> {
    const form = new FormData();
    form.set("model", this.model);
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
}
