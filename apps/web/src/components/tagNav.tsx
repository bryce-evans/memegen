import { Link, useLocation } from "react-router-dom";
import type { Tag } from "@memegen/shared";
import { Icon, NavItem, NavList, SidebarSection } from "@memegen/ui";
import { listTags } from "../api.ts";
import { useAsync } from "../useAsync.ts";

/** Topic tags in Trending: the most used on memes, all time. */
const TRENDING_LIMIT = 5;

/**
 * Side-column tag lists: Trending (topic tags on the most memes) and Teams; refetched on navigation so tags created in
 * the editor show up, keeping the current lists on screen meanwhile.
 */
export function TagSidebar() {
  const { pathname } = useLocation();
  const { data } = useAsync(
    pathname,
    () => Promise.all([listTags({ kind: "topic", sort: "memes", limit: TRENDING_LIMIT }), listTags({ kind: "team", limit: 20 })]),
    { keepStale: true },
  );
  const [trending = [], teams = []] = data ?? [];

  return (
    <>
      {trending.length > 0 && <TagList title="Trending" tags={trending} count={(t) => t.memeCount} testId="trending-tags" />}
      {teams.length > 0 && <TagList title="Teams" tags={teams} count={(t) => t.templateCount + t.memeCount} testId="team-tags" />}
    </>
  );
}

function TagList({ title, tags, count, testId }: { title: string; tags: Tag[]; count: (t: Tag) => number; testId: string }) {
  return (
    <SidebarSection as="nav" aria-label={title} heading={title} data-testid={testId}>
      <NavList>
        {tags.map((t) => (
          <NavItem
            key={t.slug}
            as={Link}
            to={`/t/${t.slug}`}
            icon={<Icon name={t.kind === "team" ? "team" : "tag"} />}
            trailing={count(t)}
            className={t.kind === "team" ? "tag-item team" : "tag-item"}
            data-tag={t.slug}
          >
            #{t.slug}
          </NavItem>
        ))}
      </NavList>
    </SidebarSection>
  );
}
