import { HttpError, type TransactionSql } from "@memegen/server-kit";

/** Tag writes participate in the caller's domain transaction, including newly created slugs. */
async function ensureTags(tx: TransactionSql, slugs: readonly string[], userId: string): Promise<void> {
  await tx`
    insert into tags (slug, name, created_by)
    select s, s, ${userId} from unnest(${slugs as string[]}::text[]) as s
    on conflict (slug) do nothing`;
}

/** Replace all explicit tags on a meme, retaining inherited template tags. */
export async function replaceMemeTags(tx: TransactionSql, memeId: string, slugs: readonly string[], userId: string): Promise<void> {
  if (slugs.length) await ensureTags(tx, slugs, userId);
  await tx`delete from meme_tags where meme_id = ${memeId}`;
  if (slugs.length) {
    await tx`
      insert into meme_tags (meme_id, tag_id)
      select ${memeId}, id from tags where slug = any(${slugs as string[]}::text[])`;
  }
}

/** Existing base/community tags keep their provenance; additions never replace them. */
export async function addTemplateTags(
  tx: TransactionSql,
  templateId: string,
  slugs: readonly string[],
  userId: string,
  base: boolean,
): Promise<void> {
  if (!slugs.length) return;
  await ensureTags(tx, slugs, userId);
  await tx`
    insert into template_tags (template_id, tag_id, base, added_by)
    select ${templateId}, id, ${base}, ${userId} from tags where slug = any(${slugs as string[]}::text[])
    on conflict (template_id, tag_id) do nothing`;
}

/** Admin replacement of direct associations, preserving retained provenance and inherited parent tags. */
export async function replaceTemplateTags(
  tx: TransactionSql,
  templateId: string,
  slugs: readonly string[],
  userId: string,
): Promise<void> {
  const [template] = await tx`select 1 from templates where id = ${templateId} for no key update`;
  if (!template) throw new HttpError(404, "template not found");
  await tx`
    delete from template_tags tt using tags g
    where tt.template_id = ${templateId} and tt.tag_id = g.id
      and not (g.slug = any(${slugs as string[]}::text[]))`;
  await addTemplateTags(tx, templateId, slugs, userId, false);
}
