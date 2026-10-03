import { useId, useState, type Dispatch, type FormEvent, type KeyboardEvent, type SetStateAction } from "react";
import { MAX_TAGS, TAG_KINDS, tagSlug, type Tag, type TagKind } from "@memegen/shared";
import { Button, Chip, ChipGroup, Field, Icon, Inline, SelectField, Text, TextField } from "@memegen/ui";
import { ApiError, createTag, listTags } from "../api.ts";
import { useAction } from "../useAction.ts";
import { useAsync } from "../useAsync.ts";
import { useDebounced } from "../useDebounced.ts";
import { ErrorView } from "./common.tsx";

/** Debounced `/api/tags?q=` lookup; an empty query (or a failed lookup) → no suggestions. */
export function useTagSuggestions(query: string, limit = 8): Tag[] {
  const q = query.trim();
  const debounced = useDebounced(q, 200);
  // Clearing the field drops the suggestions at once instead of after the debounce.
  const key = q ? debounced : "";
  const { data } = useAsync(`${key}:${limit}`, () => (key ? listTags({ q: key, limit }) : Promise.resolve([])));
  return data ?? [];
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
  const lookup = useTagSuggestions(text.split(",").pop() ?? "");

  function commit(raw: string) {
    const added = raw.split(",").map(tagSlug).filter(Boolean);
    if (added.length) onChange([...new Set([...value, ...added])].slice(0, MAX_TAGS));
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
 * A labelled tag input for forms; `allowCreate` adds the New tag form, whose created tag is added to the value.
 * `testId` goes on the input; `onChange` is a state setter so a tag created mid-edit can't drop other changes.
 */
export function TagField(props: {
  value: string[];
  onChange: Dispatch<SetStateAction<string[]>>;
  suggestions?: readonly string[];
  label?: string;
  description?: string;
  testId: string;
  disabled?: boolean;
  allowCreate?: boolean;
}) {
  const { value, onChange, suggestions, label = "Tags", description, testId, disabled = false, allowCreate = false } = props;
  return (
    <>
      <Field as="div" label={label} description={description}>
        <TagInput value={value} onChange={onChange} suggestions={suggestions} testId={testId} disabled={disabled} />
      </Field>
      {allowCreate && (
        <NewTagForm disabled={disabled} onCreated={(slug) => onChange((tags) => (tags.includes(slug) ? tags : [...tags, slug]))} />
      )}
    </>
  );
}

/** Create a tag (e.g. a team) and hand back its slug; an existing tag of that name is just handed back. */
export function NewTagForm({ disabled, onCreated }: { disabled: boolean; onCreated: (slug: string) => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<TagKind>("team");
  const { busy, error, run } = useAction();
  const off = disabled || busy;

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    void run(async () => {
      let slug: string;
      try {
        slug = (await createTag({ name: trimmed, kind })).slug;
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 409)) throw err;
        slug = tagSlug(trimmed);
      }
      setName("");
      onCreated(slug);
    });
  }

  return (
    <Field as="div" label="New tag">
      <form className="new-tag" onSubmit={submit}>
        <TextField
          size="sm"
          className="new-tag-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tag name"
          aria-label="Tag name"
          maxLength={60}
          disabled={off}
          data-testid="new-tag-name"
        />
        <SelectField
          size="sm"
          className="new-tag-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as TagKind)}
          disabled={off}
          data-testid="new-tag-kind"
          aria-label="Tag kind"
        >
          {TAG_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </SelectField>
        <Button size="sm" type="submit" disabled={off || !name.trim()} data-testid="new-tag-submit">
          Create tag
        </Button>
      </form>
      {error !== null && <ErrorView error={error} />}
    </Field>
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
  const { busy, error, setError, run } = useAction();

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

  function save() {
    void run(async () => {
      await onSave(draft);
      setEditing(false);
    });
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
