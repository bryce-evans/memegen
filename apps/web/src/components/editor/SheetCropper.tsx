import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { propagatedCrops, type Asset, type PixelCrop, type UploadLimits } from "@memegen/shared";
import { Button, Inline, Panel, SegmentedControl, Text, TextField } from "@memegen/ui";
import { uploadAsset } from "../../api.ts";
import { precheckStillImage } from "../../media.ts";
import { useAction } from "../../useAction.ts";
import { ErrorView } from "../common.tsx";

interface SheetCropperProps {
  file: File;
  limits: UploadLimits;
  room: number;
  onAdded: (assets: Asset[]) => Promise<void>;
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
}

type CropDraft = Record<keyof PixelCrop, string>;
const CROP_FIELDS = [
  { name: "x", label: "X (px)", min: 0 },
  { name: "y", label: "Y (px)", min: 0 },
  { name: "width", label: "Width (px)", min: 1 },
  { name: "height", label: "Height (px)", min: 1 },
] as const;
const DIRECTIONS = [
  { value: "horizontal", label: "Horizontal →", testId: "sheet-direction-horizontal" },
  { value: "vertical", label: "Vertical ↓", testId: "sheet-direction-vertical" },
] as const;

/** A local-only sheet preview. Only explicitly applied, fully validated PNG crops reach storage. */
export function SheetCropper({ file, limits, room, onAdded, onBusyChange, onClose }: SheetCropperProps) {
  const [image, setImage] = useState<ImageBitmap | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState<CropDraft>({ x: "0", y: "0", width: "", height: "" });
  const [selected, setSelected] = useState(false);
  const [direction, setDirection] = useState<"horizontal" | "vertical">("vertical");
  const [gap, setGap] = useState("0");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const applying = useRef(false);
  const { busy, error, setError, run } = useAction();

  useEffect(() => {
    let disposed = false;
    let bitmap: ImageBitmap | null = null;
    setImage(null);
    setReady(false);
    setLoadError(null);
    void (async () => {
      await precheckStillImage(file, limits);
      if (disposed) return;
      const decoded = await createImageBitmap(file);
      if (disposed) {
        decoded.close();
        return;
      }
      bitmap = decoded;
      setImage(decoded);
    })().catch((err: unknown) => {
      if (!disposed) setLoadError(err);
    });
    return () => {
      disposed = true;
      bitmap?.close();
    };
  }, [file, limits]);

  useEffect(() => {
    if (!image) return;
    try {
      const context = canvasRef.current?.getContext("2d");
      if (!context) throw new Error("Your browser could not create an image preview.");
      context.drawImage(image, 0, 0);
      setReady(true);
    } catch (err) {
      setLoadError(err);
    }
  }, [image]);

  const preview = useMemo((): { crops: PixelCrop[]; error: unknown } => {
    if (!image || !selected) return { crops: [], error: null };
    try {
      if ([...Object.values(draft), gap].some((value) => value.trim() === "")) {
        throw new Error("Enter whole-pixel values for the rectangle and gap.");
      }
      const first = { x: Number(draft.x), y: Number(draft.y), width: Number(draft.width), height: Number(draft.height) };
      return { crops: propagatedCrops(first, direction, Number(gap), image, room), error: null };
    } catch (err) {
      return { crops: [], error: err };
    }
  }, [image, selected, draft, direction, gap, room]);

  function point(e: PointerEvent<HTMLCanvasElement>) {
    const bounds = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(image!.width, Math.round(((e.clientX - bounds.left) / bounds.width) * image!.width))),
      y: Math.max(0, Math.min(image!.height, Math.round(((e.clientY - bounds.top) / bounds.height) * image!.height))),
    };
  }

  function drawTo(e: PointerEvent<HTMLCanvasElement>) {
    const start = drag.current;
    if (!start || start.pointerId !== e.pointerId || !image || applying.current) return;
    const end = point(e);
    setDraft({
      x: String(Math.min(start.x, end.x)),
      y: String(Math.min(start.y, end.y)),
      width: String(Math.abs(end.x - start.x)),
      height: String(Math.abs(end.y - start.y)),
    });
    setSelected(true);
    setError(null);
  }

  function apply() {
    if (applying.current || !image || !ready || loadError !== null || !preview.crops.length || preview.error !== null) return;
    applying.current = true;
    onBusyChange(true);
    void run(async (signal) => {
      try {
        // Recheck capacity at the action boundary, before encoding or uploading anything.
        const crops = propagatedCrops(preview.crops[0]!, direction, Number(gap), image, room);
        const canvas = document.createElement("canvas");
        canvas.width = crops[0]!.width;
        canvas.height = crops[0]!.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Your browser could not create crop images.");
        const files: File[] = [];
        const basename = file.name.replace(/\.[^.]+$/, "") || "sheet";
        try {
          for (const [index, crop] of crops.entries()) {
            signal.throwIfAborted();
            context.clearRect(0, 0, canvas.width, canvas.height);
            context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
            const blob = await new Promise<Blob>((resolve, reject) => {
              canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("The browser could not encode a PNG crop."))), "image/png");
            });
            signal.throwIfAborted();
            const output = new File([blob], `${basename}-${index + 1}.png`, { type: "image/png" });
            await precheckStillImage(output, limits);
            files.push(output);
          }
        } finally {
          canvas.width = 0;
          canvas.height = 0;
        }
        // Validate every output before the first upload: PNG encoding can exceed the source file's byte size.
        const assets: Asset[] = [];
        for (const output of files) {
          signal.throwIfAborted();
          assets.push(await uploadAsset(output, output.name, undefined, signal));
        }
        signal.throwIfAborted();
        await onAdded(assets);
        if (!signal.aborted) onClose();
      } finally {
        applying.current = false;
        if (!signal.aborted) onBusyChange(false);
      }
    });
  }

  const shownError = loadError ?? error ?? preview.error;
  return (
    <Panel variant="inset" heading="Split sheet" className="sheet-cropper" aria-busy={(!image && loadError === null) || busy}>
      <div className="sheet-cropper-content">
        <Text size="sm" tone="muted" className="sheet-source-name">
          {file.name}
          {image ? ` · ${image.width} × ${image.height} px` : ""}
        </Text>
        <Text size="sm" tone="muted">
          Draw the first rectangle, or enter its pixel bounds. Repeat right or down; only complete crops fit. The original sheet is not uploaded.
        </Text>
        {!image && loadError === null && <Text size="sm">Loading sheet…</Text>}
        {image && (
          <>
            <div className="sheet-canvas-wrap" style={{ "--sheet-aspect": image.width / image.height } as CSSProperties}>
              <canvas
                ref={canvasRef}
                className="sheet-crop-canvas"
                width={image.width}
                height={image.height}
                data-testid="sheet-crop-canvas"
                data-ready={ready}
                aria-label="Sheet preview. Draw the first crop, or use the pixel bounds fields below."
                aria-disabled={busy}
                onPointerDown={(e) => {
                  if (!ready || applying.current || e.button !== 0 || drag.current) return;
                  e.preventDefault();
                  drag.current = { ...point(e), pointerId: e.pointerId };
                  e.currentTarget.setPointerCapture(e.pointerId);
                  drawTo(e);
                }}
                onPointerMove={drawTo}
                onPointerUp={(e) => {
                  if (drag.current?.pointerId !== e.pointerId) return;
                  drawTo(e);
                  drag.current = null;
                  if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
                }}
                onPointerCancel={() => {
                  drag.current = null;
                }}
                onLostPointerCapture={() => {
                  drag.current = null;
                }}
              />
              {preview.crops.map((crop, index) => (
                <div
                  key={index}
                  className="sheet-crop-overlay"
                  data-first={index === 0 || undefined}
                  aria-hidden
                  style={{
                    left: `${(crop.x / image.width) * 100}%`,
                    top: `${(crop.y / image.height) * 100}%`,
                    width: `${(crop.width / image.width) * 100}%`,
                    height: `${(crop.height / image.height) * 100}%`,
                  }}
                >
                  <span>{index + 1}</span>
                </div>
              ))}
            </div>
            <div className="sheet-crop-fields">
              {CROP_FIELDS.map(({ name, label, min }) => (
                <TextField
                  key={name}
                  label={label}
                  type="number"
                  size="sm"
                  min={min}
                  step={1}
                  value={draft[name]}
                  disabled={busy}
                  data-testid={`sheet-crop-${name}`}
                  onChange={(e) => {
                    const value = e.target.value;
                    setDraft((current) => ({ ...current, [name]: value }));
                    setSelected(true);
                    setError(null);
                  }}
                />
              ))}
            </div>
            <SegmentedControl<"horizontal" | "vertical">
              aria-label="Repeat crops"
              size="sm"
              options={DIRECTIONS.map((option) => ({ ...option, disabled: busy }))}
              value={direction}
              onChange={(value) => {
                setDirection(value);
                setError(null);
              }}
            />
            <TextField
              label="Gap between crops (source pixels)"
              type="number"
              size="sm"
              min={0}
              step={1}
              value={gap}
              disabled={busy}
              data-testid="sheet-gap"
              onChange={(e) => {
                setGap(e.target.value);
                setError(null);
              }}
            />
          </>
        )}
        <Text size="sm" data-testid="sheet-crop-count" role="status">
          {preview.crops.length} {preview.crops.length === 1 ? "crop" : "crops"} · {room} pack slots available
        </Text>
        {shownError !== null && <ErrorView error={shownError} testId="sheet-error" />}
        <Inline justify="end">
          <Button
            size="sm"
            disabled={busy}
            data-testid="sheet-cancel"
            onClick={() => {
              if (!applying.current) onClose();
            }}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={busy || !ready || !preview.crops.length || loadError !== null}
            data-testid="sheet-apply"
            onClick={apply}
          >
            {busy ? "Creating images…" : "Add crops to pack"}
          </Button>
        </Inline>
      </div>
    </Panel>
  );
}
