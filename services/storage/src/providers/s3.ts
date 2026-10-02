import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { ObjectNotFoundError, type ByteRange, type StorageProvider, type StoredObject } from "./types.ts";

export interface S3ProviderOptions {
  bucket: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Key prefix inside the bucket, e.g. "memegen/". */
  prefix?: string;
}

/** Any S3-compatible store (AWS, R2, MinIO). Credentials fall back to the AWS default chain. */
export class S3StorageProvider implements StorageProvider {
  readonly name = "s3";
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(opts: S3ProviderOptions) {
    this.bucket = opts.bucket;
    this.prefix = opts.prefix ?? "";
    this.client = new S3Client({
      region: opts.region ?? "us-east-1",
      endpoint: opts.endpoint || undefined,
      forcePathStyle: Boolean(opts.endpoint),
      credentials:
        opts.accessKeyId && opts.secretAccessKey
          ? { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey }
          : undefined,
    });
  }

  private key(key: string): string {
    return this.prefix + key;
  }

  async put(key: string, data: Uint8Array, mime: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: this.key(key), Body: data, ContentType: mime }),
    );
  }

  async get(key: string, range?: ByteRange): Promise<StoredObject> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.key(key),
          Range: range ? `bytes=${range.start}-${range.end}` : undefined,
        }),
      );
      const total = res.ContentRange ? Number(res.ContentRange.split("/")[1]) : Number(res.ContentLength);
      return { body: res.Body!.transformToWebStream() as ReadableStream<Uint8Array>, size: total };
    } catch (err) {
      if (err instanceof NoSuchKey || err instanceof NotFound) throw new ObjectNotFoundError(key);
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(key) }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(key) }));
      return true;
    } catch (err) {
      if (err instanceof NotFound || err instanceof NoSuchKey) return false;
      throw err;
    }
  }
}
