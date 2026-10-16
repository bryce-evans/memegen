import { useRef, useState, type ComponentPropsWithoutRef, type FocusEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MEDIA_ACCEPT, PERIODS, STICKER_ACCEPT, STICKER_MAX_DIMENSION, type Period, type Sticker, type Template, type TemplateKind, type UploadLimits } from "@memegen/shared";
import { cx, EmptyState, FileButton, Icon, LinkButton, Panel, SegmentedControl, Spinner, Text, TextField } from "@memegen/ui";
import { countTemplates, createSticker, getHotTemplates, listTemplates, uploadAsset } from "../api.ts";
import { nameFromFile, precheckMedia, precheckSticker } from "../media.ts";
import { useAction } from "../useAction.ts";
import { useAsync } from "../useAsync.ts";
import { useDebounced } from "../useDebounced.ts";
import { usePaged } from "../usePaged.ts";
import { ErrorView, MediaView } from "./common.tsx";
import allYourBase from "../assets/create/all-your-base.mp4";
import allYourBasePoster from "../assets/create/all-your-base-poster.jpg";
import bigBrain1 from "../assets/create/big-brain-1.mp4";
import bigBrain1Poster from "../assets/create/big-brain-1-poster.jpg";
import bigBrain2 from "../assets/create/big-brain-2.mp4";
import bigBrain2Poster from "../assets/create/big-brain-2-poster.jpg";
import bigBrain3 from "../assets/create/big-brain-3.mp4";
import bigBrain3Poster from "../assets/create/big-brain-3-poster.jpg";
import dealWithIt from "../assets/create/deal-with-it.png";
import stickerPhoto from "../assets/create/shantanu.jpg";
import { PERIOD_LABELS, plural } from "../format.ts";
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
  const total = useAsync("template-count", countTemplates).data?.count;

  return (
    <Panel
      heading="All templates"
      headingActions={<SegmentedControl<KindFilter> aria-label="Template kind" size="sm" options={KIND_OPTIONS} value={kind} onChange={setKind} />}
      className="template-start"
    >
      <TextField
        type="search"
        className="template-start-search"
        placeholder={total === undefined ? "Search templates…" : `Search ${plural(total, "template")}`}
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        aria-label="Search templates"
        data-testid="template-search"
      />
      <TemplateGrid
        list={list}
        empty={<EmptyState icon={<Icon name="search" />} title="No templates found." />}
        paging="sentinel"
        data-testid="template-grid"
        data-query={q}
        data-kind={kind}
      />
    </Panel>
  );
}

export function HotTemplates() {
  const [period, setPeriod] = useState<Period>("week");
  const { data: items, error, loading } = useAsync(period, () => getHotTemplates(period));

  return (
    <Panel
      className="hot"
      heading={
        <>
          <Icon name="flame" className="hot-icon" /> Hot
        </>
      }
      headingActions={
        <SegmentedControl
          aria-label="Hot period"
          size="sm"
          value={period}
          onChange={setPeriod}
          options={PERIODS.map((p) => ({ value: p, label: PERIOD_LABELS[p], testId: `hot-period-${p}` }))}
        />
      }
    >
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
    </Panel>
  );
}

/** Expanding brain, smallest first: the stack's top two fall away on hover, leaving the last one looping. */
const BRAINS = [
  { src: bigBrain1, poster: bigBrain1Poster },
  { src: bigBrain2, poster: bigBrain2Poster },
  { src: bigBrain3, poster: bigBrain3Poster },
];

/**
 * Card art that plays only while the pointer (or focus) is on its card, never under reduced motion, and goes back to
 * its first frame after. `video` is a callback ref, so one hook can drive several videos.
 */
function useHoverPlayback() {
  const videos = useRef(new Set<HTMLVideoElement>());
  const play = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (const v of videos.current) void v.play().catch(() => {});
  };
  const stop = () => {
    for (const v of videos.current) {
      v.pause();
      v.currentTime = 0;
    }
  };
  return {
    video: (el: HTMLVideoElement) => {
      videos.current.add(el);
      return () => void videos.current.delete(el);
    },
    cardProps: {
      onPointerEnter: play,
      onPointerLeave: stop,
      onFocus: play,
      onBlur: (e: FocusEvent<HTMLElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget)) stop();
      },
    },
  };
}

/**
 * Adding content, as three cards. A new template is the only way to bring in new media, since every meme is made
 * from a template: pick a file (pre-checked against `limits`, then uploaded) and place its text boxes in the Template
 * Editor. A multi-panel template's image pack is uploaded in its editor. A sticker is a small PNG added to the sticker
 * library (the Sticker button in the editor's Layers panel).
 */
export function AddContent({ limits }: { limits: UploadLimits | null }) {
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

  const templateArt = useHoverPlayback();
  const brains = useHoverPlayback();

  return (
    <Panel heading="Upload" className="add-content">
      <div className="add-content-cards">
        <UploadTile
          className="add-card--art"
          data-testid="add-template"
          {...templateArt.cardProps}
          media={<video ref={templateArt.video} src={allYourBase} poster={allYourBasePoster} muted loop playsInline preload="none" aria-hidden />}
          title={
            <>
              <Icon name="image" /> Template
            </>
          }
          actions={
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
          }
        >
          <Text size="sm" tone="muted">
            Upload a base template.
            <br />
            Images, GIFs, and short videos supported.
          </Text>
          {error !== null && <ErrorView error={error} testId="new-template-error" />}
        </UploadTile>
        <UploadTile
          className="add-card--brains"
          data-testid="add-panels"
          {...brains.cardProps}
          media={
            // Expanding brain, smallest on top: on hover the top two come loose and fall away, one after the other.
            <div className="brain-stack" aria-hidden>
              {BRAINS.map(({ src, poster }, i) => (
                <video key={src} ref={brains.video} className={`brain brain-${i + 1}`} src={src} poster={poster} muted loop playsInline preload="none" />
              ))}
            </div>
          }
          title={
            <>
              <Icon name="grid" /> Multi-panel
            </>
          }
          actions={
            <LinkButton as={Link} to="/create?newPanels" icon={<Icon name="plus" />} data-testid="new-panel-template">
              Build from images
            </LinkButton>
          }
        >
          <Text size="sm" tone="muted">
            Template packs for flexible use.
          </Text>
        </UploadTile>
        <UploadTile
          className="add-card--sticker"
          data-testid="add-sticker"
          media={
            // The photo fills the tile's width and is cropped at the bottom to the other tiles' 16:9; the glasses sit
            // on the photo itself, so their placement survives the crop.
            <div className="sticker-art" aria-hidden>
              <div className="sticker-art-photo">
                <img src={stickerPhoto} alt="" />
                <img src={dealWithIt} alt="" className="sticker-art-glasses" />
              </div>
            </div>
          }
          title={
            <>
              <Icon name="star" /> Sticker
            </>
          }
          actions={
            <FileButton
              icon={<Icon name="plus" />}
              accept={STICKER_ACCEPT}
              disabled={sticker.busy || !limits}
              data-testid="new-sticker-file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file && limits) addSticker(file, limits);
              }}
            >
              {sticker.busy ? "Adding…" : "Choose PNG"}
            </FileButton>
          }
        >
          <Text size="sm" tone="muted">
            A PNG up to {STICKER_MAX_DIMENSION}×{STICKER_MAX_DIMENSION}px that anyone can drop on
          </Text>
          {sticker.error !== null && <ErrorView error={sticker.error} testId="new-sticker-error" />}
          {addedSticker && (
            <Text size="sm" data-testid="new-sticker-added" data-sticker-id={addedSticker.id}>
              Added sticker “{addedSticker.name}”. Add it to a meme with the Sticker button in the editor’s Layers panel.
            </Text>
          )}
        </UploadTile>
      </div>
    </Panel>
  );
}

/** One Upload option: art over a black panel with its title, text, and (at the bottom) its action. Not a card: it sits inside the Upload card. */
function UploadTile({
  media,
  title,
  actions,
  className,
  children,
  ...rest
}: { media: ReactNode; title: ReactNode; actions: ReactNode } & Omit<ComponentPropsWithoutRef<"article">, "title">) {
  return (
    <article className={cx("add-card", className)} {...rest}>
      <div className="add-card-media">{media}</div>
      <div className="add-card-body">
        <h3 className="add-card-title">{title}</h3>
        {children}
        <div className="add-card-actions">{actions}</div>
      </div>
    </article>
  );
}
