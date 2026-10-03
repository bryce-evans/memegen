import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type { Meme } from "@memegen/shared";
import { Button, Icon, Inline, LinkButton, Spinner, Text } from "@memegen/ui";
import { contentUrl, deleteMeme, getMeme, postMeme, updateMeme } from "../api.ts";
import { useAuth } from "../auth.tsx";
import { Comments } from "../components/comments.tsx";
import { ErrorView, MediaView } from "../components/common.tsx";
import { MemeAge, MemeBadges, VoteButtons } from "../components/memes.tsx";
import { TagChips, TagEditor } from "../components/tags.tsx";
import { assetExtension, fileSlug } from "../media.ts";

export function MemeDetail() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { hash } = useLocation();
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

  // Router navigations don't scroll to fragments; jump to `#comments` once the page has rendered.
  const loaded = meme !== null;
  useEffect(() => {
    if (loaded && hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [loaded, hash]);

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
  if (!meme) return <Spinner label="Loading…" />;

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
        <h1 className="detail-title" data-testid="meme-title">
          {meme.title || "Untitled"}
        </h1>
        <Text>
          by <Link to={`/u/${meme.owner.username}`}>@{meme.owner.username}</Link> · <MemeAge meme={meme} /> <MemeBadges meme={meme} />
        </Text>
        <Text tone="muted" size="sm" data-testid="meme-status">
          {meme.postedAt ? `posted ${new Date(meme.postedAt).toLocaleString()}` : "draft"}
          {" · "}
          {meme.visibility}
        </Text>
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
        <Inline className="detail-links">
          <LinkButton
            href={contentUrl(meme.outputAsset)}
            download={`${fileSlug(meme.title)}${assetExtension(meme.outputAsset)}`}
            icon={<Icon name="down" />}
            data-testid="download-meme"
          >
            Download
          </LinkButton>
          {meme.templateId && (
            <LinkButton as={Link} variant="quiet" to={`/create?template=${meme.templateId}`} icon={<Icon name="image" />}>
              Make one with this template
            </LinkButton>
          )}
        </Inline>
        {isOwner && (
          <Inline className="detail-actions">
            {meme.postedAt === null && (
              <Button variant="primary" disabled={busy} data-testid="post-meme" onClick={() => act(() => postMeme(meme.id))}>
                Post
              </Button>
            )}
            <Button
              disabled={busy}
              data-testid="visibility-toggle"
              onClick={() =>
                act(() => updateMeme(meme.id, { visibility: meme.visibility === "public" ? "private" : "public" }))
              }
            >
              Make {meme.visibility === "public" ? "private" : "public"}
            </Button>
            <Button disabled={busy} data-testid="edit-meme" onClick={() => navigate(`/create?meme=${meme.id}`)}>
              Edit
            </Button>
            <Button
              variant="danger"
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
            </Button>
          </Inline>
        )}
        {actionError !== null && <ErrorView error={actionError} />}
      </aside>
      <div className="detail-comments">
        <Comments meme={meme} onCountChange={(delta) => setMeme((m) => m && { ...m, commentCount: m.commentCount + delta })} />
      </div>
    </section>
  );
}
