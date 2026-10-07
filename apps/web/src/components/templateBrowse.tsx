import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MEDIA_ACCEPT, PERIODS, STICKER_ACCEPT, STICKER_MAX_DIMENSION, type Period, type Sticker, type Template, type TemplateKind, type UploadLimits } from "@memegen/shared";
import { EmptyState, FileButton, Icon, Inline, LinkButton, PageHeader, Panel, SegmentedControl, Spinner, Text, TextField } from "@memegen/ui";
import { createSticker, getHotTemplates, listTemplates, uploadAsset } from "../api.ts";
import { precheckMedia, precheckSticker } from "../media.ts";
import { useAction } from "../useAction.ts";
import { useAsync } from "../useAsync.ts";
import { useDebounced } from "../useDebounced.ts";
import { usePaged } from "../usePaged.ts";
import { ErrorView, LoadMoreSentinel, MediaView } from "./common.tsx";
import { nameFromFile } from "./editor/TemplateSavePanel.tsx";
import { PERIOD_LABELS } from "./feed.tsx";
import { TemplateGrid } from "./templates.tsx";

type KindFilter = TemplateKind | "all";

const KIND_OPTIONS: { value: KindFilter; label: string; title: string; testId: string }[] = [
  { value: "all", label: "All", title: "Every template", testId: "template-kind-all" },
  { value: "single", label: "Single", title: "One image with text boxes", testId: "template-kind-single" },
  { value: "multi", label: "Multi-panel", title: "Panels filled from an image pack", testId: "template-kind-multi" },
  { value: "gif", label: "GIF", title: "GIFs and videos", testId: "template-kind-gif" },
];

/**
 * All templates: a kind filter beside the heading and a debounced name search under it, loading more as the list end
 * scrolls into view.
 */
export function TemplateBrowser({ search, onSearchChange }: { search: string; onSearchChange: (search: string) => void }) {
  const [kind, setKind] = useState<KindFilter>("all");
  const q = useDebounced(search.trim(), 300);
  const filterKind = kind === "all" ? undefined : kind;
  const list = usePaged<Template>(`${kind}:${q}`, (offset) => listTemplates({ q, kind: filterKind, offset }));

  return (
    <section className="template-start">
      {/* Heading, kind filter, and search share the search's width, so the filter ends where the search does. */}
      <div className="template-start-head">
        <PageHeader
          level={2}
          title="All templates"
          actions={<SegmentedControl<KindFilter> aria-label="Template kind" size="sm" options={KIND_OPTIONS} value={kind} onChange={setKind} />}
        />
        <TextField
          type="search"
          placeholder="Search templates…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="Search templates"
          data-testid="template-search"
        />
      </div>
      <TemplateGrid
        list={list}
        empty={<EmptyState icon={<Icon name="search" />} title="No templates found." />}
        data-testid="template-grid"
        data-query={q}
        data-kind={kind}
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
 * (pre-checked against `limits`, then uploaded) and place its text boxes in the Template Editor, or start a
 * multi-panel template whose image pack is uploaded in its editor. "+ Sticker" adds a small PNG to the sticker
 * library instead (Add sticker in the editor's Layers panel).
 */
export function NewTemplateForm({ limits }: { limits: UploadLimits | null }) {
  const navigate = useNavigate();
  const { busy, error, run } = useAction();
  const sticker = useAction();
  const [addedSticker, setAddedSticker] = useState<Sticker | null>(null);

  function upload(file: File, caps: UploadLimits) {
    void run(async () => {
      const media = await precheckMedia(file, caps);
      media.dispose();
      const asset = await uploadAsset(file, file.name);
      navigate(`/create?newTemplate=${asset.id}`);
    });
  }

  function addSticker(file: File, caps: UploadLimits) {
    setAddedSticker(null);
    void sticker.run(async () => {
      await precheckSticker(file, caps);
      const asset = await uploadAsset(file, file.name);
      setAddedSticker(await createSticker({ name: nameFromFile(file.name) || "Sticker", assetId: asset.id }));
    });
  }

  return (
    <Panel heading="New template" className="upload-form">
      <Text tone="muted">
        Upload an image, GIF, MP4 or MOV, then place its default text in the Template Editor. Or build a multi-panel
        template (like expanding brain) from a pack of images, or add a sticker anyone can drop on a meme.
      </Text>
      {limits && (
        <Text size="sm" tone="muted">
          Max {(limits.maxBytes / 1024 / 1024).toFixed(0)} MB · images ≤ {limits.image.maxDimension}px · GIFs ≤{" "}
          {limits.gif.maxDimension}px / {limits.gif.maxFrames} frames · videos ≤ {limits.video.maxDimension}px /{" "}
          {limits.video.maxFrames} frames · stickers: PNG ≤ {STICKER_MAX_DIMENSION}×{STICKER_MAX_DIMENSION}px
        </Text>
      )}
      <Inline>
        <FileButton
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
        <LinkButton as={Link} to="/create?newPanels" icon={<Icon name="plus" />} data-testid="new-panel-template">
          Multi-panel template
        </LinkButton>
        <FileButton
          icon={<Icon name="plus" />}
          accept={STICKER_ACCEPT}
          disabled={sticker.busy || !limits}
          title={`Add a sticker: a PNG up to ${STICKER_MAX_DIMENSION}×${STICKER_MAX_DIMENSION}px`}
          data-testid="new-sticker-file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file && limits) addSticker(file, limits);
          }}
        >
          {sticker.busy ? "Adding…" : "Sticker"}
        </FileButton>
      </Inline>
      {error !== null && <ErrorView error={error} testId="new-template-error" />}
      {sticker.error !== null && <ErrorView error={sticker.error} testId="new-sticker-error" />}
      {addedSticker && (
        <Text size="sm" data-testid="new-sticker-added" data-sticker-id={addedSticker.id}>
          Added sticker “{addedSticker.name}”. Add it to a meme with Add sticker in the editor’s Layers panel.
        </Text>
      )}
    </Panel>
  );
}
