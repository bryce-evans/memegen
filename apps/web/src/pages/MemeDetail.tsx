import { useEffect } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type { Meme } from "@memegen/shared";
import { Button, Icon, Inline, LinkButton, Spinner, Text } from "@memegen/ui";
import { contentUrl, deleteMeme, getMeme, postMeme, updateMeme } from "../api.ts";
import { useUser } from "../auth.tsx";
import { Comments } from "../components/comments.tsx";
import { ErrorView, MediaView } from "../components/common.tsx";
import { FavoriteButton, MemeAge, MemeBadges, VoteButtons } from "../components/memes.tsx";
import { TagEditor } from "../components/tagInputs.tsx";
import { TagChips } from "../components/tags.tsx";
import { assetExtension, fileSlug } from "../media.ts";
import { useAction } from "../useAction.ts";
import { useAsync } from "../useAsync.ts";

export function MemeDetail() {
  const { id = "" } = useParams();
  const user = useUser();
  const navigate = useNavigate();
  const { hash } = useLocation();
  const { data: meme, error, setData: setMeme } = useAsync(id, () => getMeme(id));
  const { busy, error: actionError, run } = useAction();

  // Router navigations don't scroll to fragments; jump to `#comments` once the page has rendered.
  const loaded = meme !== null;
  useEffect(() => {
    if (loaded && hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [loaded, hash]);

  /** Owner actions that return the meme's new version. */
  function act(fn: () => Promise<Meme>) {
    void run(async () => setMeme(await fn()));
  }

  function remove(meme: Meme) {
    if (!window.confirm("Delete this meme?")) return;
    void run(async () => {
      await deleteMeme(meme.id);
      navigate(`/u/${meme.owner.username}`);
    });
  }

  if (error !== null) return <ErrorView error={error} />;
  if (!meme) return <Spinner label="Loading…" />;

  const isOwner = user.id === meme.owner.id;

  return (
    <section className="detail">
      <div className="detail-media">
        <MediaView asset={meme.outputAsset} alt={meme.title || "meme"} testId="meme-media" controls />
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
        <div className="detail-votes">
          <VoteButtons meme={meme} onChange={setMeme} />
          <FavoriteButton meme={meme} onChange={setMeme} />
        </div>
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
            <Button variant="danger" disabled={busy} data-testid="delete-meme" onClick={() => remove(meme)}>
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
