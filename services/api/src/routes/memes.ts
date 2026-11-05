import { createMemeSchema, favoriteSchema, updateMemeSchema, voteSchema } from "@memegen/shared";
import { idParam, parse, parseJson, type Sql, type TransactionSql } from "@memegen/server-kit";
import { deletionTransaction } from "@memegen/server-kit/audit";
import {
  loadMeme,
  loadTemplate,
  loadTemplatePack,
  ownerOrAdminMeme,
  requireLayerAssets,
  requireMemePanels,
  requireOwnOutput,
  requireUser,
  type ApiApp,
} from "../access.ts";
import { memeListed, requireListed, toMeme } from "../rows.ts";
import { replaceMemeTags } from "../tags.ts";

/** Posting casts the author's upvote once listed; unlisted posts receive none. */
async function authorUpvote(sql: TransactionSql, memeId: string, authorId: string): Promise<void> {
  await sql`
    insert into votes (user_id, meme_id, value)
    select ${authorId}, m.id, 1 from memes m where m.id = ${memeId} and ${memeListed(sql)}
    on conflict (user_id, meme_id) do nothing`;
}

/** Meme authoring, posting, votes, and favorites. */
export function register(app: ApiApp, sql: Sql): void {
  app.post("/api/memes", async (c) => {
    const user = requireUser(c);
    const body = await parseJson(c, createMemeSchema);
    const template = await loadTemplate(sql, body.templateId, user);
    const output = await requireOwnOutput(sql, body.outputAssetId, user);
    const panels = requireMemePanels(template.panels?.pack.map((a) => a.id) ?? null, body.panels);
    await requireLayerAssets(sql, body.layers);
    const id = await sql.begin(async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into memes ${tx({
          owner_id: user.id,
          template_id: template.id,
          source_asset_id: template.asset.id,
          output_asset_id: output.id,
          title: body.title,
          layers: tx.json(body.layers as never),
          panels: panels ? tx.json(panels as never) : null,
          visibility: body.visibility,
          posted_at: body.post ? new Date() : null,
        })} returning id`;
      if (body.tags.length) await replaceMemeTags(tx, row!.id, body.tags, user.id);
      if (body.post) await authorUpvote(tx, row!.id, user.id);
      return row!.id;
    });
    return c.json(toMeme(await loadMeme(sql, id, user)), 201);
  });

  app.get("/api/memes/:id", async (c) => {
    const { id } = parse(idParam, c.req.param());
    return c.json(toMeme(await loadMeme(sql, id, c.get("user"))));
  });

  app.patch("/api/memes/:id", async (c) => {
    const { user, id, meme } = await ownerOrAdminMeme(sql, c);
    const body = await parseJson(c, updateMemeSchema);
    const changes: Record<string, unknown> = {};
    if (body.title !== undefined) changes.title = body.title;
    if (body.visibility !== undefined) changes.visibility = body.visibility;
    if (body.layers && body.outputAssetId) {
      const output = await requireOwnOutput(sql, body.outputAssetId, user);
      const panels = requireMemePanels(await loadTemplatePack(sql, meme.template_id), body.panels);
      await requireLayerAssets(sql, body.layers);
      changes.layers = sql.json(body.layers as never);
      changes.panels = panels ? sql.json(panels as never) : null;
      changes.output_asset_id = output.id;
    }
    await sql.begin(async (tx) => {
      if (Object.keys(changes).length) {
        await tx`update memes set ${tx(changes)}, updated_at = now() where id = ${id}`;
      }
      if (body.tags) await replaceMemeTags(tx, id, body.tags, user.id);
    });
    return c.json(toMeme(await loadMeme(sql, id, user)));
  });

  app.post("/api/memes/:id/post", async (c) => {
    const { user, id, meme } = await ownerOrAdminMeme(sql, c);
    await sql.begin(async (tx) => {
      const [posted] = await tx`
        update memes set posted_at = now(), updated_at = now() where id = ${id} and posted_at is null returning id`;
      if (posted) await authorUpvote(tx, id, meme.owner_id);
    });
    return c.json(toMeme(await loadMeme(sql, id, user)));
  });

  app.delete("/api/memes/:id", async (c) => {
    const { user, id } = await ownerOrAdminMeme(sql, c);
    await deletionTransaction(sql, user, async (tx) => { await tx`delete from memes where id = ${id}`; });
    return c.body(null, 204);
  });

  app.put("/api/memes/:id/vote", async (c) => {
    const user = requireUser(c);
    const { id } = parse(idParam, c.req.param());
    const { value } = await parseJson(c, voteSchema);
    requireListed(await loadMeme(sql, id, user), "voted on");
    if (value === 0) {
      await sql`delete from votes where user_id = ${user.id} and meme_id = ${id}`;
    } else {
      await sql`
        insert into votes (user_id, meme_id, value) values (${user.id}, ${id}, ${value})
        on conflict (user_id, meme_id) do update set value = excluded.value, created_at = now()
        where votes.value <> excluded.value`;
    }
    return c.json(toMeme(await loadMeme(sql, id, user)));
  });

  /** Star (save to Favorites) or unstar; like votes, only posted public memes. Idempotent. */
  app.put("/api/memes/:id/favorite", async (c) => {
    const user = requireUser(c);
    const { id } = parse(idParam, c.req.param());
    const { favorite } = await parseJson(c, favoriteSchema);
    requireListed(await loadMeme(sql, id, user), "favorited");
    if (favorite) {
      await sql`insert into favorites (user_id, meme_id) values (${user.id}, ${id}) on conflict do nothing`;
    } else {
      await sql`delete from favorites where user_id = ${user.id} and meme_id = ${id}`;
    }
    return c.json(toMeme(await loadMeme(sql, id, user)));
  });
}
