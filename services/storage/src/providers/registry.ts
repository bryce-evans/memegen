import { LocalStorageProvider } from "./local.ts";
import { S3StorageProvider } from "./s3.ts";
import type { StorageProvider } from "./types.ts";

export type ProviderFactory = (env: NodeJS.ProcessEnv) => StorageProvider;

/**
 * Named provider factories. Register a new backend (GCS, Azure, ...) here or via
 * `registerProvider` before `createProviders`; asset rows store the provider name,
 * so existing files keep resolving after the default changes.
 */
const factories = new Map<string, ProviderFactory>([
  ["local", (env) => new LocalStorageProvider(env.LOCAL_STORAGE_DIR || ".data/storage")],
  [
    "s3",
    (env) => {
      if (!env.S3_BUCKET) throw new Error("S3_BUCKET is required for the s3 provider");
      return new S3StorageProvider({
        bucket: env.S3_BUCKET,
        region: env.S3_REGION,
        endpoint: env.S3_ENDPOINT,
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        prefix: env.S3_PREFIX,
      });
    },
  ],
]);

export function registerProvider(name: string, factory: ProviderFactory): void {
  factories.set(name, factory);
}

export interface Providers {
  /** Provider used for new uploads. */
  readonly default: StorageProvider;
  get(name: string): StorageProvider;
  names(): string[];
}

/**
 * Instantiates providers lazily so unconfigured ones (e.g. s3 without a bucket)
 * only fail if an asset actually references them.
 */
export function createProviders(defaultName: string, env: NodeJS.ProcessEnv = process.env): Providers {
  const instances = new Map<string, StorageProvider>();
  const get = (name: string): StorageProvider => {
    let provider = instances.get(name);
    if (!provider) {
      const factory = factories.get(name);
      if (!factory) throw new Error(`unknown storage provider: ${name}`);
      provider = factory(env);
      instances.set(name, provider);
    }
    return provider;
  };
  return { default: get(defaultName), get, names: () => [...factories.keys()] };
}

/** Fixed provider set, e.g. for tests. */
export function staticProviders(provider: StorageProvider): Providers {
  return {
    default: provider,
    get: (name) => {
      if (name !== provider.name) throw new Error(`unknown storage provider: ${name}`);
      return provider;
    },
    names: () => [provider.name],
  };
}
