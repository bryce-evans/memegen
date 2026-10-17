import { useParams } from "react-router-dom";
import { Badge, Callout, PageHeader } from "@memegen/ui";
import { getTag } from "../api.ts";
import { ErrorView } from "../components/common.tsx";
import { GalleryFeed } from "../components/feed.tsx";
import { plural } from "../format.ts";
import { useAsync } from "../useAsync.ts";

/** `/t/:slug`: the tag's header and its memes (templates with the tag are found from Create's template search). */
export function TagPage() {
  const { slug = "" } = useParams();
  const { data: tag, error } = useAsync(slug, () => getTag(slug));

  if (error !== null) return <ErrorView error={error} />;

  const head = (
    <PageHeader
      titleProps={{ "data-testid": "tag-title" }}
      title={
        <>
          #{tag?.slug ?? slug}
          {tag && <Badge tone={tag.kind === "team" ? "success" : "neutral"}>{tag.kind}</Badge>}
        </>
      }
    />
  );

  return (
    <section>
      {/* A team tag's header stands out as a callout in the team color. */}
      <header className="tag-head">{tag?.kind === "team" ? <Callout tone="success">{head}</Callout> : head}</header>

      <div data-testid="tag-memes">
        <GalleryFeed kind="tag" tag={slug} title={tag ? plural(tag.memeCount, "Post") : "Posts"} />
      </div>
    </section>
  );
}
