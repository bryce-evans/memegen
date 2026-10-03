export interface ByteRange {
  /** Inclusive byte offsets. */
  start: number;
  end: number;
}

export interface StoredObject {
  body: ReadableStream<Uint8Array>;
  /** Total object size, independent of the requested range. */
  size: number;
}

/** A place bytes live. Keys are provider-relative, '/'-separated, and never start with '/'. */
export interface StorageProvider {
  readonly name: string;
  put(key: string, data: Uint8Array, mime: string): Promise<void>;
  get(key: string, range?: ByteRange): Promise<StoredObject>;
  delete(key: string): Promise<void>;
}

export class ObjectNotFoundError extends Error {
  constructor(key: string) {
    super(`object not found: ${key}`);
  }
}
