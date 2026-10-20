import { useRef, type ComponentPropsWithoutRef, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { isListed, type Asset, type Meme } from "@memegen/shared";
import { Badge, Button, Card, CardMeta, CardTitle, EmptyState, Icon, Text } from "@memegen/ui";
import { favoriteMeme, voteMeme } from "../api.ts";
import { useUser } from "../auth.tsx";
import { plural } from "../format.ts";
import { useAction } from "../useAction.ts";
import type { Paged } from "../usePaged.ts";
import { justifyRows, useRowBox } from "../justifiedRows.ts";
import { ErrorView, MediaView, PagedList, TimeAgo } from "./common.tsx";

/** 👍/👎 with up/down counts (downvotes shown negative); clicking your current vote clears it. */
export function VoteButtons({ meme, onChange }: { meme: Meme; onChange: (meme: Meme) => void }) {
  const { busy, error, run } = useAction();
  const votable = isListed(meme);

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

/** Star toggle (filled when pressed) that saves someone else's posted public meme to your Favorites; hidden on your own and unposted memes. */
export function FavoriteButton({ meme, onChange }: { meme: Meme; onChange: (meme: Meme) => void }) {
  const user = useUser();
  const { busy, error, run } = useAction();
  if (user.id === meme.owner.id || !isListed(meme)) return null;

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
        icon={<Icon name="star" />}
      />
      {error !== null && <ErrorView error={error} />}
    </>
  );
}

export function MemeBadges({ meme }: { meme: Meme }) {
  return (
    <>
      {meme.postedAt === null && (
        <Badge tone="primary" data-testid="draft-badge">
          Draft
        </Badge>
      )}
      {meme.visibility === "private" && (
        <Badge tone="info" data-testid="private-badge">
          Private
        </Badge>
      )}
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

function MemeCard({ meme, onChange, height }: { meme: Meme; onChange: (meme: Meme) => void; height?: number }) {
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
        <Link to={`/u/${meme.owner.username}`} data-testid="meme-author">@{meme.owner.username}</Link>
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
function MemeGrid({ memes, onChange }: { memes: Meme[]; onChange: (meme: Meme) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const box = useRowBox(ref, memes.length > 0, "--meme-row-height");
  if (memes.length === 0) return null;
  const heights = box && box.width > 0 ? justifyRows(memes.map((m) => aspect(m.outputAsset)), box.width, box.gap, box.target) : null;
  return (
    <div ref={ref} className="meme-grid">
      {memes.map((m, i) => (
        <MemeCard key={m.id} meme={m} onChange={onChange} height={heights?.[i]} />
      ))}
    </div>
  );
}

/**
 * A paged meme list: its error or "No memes yet.", the grid (cards update in place after votes/favorites), and
 * "Load more". Extra props, e.g. `data-*` naming the query, go on the `meme-feed` box.
 */
export function MemeFeed({ list, ...rest }: { list: Paged<Meme> } & ComponentPropsWithoutRef<"div">) {
  return (
    <div className="meme-feed" data-testid="meme-feed" aria-busy={list.loading} {...rest}>
      <PagedList list={list} empty={<EmptyState icon={<Icon name="image" />} title="No memes yet." />} paging="button" moreTestId="load-more">
        {(memes) => <MemeGrid memes={memes} onChange={list.replace} />}
      </PagedList>
    </div>
  );
}
