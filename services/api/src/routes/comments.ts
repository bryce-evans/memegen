import { commentsQuerySchema, createCommentSchema } from "@memegen/shared";
import { HttpError, idParam, page, parse, parseJson, type Sql } from "@memegen/server-kit";
import { loadMeme, requireUser, type ApiApp } from "../access.ts";
import { commentSelect, nest, requireListed, toComment, type CommentRow } from "../rows.ts";

/** Per-meme discussion: top-level comments with one level of replies. */
export function register(app: ApiApp, sql: Sql): void {
  app.get("/api/memes/:id/comments", async (c) => {
    const { id } = parse(idParam, c.req.param());
    const { offset, limit } = parse(commentsQuerySchema, c.req.query());
    await loadMeme(sql, id, c.get("user"));
    const rows = await sql<CommentRow[]>`${commentSelect(sql)}
      where c.meme_id = ${id} and c.parent_id is null
      order by c.created_at, c.id
      offset ${offset} limit ${limit + 1}`;
    const { items: top, nextOffset } = page(rows, offset, limit);
    const replies = top.length
      ? await sql<CommentRow[]>`${commentSelect(sql)}
          where c.parent_id in ${sql(top.map((r) => r.id))}
          order by c.created_at, c.id`
      : [];
    const items = nest(top, replies, (r, rs) => toComment(r, rs.map((reply) => toComment(reply))));
    return c.json({ items, nextOffset });
  });

  app.post("/api/memes/:id/comments", async (c) => {
    const user = requireUser(c);
    const { id } = parse(idParam, c.req.param());
    const { body, parentId } = await parseJson(c, createCommentSchema);
    requireListed(await loadMeme(sql, id, user), "commented on");
    if (parentId) {
      const [parent] = await sql`
        select 1 from comments where id = ${parentId} and meme_id = ${id} and parent_id is null`;
      if (!parent) throw new HttpError(400, "replies must answer a top-level comment on this meme");
    }
    const [row] = await sql<{ id: string }[]>`
      insert into comments ${sql({ meme_id: id, parent_id: parentId ?? null, author_id: user.id, body })}
      returning id`;
    const [comment] = await sql<CommentRow[]>`${commentSelect(sql)} where c.id = ${row!.id}`;
    return c.json(toComment(comment!), 201);
  });

  /**
   * Author only. A comment with replies becomes a placeholder (soft delete); otherwise it is removed,
   * along with its soft-deleted parent once that has no replies left.
   */
  app.delete("/api/comments/:id", async (c) => {
    const user = requireUser(c);
    const { id } = parse(idParam, c.req.param());
    await sql.begin(async (tx) => {
      const [row] = await tx<{ author_id: string; parent_id: string | null }[]>`
        select author_id, parent_id from comments where id = ${id} for update`;
      if (!row) throw new HttpError(404, "comment not found");
      if (row.author_id !== user.id) throw new HttpError(403, "only the author can delete this comment");
      // Lock the parent so concurrent reply deletions agree on whether it still has replies.
      if (row.parent_id) await tx`select 1 from comments where id = ${row.parent_id} for update`;
      const [hasReplies] = await tx`select 1 from comments where parent_id = ${id} limit 1`;
      if (hasReplies) {
        await tx`update comments set deleted_at = coalesce(deleted_at, now()) where id = ${id}`;
        return;
      }
      await tx`delete from comments where id = ${id}`;
      if (row.parent_id) {
        await tx`
          delete from comments p where p.id = ${row.parent_id} and p.deleted_at is not null
            and not exists (select 1 from comments r where r.parent_id = p.id)`;
      }
    });
    return c.body(null, 204);
  });
}
