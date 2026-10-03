import { useEffect, useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { tagSlug, type Tag } from "@memegen/shared";
import {
  Badge,
  Button,
  Chip,
  ChipGroup,
  Icon,
  IconButton,
  Inline,
  NavItem,
  NavList,
  SidebarSection,
  Text,
  TextField,
} from "@memegen/ui";
import { listTags } from "../api.ts";
import { useAuth } from "../auth.tsx";
import { ErrorView } from "./common.tsx";

/** Tag links; slugs in `base` (a template's author-set tags) are marked `data-base="true"`. */
export function TagChips({ slugs, base = [] }: { slugs: readonly string[]; base?: readonly string[] }) {
  if (slugs.length === 0) return null;
  return (
    <ChipGroup>
      {slugs.map((slug) => (
        <Chip
          key={slug}
          as={Link}
          to={`/t/${slug}`}
          className={base.includes(slug) ? "tag-chip-base" : undefined}
          title={base.includes(slug) ? "Set by the template's author" : undefined}
          data-testid="tag-chip"
          data-tag={slug}
          data-base={base.includes(slug) ? "true" : undefined}
        >
          #{slug}
        </Chip>
      ))}
    </ChipGroup>
  );
}

/** Debounced `/api/tags?q=` lookup; empty query → no suggestions. */
function useTagSuggestions(query: string, limit: number): Tag[] {
  const [tags, setTags] = useState<Tag[]>([]);
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setTags([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      listTags(q, undefined, limit).then(
        (found) => !cancelled && setTags(found),
        () => !cancelled && setTags([]),
      );
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, limit]);
  return tags;
}

/**
 * Chip input for tag slugs: Enter/comma (or leaving the field) commits typed names, normalized with `tagSlug`.
 * `suggestions` are offered as one-click additions, never applied automatically.
 */
export function TagInput(props: {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: readonly string[];
  testId?: string;
  disabled?: boolean;
}) {
  const { value, onChange, suggestions = [], testId, disabled } = props;
  const [text, setText] = useState("");
  const listId = useId();
  const lookup = useTagSuggestions(text.split(",").pop() ?? "", 8);

  function commit(raw: string) {
    const added = raw.split(",").map(tagSlug).filter(Boolean);
    if (added.length) onChange([...new Set([...value, ...added])].slice(0, 20));
    setText("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commit(text);
    } else if (e.key === "Backspace" && text === "" && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  const offered = suggestions.filter((s) => !value.includes(s));
  return (
    <div className="tag-input">
      {value.length > 0 && (
        <ChipGroup>
          {value.map((slug) => (
            <Chip
              key={slug}
              data-testid="tag-input-chip"
              data-tag={slug}
              removeLabel={`Remove ${slug}`}
              removeDisabled={disabled}
              onRemove={() => onChange(value.filter((t) => t !== slug))}
            >
              #{slug}
            </Chip>
          ))}
        </ChipGroup>
      )}
      <TextField
        value={text}
        list={listId}
        disabled={disabled}
        placeholder="add tags (comma or Enter)"
        data-testid={testId}
        onChange={(e) => {
          const next = e.target.value;
          if (next.includes(",")) {
            const parts = next.split(",");
            commit(parts.slice(0, -1).join(","));
            setText(parts[parts.length - 1] ?? "");
          } else setText(next);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => text.trim() && commit(text)}
      />
      <datalist id={listId}>
        {lookup.map((t) => (
          <option key={t.slug} value={t.slug}>
            {t.name}
          </option>
        ))}
      </datalist>
      {offered.length > 0 && (
        <ChipGroup className="tag-suggest">
          <Text as="span" size="sm" tone="muted">
            Suggested:
          </Text>
          {offered.map((slug) => (
            <Chip key={slug} as="button" type="button" variant="suggest" disabled={disabled} onClick={() => onChange([...value, slug])}>
              + #{slug}
            </Chip>
          ))}
        </ChipGroup>
      )}
    </div>
  );
}

/**
 * Toggle button → chip input + Save; `onSave` returns once the server accepted the tags. The draft starts from
 * `tags` (pass `[]` to collect additions only).
 */
export function TagEditor(props: { tags: string[]; onSave: (tags: string[]) => Promise<void>; testId: string; label?: string }) {
  const { tags, onSave, testId, label = "Edit tags" } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tags);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (!editing) {
    return (
      <Button
        size="sm"
        variant="quiet"
        icon={<Icon name="tag" />}
        data-testid={testId}
        onClick={() => {
          setDraft(tags);
          setError(null);
          setEditing(true);
        }}
      >
        {label}
      </Button>
    );
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await onSave(draft);
      setEditing(false);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tag-editor">
      <TagInput value={draft} onChange={setDraft} testId="tags-input" disabled={busy} />
      <Inline className="tag-editor-actions">
        <Button size="sm" variant="primary" disabled={busy} onClick={save} data-testid="tags-save">
          Save tags
        </Button>
        <Button size="sm" disabled={busy} onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </Inline>
      {error !== null && <ErrorView error={error} />}
    </div>
  );
}

/** Header tag search: Enter (or a suggestion) opens the tag page; suggestions drop down while the field has focus. */
export function TagSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const suggestions = useTagSuggestions(query, 8);

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

/** Side-column popular/team tag lists; refetched on navigation so tags created in the editor show up. */
export function TagSidebar() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [popular, setPopular] = useState<Tag[]>([]);
  const [teams, setTeams] = useState<Tag[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listTags("", "topic", 10), listTags("", "team", 20)]).then(
      ([topic, team]) => {
        if (cancelled) return;
        setPopular(topic);
        setTeams(team);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [user?.id, pathname]);

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
