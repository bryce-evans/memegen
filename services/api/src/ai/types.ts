import type { AiProviderId } from "@memegen/shared";

export interface AiImageRequest {
  /** The caller's own key for this provider, sent per request and never stored. */
  apiKey: string;
  prompt: string;
  /** Background image the model edits or uses as context; a sniffed still image. */
  image: { data: Uint8Array<ArrayBuffer>; mime: string; ext: string };
  signal?: AbortSignal;
}

/** One image model behind a user's API key: prompt + background image in, one image's bytes out. */
export interface AiImageProvider {
  readonly id: AiProviderId;
  readonly label: string;
  edit(request: AiImageRequest): Promise<Uint8Array<ArrayBuffer>>;
}

/** The provider answered with an error, or with no image. `status` is the provider's HTTP status (502 for no image). */
export class AiProviderError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** `{ error: { message } }` (OpenAI and Gemini alike), else the status line. */
export async function providerError(res: Response): Promise<AiProviderError> {
  let message = `${res.status} ${res.statusText}`;
  try {
    const body = (await res.json()) as { error?: { message?: unknown } };
    if (typeof body.error?.message === "string" && body.error.message) message = body.error.message;
  } catch {
    // non-JSON error body; keep the status line
  }
  return new AiProviderError(res.status, message);
}
