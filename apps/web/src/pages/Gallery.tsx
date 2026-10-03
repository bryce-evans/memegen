import { useSearchParams } from "react-router-dom";
import { GALLERY_SORTS, PERIODS, type GallerySort, type Meme, type Period } from "@memegen/shared";
import { Button, PageHeader, SegmentedControl, SidebarSection, Spinner, useSkin } from "@memegen/ui";
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
  // Build from the live URL, not this render's params: React Router applies navigations in a
  // transition, so two quick clicks would otherwise both start from the same stale value.
  const update = (next: { period?: Period; sort?: GallerySort }) => {
    const live = new URLSearchParams(window.location.search);
    setParams(
      { period: next.period ?? live.get("period") ?? period, sort: next.sort ?? live.get("sort") ?? sort },
      { replace: true },
    );
  };
  return { period, sort, update };
}

/**
 * Sort/period controls for gallery-style meme feeds (`/` defaults to this week, tag pages to all time).
 * The skin decides whether they sit in the side column or beside the feed title.
 */
export function GalleryFilters({ defaultPeriod, placement }: { defaultPeriod: Period; placement: "sidebar" | "header" }) {
  const { period, sort, update } = useGalleryFilters(defaultPeriod);
  const sortControl = (
    <SegmentedControl
      aria-label="Sort"
      size="sm"
      value={sort}
      onChange={(s) => update({ sort: s })}
      options={GALLERY_SORTS.map((s) => ({ value: s, label: SORT_LABELS[s], testId: `sort-${s}` }))}
    />
  );
  const periodControl = (
    <SegmentedControl
      aria-label="Period"
      size="sm"
      orientation={placement === "sidebar" ? "vertical" : "horizontal"}
      value={period}
      onChange={(p) => update({ period: p })}
      options={PERIODS.map((p) => ({ value: p, label: PERIOD_LABELS[p], testId: `period-${p}` }))}
    />
  );
  if (placement === "header") {
    return (
      <>
        {sortControl}
        {periodControl}
      </>
    );
  }
  return (
    <>
      <SidebarSection heading="Sort">{sortControl}</SidebarSection>
      <SidebarSection heading="Period">{periodControl}</SidebarSection>
    </>
  );
}

/** Paged meme grid for the URL's period/sort, optionally limited to a tag. */
export function GalleryFeed({ defaultPeriod, tag, title }: { defaultPeriod: Period; tag?: string; title: string }) {
  const { user } = useAuth();
  const { layout } = useSkin();
  const { period, sort } = useGalleryFilters(defaultPeriod);
  const list = usePaged<Meme>(`${period}:${sort}:${tag ?? ""}:${user?.id ?? ""}`, (offset) =>
    getGallery(period, sort, offset, 24, tag),
  );
  const filtersHere = layout.filters === "header";

  return (
    <>
      <PageHeader
        level={tag ? 2 : 1}
        title={filtersHere ? title : `${title} · ${SORT_LABELS[sort]} · ${PERIOD_LABELS[period]}`}
        actions={filtersHere ? <GalleryFilters defaultPeriod={defaultPeriod} placement="header" /> : undefined}
      />
      {list.error !== null && <ErrorView error={list.error} />}
      <div className="meme-feed" data-testid="meme-feed" aria-busy={list.loading}>
        {!(list.loading && list.items.length === 0) && (
          <MemeGrid memes={list.items} onChange={(m) => list.setItems((items) => items.map((x) => (x.id === m.id ? m : x)))} />
        )}
        {list.loading && <Spinner label="Loading…" />}
        {list.hasMore && !list.loading && (
          <div className="load-more">
            <Button data-testid="load-more" onClick={list.loadMore}>
              Load more
            </Button>
          </div>
        )}
      </div>
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
