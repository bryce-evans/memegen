import { join } from "node:path";
import {
  AutoProcessor,
  AutoTokenizer,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  env,
  RawImage,
  type PreTrainedModel,
  type PreTrainedTokenizer,
  type Processor,
} from "@huggingface/transformers";

/**
 * Text queries are embedded as the mean of these phrasings (CLIP's prompt ensembling): one bare word ("pet") matches
 * far better as several captions than alone.
 */
const QUERY_PROMPTS = [
  "a photo of a {}",
  "a {}",
  "a picture of a {}",
  "an image of a {}",
  "a cropped photo of a {}",
  "a meme of a {}",
];

/**
 * Some images (lots of caption text, busy scenes) sit close to every query. Their similarity to this neutral caption
 * is subtracted from their text scores, so they don't top every search.
 */
const BASELINE_PROMPT = "a photo";

/** CLIP (via transformers.js / ONNX Runtime): images and text into one unit-length embedding space. */
export class Clip {
  readonly model: string;
  readonly dimension: number;
  private readonly processor: Processor;
  private readonly tokenizer: PreTrainedTokenizer;
  private readonly vision: PreTrainedModel;
  private readonly text: PreTrainedModel;
  private baseline: Float32Array | null = null;

  private constructor(model: string, processor: Processor, tokenizer: PreTrainedTokenizer, vision: PreTrainedModel, text: PreTrainedModel) {
    this.model = model;
    this.processor = processor;
    this.tokenizer = tokenizer;
    this.vision = vision;
    this.text = text;
    this.dimension = (vision.config as unknown as { projection_dim: number }).projection_dim;
  }

  /** Loads `model`, downloading it into `dataDir/models` the first time. */
  static async load(model: string, dataDir: string): Promise<Clip> {
    env.cacheDir = join(dataDir, "models");
    const [processor, tokenizer, vision, text] = await Promise.all([
      AutoProcessor.from_pretrained(model),
      AutoTokenizer.from_pretrained(model),
      CLIPVisionModelWithProjection.from_pretrained(model, { dtype: "fp32" }),
      CLIPTextModelWithProjection.from_pretrained(model, { dtype: "fp32" }),
    ]);
    const clip = new Clip(model, processor, tokenizer, vision, text);
    clip.baseline = await clip.embedPrompts([BASELINE_PROMPT]);
    return clip;
  }

  /** A still image or a GIF (its first frame). */
  async embedImage(bytes: Uint8Array): Promise<Float32Array> {
    const image = await RawImage.fromBlob(new Blob([bytes as Uint8Array<ArrayBuffer>]));
    const { image_embeds } = await this.vision(await this.processor(image));
    return normalize(image_embeds.data as Float32Array);
  }

  /**
   * A natural-language query ("dog", "a man pointing") as a search direction: its embedding minus the neutral
   * baseline's, so an image's inner product with it is its query similarity less its similarity to the baseline.
   * Not unit length.
   */
  async embedQuery(query: string): Promise<Float32Array> {
    const embedding = await this.embedPrompts(QUERY_PROMPTS.map((p) => p.replace("{}", query)));
    return embedding.map((x, i) => x - this.baseline![i]!);
  }

  private async embedPrompts(prompts: string[]): Promise<Float32Array> {
    const inputs = this.tokenizer(prompts, { padding: true, truncation: true });
    const { text_embeds } = await this.text(inputs);
    const all = text_embeds.data as Float32Array;
    const mean = new Float32Array(this.dimension);
    for (let p = 0; p < prompts.length; p++) {
      const one = normalize(all.subarray(p * this.dimension, (p + 1) * this.dimension));
      for (let i = 0; i < this.dimension; i++) mean[i] = mean[i]! + one[i]!;
    }
    return normalize(mean);
  }
}

export function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

function normalize(v: Float32Array): Float32Array {
  const length = Math.sqrt(dot(v, v)) || 1;
  return v.map((x) => x / length);
}
