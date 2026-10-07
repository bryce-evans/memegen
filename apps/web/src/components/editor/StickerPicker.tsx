import type { Sticker } from "@memegen/shared";
import { Button, Dialog, EmptyState, Spinner } from "@memegen/ui";
import { contentUrl, listStickers } from "../../api.ts";
import { plural } from "../../format.ts";
import { usePaged } from "../../usePaged.ts";
import { ErrorView, LoadMoreButton } from "../common.tsx";

export interface StickerPickerProps {
  open: boolean;
  onClose: () => void;
  /** Called with the chosen sticker; the picker closes itself. */
  onPick: (sticker: Sticker) => void;
}

/** The Layers panel's Sticker button: the sticker library as a grid of thumbnails; picking one adds it as an image layer. */
export function StickerPicker({ open, onClose, onPick }: StickerPickerProps) {
  return (
    <Dialog open={open} onClose={onClose} heading="Add sticker" className="sticker-picker" data-testid="sticker-picker">
      {/* Dialog children mount only while open, so every opening loads the library fresh. */}
      <StickerGrid
        onPick={(sticker) => {
          onPick(sticker);
          onClose();
        }}
      />
    </Dialog>
  );
}

function StickerGrid({ onPick }: { onPick: (sticker: Sticker) => void }) {
  const list = usePaged<Sticker>("stickers", (offset) => listStickers({ offset }));
  return (
    <>
      {list.error !== null && <ErrorView error={list.error} />}
      {!list.loading && list.items.length === 0 && list.error === null && (
        <EmptyState title="No stickers yet." description="Add one with “+ Sticker” under New template on Create." />
      )}
      {/* Most used first (the API ranks by posts, then saves). */}
      <ul className="sticker-grid" data-testid="sticker-grid" aria-busy={list.loading}>
        {list.items.map((sticker) => {
          const used = `posted ${plural(sticker.useCount, "time")}`;
          return (
            <li key={sticker.id}>
              <Button
                variant="quiet"
                className="sticker-option"
                title={`${sticker.name} · ${used}`}
                aria-label={`Add ${sticker.name}, ${used}`}
                data-testid="sticker-option"
                data-sticker-id={sticker.id}
                data-use-count={sticker.useCount}
                onClick={() => onPick(sticker)}
              >
                <img src={contentUrl(sticker.asset)} alt="" />
                <span className="sticker-uses">{sticker.useCount}🔥</span>
              </Button>
            </li>
          );
        })}
      </ul>
      {list.loading && <Spinner label="Loading…" />}
      <LoadMoreButton hasMore={list.hasMore} loading={list.loading} onLoadMore={list.loadMore} testId="sticker-load-more" />
    </>
  );
}
