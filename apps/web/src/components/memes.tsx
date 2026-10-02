import { useState } from "react";
import { Link } from "react-router-dom";
import type { Meme } from "@memegen/shared";
import { voteMeme } from "../api.ts";
import { useAuth } from "../auth.tsx";
import { timeAgo } from "../time.ts";
import { ErrorView, MediaView } from "./common.tsx";
import { TagChips } from "./tags.tsx";

/** 👍/👎 with up/down counts; clicking your current vote clears it. */
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
      <button
        type="button"
        className={meme.myVote === 1 ? "vote up active" : "vote up"}
        onClick={() => vote(1)}
        disabled={busy || !votable}
        title={disabledReason ?? (meme.myVote === 1 ? "Remove upvote" : "Upvote")}
        aria-pressed={meme.myVote === 1}
        data-testid="vote-up"
      >
        <span aria-hidden>👍</span>
        <span data-testid="upvote-count">{meme.upvotes}</span>
      </button>
      <button
        type="button"
        className={meme.myVote === -1 ? "vote down active" : "vote down"}
        onClick={() => vote(-1)}
        disabled={busy || !votable}
        title={disabledReason ?? (meme.myVote === -1 ? "Remove downvote" : "Downvote")}
        aria-pressed={meme.myVote === -1}
        data-testid="vote-down"
      >
        <span aria-hidden>👎</span>
        <span data-testid="downvote-count">{meme.downvotes}</span>
      </button>
      <span className="score" title="Score (up − down)" data-testid="meme-score">
        {meme.score > 0 ? `+${meme.score}` : meme.score}
      </span>
      {error !== null && <ErrorView error={error} />}
    </div>
  );
}

export function MemeBadges({ meme }: { meme: Meme }) {
  return (
    <>
      {meme.postedAt === null && <span className="badge draft">Draft</span>}
      {meme.visibility === "private" && <span className="badge private">Private</span>}
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
    <article className="card meme-card" data-testid="meme-card" data-meme-id={meme.id}>
      <Link to={`/m/${meme.id}`} className="card-media">
        <MediaView asset={meme.outputAsset} alt={meme.title || "meme"} />
      </Link>
      <div className="card-body">
        <Link to={`/m/${meme.id}`} className="card-title">
          {meme.title || "Untitled"}
        </Link>
        <div className="card-meta">
          <Link to={`/u/${meme.owner.username}`}>@{meme.owner.username}</Link>
          <span aria-hidden> · </span>
          <MemeAge meme={meme} />
          <MemeBadges meme={meme} />
        </div>
        <TagChips slugs={meme.tags} />
        <VoteButtons meme={meme} onChange={onChange} />
      </div>
    </article>
  );
}

export function MemeGrid({ memes, onChange }: { memes: Meme[]; onChange: (meme: Meme) => void }) {
  if (memes.length === 0) return <p className="muted">No memes yet.</p>;
  return (
    <div className="grid">
      {memes.map((m) => (
        <MemeCard key={m.id} meme={m} onChange={onChange} />
      ))}
    </div>
  );
}
