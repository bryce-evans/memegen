import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile, rename } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { ObjectNotFoundError, type ByteRange, type StorageProvider, type StoredObject } from "./types.ts";

export class LocalStorageProvider implements StorageProvider {
  readonly name = "local";
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new Error(`key escapes storage root: ${key}`);
    return full;
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    const full = this.path(key);
    await mkdir(dirname(full), { recursive: true });
    const tmp = `${full}.${process.pid}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, full);
  }

  async get(key: string, range?: ByteRange): Promise<StoredObject> {
    const full = this.path(key);
    let size: number;
    try {
      size = (await stat(full)).size;
    } catch {
      throw new ObjectNotFoundError(key);
    }
    const stream = createReadStream(full, range ? { start: range.start, end: range.end } : {});
    return { body: Readable.toWeb(stream) as ReadableStream<Uint8Array>, size };
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.path(key));
      return true;
    } catch {
      return false;
    }
  }
}
