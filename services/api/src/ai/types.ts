import type { AiEditRequest, AiProviderId } from "@memegen/shared";

/** A sniffed still image sent to a model. */
export interface AiImage {
  data: Uint8Array<ArrayBuffer>;
  mime: string;
  ext: string;
}

export interface AiImageRequest {
  /** The caller's own key for this provider, sent per request and never stored. */
  apiKey: string;
  prompt: string;
  /** Background image the model edits or uses as context. */
  image: AiImage;
  /** The agent's image model; the adapter's default when absent. */
  model?: string;
  signal?: AbortSignal;
}

/** One `quick-creator/1` edit: the agent's instructions and the request, answered by a text model. */
export interface AiEditCall {
  /** The caller's own key for this provider, sent per request and never stored. */
  apiKey: string;
  /** The agent's own instructions (style and voice), after the spec's rules. */
  instructions: string;
  request: AiEditRequest;
  /** The still media the boxes sit on, when the client sends it; image edits need it. */
  image?: AiImage;
  /** The agent's text model; the adapter's default when absent. */
  model?: string;
  signal?: AbortSignal;
}

/** The models behind a user's API key for one provider. */
export interface AiProvider {
  readonly id: AiProviderId;
  readonly label: string;
  /** Prompt + background image in, one image's bytes out. */
  edit(request: AiImageRequest): Promise<Uint8Array<ArrayBuffer>>;
  /** A `quick-creator/1` request in; the model's parsed JSON out, unchecked (see `normalizeEdit`). */
  quickEdit(call: AiEditCall): Promise<unknown>;
}

/** The provider answered with an error, or with no result. `status` is the provider's HTTP status (502 for no result). */
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
