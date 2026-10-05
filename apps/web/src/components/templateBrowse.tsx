import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MEDIA_ACCEPT, PERIODS, type Period, type Template, type UploadLimits } from "@memegen/shared";
import { EmptyState, FileButton, Icon, PageHeader, Panel, SegmentedControl, Spinner, Text, TextField } from "@memegen/ui";
import { getHotTemplates, listTemplates, uploadAsset } from "../api.ts";
import { precheckMedia } from "../media.ts";
import { useAction } from "../useAction.ts";
import { useAsync } from "../useAsync.ts";
import { useDebounced } from "../useDebounced.ts";
import { usePaged } from "../usePaged.ts";
import { ErrorView, LoadMoreSentinel, MediaView } from "./common.tsx";
import { PERIOD_LABELS } from "./feed.tsx";
import { TemplateGrid } from "./templates.tsx";

/** All templates: a debounced name search under the heading, loading more as the list end scrolls into view. */
export function TemplateBrowser({ search, onSearchChange }: { search: string; onSearchChange: (search: string) => void }) {
  const q = useDebounced(search.trim(), 300);
  const list = usePaged<Template>(q, (offset) => listTemplates({ q, offset }));

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
      <TemplateGrid
        list={list}
        empty={<EmptyState icon={<Icon name="search" />} title="No templates found." />}
        data-testid="template-grid"
        data-query={q}
      />
      <LoadMoreSentinel hasMore={list.hasMore} loading={list.loading} onLoadMore={list.loadMore} />
    </section>
  );
}

export function HotTemplates() {
  const [period, setPeriod] = useState<Period>("week");
  const { data: items, error, loading } = useAsync(period, () => getHotTemplates(period));

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
      {loading && <Spinner label="Loading…" />}
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

/**
 * Adding a template — the only way to bring in new media, since every meme is made from a template: pick a file
 * (pre-checked against `limits`, then uploaded) and place its text boxes in the Template Editor.
 */
export function NewTemplateForm({ limits }: { limits: UploadLimits | null }) {
  const navigate = useNavigate();
  const { busy, error, run } = useAction();

  function upload(file: File, caps: UploadLimits) {
    void run(async () => {
      const media = await precheckMedia(file, caps);
      media.dispose();
      const asset = await uploadAsset(file, file.name);
      navigate(`/create?newTemplate=${asset.id}`);
    });
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
          if (file && limits) upload(file, limits);
        }}
      >
        {busy ? "Uploading…" : "Choose file"}
      </FileButton>
      {error !== null && <ErrorView error={error} testId="new-template-error" />}
    </Panel>
  );
}
