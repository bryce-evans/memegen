import { useEffect, useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { TAG_KINDS, tagSlug, type Tag, type TagKind } from "@memegen/shared";
import { createTag, listTags } from "../api.ts";
import { useAuth } from "../auth.tsx";
import { ErrorView } from "./common.tsx";

export function TagChips({ slugs }: { slugs: readonly string[] }) {
  if (slugs.length === 0) return null;
  return (
    <span className="tag-chips">
      {slugs.map((slug) => (
        <Link key={slug} to={`/t/${slug}`} className="tag-chip" data-testid="tag-chip" data-tag={slug}>
          #{slug}
        </Link>
      ))}
    </span>
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
      <div className="tag-chips">
        {value.map((slug) => (
          <span key={slug} className="tag-chip editable" data-tag={slug}>
            #{slug}
            <button type="button" aria-label={`Remove ${slug}`} disabled={disabled} onClick={() => onChange(value.filter((t) => t !== slug))}>
              ×
            </button>
          </span>
        ))}
      </div>
      <input
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
        <div className="tag-suggest">
          <span className="muted small">Suggested:</span>
          {offered.map((slug) => (
            <button key={slug} type="button" className="tag-chip add" disabled={disabled} onClick={() => onChange([...value, slug])}>
              + #{slug}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** "Edit tags" toggle → chip input + Save; `onSave` returns once the server accepted the tags. */
export function TagEditor({ tags, onSave, testId }: { tags: string[]; onSave: (tags: string[]) => Promise<void>; testId: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tags);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (!editing) {
    return (
      <button
        type="button"
        className="small-button"
        data-testid={testId}
        onClick={() => {
          setDraft(tags);
          setError(null);
          setEditing(true);
        }}
      >
        Edit tags
      </button>
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
      <div className="actions">
        <button type="button" className="primary" disabled={busy} onClick={save} data-testid="tags-save">
          Save tags
        </button>
        <button type="button" disabled={busy} onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
      {error !== null && <ErrorView error={error} />}
    </div>
  );
}

/** Side-column tag search, popular/team tag lists, and the "new tag" form. */
export function TagSidebar() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const suggestions = useTagSuggestions(query, 8);
  const [popular, setPopular] = useState<Tag[]>([]);
  const [teams, setTeams] = useState<Tag[]>([]);
  const [reloads, setReloads] = useState(0);

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
  }, [reloads, user?.id]);

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
    <>
      <form className="side-group tag-search" onSubmit={submit} role="search">
        <h4>Tags</h4>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tags…"
          aria-label="Search tags"
          data-testid="tag-search"
        />
        {suggestions.length > 0 && (
          <ul className="tag-suggestions">
            {suggestions.map((t) => (
              <li key={t.slug}>
                <button type="button" className="side-item" data-testid="tag-suggestion" data-tag={t.slug} onClick={() => go(t.slug)}>
                  #{t.slug}
                  {t.kind === "team" && <span className="badge team">team</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>
      {popular.length > 0 && <TagList title="Popular tags" tags={popular} />}
      {teams.length > 0 && <TagList title="Teams" tags={teams} />}
      {user && (
        <NewTagForm
          onCreated={(tag) => {
            setReloads((n) => n + 1);
            go(tag.slug);
          }}
        />
      )}
    </>
  );
}

function TagList({ title, tags }: { title: string; tags: Tag[] }) {
  return (
    <nav className="side-group" aria-label={title}>
      <h4>{title}</h4>
      {tags.map((t) => (
        <Link key={t.slug} to={`/t/${t.slug}`} className={t.kind === "team" ? "side-item team" : "side-item"} data-tag={t.slug}>
          #{t.slug} <span className="muted small">{t.templateCount + t.memeCount}</span>
        </Link>
      ))}
    </nav>
  );
}

function NewTagForm({ onCreated }: { onCreated: (tag: Tag) => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<TagKind>("team");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const tag = await createTag({ name: name.trim(), kind });
      setName("");
      onCreated(tag);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="side-group new-tag" onSubmit={submit}>
      <h4>New tag</h4>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tag name" maxLength={60} data-testid="new-tag-name" />
      <div className="row">
        <select value={kind} onChange={(e) => setKind(e.target.value as TagKind)} data-testid="new-tag-kind" aria-label="Tag kind">
          {TAG_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <button type="submit" disabled={busy || !name.trim()} data-testid="new-tag-submit">
          Create
        </button>
      </div>
      {error !== null && <ErrorView error={error} />}
    </form>
  );
}
