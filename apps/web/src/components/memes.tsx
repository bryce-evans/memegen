import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Link } from "react-router-dom";
import type { Asset, Meme } from "@memegen/shared";
import { Badge, Button, Card, CardMeta, CardTitle, EmptyState, Icon, MediaGrid, Text } from "@memegen/ui";
import { favoriteMeme, voteMeme } from "../api.ts";
import { useAuth } from "../auth.tsx";
import { timeAgo } from "../time.ts";
import { ErrorView, MediaView } from "./common.tsx";
import { TagChips } from "./tags.tsx";

/** 👍/👎 with up/down counts (downvotes shown negative); clicking your current vote clears it. */
export function VoteButtons({ meme, onChange }: { meme: Meme; onChange: (meme: Meme) => void }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const votable = meme.postedAt !== null && meme.visibility === "public";

  async function vote(dir: -1 | 1) {
    if (!user) {
      setError(new Error("Sign in (top right) to vote."));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onChange(await voteMeme(meme.id, meme.myVote === dir ? 0 : dir));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const disabledReason = votable ? undefined : "Only posted public memes can be voted on";
  return (
    <div className="votes">
      <Button
        size="sm"
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
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (user?.id === meme.owner.id || meme.postedAt === null || meme.visibility !== "public") return null;

  async function toggle() {
    if (!user) {
      setError(new Error("Sign in (top right) to save favorites."));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onChange(await favoriteMeme(meme.id, !meme.favorited));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const label = meme.favorited ? "Remove from favorites" : "Add to favorites";
  return (
    <>
      <Button
        size="sm"
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
  const iso = meme.postedAt ?? meme.createdAt;
  return (
    <time className="age" dateTime={iso} title={new Date(iso).toLocaleString()} data-testid="meme-age">
      {timeAgo(iso)}
    </time>
  );
}

/**
 * Media row height as a fraction of a column's width (keep in sync with `.meme-grid` in styles.css).
 * A meme spans round(aspect × this) columns, 1 to MAX_SPAN, so wide memes get room instead of being cropped.
 */
const ROW_PER_COLUMN = 0.8;
const MAX_SPAN = 3;

function columnSpan(asset: Asset, columns: number): number {
  if (!asset.width || !asset.height) return 1;
  const wanted = Math.round((asset.width / asset.height) * ROW_PER_COLUMN);
  return Math.max(1, Math.min(wanted, MAX_SPAN, columns));
}

/** CSS length (px or rem) in px. */
function toPx(value: string): number {
  const n = parseFloat(value);
  return value.trim().endsWith("rem") ? n * parseFloat(getComputedStyle(document.documentElement).fontSize) : n;
}

/**
 * Columns the grid's `repeat(auto-fill, minmax(--ui-grid-min, 1fr))` yields at its width. Computed from the width,
 * not the rendered tracks: a spanning card adds implicit tracks, which would otherwise feed back into the count.
 */
function useColumnCount(ref: RefObject<HTMLDivElement | null>, mounted: boolean): number {
  const [columns, setColumns] = useState(MAX_SPAN);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!mounted || !el) return;
    const measure = () => {
      const style = getComputedStyle(el);
      // Masonry skins lay the grid out as CSS columns; spans don't apply there.
      if (style.display !== "grid") return setColumns(1);
      const min = toPx(style.getPropertyValue("--ui-grid-min"));
      const gap = parseFloat(style.columnGap) || 0;
      setColumns(min > 0 ? Math.max(1, Math.floor((el.clientWidth + gap) / (min + gap))) : 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, mounted]);
  return columns;
}

export function MemeCard({ meme, onChange, span = 1 }: { meme: Meme; onChange: (meme: Meme) => void; span?: number }) {
  return (
    <Card
      borderless
      className="meme-card"
      data-testid="meme-card"
      data-meme-id={meme.id}
      data-span={span}
      style={span > 1 ? { gridColumn: `span ${span}` } : undefined}
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
      <TagChips slugs={meme.tags} />
      <div className="meme-card-actions">
        <VoteButtons meme={meme} onChange={onChange} />
        <FavoriteButton meme={meme} onChange={onChange} />
        <Link
          to={`/m/${meme.id}#comments`}
          className="comment-count"
          aria-label={`${meme.commentCount} ${meme.commentCount === 1 ? "comment" : "comments"}`}
          title="Discussion"
          data-testid="meme-comment-count"
        >
          <span aria-hidden>💬</span> {meme.commentCount}
        </Link>
      </div>
    </Card>
  );
}

/** Memes at their native aspect: one media height per row, wide memes spanning up to three columns. */
export function MemeGrid({ memes, onChange }: { memes: Meme[]; onChange: (meme: Meme) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const columns = useColumnCount(ref, memes.length > 0);
  if (memes.length === 0) return <EmptyState icon={<Icon name="image" />} title="No memes yet." />;
  return (
    <MediaGrid ref={ref} className="meme-grid">
      {memes.map((m) => (
        <MemeCard key={m.id} meme={m} onChange={onChange} span={columnSpan(m.outputAsset, columns)} />
      ))}
    </MediaGrid>
  );
}
