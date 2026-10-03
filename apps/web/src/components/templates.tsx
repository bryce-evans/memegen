import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { PERIODS, type HotTemplate, type Period, type Template, type TemplateUsage } from "@memegen/shared";
import {
  Badge,
  Button,
  Card,
  CardMeta,
  CardTitle,
  EmptyState,
  Field,
  FileButton,
  Icon,
  Inline,
  LinkButton,
  MediaGrid,
  PageHeader,
  Panel,
  SegmentedControl,
  SelectField,
  Spinner,
  Text,
  TextField,
} from "@memegen/ui";
import { addTemplateTags, createTemplate, getHotTemplates, getLimits, getTemplateUsage, listTemplates, uploadAsset } from "../api.ts";
import { useAuth } from "../auth.tsx";
import { MEDIA_ACCEPT, precheckMedia } from "../media.ts";
import { PERIOD_LABELS } from "../pages/Gallery.tsx";
import { usePaged } from "../usePaged.ts";
import { ErrorView, LoadMoreSentinel, MediaView, SignInPrompt } from "./common.tsx";
import { TagChips, TagEditor } from "./tags.tsx";

/** Pre-check against upload caps, upload the file, then register it as a template (or variation). */
async function uploadTemplate(file: File, name: string, parentId: string | null): Promise<Template> {
  const media = await precheckMedia(file, await getLimits());
  media.dispose();
  const asset = await uploadAsset(file, file.name, name);
  return createTemplate({ name, assetId: asset.id, parentId });
}

/** Hot templates, a debounced name search and the matching templates, loading more as the list end scrolls into view. */
export function TemplateBrowser({ search, onSearchChange }: { search: string; onSearchChange: (search: string) => void }) {
  const { user } = useAuth();
  const [q, setQ] = useState(search.trim());
  const list = usePaged<Template>(`${q}:${user?.id ?? ""}`, (offset) => listTemplates(q, offset));

  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  return (
    <>
      <HotTemplates />
      <PageHeader
        level={2}
        title="All templates"
        actions={
          <TextField
            type="search"
            className="template-search"
            placeholder="Search templates…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label="Search templates"
            data-testid="template-search"
          />
        }
      />
      {list.error !== null && <ErrorView error={list.error} />}
      {!list.loading && list.items.length === 0 && list.error === null && (
        <EmptyState icon={<Icon name="search" />} title="No templates found." />
      )}
      <MediaGrid data-testid="template-grid" aria-busy={list.loading}>
        {list.items.map((t) => (
          <TemplateCard key={t.id} template={t} onChanged={list.reload} />
        ))}
      </MediaGrid>
      {list.loading && <Spinner label="Loading…" />}
      <LoadMoreSentinel hasMore={list.hasMore} loading={list.loading} onLoadMore={list.loadMore} />
    </>
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
      <PageHeader
        level={2}
        title={
          <>
            <Icon name="flame" className="hot-icon" /> Hot
          </>
        }
        actions={
          <SegmentedControl
            aria-label="Hot period"
            size="sm"
            value={period}
            onChange={setPeriod}
            options={PERIODS.map((p) => ({ value: p, label: PERIOD_LABELS[p], testId: `hot-period-${p}` }))}
          />
        }
      />
      {error !== null && <ErrorView error={error} />}
      {items === null && error === null && <Spinner label="Loading…" />}
      {items?.length === 0 && <EmptyState icon={<Icon name="flame" />} title="No templates used in this period yet." />}
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
              <Text as="span" size="sm" tone="muted">
                <span data-testid="hot-uses">{uses}</span> {uses === 1 ? "use" : "uses"} · {posts} posted
              </Text>
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
      <Inline>
        <SelectField size="sm" value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label="Usage period">
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {PERIOD_LABELS[p]}
            </option>
          ))}
        </SelectField>
        {usage && (
          <Text as="span" size="sm" tone="muted">
            {total} {total === 1 ? "use" : "uses"} · per {usage.bucket}
          </Text>
        )}
      </Inline>
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
  // Base tags come from the author and always stay; any signed-in user can add more.
  const [tagged, setTagged] = useState({ tags: template.tags, baseTags: template.baseTags });

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
    <Card
      borderless
      className="template-card"
      data-testid="template-card"
      data-template-id={template.id}
      media={
        <Link to={`/create?template=${template.id}`}>
          <MediaView asset={template.asset} alt={template.name} />
        </Link>
      }
      actions={
        <>
          <LinkButton as={Link} size="sm" variant="primary" to={`/create?template=${template.id}`} data-testid="use-template">
            Use
          </LinkButton>
          {template.parentId === null && user && (
            <FileButton
              size="sm"
              icon={<Icon name="upload" />}
              accept={MEDIA_ACCEPT}
              disabled={busy}
              data-testid="add-variation"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void addVariation(file);
              }}
            >
              {busy ? "Uploading…" : "Add variation"}
            </FileButton>
          )}
          <Button
            size="sm"
            variant="quiet"
            icon={<Icon name="chart" />}
            onClick={() => setShowUsage((s) => !s)}
            pressed={showUsage}
            data-testid="usage-toggle"
          >
            Usage
          </Button>
        </>
      }
    >
      <CardTitle as="button" type="button" onClick={() => setShowUsage((s) => !s)} title="Show usage">
        {template.name}
      </CardTitle>
      <CardMeta>
        <span data-testid="template-author">
          added by <Link to={`/u/${template.owner.username}`}>@{template.owner.username}</Link>
        </span>
        <span aria-hidden> · </span>
        <span
          data-testid="template-use-count"
          aria-label={`used ${template.useCount} ${template.useCount === 1 ? "time" : "times"}`}
          title={`used ${template.useCount} ${template.useCount === 1 ? "time" : "times"}`}
        >
          {template.useCount}🔥
        </span>
        {!template.isPublic && <Badge tone="info">Private</Badge>}
      </CardMeta>
      <TagChips slugs={tagged.tags} base={tagged.baseTags} />
      {user && (
        <TagEditor
          tags={[]}
          label="Add tags"
          testId="template-tags-add"
          onSave={async (added) => {
            const next = await addTemplateTags(template.id, added);
            setTagged({ tags: next.tags, baseTags: next.baseTags });
          }}
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
      {error !== null && <ErrorView error={error} />}
    </Card>
  );
}

export function NewTemplateForm({ onCreated }: { onCreated: (template: Template) => void }) {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (!user) return <SignInPrompt action="add templates" />;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    if (!file || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const template = await uploadTemplate(file, name.trim(), null);
      setName("");
      setFile(null);
      form.reset();
      onCreated(template);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel heading="New template" className="upload-form">
      <form onSubmit={submit}>
        <Inline align="end" gap="md">
          <TextField
            label="Name"
            className="upload-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={120}
            data-testid="new-template-name"
          />
          <Field as="div" label="Image, GIF or video" className="upload-file">
            <Inline wrap={false}>
              <FileButton
                icon={<Icon name="upload" />}
                accept={MEDIA_ACCEPT}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                required
                data-testid="new-template-file"
              >
                Choose file
              </FileButton>
              <Text as="span" size="sm" tone="muted" className="file-name">
                {file?.name ?? "No file chosen"}
              </Text>
            </Inline>
          </Field>
          <Button type="submit" variant="primary" className="upload-submit" disabled={busy || !file || !name.trim()} data-testid="new-template-submit">
            {busy ? "Uploading…" : "Upload"}
          </Button>
        </Inline>
      </form>
      {error !== null && <ErrorView error={error} />}
    </Panel>
  );
}
