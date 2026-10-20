import type { FetchAsset } from "./catalog.ts";

/** Reads asset bytes over storage's HTTP API, so the sidecar works with every storage provider. */
export function fetchFromStorage(storageUrl: string): FetchAsset {
  return async (assetId) => {
    const res = await fetch(`${storageUrl}/assets/${assetId}/content`);
    if (!res.ok) throw new Error(`storage answered ${res.status} for asset ${assetId}`);
    return new Uint8Array(await res.arrayBuffer());
  };
}
