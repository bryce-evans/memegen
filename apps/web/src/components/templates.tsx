import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Template } from "@memegen/shared";
import { Badge, Card, CardMeta, CardTitle, LinkButton, MediaGrid, Spinner } from "@memegen/ui";
import { plural } from "../format.ts";
import type { Paged } from "../usePaged.ts";
import { ErrorView, MediaView } from "./common.tsx";

/**
 * Gallery tile: the template, who added it, how often it's used, and Use. Details live in the editor.
 * `editable` (the author's own profile) points the tile at the template's editor and swaps Use for Edit.
 */
export function TemplateCard({ template, editable = false }: { template: Template; editable?: boolean }) {
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
      <CardTitle as={Link} to={to}>
        {template.name}
      </CardTitle>
      <TemplateMeta template={template} />
    </Card>
  );
}

/** Author, use count (`n🔥`) and a Private badge. */
export function TemplateMeta({ template }: { template: Template }) {
  const used = `used ${plural(template.useCount, "time")}`;
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

/**
 * A paged template list: its error, `empty` once a load found nothing, the cards, and a spinner while loading.
 * Extra props go on the grid; callers add the paging control that suits the page. `editable` as on `TemplateCard`.
 */
export function TemplateGrid({
  list,
  empty,
  editable = false,
  ...rest
}: { list: Paged<Template>; empty: ReactNode; editable?: boolean } & ComponentPropsWithoutRef<"div">) {
  return (
    <>
      {list.error !== null && <ErrorView error={list.error} />}
      {!list.loading && list.items.length === 0 && list.error === null && empty}
      <MediaGrid aria-busy={list.loading} {...rest}>
        {list.items.map((t) => (
          <TemplateCard key={t.id} template={t} editable={editable} />
        ))}
      </MediaGrid>
      {list.loading && <Spinner label="Loading…" />}
    </>
  );
}
