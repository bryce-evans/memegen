import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type { Meme } from "@memegen/shared";
import { Button, Chip, Icon, Inline, LinkButton, Panel, Spinner, Text } from "@memegen/ui";
import { contentUrl, deleteMeme, getMeme, postMeme, updateMeme } from "../api.ts";
import { useUser } from "../auth.tsx";
import { Comments } from "../components/comments.tsx";
import { ErrorView, MediaView } from "../components/common.tsx";
import { FavoriteButton, MemeAge, MemeBadges, VoteButtons } from "../components/memes.tsx";
import { TagField } from "../components/tagInputs.tsx";
import { assetExtension, fileSlug } from "../media.ts";
import { useAction } from "../useAction.ts";
import { useAsync } from "../useAsync.ts";
import { ReportButton } from "../components/ReportButton.tsx";

export function MemeDetail() {
  const { id = "" } = useParams();
  const user = useUser();
  const navigate = useNavigate();
  const { hash } = useLocation();
  const { data: meme, error, setData: setMeme } = useAsync(id, () => getMeme(id));
  const { busy, error: actionError, run } = useAction();
  const [adminTags, setAdminTags] = useState<string[]>([]);
  useEffect(() => setAdminTags(meme?.tags ?? []), [meme?.id, meme?.tags]);

  // Router navigations don't scroll to fragments; jump to `#comments` once the page has rendered.
  const loaded = meme !== null;
  useEffect(() => {
    if (loaded && hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [loaded, hash]);

  /** Owner and admin actions that return the meme's new version. */
  function act(fn: () => Promise<Meme>) {
    void run(async () => setMeme(await fn()));
  }

  function remove(meme: Meme) {
    if (!window.confirm("Delete this meme?")) return;
    void run(async () => {
      await deleteMeme(meme.id);
      navigate(`/u/${meme.owner.username}?tab=memes`);
    });
  }

  if (error !== null) return <ErrorView error={error} />;
  if (!meme) return <Spinner label="Loading…" />;

  const isOwner = user.id === meme.owner.id;

  return (
    <section className="detail">
      <div className="detail-header">
        <div className="detail-info">
          <Text as="div" tone="muted" className="detail-meta" data-testid="meme-meta">
            <span className="detail-byline">
              by <Link to={`/u/${meme.owner.username}`}>@{meme.owner.username}</Link> · <MemeAge meme={meme} /> <MemeBadges meme={meme} />
            </span>
            {meme.tags.length > 0 && (
              <span className="detail-tags" data-testid="meme-tags" title={meme.tags.map((tag) => `#${tag}`).join(" ")}>
                {meme.tags.map((tag, index) => (
                  <span key={tag}>
                    {index > 0 && " "}
                    <Chip as={Link} to={`/t/${tag}`} data-testid="tag-chip" data-tag={tag}>#{tag}</Chip>
                  </span>
                ))}
              </span>
            )}
          </Text>
          <div className="detail-heading">
            <h1 className="detail-title" data-testid="meme-title">
              {meme.title || "Untitled"}
              {meme.favorited && <Icon name="star" label="Favorited" className="detail-favorite-mark" data-testid="meme-favorite-mark" />}
            </h1>
            <Inline className="detail-links">
              <ShareButton memeId={meme.id} />
              <LinkButton
                size="sm"
                href={contentUrl(meme.outputAsset)}
                download={`${fileSlug(meme.title)}${assetExtension(meme.outputAsset)}`}
                icon={<Icon name="down" />}
                data-testid="download-meme"
              >
                Download
              </LinkButton>
              <ReportButton kind="meme" id={meme.id} />
            </Inline>
          </div>
        </div>
      </div>
      <div className="detail-media">
        <MediaView asset={meme.outputAsset} alt={meme.title || "meme"} testId="meme-media" controls />
      </div>
      <div className="detail-actions">
        <div className="detail-votes" data-testid="meme-votes">
          <VoteButtons meme={meme} onChange={setMeme} />
          <FavoriteButton meme={meme} onChange={setMeme} showLabel />
        </div>
        <LinkButton as={Link} variant="quiet" to={`/create?template=${meme.templateId}`} icon={<Icon name="image" />} data-testid="use-template">
          Make one with this template
        </LinkButton>
      </div>
      <div className="detail-comments" data-testid="meme-comments">
        <Comments meme={meme} onCountChange={(delta) => setMeme((m) => m && { ...m, commentCount: m.commentCount + delta })} />
      </div>
      {user.isAdmin && (
        <Panel variant="inset" heading="Admin tools" className="detail-owner" data-testid="admin-actions">
          <Inline>
            {meme.postedAt === null && (
              <Button variant="primary" disabled={busy} data-testid="admin-post-meme" onClick={() => act(() => postMeme(meme.id))}>
                Post
              </Button>
            )}
            <Button
              disabled={busy}
              data-testid="admin-visibility-toggle"
              onClick={() => act(() => updateMeme(meme.id, { visibility: meme.visibility === "public" ? "unlisted" : "public" }))}
            >
              {meme.visibility === "public" ? "Delist" : "Make public"}
            </Button>
            <Button disabled={busy} data-testid="admin-edit-meme" onClick={() => navigate(`/create?meme=${meme.id}`)}>
              Edit
            </Button>
            <Button variant="danger" disabled={busy} data-testid="admin-delete-meme" onClick={() => remove(meme)}>
              Delete
            </Button>
          </Inline>
          <TagField value={adminTags} onChange={setAdminTags} testId="admin-meme-tags" disabled={busy} />
          <Button disabled={busy} data-testid="admin-save-meme-tags" onClick={() => act(() => updateMeme(meme.id, { tags: adminTags }))}>
            Save tags
          </Button>
          {actionError !== null && <ErrorView error={actionError} />}
        </Panel>
      )}
        {isOwner && (
          <Panel variant="inset" heading="Only visible to you" className="detail-owner" data-testid="owner-actions">
            <Inline>
              {meme.postedAt === null && (
                <Button variant="primary" disabled={busy} data-testid="post-meme" onClick={() => act(() => postMeme(meme.id))}>
                  Post
                </Button>
              )}
              <Button
                disabled={busy}
                data-testid="visibility-toggle"
                onClick={() =>
                  act(() => updateMeme(meme.id, { visibility: meme.visibility === "public" ? "unlisted" : "public" }))
                }
              >
                {meme.visibility === "public" ? "Delist" : "Make public"}
              </Button>
              <Button disabled={busy} data-testid="edit-meme" onClick={() => navigate(`/create?meme=${meme.id}`)}>
                Edit
              </Button>
              <Button variant="danger" disabled={busy} data-testid="delete-meme" onClick={() => remove(meme)}>
                Delete
              </Button>
            </Inline>
            {actionError !== null && <ErrorView error={actionError} />}
          </Panel>
        )}
    </section>
  );
}

/** Copies the meme's link to the clipboard, and says so on the button for a few seconds. */
function ShareButton({ memeId }: { memeId: string }) {
  // null: idle; true: copied; false: the browser refused (no clipboard permission).
  const [copied, setCopied] = useState<boolean | null>(null);
  useEffect(() => {
    if (copied === null) return;
    const timer = setTimeout(() => setCopied(null), 2500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      size="sm"
      icon={<Icon name={copied ? "check" : "link"} />}
      aria-live="polite"
      data-testid="share-meme"
      onClick={() =>
        navigator.clipboard.writeText(`${window.location.origin}/m/${memeId}`).then(
          () => setCopied(true),
          () => setCopied(false),
        )
      }
    >
      {copied === true ? "Copied link to clipboard!" : copied === false ? "Couldn't copy the link" : "Share"}
    </Button>
  );
}
