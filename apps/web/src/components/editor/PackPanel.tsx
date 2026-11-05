import { useRef, useState } from "react";
import { IMAGE_ACCEPT, MAX_PACK_IMAGES, type Asset, type UploadLimits } from "@memegen/shared";
import { FileButton, Icon, IconButton, Inline, Panel, Text } from "@memegen/ui";
import { contentUrl, uploadAsset } from "../../api.ts";
import { precheckStillImage } from "../../media.ts";
import { useAction } from "../../useAction.ts";
import { ErrorView } from "../common.tsx";
import { SheetCropper } from "./SheetCropper.tsx";

export interface PackPanelProps {
  pack: Asset[];
  limits: UploadLimits;
  /** Images that can't be removed: already saved in the template's pack, or shown by a panel. */
  locked: (asset: Asset) => string | null;
  onAdded: (assets: Asset[]) => Promise<void>;
  onRemove: (asset: Asset) => void;
}

/** Template authoring: upload whole images or split a local sheet into reusable, unedited pack images. */
export function PackPanel({ pack, limits, locked, onAdded, onRemove }: PackPanelProps) {
  const { busy, error, run } = useAction();
  const [sheet, setSheet] = useState<{ file: File; key: number } | null>(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const sheetVersion = useRef(0);
  const uploading = useRef(false);
  const applyingSheet = useRef(false);
  const room = MAX_PACK_IMAGES - pack.length;

  function upload(files: File[]) {
    if (uploading.current || sheet !== null) return;
    uploading.current = true;
    void run(async (signal) => {
      try {
        const assets: Asset[] = [];
        for (const file of files.slice(0, room)) {
          signal.throwIfAborted();
          await precheckStillImage(file, limits);
          signal.throwIfAborted();
          assets.push(await uploadAsset(file, file.name, undefined, signal));
        }
        signal.throwIfAborted();
        await onAdded(assets);
      } finally {
        uploading.current = false;
      }
    });
  }

  return (
    <Panel
      heading="Image pack"
      className="pack-panel"
      headingActions={
        <Inline gap="sm">
          <FileButton
            size="sm"
            accept={IMAGE_ACCEPT}
            disabled={busy || sheetBusy || room <= 0}
            data-testid="pack-sheet-file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file && !uploading.current && !applyingSheet.current) setSheet({ file, key: ++sheetVersion.current });
            }}
          >
            {sheet ? "Replace sheet" : "Split sheet"}
          </FileButton>
          <FileButton
            size="sm"
            icon={<Icon name="upload" />}
            accept={IMAGE_ACCEPT}
            multiple
            disabled={busy || sheet !== null || room <= 0}
            data-testid="pack-file"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              if (files.length) upload(files);
            }}
          >
            {busy ? "Uploading…" : "Add images"}
          </FileButton>
        </Inline>
      }
    >
      <Text size="sm" tone="muted">
        {pack.length} / {MAX_PACK_IMAGES} reusable images. Add whole images or split one sheet into crops.
      </Text>
      {sheet && (
        <SheetCropper
          key={sheet.key}
          file={sheet.file}
          limits={limits}
          room={room}
          onAdded={onAdded}
          onBusyChange={(value) => {
            applyingSheet.current = value;
            setSheetBusy(value);
          }}
          onClose={() => {
            setSheet(null);
            applyingSheet.current = false;
            setSheetBusy(false);
          }}
        />
      )}
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
                  data-testid="pack-item-remove"
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
