import { useSearchParams } from "react-router-dom";
import { GALLERY_SORTS, PERIODS, type GallerySort, type Meme, type Period } from "@memegen/shared";
import { getGallery } from "../api.ts";
import { useAuth } from "../auth.tsx";
import { ErrorView } from "../components/common.tsx";
import { MemeGrid } from "../components/memes.tsx";
import { usePaged } from "../usePaged.ts";

export const PERIOD_LABELS: Record<Period, string> = {
  day: "Today",
  week: "This week",
  month: "This month",
  year: "This year",
  all: "All time",
};

const SORT_LABELS: Record<GallerySort, string> = { best: "Best", new: "New" };

/** Gallery filters live in the URL so the side column and the grid share them. */
function useGalleryFilters(defaultPeriod: Period) {
  const [params, setParams] = useSearchParams();
  const periodParam = params.get("period");
  const sortParam = params.get("sort");
  const period: Period = PERIODS.find((p) => p === periodParam) ?? defaultPeriod;
  const sort: GallerySort = GALLERY_SORTS.find((s) => s === sortParam) ?? "best";
  const update = (next: { period?: Period; sort?: GallerySort }) =>
    setParams({ period: next.period ?? period, sort: next.sort ?? sort }, { replace: true });
  return { period, sort, update };
}

/** Side-column controls for gallery-style meme feeds (`/` defaults to this week, tag pages to all time). */
export function GalleryFilters({ defaultPeriod }: { defaultPeriod: Period }) {
  const { period, sort, update } = useGalleryFilters(defaultPeriod);
  return (
    <>
      <div className="side-group" role="group" aria-label="Sort">
        <h4>Sort</h4>
        {GALLERY_SORTS.map((s) => (
          <button
            key={s}
            type="button"
            className={s === sort ? "side-item active" : "side-item"}
            aria-pressed={s === sort}
            data-testid={`sort-${s}`}
            onClick={() => update({ sort: s })}
          >
            {SORT_LABELS[s]}
          </button>
        ))}
      </div>
      <div className="side-group" role="group" aria-label="Period">
        <h4>Period</h4>
        {PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            className={p === period ? "side-item active" : "side-item"}
            aria-pressed={p === period}
            data-testid={`period-${p}`}
            onClick={() => update({ period: p })}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>
    </>
  );
}

/** Paged meme grid for the URL's period/sort, optionally limited to a tag. */
export function GalleryFeed({ defaultPeriod, tag, title }: { defaultPeriod: Period; tag?: string; title: string }) {
  const { user } = useAuth();
  const { period, sort } = useGalleryFilters(defaultPeriod);
  const list = usePaged<Meme>(`${period}:${sort}:${tag ?? ""}:${user?.id ?? ""}`, (offset) =>
    getGallery(period, sort, offset, 24, tag),
  );

  return (
    <>
      <h2 className={tag ? "section-title" : "page-title"}>
        {title} · {SORT_LABELS[sort]} · {PERIOD_LABELS[period]}
      </h2>
      {list.error !== null && <ErrorView error={list.error} />}
      {!(list.loading && list.items.length === 0) && (
        <MemeGrid memes={list.items} onChange={(m) => list.setItems((items) => items.map((x) => (x.id === m.id ? m : x)))} />
      )}
      {list.loading && <p className="muted">Loading…</p>}
      {list.hasMore && !list.loading && (
        <div className="center">
          <button type="button" data-testid="load-more" onClick={list.loadMore}>
            Load more
          </button>
        </div>
      )}
    </>
  );
}

export function Gallery() {
  return (
    <section>
      <GalleryFeed defaultPeriod="week" title="Gallery" />
    </section>
  );
}
