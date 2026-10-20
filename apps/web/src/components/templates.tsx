import { useRef, type ComponentPropsWithoutRef, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
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

/** A card is at least this share of the skin's grid column (`--ui-grid-min`) wide: room for its title and Use. */
const MIN_WIDTH_SHARE = 0.6;

/** Where the grid placed a card: its width and media height, px. */
interface Slot {
  width: number;
  height: number;
}

/**
 * Gallery tile: the template, who added it, how often it's used, and Use. Details live in the editor.
 * `editable` (the author's own profile) points the tile at the template's editor and swaps Use for Edit.
 */
function TemplateCard({ template, editable = false, slot }: { template: Template; editable?: boolean; slot?: Slot }) {
  const to = editable ? `/create?editTemplate=${template.id}` : `/create?template=${template.id}`;
  // Until the grid is measured, the card sits at the CSS row height, as wide as its media's aspect.
  const style = {
    "--template-ratio": aspect(template),
    "--template-width": slot ? `${slot.width}px` : undefined,
    "--template-height": slot ? `${slot.height}px` : undefined,
  } as CSSProperties;
  return (
    <Card
      borderless
      className="template-card"
      data-testid="template-card"
      data-template-id={template.id}
      style={style}
      media={
        <Link to={to}>
          <MediaView asset={template.asset} alt={template.name} />
        </Link>
      }
      actions={
        editable ? (
          <LinkButton as={Link} size="sm" to={to} data-testid="edit-template">
            Edit
          </LinkButton>
        ) : (
          <LinkButton as={Link} size="sm" to={to} data-testid="use-template">
            Use
          </LinkButton>
        )
      }
    >
      <div className="template-card-title">
        <CardTitle as={Link} to={to}>
          {template.name}
        </CardTitle>
        {template.kind === "multi" && <Icon name="panels" gradient tooltip="Image pack template" data-testid="template-multi-panel" />}
      </div>
      <TemplateMeta template={template} />
    </Card>
  );
}

/** Width ÷ height of the template's media; square when the asset has no dimensions. */
function aspect({ asset }: Template): number {
  return asset.width && asset.height ? asset.width / asset.height : 1;
}

/** Author, use count (`n` and a flame) and a Private badge. */
export function TemplateMeta({ template }: { template: Template }) {
  const used = `used ${plural(template.useCount, "time")}`;
  return (
    <CardMeta>
      <span data-testid="template-author">
        added by <Link to={`/u/${template.owner.username}`}>@{template.owner.username}</Link>
      </span>
      <span aria-hidden> · </span>
      <span data-testid="template-use-count" aria-label={used} title={used}>
        {template.useCount}
        <Icon name="flame" />
      </span>
      {!template.isPublic && <Badge tone="info">Private</Badge>}
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
