import { useParams } from "react-router-dom";
import type { Template } from "@memegen/shared";
import { Badge, EmptyState, Icon, PageHeader, Text } from "@memegen/ui";
import { getTag, listTemplates } from "../api.ts";
import { useAuth } from "../auth.tsx";
import { ErrorView, LoadMoreButton } from "../components/common.tsx";
import { GalleryFeed } from "../components/feed.tsx";
import { TemplateGrid } from "../components/templates.tsx";
import { plural } from "../format.ts";
import { useAsync } from "../useAsync.ts";
import { usePaged } from "../usePaged.ts";

export function TagPage() {
  const { slug = "" } = useParams();
  const { user } = useAuth();
  const { data: tag, error } = useAsync(slug, () => getTag(slug));
  const templates = usePaged<Template>(`${slug}:${user?.id ?? ""}`, (offset) => listTemplates({ tag: slug, offset }));

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
            {plural(tag.templateCount, "template")} · {plural(tag.memeCount, "meme")}
          </Text>
        )}
      </header>

      <div data-testid="tag-templates">
        <PageHeader level={2} title="Templates" />
        <TemplateGrid list={templates} empty={<EmptyState icon={<Icon name="image" />} title="No templates with this tag." />} />
        <LoadMoreButton hasMore={templates.hasMore} loading={templates.loading} onLoadMore={templates.loadMore} label="More templates" />
      </div>

      <div data-testid="tag-memes">
        <GalleryFeed kind="tag" tag={slug} title="Memes" />
      </div>
    </section>
  );
}
