import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { Tag, Template } from "@memegen/shared";
import { getTag, listTemplates } from "../api.ts";
import { useAuth } from "../auth.tsx";
import { ErrorView } from "../components/common.tsx";
import { usePaged } from "../usePaged.ts";
import { GalleryFeed } from "./Gallery.tsx";
import { TemplateCard } from "./Templates.tsx";

export function TagPage() {
  const { slug = "" } = useParams();
  const { user } = useAuth();
  const [tag, setTag] = useState<Tag | null>(null);
  const [error, setError] = useState<unknown>(null);
  const templates = usePaged<Template>(`${slug}:${user?.id ?? ""}`, (offset) => listTemplates("", offset, 24, slug));

  useEffect(() => {
    let cancelled = false;
    setTag(null);
    setError(null);
    getTag(slug).then(
      (t) => !cancelled && setTag(t),
      (err) => !cancelled && setError(err),
    );
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (error !== null) return <ErrorView error={error} />;

  return (
    <section className={tag?.kind === "team" ? "tag-page team" : "tag-page"}>
      <header className="tag-head">
        <h1 className="page-title" data-testid="tag-title">
          #{tag?.slug ?? slug}
          {tag && tag.name !== tag.slug && <span className="tag-name"> {tag.name}</span>}
          {tag && <span className={`badge kind ${tag.kind}`}>{tag.kind}</span>}
        </h1>
        {tag?.description && <p>{tag.description}</p>}
        {tag && (
          <p className="muted">
            {tag.templateCount} {tag.templateCount === 1 ? "template" : "templates"} · {tag.memeCount}{" "}
            {tag.memeCount === 1 ? "meme" : "memes"}
          </p>
        )}
      </header>

      <div data-testid="tag-templates">
        <h2 className="section-title">Templates</h2>
        {templates.error !== null && <ErrorView error={templates.error} />}
        {!templates.loading && templates.items.length === 0 && templates.error === null && (
          <p className="muted">No templates with this tag.</p>
        )}
        <div className="grid">
          {templates.items.map((t) => (
            <TemplateCard key={t.id} template={t} onChanged={templates.reload} />
          ))}
        </div>
        {templates.loading && <p className="muted">Loading…</p>}
        {templates.hasMore && !templates.loading && (
          <div className="center">
            <button type="button" onClick={templates.loadMore}>
              More templates
            </button>
          </div>
        )}
      </div>

      <div data-testid="tag-memes">
        <GalleryFeed defaultPeriod="all" tag={slug} title="Memes" />
      </div>
    </section>
  );
}
