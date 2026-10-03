import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PERIODS, type HotTemplate, type Period, type Template, type TemplateUsage, type UploadLimits } from "@memegen/shared";
import {
  Badge,
  Card,
  CardMeta,
  CardTitle,
  EmptyState,
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
import { addTemplateTags, getHotTemplates, getTemplateUsage, listTemplates, uploadAsset } from "../api.ts";
import { useAuth } from "../auth.tsx";
import { MEDIA_ACCEPT, precheckMedia } from "../media.ts";
import { PERIOD_LABELS } from "../pages/Gallery.tsx";
import { usePaged } from "../usePaged.ts";
import { ErrorView, LoadMoreSentinel, MediaView, SignInPrompt } from "./common.tsx";
import { TagChips, TagEditor } from "./tags.tsx";

/** All templates: a debounced name search under the heading, loading more as the list end scrolls into view. */
export function TemplateBrowser({ search, onSearchChange }: { search: string; onSearchChange: (search: string) => void }) {
  const { user } = useAuth();
  const [q, setQ] = useState(search.trim());
  const list = usePaged<Template>(`${q}:${user?.id ?? ""}`, (offset) => listTemplates(q, offset));

  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  return (
    <section className="template-start">
      <PageHeader level={2} title="All templates" />
      <TextField
        type="search"
        className="template-search"
        placeholder="Search templates…"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        aria-label="Search templates"
        data-testid="template-search"
      />
      {list.error !== null && <ErrorView error={list.error} />}
      {!list.loading && list.items.length === 0 && list.error === null && (
        <EmptyState icon={<Icon name="search" />} title="No templates found." />
      )}
      <MediaGrid data-testid="template-grid" data-query={q} aria-busy={list.loading}>
        {list.items.map((t) => (
          <TemplateCard key={t.id} template={t} />
        ))}
      </MediaGrid>
      {list.loading && <Spinner label="Loading…" />}
      <LoadMoreSentinel hasMore={list.hasMore} loading={list.loading} onLoadMore={list.loadMore} />
    </section>
  );
}

export function HotTemplates() {
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

/** Gallery tile: the template, who added it, how often it's used, and Use. Details live in the editor. */
export function TemplateCard({ template }: { template: Template }) {
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
        <LinkButton as={Link} size="sm" variant="primary" to={`/create?template=${template.id}`} data-testid="use-template">
          Use
        </LinkButton>
      }
    >
      <CardTitle as={Link} to={`/create?template=${template.id}`}>
        {template.name}
      </CardTitle>
      <TemplateMeta template={template} />
    </Card>
  );
}

function TemplateMeta({ template }: { template: Template }) {
  const used = `used ${template.useCount} ${template.useCount === 1 ? "time" : "times"}`;
  return (
    <CardMeta>
      <span data-testid="template-author">
        added by <Link to={`/u/${template.owner.username}`}>@{template.owner.username}</Link>
      </span>
      <span aria-hidden> · </span>
      <span data-testid="template-use-count" aria-label={used} title={used}>
        {template.useCount}🔥
      </span>
      {!template.isPublic && <Badge tone="info">Private</Badge>}
    </CardMeta>
  );
}

/** Under the editor stage when a template is open: its tags (anyone signed in can add), usage, and variations. */
export function TemplateDetails({ template }: { template: Template }) {
  const { user } = useAuth();
  // Base tags come from the author and always stay; added tags sit beside them.
  const [tagged, setTagged] = useState({ tags: template.tags, baseTags: template.baseTags });

  return (
    <Panel heading={template.name} className="template-details" data-testid="template-details">
      <TemplateMeta template={template} />
      <div className="template-details-tags">
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
      </div>
      <Panel variant="inset" heading="Usage">
        <UsageChart templateId={template.id} />
      </Panel>
      {template.variations.length > 0 && (
        <Panel variant="inset" heading="Variations">
          <div className="variations">
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
        </Panel>
      )}
    </Panel>
  );
}

/**
 * Adding a template — the only way to bring in new media, since every meme is made from a template: pick a file
 * (pre-checked against `limits`, then uploaded) and place its text boxes in the Template Editor.
 */
export function NewTemplateForm({ limits }: { limits: UploadLimits | null }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (!user) return <SignInPrompt action="add templates" />;

  async function upload(file: File, caps: UploadLimits) {
    setBusy(true);
    setError(null);
    try {
      const media = await precheckMedia(file, caps);
      media.dispose();
      const asset = await uploadAsset(file, file.name);
      navigate(`/create?newTemplate=${asset.id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Panel heading="New template" className="upload-form">
      <Text tone="muted">Upload an image, GIF, MP4 or MOV, then place its default text in the Template Editor.</Text>
      {limits && (
        <Text size="sm" tone="muted">
          Max {(limits.maxBytes / 1024 / 1024).toFixed(0)} MB · images ≤ {limits.image.maxDimension}px · GIFs ≤{" "}
          {limits.gif.maxDimension}px / {limits.gif.maxFrames} frames · videos ≤ {limits.video.maxDimension}px /{" "}
          {limits.video.maxFrames} frames
        </Text>
      )}
      <FileButton
        variant="primary"
        icon={<Icon name="upload" />}
        accept={MEDIA_ACCEPT}
        disabled={busy || !limits}
        data-testid="new-template-file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file && limits) void upload(file, limits);
        }}
      >
        {busy ? "Uploading…" : "Choose file"}
      </FileButton>
      {error !== null && <ErrorView error={error} testId="new-template-error" />}
    </Panel>
  );
}
