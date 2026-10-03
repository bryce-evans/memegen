import { useState } from "react";
import { Link } from "react-router-dom";
import type { Meme } from "@memegen/shared";
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

export function MemeCard({ meme, onChange }: { meme: Meme; onChange: (meme: Meme) => void }) {
  return (
    <Card
      borderless
      className="meme-card"
      data-testid="meme-card"
      data-meme-id={meme.id}
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

export function MemeGrid({ memes, onChange }: { memes: Meme[]; onChange: (meme: Meme) => void }) {
  if (memes.length === 0) return <EmptyState icon={<Icon name="image" />} title="No memes yet." />;
  return (
    <MediaGrid>
      {memes.map((m) => (
        <MemeCard key={m.id} meme={m} onChange={onChange} />
      ))}
    </MediaGrid>
  );
}
