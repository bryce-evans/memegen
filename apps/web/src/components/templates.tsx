import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Template } from "@memegen/shared";
import { Badge, Card, CardMeta, CardTitle, Icon, LinkButton, MediaGrid } from "@memegen/ui";
import { plural } from "../format.ts";
import type { Paged } from "../usePaged.ts";
import { MediaView, PagedList } from "./common.tsx";

/**
 * Gallery tile: the template, who added it, how often it's used, and Use. Details live in the editor.
 * `editable` (the author's own profile) points the tile at the template's editor and swaps Use for Edit.
 */
function TemplateCard({ template, editable = false }: { template: Template; editable?: boolean }) {
  const to = editable ? `/create?editTemplate=${template.id}` : `/create?template=${template.id}`;
  return (
    <Card
      borderless
      className="template-card"
      data-testid="template-card"
      data-template-id={template.id}
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
        <MediaGrid aria-busy={list.loading} {...rest}>
          {templates.map((t) => (
            <TemplateCard key={t.id} template={t} editable={editable} />
          ))}
        </MediaGrid>
      )}
    </PagedList>
  );
}
