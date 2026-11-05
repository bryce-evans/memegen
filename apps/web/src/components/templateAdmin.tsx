import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Meme, Template } from "@memegen/shared";
import { Button, Inline, LinkButton, Panel, Text } from "@memegen/ui";
import { ApiError, deleteMeme, deleteTemplate, deleteTemplateDependents, getTemplateDependents, replaceTemplateTags, updateTemplate } from "../api.ts";
import { plural } from "../format.ts";
import { useAction } from "../useAction.ts";
import { usePaged } from "../usePaged.ts";
import { ErrorView, MediaView, PagedList } from "./common.tsx";
import { TagField } from "./tagInputs.tsx";

/** Moderation is separate from author controls, including when an admin is also the author. */
export function TemplateAdminActions({ template, onChange }: { template: Template; onChange: (template: Template) => void }) {
  const [tags, setTags] = useState(template.tags);
  const [review, setReview] = useState(false);
  const { busy, error, run } = useAction();
  useEffect(() => setTags(template.tags), [template.id, template.tags]);

  return (
    <Panel variant="inset" heading="Admin tools" data-testid="template-admin-actions">
      <Inline>
        <LinkButton as={Link} to={`/create?editTemplate=${template.id}`} data-testid="template-admin-edit">
          Edit template
        </LinkButton>
        <Button
          disabled={busy}
          data-testid="template-admin-visibility"
          onClick={() => run(async () => onChange(await updateTemplate(template.id, { isPublic: !template.isPublic })))}
        >
          {template.isPublic ? "Delist" : "Make public"}
        </Button>
      </Inline>
      <TagField
        value={tags}
        onChange={setTags}
        testId="template-admin-tags"
        description="Edit this template's direct base and community tags. Parent template tags are not changed."
        disabled={busy}
      />
      <Button
        disabled={busy}
        data-testid="template-admin-save-tags"
        onClick={() => run(async () => onChange(await replaceTemplateTags(template.id, tags)))}
      >
        Save tags
      </Button>
      {error !== null && <ErrorView error={error} />}
      <Text size="sm" tone="muted">
        Before removing this template, review all related posts and drafts, including unlisted records and uses of its variations.
        Delete them individually or explicitly delete all. Template removal stays blocked until none remain; stored assets are not deleted.
      </Text>
      {review ? (
        <TemplateRemovalReview key={template.id} template={template} />
      ) : (
        <Inline>
          <Button data-testid="template-admin-review" onClick={() => setReview(true)}>
            Review related posts before removal
          </Button>
          <Button variant="danger" disabled data-testid="template-admin-delete">Delete template</Button>
        </Inline>
      )}
    </Panel>
  );
}

function TemplateRemovalReview({ template }: { template: Template }) {
  const navigate = useNavigate();
  const [total, setTotal] = useState<number | null>(null);
  const { busy, error, run } = useAction();
  const list = usePaged<Meme>(template.id, async (offset) => {
    const page = await getTemplateDependents(template.id, { offset, limit: 20 });
    setTotal(page.total);
    return page;
  });
  const ready = total !== null && !list.loading && list.error === null && !busy;

  function removePost(meme: Meme) {
    if (!window.confirm(`Delete 1 related ${meme.postedAt === null ? "draft" : "post"}, “${meme.title || "Untitled"}”, by @${meme.owner.username}? This cannot be undone.`)) return;
    void run(async (signal) => {
      await deleteMeme(meme.id);
      if (!signal.aborted) {
        setTotal(null);
        list.reload();
      }
    });
  }

  function removeAll() {
    if (!ready || total === 0) return;
    if (!window.confirm(`Delete all ${total} related posts and drafts using this template or its variations, including unlisted records? This cannot be undone. The template and stored assets will not be deleted.`)) return;
    void run(async (signal) => {
      await deleteTemplateDependents(template.id);
      if (!signal.aborted) {
        setTotal(null);
        list.reload();
      }
    });
  }

  function removeTemplate() {
    if (!ready || total !== 0) return;
    if (!window.confirm(`Delete “${template.name}” and its variations? The review found 0 related posts or drafts. Stored assets will not be deleted. This cannot be undone.`)) return;
    void run(async (signal) => {
      try {
        await deleteTemplate(template.id);
        if (!signal.aborted) navigate("/create");
      } catch (err) {
        if (!signal.aborted && err instanceof ApiError && err.status === 409) {
          setTotal(null);
          list.reload();
        }
        throw err;
      }
    });
  }

  return (
    <div className="template-removal-review" aria-busy={list.loading || busy}>
      <Text data-testid="template-dependent-count" aria-live="polite">
        {total === null ? "Checking related posts and drafts…" : `${plural(total, "related post or draft", "related posts and drafts")} affected`}
      </Text>
      <Text size="sm" tone="muted">Includes this template and its variations, all authors, public and unlisted posts, and unpublished drafts.</Text>
      <Button
        disabled={busy || list.loading}
        data-testid="template-admin-review"
        onClick={() => {
          setTotal(null);
          list.reload();
        }}
      >
        Refresh related posts
      </Button>
      <PagedList
        list={{ ...list, hasMore: list.hasMore && !busy }}
        empty={<Text>No related posts or drafts remain. The template can now be removed.</Text>}
        paging="button"
        moreLabel="More related posts"
        moreTestId="template-dependents-more"
      >
        {(memes) => (
          <ul className="template-dependents">
            {memes.map((meme) => (
              <li key={meme.id} className="template-dependent" data-testid="template-dependent-post" data-meme-id={meme.id}>
                <Link to={`/m/${meme.id}`} className="template-dependent-media">
                  <MediaView asset={meme.outputAsset} alt={meme.title || "Untitled"} />
                </Link>
                <div className="template-dependent-info">
                  <Link to={`/m/${meme.id}`}>{meme.title || "Untitled"}</Link>
                  <Text size="sm" tone="muted">
                    by @{meme.owner.username} · {meme.postedAt === null ? "Draft" : "Posted"} · {meme.visibility} · {meme.templateId === template.id ? "This template" : "Variation"}
                  </Text>
                </div>
                <Button variant="danger" size="sm" disabled={!ready} data-testid="template-dependent-delete" onClick={() => removePost(meme)}>
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
      </PagedList>
      <Inline>
        <Button variant="danger" disabled={!ready || total === 0} data-testid="template-dependents-delete-all" onClick={removeAll}>
          Delete all related posts and drafts
        </Button>
        <Button variant="danger" disabled={!ready || total !== 0} data-testid="template-admin-delete" onClick={removeTemplate}>
          Delete template
        </Button>
      </Inline>
      {error !== null && <ErrorView error={error} />}
    </div>
  );
}
