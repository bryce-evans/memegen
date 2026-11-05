import { z } from "zod";
import { adminAuditQuerySchema, adminResourceKinds, adminResourcesQuerySchema, type AdminAuditEntry, type AdminResource, type AdminResourceKind } from "@memegen/shared";
import { HttpError, idParam, page, parse, type Sql } from "@memegen/server-kit";
import { deletionTransaction } from "@memegen/server-kit/audit";
import { requireAdmin, type ApiApp } from "../access.ts";

const resourceColumns: Record<AdminResourceKind, { label: string; owner: string }> = {
  memes: { label: "title", owner: "owner_id" },
  templates: { label: "name", owner: "owner_id" },
  comments: { label: "body", owner: "author_id" },
  tags: { label: "name", owner: "created_by" },
  stickers: { label: "name", owner: "owner_id" },
  assets: { label: "name", owner: "owner_id" },
  users: { label: "username", owner: "id" },
};

export function register(app: ApiApp, sql: Sql): void {
  app.get("/api/admin/resources/:kind", async (c) => {
    requireAdmin(c);
    const kind = parse(z.enum(adminResourceKinds), c.req.param("kind"));
    const { search, ownerId, offset, limit } = parse(adminResourcesQuerySchema, c.req.query());
    const columns = resourceColumns[kind];
    const rows = await sql<{ id: string; label: string; owner_id: string | null; owner_name: string | null; created_at: Date; meme_id: string | null; slug: string | null }[]>`
      select r.id, left(r.${sql(columns.label)}, 200) as label, r.${sql(columns.owner)} as owner_id,
        u.username as owner_name, r.created_at,
        ${kind === "comments" ? sql`r.meme_id` : sql`null::uuid`} as meme_id,
        ${kind === "tags" ? sql`r.slug` : sql`null::text`} as slug
      from ${sql(kind)} r left join users u on u.id = r.${sql(columns.owner)}
      where (${search} = '' or r.${sql(columns.label)} ilike ${`%${search}%`} or r.id::text = ${search}
        or u.username ilike ${`%${search}%`})
        ${ownerId ? sql`and r.${sql(columns.owner)} = ${ownerId}` : sql``}
      order by r.created_at desc, r.id offset ${offset} limit ${limit + 1}`;
    const items: AdminResource[] = rows.map((r) => ({
      id: r.id, kind, label: r.label || `Untitled ${kind}`, ownerId: r.owner_id, ownerName: r.owner_name,
      createdAt: r.created_at.toISOString(),
      href: kind === "memes" ? `/m/${r.id}` : kind === "templates" ? `/create?template=${r.id}`
        : kind === "comments" ? `/m/${r.meme_id}#comments` : kind === "users" ? `/u/${encodeURIComponent(r.label)}`
        : kind === "tags" ? `/t/${r.slug}` : kind === "assets" ? `/storage/assets/${r.id}/content` : null,
    }));
    return c.json(page(items, offset, limit));
  });

  app.get("/api/admin/audit", async (c) => {
    requireAdmin(c);
    const { search, kind, offset, limit } = parse(adminAuditQuerySchema, c.req.query());
    const rows = await sql<{ id: string; actor_id: string; actor_name: string; action: AdminAuditEntry["action"]; target_kind: AdminResourceKind; target_id: string; label: string; snapshot: AdminAuditEntry["snapshot"]; created_at: Date }[]>`
      select id::text, actor_id, actor_name, action, target_kind, target_id, label, snapshot, created_at
      from admin_audit where (${search} = '' or label ilike ${`%${search}%`} or actor_name ilike ${`%${search}%`}
        or target_id::text = ${search} or actor_id::text = ${search})
        ${kind ? sql`and target_kind = ${kind}` : sql``}
      order by created_at desc, admin_audit.id desc offset ${offset} limit ${limit + 1}`;
    return c.json(page(rows.map((r): AdminAuditEntry => ({
      id: r.id, actorId: r.actor_id, actorName: r.actor_name, action: r.action,
      targetKind: r.target_kind, targetId: r.target_id, label: r.label, snapshot: r.snapshot, createdAt: r.created_at.toISOString(),
    })), offset, limit));
  });

  for (const kind of ["tags", "stickers"] as const) {
    app.delete(`/api/admin/${kind}/:id`, async (c) => {
      const actor = requireAdmin(c);
      const { id } = parse(idParam, c.req.param());
      await deletionTransaction(sql, actor, async (tx) => {
        const rows = await tx`delete from ${tx(kind)} where id = ${id} returning id`;
        if (!rows.length) throw new HttpError(404, `${kind} not found`);
      }, true);
      return c.body(null, 204);
    });
  }

  app.delete("/api/admin/users/:id", async (c) => {
    const actor = requireAdmin(c);
    const { id } = parse(idParam, c.req.param());
    if (actor.id === id) throw new HttpError(409, "You cannot delete your own account.");
    await deletionTransaction(sql, actor, async (tx) => {
      const [target] = await tx<{ username: string; is_admin: boolean }[]>`
        select username, is_admin from users where id = ${id} for update`;
      if (!target) throw new HttpError(404, "user not found");
      if (target.username.toLowerCase() === "memegen") throw new HttpError(409, "The built-in memegen account cannot be deleted.");
      if (target.is_admin) {
        const [other] = await tx`select 1 from users where is_admin and id <> ${id} limit 1`;
        if (!other) throw new HttpError(409, "The last administrator cannot be deleted.");
      }
      const blockers: string[] = [];
      for (const kind of adminResourceKinds) {
        if (kind === "users") continue;
        const [row] = await tx<{ total: number }[]>`
          select count(*)::int as total from ${tx(kind)} where ${tx(resourceColumns[kind].owner)} = ${id}`;
        if (row!.total) blockers.push(`${row!.total} ${kind}`);
      }
      if (blockers.length) throw new HttpError(409,
        `Account still owns ${blockers.join(", ")}. Filter resources by owner ${id}, clear those resources, then retry. No content was deleted.`);
      await tx`delete from users where id = ${id}`;
    }, true, true);
    return c.body(null, 204);
  });
}
