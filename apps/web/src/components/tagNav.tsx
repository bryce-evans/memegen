import { Link, useLocation } from "react-router-dom";
import type { Tag } from "@memegen/shared";
import { Icon, NavItem, NavList, SidebarSection } from "@memegen/ui";
import { listTags } from "../api.ts";
import { useAsync } from "../useAsync.ts";

/**
 * Side-column popular/team tag lists; refetched on navigation so tags created in the editor show up, keeping the
 * current lists on screen meanwhile.
 */
export function TagSidebar() {
  const { pathname } = useLocation();
  const { data } = useAsync(
    pathname,
    () => Promise.all([listTags({ kind: "topic", limit: 10 }), listTags({ kind: "team", limit: 20 })]),
    { keepStale: true },
  );
  const [popular = [], teams = []] = data ?? [];

  return (
    <>
      {popular.length > 0 && <TagList title="Popular tags" tags={popular} />}
      {teams.length > 0 && <TagList title="Teams" tags={teams} />}
    </>
  );
}

function TagList({ title, tags }: { title: string; tags: Tag[] }) {
  return (
    <SidebarSection as="nav" aria-label={title} heading={title}>
      <NavList>
        {tags.map((t) => (
          <NavItem
            key={t.slug}
            as={Link}
            to={`/t/${t.slug}`}
            icon={<Icon name={t.kind === "team" ? "team" : "tag"} />}
            trailing={t.templateCount + t.memeCount}
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
