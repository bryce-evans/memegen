import { IMAGE_ACCEPT, MAX_PACK_IMAGES, type Asset, type UploadLimits } from "@memegen/shared";
import { FileButton, Icon, IconButton, Panel, Text } from "@memegen/ui";
import { contentUrl, uploadAsset } from "../../api.ts";
import { precheckMedia } from "../../media.ts";
import { useAction } from "../../useAction.ts";
import { ErrorView } from "../common.tsx";

export interface PackPanelProps {
  pack: Asset[];
  limits: UploadLimits;
  /** Images that can't be removed: already saved in the template's pack, or shown by a panel. */
  locked: (asset: Asset) => string | null;
  onAdded: (assets: Asset[]) => Promise<void>;
  onRemove: (asset: Asset) => void;
}

/**
 * Template authoring: the still images a multi-panel template's panels pick from. Images are uploaded as they are
 * (pre-checked against the image caps) and never edited; a saved template's pack only grows.
 */
export function PackPanel({ pack, limits, locked, onAdded, onRemove }: PackPanelProps) {
  const { busy, error, run } = useAction();
  const room = MAX_PACK_IMAGES - pack.length;

  function upload(files: File[]) {
    void run(async () => {
      const assets: Asset[] = [];
      for (const file of files.slice(0, room)) {
        const media = await precheckMedia(file, limits);
        const kind = media.kind;
        media.dispose();
        if (kind !== "image") throw new Error(`${file.name}: pack images must be still images (JPEG, PNG, or WebP)`);
        assets.push(await uploadAsset(file, file.name));
      }
      await onAdded(assets);
    });
  }

  return (
    <Panel
      heading="Image pack"
      className="pack-panel"
      headingActions={
        <FileButton
          size="sm"
          icon={<Icon name="upload" />}
          accept={IMAGE_ACCEPT}
          multiple
          disabled={busy || room <= 0}
          data-testid="pack-file"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length) upload(files);
          }}
        >
          {busy ? "Uploading…" : "Add images"}
        </FileButton>
      }
    >
      <Text size="sm" tone="muted">
        {pack.length} / {MAX_PACK_IMAGES} images. Panels show them whole, never cropped or edited.
      </Text>
      {pack.length > 0 && (
        <ul className="pack-list" data-testid="pack-list">
          {pack.map((asset, i) => {
            const reason = locked(asset);
            return (
              <li key={asset.id} className="pack-item" data-testid="pack-item" data-asset-id={asset.id}>
                <img className="panel-thumb" src={contentUrl(asset)} alt={`Image ${i + 1}`} title={asset.filename} />
                <IconButton
                  size="sm"
                  variant="quiet"
                  className="danger-icon"
                  label={reason ?? `Remove image ${i + 1}`}
                  disabled={reason !== null}
                  onClick={() => onRemove(asset)}
                >
                  <Icon name="close" />
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}
      {error !== null && <ErrorView error={error} testId="pack-error" />}
    </Panel>
  );
}
