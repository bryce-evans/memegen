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

/** `popular` = `/`, `recent` = `/recent`, `tag` = the memes on `/t/:slug`. */
export type FeedKind = "popular" | "recent" | "tag";

interface FeedConfig {
  /** Default (or fixed, without its control) period and sort. */
  period: Period;
  sort: GallerySort;
  periodControl: boolean;
  sortControl: boolean;
}

const FEEDS: Record<FeedKind, FeedConfig> = {
  popular: { period: "week", sort: "best", periodControl: true, sortControl: false },
  recent: { period: "all", sort: "new", periodControl: false, sortControl: false },
  tag: { period: "all", sort: "best", periodControl: true, sortControl: true },
};

/** Which feed (if any) a pathname shows, so the side column can host its filters. */
export function feedKindFor(pathname: string): FeedKind | null {
  if (pathname === "/") return "popular";
  if (pathname === "/recent") return "recent";
  if (pathname.startsWith("/t/")) return "tag";
  return null;
}

export function hasFeedControls(kind: FeedKind): boolean {
  return FEEDS[kind].periodControl || FEEDS[kind].sortControl;
}

/** Feed filters live in the URL so the side column and the grid share them; uncontrolled ones are fixed. */
function useFeedFilters(kind: FeedKind) {
  const config = FEEDS[kind];
  const [params, setParams] = useSearchParams();
  const periodParam = params.get("period");
  const sortParam = params.get("sort");
  const period: Period = (config.periodControl && PERIODS.find((p) => p === periodParam)) || config.period;
  const sort: GallerySort = (config.sortControl && GALLERY_SORTS.find((s) => s === sortParam)) || config.sort;
  // Build from the live URL, not this render's params: React Router applies navigations in a
  // transition, so two quick clicks would otherwise both start from the same stale value.
  const update = (next: { period?: Period; sort?: GallerySort }) => {
    const live = new URLSearchParams(window.location.search);
    if (next.period) live.set("period", next.period);
    if (next.sort) live.set("sort", next.sort);
    setParams(live, { replace: true });
  };
  return { config, period, sort, update };
}

/**
 * Period (and, on tag pages, sort) controls for a meme feed. The skin decides whether they sit in the side
 * column or beside the feed title.
 */
export function GalleryFilters({ kind, placement }: { kind: FeedKind; placement: "sidebar" | "header" }) {
  const { config, period, sort, update } = useFeedFilters(kind);
  const sortControl = config.sortControl && (
    <SegmentedControl
      aria-label="Sort"
      size="sm"
      value={sort}
      onChange={(s) => update({ sort: s })}
      options={GALLERY_SORTS.map((s) => ({ value: s, label: SORT_LABELS[s], testId: `sort-${s}` }))}
    />
  );
  const periodControl = config.periodControl && (
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
      {sortControl && <SidebarSection heading="Sort">{sortControl}</SidebarSection>}
      {periodControl && <SidebarSection heading="Period">{periodControl}</SidebarSection>}
    </>
  );
}

/** Paged meme grid for one feed kind, optionally limited to a tag. */
export function GalleryFeed({ kind, tag, title }: { kind: FeedKind; tag?: string; title: string }) {
  const { user } = useAuth();
  const { layout } = useSkin();
  const { config, period, sort } = useFeedFilters(kind);
  const list = usePaged<Meme>(`${period}:${sort}:${tag ?? ""}:${user?.id ?? ""}`, (offset) =>
    getGallery(period, sort, offset, 24, tag),
  );
  const filtersHere = layout.filters === "header" && hasFeedControls(kind);
  const subtitle = [config.sortControl && SORT_LABELS[sort], config.periodControl && PERIOD_LABELS[period]].filter(Boolean);

  return (
    <>
      <PageHeader
        level={tag ? 2 : 1}
        title={filtersHere || subtitle.length === 0 ? title : `${title} · ${subtitle.join(" · ")}`}
        actions={filtersHere ? <GalleryFilters kind={kind} placement="header" /> : undefined}
      />
      {list.error !== null && <ErrorView error={list.error} />}
      <div
        className="meme-feed"
        data-testid="meme-feed"
        data-feed={kind}
        data-period={period}
        data-sort={sort}
        aria-busy={list.loading}
      >
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

export function Popular() {
  return (
    <section>
      <GalleryFeed kind="popular" title="Popular" />
    </section>
  );
}

export function Recent() {
  return (
    <section>
      <GalleryFeed kind="recent" title="Recent" />
    </section>
  );
}
