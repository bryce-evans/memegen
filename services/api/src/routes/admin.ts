import { adminAuditQuerySchema, adminResourceKinds, type AdminAuditEntry, type AdminResourceKind } from "@memegen/shared";
import { HttpError, idParam, page, parse, type Sql } from "@memegen/server-kit";
import { deletionTransaction } from "@memegen/server-kit/audit";
import { requireAdmin, type ApiApp } from "../access.ts";

const resourceOwnerColumns: Record<Exclude<AdminResourceKind, "users">, string> = {
  memes: "owner_id",
  templates: "owner_id",
  comments: "author_id",
  tags: "created_by",
  stickers: "owner_id",
  assets: "owner_id",
};

export function register(app: ApiApp, sql: Sql): void {
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
          select count(*)::int as total from ${tx(kind)} where ${tx(resourceOwnerColumns[kind])} = ${id}`;
        if (row!.total) blockers.push(`${row!.total} ${kind}`);
      }
      if (blockers.length) throw new HttpError(409,
        `Account still owns ${blockers.join(", ")}. Delete that content through its individual administration controls, then retry. No content was deleted.`);
      await tx`delete from users where id = ${id}`;
    }, true, true);
    return c.body(null, 204);
  });
}
