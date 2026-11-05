import {
  createTemplateSchema,
  hotTemplatesQuerySchema,
  setTagsSchema,
  templateDuplicatesQuerySchema,
  templatesQuerySchema,
  templateUsageQuerySchema,
  updateTemplateSchema,
  templateDependentsQuerySchema,
  type TemplateDependents,
} from "@memegen/shared";
import { HttpError, idParam, page, parse, parseJson, type Sql, type TransactionSql } from "@memegen/server-kit";
import { deletionTransaction } from "@memegen/server-kit/audit";
import {
  loadTemplate,
  loadTemplatePack,
  ownerOrAdminTemplate,
  requireAdmin,
  requireLayerAssets,
  requireMediaAsset,
  requirePackImages,
  requireUser,
  type ApiApp,
} from "../access.ts";
import { memeSelect, storedPanels, toMeme, type MemeRow } from "../rows.ts";
import { addTemplateTags, replaceTemplateTags } from "../tags.ts";
import { browseTemplates, templateCount, templateDuplicates } from "../template-queries.ts";
import { hotTemplates, templateUsage } from "../template-usage.ts";
import type { TemplateSearch } from "../search.ts";

/**
 * Lock the root first, then read/lock its variations in a fresh statement snapshot. Foreign-key
 * key-share locks now block new variations and memes until the caller's transaction completes.
 */
async function lockTemplateScope(tx: TransactionSql, id: string): Promise<void> {
  const [template] = await tx`select id from templates where id = ${id} for update`;
  if (!template) throw new HttpError(404, "template not found");
  await tx`select id from templates where parent_id = ${id} order by id for update`;
}


/** Template browsing and search, duplicate checks, usage stats, authoring, and community tags. */
export function register(app: ApiApp, sql: Sql, search: TemplateSearch | null): void {
  app.get("/api/templates", async (c) => {
    const query = parse(templatesQuerySchema, c.req.query());
    return c.json(await browseTemplates(sql, search, c.get("user")?.id ?? null, query));
  });

  /** How many templates the browser lists with no search or filter. */
  app.get("/api/templates/count", async (c) => {
    return c.json(await templateCount(sql, c.get("user")?.id ?? null));
  });

  /**
   * Templates that already use an uploaded image, exact copies (same bytes) first, then (with the search sidecar)
   * ones that look alike. The Template Editor asks before a new template is saved.
   */
  app.get("/api/templates/duplicates", async (c) => {
    const user = requireUser(c);
    const { assetId } = parse(templateDuplicatesQuerySchema, c.req.query());
    return c.json(await templateDuplicates(sql, search, assetId, user.id));
  });

  /** Most-used top-level templates in the period; variation uses roll up into their parent. */
  app.get("/api/templates/hot", async (c) => {
    const { period, limit } = parse(hotTemplatesQuerySchema, c.req.query());
    return c.json(await hotTemplates(sql, c.get("user")?.id ?? null, period, limit));
  });

  /** Zero-filled usage time series for one template (top-level includes its variations). */
  app.get("/api/templates/:id/usage", async (c) => {
    const { id } = parse(idParam, c.req.param());
    const { period } = parse(templateUsageQuerySchema, c.req.query());
    const template = await loadTemplate(sql, id, c.get("user"));
    return c.json(await templateUsage(sql, template, period));
  });

  app.get("/api/templates/:id", async (c) => {
    const { id } = parse(idParam, c.req.param());
    return c.json(await loadTemplate(sql, id, c.get("user")));
  });

  app.post("/api/templates", async (c) => {
    const user = requireUser(c);
    const body = await parseJson(c, createTemplateSchema);
    await requireMediaAsset(sql, body.assetId, "assetId");
    if (body.parentId) {
      const [parent] = await sql<{ parent_id: string | null }[]>`
        select t.parent_id from templates t where t.id = ${body.parentId}`;
      if (!parent) throw new HttpError(400, "parent template does not exist");
      if (parent.parent_id) throw new HttpError(400, "variations cannot have variations; use the top-level template");
    }
    if (body.panels) await requirePackImages(sql, body.panels.packAssetIds);
    await requireLayerAssets(sql, body.defaultLayers);
    const id = await sql.begin(async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into templates ${tx({
          name: body.name,
          asset_id: body.assetId,
          parent_id: body.parentId ?? null,
          owner_id: user.id,
          default_layers: tx.json(body.defaultLayers as never),
          panels: body.panels ? tx.json(storedPanels(body.panels) as never) : null,
          is_public: body.isPublic,
        })} returning id`;
      if (body.panels) {
        const rows = body.panels.packAssetIds.map((assetId, position) => ({ template_id: row!.id, asset_id: assetId, position }));
        await tx`insert into template_pack_assets ${tx(rows)}`;
      }
      await addTemplateTags(tx, row!.id, body.tags, user.id, true);
      return row!.id;
    });
    return c.json(await loadTemplate(sql, id, user), 201);
  });

  app.patch("/api/templates/:id", async (c) => {
    const { user, id } = await ownerOrAdminTemplate(sql, c);
    const body = await parseJson(c, updateTemplateSchema);
    const pack = await loadTemplatePack(sql, id);
    if (pack && body.defaultLayers?.length) throw new HttpError(400, "multi-panel templates have no text layers");
    const changes: Record<string, unknown> = {};
    if (body.name !== undefined) changes.name = body.name;
    if (body.isPublic !== undefined) changes.is_public = body.isPublic;
    if (body.defaultLayers !== undefined) {
      await requireLayerAssets(sql, body.defaultLayers);
      changes.default_layers = sql.json(body.defaultLayers as never);
    }
    const panels = body.panels;
    if (panels && body.assetId) {
      if (!pack) throw new HttpError(400, "only multi-panel templates have panels");
      // Memes keep using the pack images they picked, so the pack only grows.
      if (!pack.every((assetId) => panels.packAssetIds.includes(assetId))) {
        throw new HttpError(400, "pack images can't be removed once added");
      }
      await requirePackImages(sql, panels.packAssetIds.filter((assetId) => !pack.includes(assetId)));
      await requireMediaAsset(sql, body.assetId, "assetId");
      changes.panels = sql.json(storedPanels(panels) as never);
      changes.asset_id = body.assetId;
    }
    if (Object.keys(changes).length || panels) {
      await sql.begin(async (tx) => {
        if (Object.keys(changes).length) await tx`update templates set ${tx(changes)} where id = ${id}`;
        if (panels) {
          await tx`
            insert into template_pack_assets ${tx(panels.packAssetIds.map((assetId, position) => ({ template_id: id, asset_id: assetId, position })))}
            on conflict (template_id, asset_id) do update set position = excluded.position`;
        }
      });
    }
    return c.json(await loadTemplate(sql, id, user));
  });

  app.delete("/api/templates/:id", async (c) => {
    const { user, id } = await ownerOrAdminTemplate(sql, c);
    try {
      await deletionTransaction(sql, user, async (tx) => {
        await lockTemplateScope(tx, id);
        // Memes keep their template; removing a root also removes its variations, never their memes.
        const [used] = await tx`select 1 from memes m join templates t on t.id = m.template_id
          where t.id = ${id} or t.parent_id = ${id} limit 1`;
        if (used) throw new HttpError(409, "template is used by memes and can't be deleted");
        await tx`delete from templates where id = ${id}`;
      });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "23503") {
        throw new HttpError(409, "template is used by memes and can't be deleted");
      }
      throw error;
    }
    return c.body(null, 204);
  });

  /** Any signed-in user adds non-base tags; only admins may remove direct tags. */
  app.post("/api/templates/:id/tags", async (c) => {
    const user = requireUser(c);
    const { id } = parse(idParam, c.req.param());
    const { tags } = await parseJson(c, setTagsSchema);
    await sql.begin(async (tx) => {
      // Serialize community additions with admin replacement without changing their provenance.
      const [template] = await tx`select 1 from templates where id = ${id} for no key update`;
      if (!template) throw new HttpError(404, "template not found");
      await addTemplateTags(tx, id, tags, user.id, false);
    });
    return c.json(await loadTemplate(sql, id, user));
  });

  app.put("/api/templates/:id/tags", async (c) => {
    const user = requireAdmin(c);
    const { id } = parse(idParam, c.req.param());
    const { tags } = await parseJson(c, setTagsSchema);
    await sql.begin((tx) => replaceTemplateTags(tx, id, tags, user.id));
    return c.json(await loadTemplate(sql, id, user));
  });

  app.get("/api/admin/templates/:id/memes", async (c) => {
    const user = requireAdmin(c);
    const { id } = parse(idParam, c.req.param());
    const { offset, limit } = parse(templateDependentsQuerySchema, c.req.query());
    const dependents = await sql.begin("isolation level repeatable read read only", async (tx): Promise<TemplateDependents> => {
      const [template] = await tx`select 1 from templates where id = ${id}`;
      if (!template) throw new HttpError(404, "template not found");
      const [count] = await tx<{ total: number }[]>`
        select count(*)::int as total from memes m join templates t on t.id = m.template_id
        where t.id = ${id} or t.parent_id = ${id}`;
      const rows = await tx<MemeRow[]>`${memeSelect(tx, user.id)}
        join templates t on t.id = m.template_id
        where t.id = ${id} or t.parent_id = ${id}
        order by m.created_at desc, m.id
        offset ${offset} limit ${limit + 1}`;
      return { ...page(rows.map(toMeme), offset, limit), total: count!.total };
    });
    return c.json(dependents);
  });

  app.delete("/api/admin/templates/:id/memes", async (c) => {
    const user = requireAdmin(c);
    const { id } = parse(idParam, c.req.param());
    await deletionTransaction(sql, user, async (tx) => {
      await lockTemplateScope(tx, id);
      await tx`delete from memes m using templates t
        where m.template_id = t.id and (t.id = ${id} or t.parent_id = ${id})`;
    }, true);
    return c.body(null, 204);
  });
}
