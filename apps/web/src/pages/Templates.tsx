import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { PERIODS, type HotTemplate, type Period, type Template, type TemplateUsage } from "@memegen/shared";
import { createTemplate, getHotTemplates, getLimits, getTemplateUsage, listTemplates, setTemplateTags, uploadAsset } from "../api.ts";
import { useAuth } from "../auth.tsx";
import { ErrorView, MediaView, SignInPrompt } from "../components/common.tsx";
import { TagChips, TagEditor } from "../components/tags.tsx";
import { MEDIA_ACCEPT, precheckMedia } from "../media.ts";
import { usePaged } from "../usePaged.ts";
import { PERIOD_LABELS } from "./Gallery.tsx";

/** Pre-check against upload caps, upload the file, then register it as a template (or variation). */
async function uploadTemplate(file: File, name: string, parentId: string | null): Promise<Template> {
  const media = await precheckMedia(file, await getLimits());
  media.dispose();
  const asset = await uploadAsset(file, file.name, name);
  return createTemplate({ name, assetId: asset.id, parentId });
}

export function Templates() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const list = usePaged<Template>(`${q}:${user?.id ?? ""}`, (offset) => listTemplates(q, offset));

  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  return (
    <section>
      <h1 className="page-title">Templates</h1>
      <HotTemplates />
      <h2 className="section-title">All templates</h2>
      <div className="toolbar">
        <input
          type="search"
          className="search"
          placeholder="Search templates…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search templates"
          data-testid="template-search"
        />
      </div>
      <NewTemplateForm onDone={list.reload} />
      {list.error !== null && <ErrorView error={list.error} />}
      {!list.loading && list.items.length === 0 && list.error === null && <p className="muted">No templates found.</p>}
      <div className="grid">
        {list.items.map((t) => (
          <TemplateCard key={t.id} template={t} onChanged={list.reload} />
        ))}
      </div>
      {list.loading && <p className="muted">Loading…</p>}
      {list.hasMore && !list.loading && (
        <div className="center">
          <button type="button" data-testid="load-more" onClick={list.loadMore}>
            Load more
          </button>
        </div>
      )}
    </section>
  );
}

function HotTemplates() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<Period>("week");
  const [items, setItems] = useState<HotTemplate[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    getHotTemplates(period).then(
      (hot) => !cancelled && setItems(hot),
      (err) => !cancelled && setError(err),
    );
    return () => {
      cancelled = true;
    };
  }, [period, user?.id]);

  return (
    <section className="hot">
      <div className="toolbar">
        <h2 className="section-title">🔥 Hot</h2>
        <div className="tabs" role="group" aria-label="Hot period">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              className={p === period ? "tab active" : "tab"}
              aria-pressed={p === period}
              data-testid={`hot-period-${p}`}
              onClick={() => setPeriod(p)}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>
      {error !== null && <ErrorView error={error} />}
      {items === null && error === null && <p className="muted">Loading…</p>}
      {items?.length === 0 && <p className="muted">No templates used in this period yet.</p>}
      {items && items.length > 0 && (
        <div className="hot-row">
          {items.map(({ template, uses, posts }) => (
            <Link
              key={template.id}
              to={`/create?template=${template.id}`}
              className="hot-card"
              data-testid="hot-template"
              data-template-id={template.id}
              title={`Use “${template.name}”`}
            >
              <MediaView asset={template.asset} alt={template.name} />
              <span className="hot-name">{template.name}</span>
              <span className="muted small">
                <span data-testid="hot-uses">{uses}</span> {uses === 1 ? "use" : "uses"} · {posts} posted
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

/** Inline SVG sparkline of template uses over the period. */
function UsageChart({ templateId }: { templateId: string }) {
  const [period, setPeriod] = useState<Period>("month");
  const [usage, setUsage] = useState<TemplateUsage | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    getTemplateUsage(templateId, period).then(
      (u) => !cancelled && setUsage(u),
      (err) => !cancelled && setError(err),
    );
    return () => {
      cancelled = true;
    };
  }, [templateId, period]);

  const width = 220;
  const height = 48;
  const points = usage?.points ?? [];
  const max = Math.max(1, ...points.map((p) => p.uses));
  const step = points.length > 1 ? width / (points.length - 1) : 0;
  const line = points.map((p, i) => `${(i * step).toFixed(1)},${(height - 2 - (p.uses / max) * (height - 4)).toFixed(1)}`).join(" ");
  const total = points.reduce((sum, p) => sum + p.uses, 0);

  return (
    <div className="usage">
      <div className="row">
        <select value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label="Usage period">
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {PERIOD_LABELS[p]}
            </option>
          ))}
        </select>
        {usage && (
          <span className="muted small">
            {total} {total === 1 ? "use" : "uses"} · per {usage.bucket}
          </span>
        )}
      </div>
      {error !== null && <ErrorView error={error} />}
      {usage && (
        <svg
          className="sparkline"
          data-testid="usage-chart"
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${total} uses, peak ${max} per ${usage.bucket}`}
        >
          {points.length > 1 ? (
            <polyline points={line} fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          ) : (
            <circle cx={width / 2} cy={height / 2} r={3} fill="currentColor" />
          )}
        </svg>
      )}
    </div>
  );
}

export function TemplateCard({ template, onChanged }: { template: Template; onChanged: () => void }) {
  const { user } = useAuth();
  const [showUsage, setShowUsage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [tags, setTags] = useState(template.tags);
  // Owners retag their templates; seeded (ownerless) ones are community-tagged.
  const canTag = user !== null && (template.owner === null || template.owner.id === user.id);

  async function addVariation(file: File) {
    setBusy(true);
    setError(null);
    try {
      const name = `${template.name} (${file.name.replace(/\.[^.]+$/, "")})`.slice(0, 120);
      await uploadTemplate(file, name, template.id);
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card" data-testid="template-card" data-template-id={template.id}>
      <Link to={`/create?template=${template.id}`} className="card-media">
        <MediaView asset={template.asset} alt={template.name} />
      </Link>
      <div className="card-body">
        <button type="button" className="card-title linkish" onClick={() => setShowUsage((s) => !s)} title="Show usage">
          {template.name}
        </button>
        <div className="card-meta">
          {template.owner ? <Link to={`/u/${template.owner.username}`}>@{template.owner.username}</Link> : <span>built-in</span>}
          <span aria-hidden> · </span>
          <span data-testid="template-use-count">used {template.useCount}×</span>
          {!template.isPublic && <span className="badge private">Private</span>}
        </div>
        <TagChips slugs={tags} />
        {canTag && (
          <TagEditor
            tags={tags}
            testId="template-tags-edit"
            onSave={async (next) => setTags((await setTemplateTags(template.id, next)).tags)}
          />
        )}
        {showUsage && <UsageChart templateId={template.id} />}
        {template.variations.length > 0 && (
          <div className="variations" aria-label="Variations">
            {template.variations.map((v) => (
              <Link
                key={v.id}
                to={`/create?template=${v.id}`}
                className="variation"
                title={`Use “${v.name}”`}
                data-testid="variation-item"
                data-template-id={v.id}
              >
                <MediaView asset={v.asset} alt={v.name} />
              </Link>
            ))}
          </div>
        )}
        <div className="actions">
          <Link to={`/create?template=${template.id}`} className="button primary" data-testid="use-template">
            Use
          </Link>
          {template.parentId === null && user && (
            <label className={busy ? "button file-button disabled" : "button file-button"}>
              {busy ? "Uploading…" : "Add variation"}
              <input
                type="file"
                accept={MEDIA_ACCEPT}
                disabled={busy}
                data-testid="add-variation"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void addVariation(file);
                }}
              />
            </label>
          )}
          <button type="button" onClick={() => setShowUsage((s) => !s)} aria-pressed={showUsage} data-testid="usage-toggle">
            📈 Usage
          </button>
        </div>
        {error !== null && <ErrorView error={error} />}
      </div>
    </article>
  );
}

function NewTemplateForm({ onDone }: { onDone: () => void }) {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (!user) return <SignInPrompt action="upload templates" />;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    if (!file || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await uploadTemplate(file, name.trim(), null);
      setName("");
      setFile(null);
      form.reset();
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel upload-form" onSubmit={submit}>
      <h3>New template</h3>
      <div className="row">
        <label className="field">
          <span>Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={120}
            data-testid="new-template-name"
          />
        </label>
        <label className="field">
          <span>Image, GIF or video</span>
          <input
            type="file"
            accept={MEDIA_ACCEPT}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            required
            data-testid="new-template-file"
          />
        </label>
        <button type="submit" className="primary" disabled={busy || !file || !name.trim()} data-testid="new-template-submit">
          {busy ? "Uploading…" : "Upload"}
        </button>
      </div>
      {error !== null && <ErrorView error={error} />}
    </form>
  );
}
