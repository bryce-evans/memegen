import { useParams } from "react-router-dom";
import type { Template } from "@memegen/shared";
import { Badge, Callout, EmptyState, Icon, PageHeader, Text } from "@memegen/ui";
import { getTag, listTemplates } from "../api.ts";
import { ErrorView } from "../components/common.tsx";
import { GalleryFeed } from "../components/feed.tsx";
import { TemplateGrid } from "../components/templates.tsx";
import { plural } from "../format.ts";
import { useAsync } from "../useAsync.ts";
import { usePaged } from "../usePaged.ts";

export function TagPage() {
  const { slug = "" } = useParams();
  const { data: tag, error } = useAsync(slug, () => getTag(slug));
  const templates = usePaged<Template>(slug, (offset) => listTemplates({ tag: slug, offset }));

  if (error !== null) return <ErrorView error={error} />;

  const head = (
    <>
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
    </>
  );

  return (
    <section>
      {/* A team tag's header stands out as a callout in the team color. */}
      <header className="tag-head">{tag?.kind === "team" ? <Callout tone="success">{head}</Callout> : head}</header>

      <div data-testid="tag-templates">
        <PageHeader level={2} title="Templates" />
        <TemplateGrid list={templates} empty={<EmptyState icon={<Icon name="image" />} title="No templates with this tag." />} paging="button" />
      </div>

      <div data-testid="tag-memes">
        <GalleryFeed kind="tag" tag={slug} title="Memes" />
      </div>
    </section>
  );
}
