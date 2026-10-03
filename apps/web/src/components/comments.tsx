import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { Comment, Meme } from "@memegen/shared";
import { Button, PageHeader, Spinner, Text, TextArea } from "@memegen/ui";
import { createComment, deleteComment, listComments } from "../api.ts";
import { useAuth } from "../auth.tsx";
import { timeAgo } from "../time.ts";
import { usePaged } from "../usePaged.ts";
import { ErrorView, SignInPrompt } from "./common.tsx";

/**
 * Mirrors the server's delete rule: a comment with replies stays as a placeholder; otherwise it goes, and a
 * placeholder parent left without replies goes with it.
 */
function removeComment(items: Comment[], target: Comment): Comment[] {
  if (target.parentId === null) {
    return target.replies.length > 0
      ? items.map((c) => (c.id === target.id ? { ...c, body: "", deleted: true } : c))
      : items.filter((c) => c.id !== target.id);
  }
  return items.flatMap((c) => {
    if (c.id !== target.parentId) return [c];
    const replies = c.replies.filter((r) => r.id !== target.id);
    return c.deleted && replies.length === 0 ? [] : [{ ...c, replies }];
  });
}

/** Discussion under a meme: top-level comments with one level of replies. `onCountChange` gets ±1 per post/delete. */
export function Comments({ meme, onCountChange }: { meme: Meme; onCountChange: (delta: number) => void }) {
  const { user } = useAuth();
  const list = usePaged<Comment>(`${meme.id}:${user?.id ?? ""}`, (offset) => listComments(meme.id, offset));
  const open = meme.postedAt !== null && meme.visibility === "public";
  const canPost = open && user !== null;

  function added(comment: Comment) {
    onCountChange(1);
    list.setItems((items) =>
      comment.parentId === null
        ? [...items, comment]
        : items.map((c) => (c.id === comment.parentId ? { ...c, replies: [...c.replies, comment] } : c)),
    );
  }

  async function remove(comment: Comment) {
    await deleteComment(comment.id);
    onCountChange(-1);
    list.setItems((items) => removeComment(items, comment));
  }

  return (
    <section id="comments" className="comments" data-testid="comments" aria-busy={list.loading}>
      <PageHeader level={2} title={`Discussion (${meme.commentCount})`} />
      {!open && <Text tone="muted">Posting this meme publicly opens the discussion.</Text>}
      {list.error !== null && <ErrorView error={list.error} />}
      {!list.loading && list.items.length === 0 && list.error === null && open && (
        <Text tone="muted">No comments yet. Start the discussion!</Text>
      )}
      <ol className="comment-list">
        {list.items.map((c) => (
          <li key={c.id}>
            <CommentItem comment={c} canReply={canPost} onPosted={added} onDelete={remove} />
          </li>
        ))}
      </ol>
      {list.loading && <Spinner label="Loading…" />}
      {list.hasMore && !list.loading && (
        <div className="load-more">
          <Button onClick={list.loadMore}>More comments</Button>
        </div>
      )}
      {open && !user && <SignInPrompt action="join the discussion" />}
      {canPost && <CommentForm memeId={meme.id} parentId={null} onPosted={added} />}
    </section>
  );
}

function CommentItem(props: {
  comment: Comment;
  canReply: boolean;
  onPosted: (comment: Comment) => void;
  onDelete: (comment: Comment) => Promise<void>;
}) {
  const { comment, canReply, onPosted, onDelete } = props;
  const { user } = useAuth();
  const [replying, setReplying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const isReply = comment.parentId !== null;

  async function remove() {
    if (!window.confirm("Delete this comment?")) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete(comment);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <article className="comment" data-testid="comment" data-comment-id={comment.id}>
      <Text size="sm" tone="muted" className="comment-meta">
        {comment.deleted ? (
          <span data-testid="comment-author">[deleted]</span>
        ) : (
          <Link to={`/u/${comment.author.username}`} data-testid="comment-author">
            @{comment.author.username}
          </Link>
        )}
        {" · "}
        <time dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString()}>
          {timeAgo(comment.createdAt)}
        </time>
      </Text>
      <Text tone={comment.deleted ? "muted" : "default"} className="comment-body" data-testid="comment-body">
        {comment.deleted ? "This comment was deleted." : comment.body}
      </Text>
      {!comment.deleted && (
        <div className="comment-actions">
          {!isReply && canReply && (
            <Button size="sm" variant="quiet" pressed={replying} onClick={() => setReplying((r) => !r)} data-testid="comment-reply">
              Reply
            </Button>
          )}
          {user?.id === comment.author.id && (
            <Button size="sm" variant="quiet" disabled={busy} onClick={remove} data-testid="comment-delete">
              Delete
            </Button>
          )}
        </div>
      )}
      {error !== null && <ErrorView error={error} />}
      {replying && (
        <CommentForm
          memeId={comment.memeId}
          parentId={comment.id}
          onPosted={(reply) => {
            setReplying(false);
            onPosted(reply);
          }}
        />
      )}
      {comment.replies.length > 0 && (
        <ol className="comment-replies">
          {comment.replies.map((r) => (
            <li key={r.id}>
              <CommentItem comment={r} canReply={false} onPosted={onPosted} onDelete={onDelete} />
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

/** New top-level comment (`parentId` null) or a reply to a top-level comment. */
function CommentForm({ memeId, parentId, onPosted }: { memeId: string; parentId: string | null; onPosted: (comment: Comment) => void }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const reply = parentId !== null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const comment = await createComment(memeId, body.trim(), parentId);
      setBody("");
      onPosted(comment);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="comment-form" onSubmit={submit}>
      <TextArea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={reply ? "Write a reply…" : "Add a comment…"}
        aria-label={reply ? "Reply" : "Comment"}
        maxLength={2000}
        rows={reply ? 2 : 3}
        disabled={busy}
        data-testid={reply ? "reply-input" : "comment-input"}
      />
      <Button type="submit" size="sm" variant="primary" disabled={busy || !body.trim()} data-testid={reply ? "reply-submit" : "comment-submit"}>
        {reply ? "Reply" : "Comment"}
      </Button>
      {error !== null && <ErrorView error={error} />}
    </form>
  );
}
