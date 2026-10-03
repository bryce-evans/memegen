import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { tagSlug, type Tag } from "@memegen/shared";
import { Badge, Icon, IconButton, NavItem, NavList, SidebarSection, TextField } from "@memegen/ui";
import { listTags } from "../api.ts";
import { useAuth } from "../auth.tsx";
import { useAsync } from "../useAsync.ts";
import { useTagSuggestions } from "./tagInputs.tsx";

/** Header tag search: Enter (or a suggestion) opens the tag page; suggestions drop down while the field has focus. */
export function TagSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const suggestions = useTagSuggestions(query);

  function go(slug: string) {
    setQuery("");
    navigate(`/t/${slug}`);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const slug = suggestions[0]?.slug ?? tagSlug(query);
    if (slug) go(slug);
  }

  return (
    <form className="tag-search" onSubmit={submit} role="search">
      <div className="tag-search-field">
        <TextField
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tags…"
          aria-label="Search tags"
          data-testid="tag-search"
        />
        <IconButton type="submit" variant="primary" label="Search" className="tag-search-submit">
          <Icon name="search" />
        </IconButton>
      </div>
      {suggestions.length > 0 && (
        <NavList className="tag-suggestions">
          {suggestions.map((t) => (
            <NavItem
              key={t.slug}
              as="button"
              type="button"
              icon={<Icon name={t.kind === "team" ? "team" : "tag"} />}
              trailing={t.kind === "team" ? <Badge tone="success">team</Badge> : undefined}
              data-testid="tag-suggestion"
              data-tag={t.slug}
              onClick={() => go(t.slug)}
            >
              #{t.slug}
            </NavItem>
          ))}
        </NavList>
      )}
    </form>
  );
}

/**
 * Side-column popular/team tag lists; refetched on navigation so tags created in the editor show up, keeping the
 * current lists on screen meanwhile.
 */
export function TagSidebar() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const { data } = useAsync(
    `${user?.id ?? ""}:${pathname}`,
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
