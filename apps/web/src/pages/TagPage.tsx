import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { Tag, Template } from "@memegen/shared";
import { Badge, Button, EmptyState, Icon, MediaGrid, PageHeader, Spinner, Text } from "@memegen/ui";
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
        <PageHeader
          titleProps={{ "data-testid": "tag-title" }}
          title={
            <>
              #{tag?.slug ?? slug}
              {tag && tag.name !== tag.slug && <span className="tag-name"> {tag.name}</span>}
              {tag && <Badge tone={tag.kind === "team" ? "success" : "neutral"}>{tag.kind}</Badge>}
            </>
          }
        />
        {tag?.description && <Text>{tag.description}</Text>}
        {tag && (
          <Text tone="muted">
            {tag.templateCount} {tag.templateCount === 1 ? "template" : "templates"} · {tag.memeCount}{" "}
            {tag.memeCount === 1 ? "meme" : "memes"}
          </Text>
        )}
      </header>

      <div data-testid="tag-templates">
        <PageHeader level={2} title="Templates" />
        {templates.error !== null && <ErrorView error={templates.error} />}
        {!templates.loading && templates.items.length === 0 && templates.error === null && (
          <EmptyState icon={<Icon name="image" />} title="No templates with this tag." />
        )}
        <MediaGrid>
          {templates.items.map((t) => (
            <TemplateCard key={t.id} template={t} onChanged={templates.reload} />
          ))}
        </MediaGrid>
        {templates.loading && <Spinner label="Loading…" />}
        {templates.hasMore && !templates.loading && (
          <div className="load-more">
            <Button onClick={templates.loadMore}>More templates</Button>
          </div>
        )}
      </div>

      <div data-testid="tag-memes">
        <GalleryFeed defaultPeriod="all" tag={slug} title="Memes" />
      </div>
    </section>
  );
}
