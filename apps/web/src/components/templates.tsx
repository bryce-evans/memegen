import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Template } from "@memegen/shared";
import { Badge, Card, CardMeta, CardTitle, LinkButton, MediaGrid, Spinner } from "@memegen/ui";
import { plural } from "../format.ts";
import type { Paged } from "../usePaged.ts";
import { ErrorView, MediaView } from "./common.tsx";

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
 * Extra props go on the grid; callers add the paging control that suits the page.
 */
export function TemplateGrid({ list, empty, ...rest }: { list: Paged<Template>; empty: ReactNode } & ComponentPropsWithoutRef<"div">) {
  return (
    <>
      {list.error !== null && <ErrorView error={list.error} />}
      {!list.loading && list.items.length === 0 && list.error === null && empty}
      <MediaGrid aria-busy={list.loading} {...rest}>
        {list.items.map((t) => (
          <TemplateCard key={t.id} template={t} />
        ))}
      </MediaGrid>
      {list.loading && <Spinner label="Loading…" />}
    </>
  );
}
