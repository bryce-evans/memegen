import { useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef, type CSSProperties, type RefObject } from "react";
import { Link } from "react-router-dom";
import type { Asset, Meme } from "@memegen/shared";
import { Badge, Button, Card, CardMeta, CardTitle, EmptyState, Icon, MediaGrid, Spinner, Text } from "@memegen/ui";
import { favoriteMeme, voteMeme } from "../api.ts";
import { useUser } from "../auth.tsx";
import { plural } from "../format.ts";
import { useAction } from "../useAction.ts";
import type { Paged } from "../usePaged.ts";
import { ErrorView, LoadMoreButton, MediaView, TimeAgo } from "./common.tsx";

/** 👍/👎 with up/down counts (downvotes shown negative); clicking your current vote clears it. */
export function VoteButtons({ meme, onChange }: { meme: Meme; onChange: (meme: Meme) => void }) {
  const { busy, error, run } = useAction();
  const votable = meme.postedAt !== null && meme.visibility === "public";

  function vote(dir: -1 | 1) {
    void run(async () => onChange(await voteMeme(meme.id, meme.myVote === dir ? 0 : dir)));
  }

  const disabledReason = votable ? undefined : "Only posted public memes can be voted on";
  return (
    <div className="votes">
      <Button
        size="sm"
        tone="warning"
        className="vote vote-up"
        onClick={() => vote(1)}
        disabled={busy || !votable}
        title={disabledReason ?? (meme.myVote === 1 ? "Remove upvote" : "Upvote")}
        pressed={meme.myVote === 1}
        data-testid="vote-up"
      >
        <span aria-hidden>👍</span>
        <span data-testid="upvote-count">{meme.upvotes}</span>
      </Button>
      <Button
        size="sm"
        tone="info"
        className="vote vote-down"
        onClick={() => vote(-1)}
        disabled={busy || !votable}
        title={disabledReason ?? (meme.myVote === -1 ? "Remove downvote" : "Downvote")}
        pressed={meme.myVote === -1}
        data-testid="vote-down"
      >
        <span aria-hidden>👎</span>
        <span data-testid="downvote-count">{meme.downvotes > 0 ? `-${meme.downvotes}` : "0"}</span>
      </Button>
      <Text as="span" size="sm" tone="muted" numeric className="score" title="Score (up − down)" data-testid="meme-score">
        {meme.score > 0 ? `+${meme.score}` : meme.score}
      </Text>
      {error !== null && <ErrorView error={error} />}
    </div>
  );
}

/** ☆/★ toggle that saves someone else's posted public meme to your Favorites; hidden on your own and unposted memes. */
export function FavoriteButton({ meme, onChange }: { meme: Meme; onChange: (meme: Meme) => void }) {
  const user = useUser();
  const { busy, error, run } = useAction();
  if (user.id === meme.owner.id || meme.postedAt === null || meme.visibility !== "public") return null;

  function toggle() {
    void run(async () => onChange(await favoriteMeme(meme.id, !meme.favorited)));
  }

  const label = meme.favorited ? "Remove from favorites" : "Add to favorites";
  return (
    <>
      <Button
        size="sm"
        tone="warning"
        className="favorite"
        onClick={toggle}
        disabled={busy}
        pressed={meme.favorited}
        aria-label={label}
        title={label}
        data-testid="favorite"
      >
        <span aria-hidden>{meme.favorited ? "★" : "☆"}</span>
      </Button>
      {error !== null && <ErrorView error={error} />}
    </>
  );
}

export function MemeBadges({ meme }: { meme: Meme }) {
  return (
    <>
      {meme.postedAt === null && <Badge tone="primary">Draft</Badge>}
      {meme.visibility === "private" && <Badge tone="info">Private</Badge>}
    </>
  );
}

export function MemeAge({ meme }: { meme: Meme }) {
  return <TimeAgo iso={meme.postedAt ?? meme.createdAt} className="age" data-testid="meme-age" />;
}

/** Width ÷ height, for the flowing meme rows; square when the asset has no dimensions. */
function aspect(asset: Asset): number {
  return asset.width && asset.height ? asset.width / asset.height : 1;
}

/**
 * Justified rows: splits items (by aspect) into rows that exactly fill `width`, each as close to `target` height as
 * possible. A row closes at the first item that brings it to or below the target, keeping that item only if it lands
 * nearer the target than stopping before it. The last, unfilled row stays at the target instead of stretching.
 * Returns one height per item; an item's width is aspect × height. Half a pixel is held back so rounding never wraps.
 */
function justifyRows(aspects: readonly number[], width: number, gap: number, target: number): number[] {
  const heights: number[] = [];
  let start = 0;
  while (start < aspects.length) {
    let n = 0;
    let sum = 0;
    let height = Infinity;
    let full = false;
    while (start + n < aspects.length) {
      const nextSum = sum + aspects[start + n]!;
      const nextHeight = (width - gap * n - 0.5) / nextSum;
      if (nextHeight > target) {
        n++;
        sum = nextSum;
        height = nextHeight;
        continue;
      }
      // This item fills the row: keep it if that lands nearer the target than stopping before it.
      if (n === 0 || target - nextHeight <= height - target) {
        n++;
        height = nextHeight;
      }
      full = true;
      break;
    }
    for (let i = 0; i < n; i++) heights.push(full ? height : target);
    start += n;
  }
  return heights;
}

/** CSS length (px or rem) in px. */
function toPx(value: string): number {
  const n = parseFloat(value);
  return value.trim().endsWith("rem") ? n * parseFloat(getComputedStyle(document.documentElement).fontSize) : n;
}

interface RowBox {
  width: number;
  gap: number;
  target: number;
}

/** The grid's content width, column gap, and target row height, re-measured on resize. */
function useRowBox(ref: RefObject<HTMLDivElement | null>, mounted: boolean): RowBox | null {
  const [box, setBox] = useState<RowBox | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!mounted || !el) return;
    const measure = () => {
      const style = getComputedStyle(el);
      const next = {
        width: el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        gap: parseFloat(style.columnGap) || 0,
        target: toPx(style.getPropertyValue("--meme-row-height")),
      };
      setBox((prev) => (prev && prev.width === next.width && prev.gap === next.gap && prev.target === next.target ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, mounted]);
  return box;
}

export function MemeCard({ meme, onChange, height }: { meme: Meme; onChange: (meme: Meme) => void; height?: number }) {
  // Until the grid is measured, cards sit at the CSS default row height.
  const style = { "--meme-aspect": aspect(meme.outputAsset), "--meme-height": height ? `${height}px` : undefined } as CSSProperties;
  return (
    <Card
      borderless
      className="meme-card"
      data-testid="meme-card"
      data-meme-id={meme.id}
      style={style}
      media={
        <Link to={`/m/${meme.id}`}>
          <MediaView asset={meme.outputAsset} alt={meme.title || "meme"} />
        </Link>
      }
    >
      <CardTitle as={Link} to={`/m/${meme.id}`}>
        {meme.title || "Untitled"}
      </CardTitle>
      <CardMeta>
        <Link to={`/u/${meme.owner.username}`}>@{meme.owner.username}</Link>
        <span aria-hidden> · </span>
        <MemeAge meme={meme} />
        <MemeBadges meme={meme} />
      </CardMeta>
      <div className="meme-card-actions">
        <VoteButtons meme={meme} onChange={onChange} />
        <FavoriteButton meme={meme} onChange={onChange} />
        <Link
          to={`/m/${meme.id}#comments`}
          className="comment-count"
          aria-label={plural(meme.commentCount, "comment")}
          title="Discussion"
          data-testid="meme-comment-count"
        >
          <span aria-hidden>💬</span> {meme.commentCount}
        </Link>
      </div>
    </Card>
  );
}

/** Memes flow in justified rows at their native aspect: one height per row, widths vary, nothing cropped. */
export function MemeGrid({ memes, onChange }: { memes: Meme[]; onChange: (meme: Meme) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const box = useRowBox(ref, memes.length > 0);
  if (memes.length === 0) return <EmptyState icon={<Icon name="image" />} title="No memes yet." />;
  const heights = box && box.width > 0 ? justifyRows(memes.map((m) => aspect(m.outputAsset)), box.width, box.gap, box.target) : null;
  return (
    <MediaGrid ref={ref} className="meme-grid">
      {memes.map((m, i) => (
        <MemeCard key={m.id} meme={m} onChange={onChange} height={heights?.[i]} />
      ))}
    </MediaGrid>
  );
}

/**
 * A paged meme list: its error, the grid (cards update in place after votes/favorites), and "Load more".
 * Extra props, e.g. `data-*` naming the query, go on the `meme-feed` box.
 */
export function MemeFeed({ list, ...rest }: { list: Paged<Meme> } & ComponentPropsWithoutRef<"div">) {
  return (
    <>
      {list.error !== null && <ErrorView error={list.error} />}
      <div className="meme-feed" data-testid="meme-feed" aria-busy={list.loading} {...rest}>
        {!(list.loading && list.items.length === 0) && <MemeGrid memes={list.items} onChange={list.replace} />}
        {list.loading && <Spinner label="Loading…" />}
        <LoadMoreButton hasMore={list.hasMore} loading={list.loading} onLoadMore={list.loadMore} testId="load-more" />
      </div>
    </>
  );
}
