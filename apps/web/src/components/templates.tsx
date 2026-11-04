import { useRef, type ComponentPropsWithoutRef, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Template } from "@memegen/shared";
import { Badge, Card, CardMeta, CardTitle, cx, Icon, LinkButton, MediaGrid } from "@memegen/ui";
import { plural } from "../format.ts";
import { justifyRows, useRowBox } from "../justifiedRows.ts";
import { countTemplates } from "../api.ts";
import { useAsync } from "../useAsync.ts";
import type { Paged } from "../usePaged.ts";
import { MediaView, PagedList } from "./common.tsx";

/** Placeholder for a template search box: "Search 312 templates", or "Search templates…" until the count loads. */
export function useTemplateSearchPlaceholder(): string {
  const total = useAsync("template-count", countTemplates).data?.count;
  return total === undefined ? "Search templates…" : `Search ${plural(total, "template")}`;
}

/** A card is at least this share of the skin's grid column wide: room for its title and usage. */
const MIN_WIDTH_SHARE = 0.6;

/** Where the grid placed a card: its width and media height, px. */
interface Slot {
  width: number;
  height: number;
}

/**
 * Gallery tile: title and usage beside the template. Details live in the editor.
 * `editable` (the author's own profile) points the tile at the template's editor and shows Edit.
 */
function TemplateCard({ template, editable = false, slot }: { template: Template; editable?: boolean; slot?: Slot }) {
  const navigate = useNavigate();
  const to = editable ? `/create?editTemplate=${template.id}` : `/create?template=${template.id}`;
  // Until the grid is measured, the card sits at the CSS row height, as wide as its media's aspect.
  const style = {
    "--template-ratio": aspect(template),
    "--template-width": slot ? `${slot.width}px` : undefined,
    "--template-height": slot ? `${slot.height}px` : undefined,
  } as CSSProperties;
  function open(e: MouseEvent<HTMLElement>) {
    if (e.defaultPrevented || (e.target as Element).closest("a, button, input, textarea, select, label")) return;
    if (window.getSelection()?.isCollapsed === false) return;
    if (e.metaKey || e.ctrlKey) window.open(to, "_blank", "noopener");
    else navigate(to);
  }
  return (
    <Card
      borderless
      className="template-card"
      data-testid="template-card"
      data-template-id={template.id}
      style={style}
      onClick={open}
      media={
        <Link to={to} data-testid="template-card-media">
          <MediaView asset={template.asset} alt={template.name} />
        </Link>
      }
      actions={
        editable && (
          <LinkButton as={Link} size="sm" to={to} data-testid="edit-template">
            Edit
          </LinkButton>
        )
      }
    >
      <div className="template-card-title">
        <CardTitle as={Link} to={to} data-testid="template-card-title">
          {template.name}
        </CardTitle>
        {template.kind === "multi" && <Icon name="panels" gradient tooltip="Image pack template" data-testid="template-multi-panel" />}
      </div>
      <CardMeta>
        <TemplateUseCount template={template} />
      </CardMeta>
      {!template.isPublic && <Badge tone="info" className="template-card-unlisted">Unlisted</Badge>}
    </Card>
  );
}

/** Width ÷ height of the template's media; square when the asset has no dimensions. */
function aspect({ asset }: Template): number {
  return asset.width && asset.height ? asset.width / asset.height : 1;
}

function TemplateUseCount({ template }: { template: Template }) {
  const used = `used ${plural(template.useCount, "time")}`;
  return (
    <span data-testid="template-use-count" aria-label={used} title={used}>
      {template.useCount}
      <Icon name="flame" />
    </span>
  );
}

/** Author, use count (`n` and a flame) and an Unlisted badge. */
export function TemplateMeta({ template }: { template: Template }) {
  return (
    <CardMeta>
      <span data-testid="template-author">
        added by <Link to={`/u/${template.owner.username}`}>@{template.owner.username}</Link>
      </span>
      <span aria-hidden> · </span>
      <TemplateUseCount template={template} />
      {!template.isPublic && <Badge tone="info">Unlisted</Badge>}
    </CardMeta>
  );
}

/**
 * A paged template list: its error, `empty` once a load found nothing, the cards, a spinner while loading, and the
 * paging control: `button` ("More templates") when content follows the list, `sentinel` when it ends the page.
 * Extra props go on the grid. `editable` as on `TemplateCard`.
 */
export function TemplateGrid({
  list,
  empty,
  paging,
  editable = false,
  ...rest
}: { list: Paged<Template>; empty: ReactNode; paging: "button" | "sentinel"; editable?: boolean } & ComponentPropsWithoutRef<"div">) {
  return (
    <PagedList list={list} empty={empty} paging={paging} moreLabel="More templates">
      {(templates) => (
        <JustifiedTemplates templates={templates} editable={editable} aria-busy={list.loading} {...rest} className={cx("template-grid", rest.className)} />
      )}
    </PagedList>
  );
}

/**
 * Templates in justified rows, like the meme feeds (`justifyRows`): every full row fills the line edge to edge at
 * close to the target `--template-row-height`, so no row ends in a gap. A card is laid out at least
 * `MIN_WIDTH_SHARE` of a grid column wide (a tall template's media then sits centered in it).
 */
function JustifiedTemplates({
  templates,
  editable,
  ...rest
}: { templates: Template[]; editable: boolean } & ComponentPropsWithoutRef<"div">) {
  const ref = useRef<HTMLDivElement>(null);
  const box = useRowBox(ref, true, "--template-row-height");
  let slots: Slot[] | null = null;
  if (box && box.width > 0) {
    const least = (box.gridMin * MIN_WIDTH_SHARE) / box.target;
    const aspects = templates.map((t) => Math.max(aspect(t), least));
    slots = justifyRows(aspects, box.width, box.gap, box.target).map((height, i) => ({ width: aspects[i]! * height, height }));
  }
  return (
    <MediaGrid ref={ref} {...rest}>
      {templates.map((t, i) => (
        <TemplateCard key={t.id} template={t} editable={editable} slot={slots?.[i]} />
      ))}
    </MediaGrid>
  );
}
