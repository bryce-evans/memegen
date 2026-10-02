import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Meme } from "@memegen/shared";
import { contentUrl, deleteMeme, getMeme, postMeme, updateMeme } from "../api.ts";
import { useAuth } from "../auth.tsx";
import { ErrorView, MediaView } from "../components/common.tsx";
import { MemeAge, MemeBadges, VoteButtons } from "../components/memes.tsx";
import { TagChips, TagEditor } from "../components/tags.tsx";

export function MemeDetail() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [meme, setMeme] = useState<Meme | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMeme(null);
    setError(null);
    getMeme(id).then(
      (m) => !cancelled && setMeme(m),
      (err) => !cancelled && setError(err),
    );
    return () => {
      cancelled = true;
    };
  }, [id, user?.id]);

  async function act(fn: () => Promise<Meme | void>) {
    setBusy(true);
    setActionError(null);
    try {
      const result = await fn();
      if (result) setMeme(result);
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  if (error !== null) return <ErrorView error={error} />;
  if (!meme) return <p className="muted">Loading…</p>;

  const isOwner = user?.id === meme.owner.id;

  return (
    <section className="detail">
      <div className="detail-media">
        {meme.outputAsset.kind === "video" ? (
          <video data-testid="meme-media" src={contentUrl(meme.outputAsset)} controls loop autoPlay muted playsInline />
        ) : (
          <MediaView asset={meme.outputAsset} alt={meme.title || "meme"} testId="meme-media" />
        )}
      </div>
      <aside className="detail-side">
        <h1 data-testid="meme-title">{meme.title || "Untitled"}</h1>
        <p>
          by <Link to={`/u/${meme.owner.username}`}>@{meme.owner.username}</Link> · <MemeAge meme={meme} /> <MemeBadges meme={meme} />
        </p>
        <p className="muted" data-testid="meme-status">
          {meme.postedAt ? `posted ${new Date(meme.postedAt).toLocaleString()}` : "draft"}
          {" · "}
          {meme.visibility}
        </p>
        <VoteButtons meme={meme} onChange={setMeme} />
        <div className="detail-tags">
          <TagChips slugs={meme.tags} />
          {isOwner && (
            <TagEditor
              tags={meme.tags}
              testId="edit-tags"
              onSave={async (tags) => setMeme(await updateMeme(meme.id, { tags }))}
            />
          )}
        </div>
        {meme.templateId && (
          <p>
            <Link to={`/create?template=${meme.templateId}`}>Make one with this template</Link>
          </p>
        )}
        {isOwner && (
          <div className="actions">
            {meme.postedAt === null && (
              <button
                type="button"
                className="primary"
                disabled={busy}
                data-testid="post-meme"
                onClick={() => act(() => postMeme(meme.id))}
              >
                Post
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              data-testid="visibility-toggle"
              onClick={() =>
                act(() => updateMeme(meme.id, { visibility: meme.visibility === "public" ? "private" : "public" }))
              }
            >
              Make {meme.visibility === "public" ? "private" : "public"}
            </button>
            <button type="button" disabled={busy} data-testid="edit-meme" onClick={() => navigate(`/create?meme=${meme.id}`)}>
              Edit
            </button>
            <button
              type="button"
              className="danger"
              disabled={busy}
              data-testid="delete-meme"
              onClick={() =>
                act(async () => {
                  if (!window.confirm("Delete this meme?")) return;
                  await deleteMeme(meme.id);
                  navigate(`/u/${meme.owner.username}`);
                })
              }
            >
              Delete
            </button>
          </div>
        )}
        {actionError !== null && <ErrorView error={actionError} />}
      </aside>
    </section>
  );
}
