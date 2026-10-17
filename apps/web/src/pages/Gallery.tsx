import { useSearchParams } from "react-router-dom";
import type { Template, UserSummary } from "@memegen/shared";
import { EmptyState, Icon, PageHeader, SegmentedControl } from "@memegen/ui";
import { listTemplates, searchUsers } from "../api.ts";
import { GalleryFeed, SEARCH_TYPE_LABELS, SEARCH_TYPES, useSearchType } from "../components/feed.tsx";
import { TemplateGrid } from "../components/templates.tsx";
import { UserList } from "../components/users.tsx";
import { usePaged } from "../usePaged.ts";

export function Popular() {
  return (
    <section>
      <GalleryFeed kind="popular" title="Popular" />
    </section>
  );
}

export function Recent() {
  return (
    <section>
      <GalleryFeed kind="recent" title="Recent" />
    </section>
  );
}

/**
 * `/search?q=&type=`: what matches `q`, by type (beside the title): listed memes whose title, template name, tags, or
 * author match (`posts`, the default), templates by name, or users by username.
 */
export function Search() {
  const [params, setParams] = useSearchParams();
  const q = (params.get("q") ?? "").trim();
  const type = useSearchType();
  const title = q ? `Search: ${q}` : "Search";
  const typeControl = (
    <SegmentedControl
      aria-label="Show"
      size="sm"
      value={type}
      onChange={(next) => {
        // From the live URL, so the query and period stay as they are.
        const live = new URLSearchParams(window.location.search);
        live.set("type", next);
        setParams(live, { replace: true });
      }}
      options={SEARCH_TYPES.map((t) => ({ value: t, label: SEARCH_TYPE_LABELS[t], testId: `search-type-${t}` }))}
    />
  );
  return (
    <section data-testid="search-results" data-query={q} data-type={type}>
      {type === "posts" ? (
        <GalleryFeed kind="search" q={q} title={title} actions={typeControl} />
      ) : (
        <>
          <PageHeader title={title} actions={typeControl} />
          {type === "templates" ? <TemplateResults q={q} /> : <UserResults q={q} />}
        </>
      )}
    </section>
  );
}

function TemplateResults({ q }: { q: string }) {
  const list = usePaged<Template>(q, (offset) => listTemplates({ q, offset }));
  return (
    <TemplateGrid
      list={list}
      empty={<EmptyState icon={<Icon name="search" />} title="No templates found." />}
      paging="sentinel"
      data-testid="search-templates"
    />
  );
}

function UserResults({ q }: { q: string }) {
  const list = usePaged<UserSummary>(q, (offset) => searchUsers({ q, offset }));
  return <UserList list={list} empty={<EmptyState icon={<Icon name="search" />} title="No users found." />} />;
}
