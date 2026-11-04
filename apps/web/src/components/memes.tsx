import { useRef, type ComponentPropsWithoutRef, type CSSProperties, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { isListed, type Asset, type Meme } from "@memegen/shared";
import { Badge, Button, Card, CardMeta, CardTitle, EmptyState, Icon, Text } from "@memegen/ui";
import { favoriteMeme, voteMeme } from "../api.ts";
import { useUser } from "../auth.tsx";
import { plural } from "../format.ts";
import { useAction } from "../useAction.ts";
import type { Paged } from "../usePaged.ts";
import { useCardLayout, type CardLayout } from "../cardLayout.ts";
import { justifyRows, useRowBox } from "../justifiedRows.ts";
import { ErrorView, MediaView, PagedList, TimeAgo } from "./common.tsx";

/**
 * [👍] score [👎]: thumb toggles around the score (up − down); your vote's thumb is pressed (toned and filled).
 * Clicking your current vote clears it.
 */
export function VoteButtons({ meme, onChange }: { meme: Meme; onChange: (meme: Meme) => void }) {
  const { busy, error, run } = useAction();
  const votable = isListed(meme);

  function vote(dir: -1 | 1) {
    void run(async () => onChange(await voteMeme(meme.id, meme.myVote === dir ? 0 : dir)));
  }

  const disabledReason = votable ? undefined : "Only posted public memes can be voted on";
  const upLabel = meme.myVote === 1 ? "Remove upvote" : "Upvote";
  const downLabel = meme.myVote === -1 ? "Remove downvote" : "Downvote";
  return (
    <div className="votes">
      <div className="vote-controls" data-testid="vote-controls">
        <Button
          size="sm"
          tone="warning"
          className="vote vote-up"
          onClick={() => vote(1)}
          disabled={busy || !votable}
          aria-label={upLabel}
          title={disabledReason ?? upLabel}
          pressed={meme.myVote === 1}
          data-testid="vote-up"
          icon={<Icon name="thumbUp" />}
        />
        <Text
          as="span"
          size="sm"
          numeric
          className="score"
          title={`Score: ${meme.upvotes} up, ${meme.downvotes} down`}
          data-testid="meme-score"
        >
          {meme.score > 0 ? `+${meme.score}` : meme.score}
        </Text>
        <Button
          size="sm"
          tone="info"
          className="vote vote-down"
          onClick={() => vote(-1)}
          disabled={busy || !votable}
          aria-label={downLabel}
          title={disabledReason ?? downLabel}
          pressed={meme.myVote === -1}
          data-testid="vote-down"
          icon={<Icon name="thumbDown" />}
        />
      </div>
      {error !== null && <ErrorView error={error} />}
    </div>
  );
}

/**
 * Star toggle (filled when pressed) that saves a posted public meme, your own included, to your Favorites; hidden on
 * unposted and unlisted memes. `className` lets a page restyle it (the meme page's bare title star).
 */
export function FavoriteButton({ meme, onChange, className }: { meme: Meme; onChange: (meme: Meme) => void; className?: string }) {
  const { busy, error, run } = useAction();
  if (!isListed(meme)) return null;

  function toggle() {
    void run(async () => onChange(await favoriteMeme(meme.id, !meme.favorited)));
  }

  const label = meme.favorited ? "Remove from favorites" : "Add to favorites";
  return (
    <>
      <Button
        size="sm"
        tone="warning"
        className={className ? `favorite ${className}` : "favorite"}
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
      {meme.visibility === "unlisted" && (
        <Badge tone="info" data-testid="unlisted-badge">
          Unlisted
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

/** Clicks on the card's own controls and links (votes, favorite, author, title, media) keep their behavior. */
const CARD_CONTROLS = "a, button, input, textarea, select, label";

/**
 * The whole card opens the meme; hovering it lights a rounded highlight around it (styles.css). Author, age, favorite
 * star, and comment count show only in the hover layout; below the image (Google-style) the card keeps the
 * title with the votes at the right of its line, and any badges under it.
 */
function MemeCard({ meme, layout, onChange, height }: { meme: Meme; layout: CardLayout; onChange: (meme: Meme) => void; height?: number }) {
  const navigate = useNavigate();
  const href = `/m/${meme.id}`;
  // Until the grid is measured, cards sit at the CSS default row height.
  const style = { "--meme-aspect": aspect(meme.outputAsset), "--meme-height": height ? `${height}px` : undefined } as CSSProperties;

  function open(e: MouseEvent<HTMLElement>) {
    if (e.defaultPrevented || (e.target as Element).closest(CARD_CONTROLS)) return;
    // Finishing a text selection is not a click on the card.
    if (window.getSelection()?.isCollapsed === false) return;
    if (e.metaKey || e.ctrlKey) window.open(href, "_blank", "noopener");
    else navigate(href);
  }

  return (
    <Card
      borderless
      className="meme-card"
      data-testid="meme-card"
      data-meme-id={meme.id}
      style={style}
      onClick={open}
      media={
        <Link to={href}>
          <MediaView asset={meme.outputAsset} alt={meme.title || "meme"} testId="meme-card-media" />
        </Link>
      }
    >
      <CardTitle as={Link} to={href} data-testid="meme-card-title">
        {meme.title || "Untitled"}
      </CardTitle>
      <CardMeta>
        {layout === "hover" && (
          <>
            <Link to={`/u/${meme.owner.username}`} data-testid="meme-author">@{meme.owner.username}</Link>
            <span aria-hidden> · </span>
            <MemeAge meme={meme} />
          </>
        )}
        <MemeBadges meme={meme} />
      </CardMeta>
      <div className="meme-card-actions">
        <VoteButtons meme={meme} onChange={onChange} />
        {layout === "hover" && (
          <>
            <FavoriteButton meme={meme} onChange={onChange} />
            <span className="comment-count" title={plural(meme.commentCount, "comment")} data-testid="meme-comment-count">
              <Icon name="comment" label="Comments" />
              {meme.commentCount}
            </span>
          </>
        )}
      </div>
    </Card>
  );
}

/**
 * Memes flow in justified rows at their native aspect: one height per row, widths vary, nothing cropped. Each card's
 * info sits below its image or over it on hover, per the user's card layout setting.
 */
function MemeGrid({ memes, onChange }: { memes: Meme[]; onChange: (meme: Meme) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const box = useRowBox(ref, memes.length > 0, "--meme-row-height");
  const { layout } = useCardLayout(useUser().id);
  if (memes.length === 0) return null;
  const heights = box && box.width > 0 ? justifyRows(memes.map((m) => aspect(m.outputAsset)), box.width, box.gap, box.target) : null;
  return (
    <div ref={ref} className="meme-grid" data-card-layout={layout} data-testid="meme-grid">
      {memes.map((m, i) => (
        <MemeCard key={m.id} meme={m} layout={layout} onChange={onChange} height={heights?.[i]} />
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
