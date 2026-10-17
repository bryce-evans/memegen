import { EDIT_GEMINI_SCHEMA, editSystemPrompt, editUserPrompt, parseEditJson } from "./quickEdit.ts";
import { AiProviderError, providerError, type AiEditCall, type AiImageProvider, type AiImageRequest } from "./types.ts";

interface GenerateContentResponse {
  promptFeedback?: { blockReason?: string };
  candidates?: { finishReason?: string; content?: { parts?: { text?: string; inlineData?: { data?: string } }[] } }[];
}

/**
 * Google Gemini at `POST {baseUrl}/models/{model}:generateContent`: Nano Banana image edits with the image inline,
 * and Quick Creator edits from a text model answering JSON.
 */
export class GeminiProvider implements AiImageProvider {
  readonly id = "gemini";
  readonly label = "Gemini";
  readonly baseUrl: string;
  readonly imageModel: string;
  readonly textModel: string;

  constructor({ baseUrl, imageModel, textModel }: { baseUrl: string; imageModel: string; textModel: string }) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.imageModel = imageModel;
    this.textModel = textModel;
  }

  private async generate(model: string, apiKey: string, body: unknown, signal?: AbortSignal): Promise<GenerateContentResponse> {
    const res = await fetch(`${this.baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw await providerError(res);
    const result = (await res.json()) as GenerateContentResponse;
    if (result.promptFeedback?.blockReason) throw new AiProviderError(422, `prompt blocked (${result.promptFeedback.blockReason})`);
    return result;
  }

  async edit({ apiKey, prompt, image, model, signal }: AiImageRequest): Promise<Uint8Array<ArrayBuffer>> {
    const body = await this.generate(
      model ?? this.imageModel,
      apiKey,
      {
        contents: [
          { parts: [{ text: prompt }, { inlineData: { mimeType: image.mime, data: Buffer.from(image.data).toString("base64") } }] },
        ],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      },
      signal,
    );
    const [candidate] = body.candidates ?? [];
    const parts = candidate?.content?.parts ?? [];
    const data = parts.find((p) => p.inlineData?.data)?.inlineData?.data;
    if (data) return Buffer.from(data, "base64");
    // No image: the model's text (often a refusal) or the finish reason says why.
    const text = parts.flatMap((p) => (p.text ? [p.text.trim()] : [])).join(" ");
    throw new AiProviderError(422, `returned no image${text ? `: ${text}` : candidate?.finishReason ? ` (${candidate.finishReason})` : ""}`);
  }

  async quickEdit({ apiKey, request, image, model, signal }: AiEditCall): Promise<unknown> {
    const parts: unknown[] = [{ text: editUserPrompt({ request, image }) }];
    if (image) parts.push({ inlineData: { mimeType: image.mime, data: Buffer.from(image.data).toString("base64") } });
    const body = await this.generate(
      model ?? this.textModel,
      apiKey,
      {
        systemInstruction: { parts: [{ text: editSystemPrompt() }] },
        contents: [{ parts }],
        generationConfig: { responseMimeType: "application/json", responseSchema: EDIT_GEMINI_SCHEMA },
      },
      signal,
    );
    return parseEditJson(body.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text);
  }
}
