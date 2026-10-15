import { AiProviderError, providerError, type AiImageProvider, type AiImageRequest } from "./types.ts";

interface GenerateContentResponse {
  promptFeedback?: { blockReason?: string };
  candidates?: { finishReason?: string; content?: { parts?: { text?: string; inlineData?: { data?: string } }[] } }[];
}

/** Google Nano Banana: `POST {baseUrl}/models/{model}:generateContent` with the prompt and the image inline. */
export class GeminiImageProvider implements AiImageProvider {
  readonly id = "gemini";
  readonly label = "Gemini";
  readonly baseUrl: string;
  readonly model: string;

  constructor({ baseUrl, model }: { baseUrl: string; model: string }) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.model = model;
  }

  async edit({ apiKey, prompt, image, signal }: AiImageRequest): Promise<Uint8Array<ArrayBuffer>> {
    const res = await fetch(`${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        contents: [
          { parts: [{ text: prompt }, { inlineData: { mimeType: image.mime, data: Buffer.from(image.data).toString("base64") } }] },
        ],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
      signal,
    });
    if (!res.ok) throw await providerError(res);
    const body = (await res.json()) as GenerateContentResponse;
    if (body.promptFeedback?.blockReason) throw new AiProviderError(422, `prompt blocked (${body.promptFeedback.blockReason})`);
    const [candidate] = body.candidates ?? [];
    const parts = candidate?.content?.parts ?? [];
    const data = parts.find((p) => p.inlineData?.data)?.inlineData?.data;
    if (data) return Buffer.from(data, "base64");
    // No image: the model's text (often a refusal) or the finish reason says why.
    const text = parts.flatMap((p) => (p.text ? [p.text.trim()] : [])).join(" ");
    throw new AiProviderError(422, `returned no image${text ? `: ${text}` : candidate?.finishReason ? ` (${candidate.finishReason})` : ""}`);
  }
}
