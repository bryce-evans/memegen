-- Every meme is made from a template. Memes made from one-off uploads (before this rule) get a private
-- template built from their own source image, owned by the meme's author, so their history stays editable.
with orphans as (
  select m.id as meme_id, m.owner_id, m.source_asset_id, coalesce(nullif(m.title, ''), 'Untitled') as name
  from memes m where m.template_id is null
), made as (
  insert into templates (name, asset_id, owner_id, is_public)
  select distinct on (source_asset_id, owner_id) name, source_asset_id, owner_id, false
  from orphans order by source_asset_id, owner_id, meme_id
  returning id, asset_id, owner_id
)
update memes m set template_id = made.id
from made where m.template_id is null and m.source_asset_id = made.asset_id and m.owner_id = made.owner_id;

alter table memes alter column template_id set not null;

-- A template in use can't disappear from under its memes (was `on delete set null`).
alter table memes drop constraint memes_template_id_fkey;
alter table memes add constraint memes_template_id_fkey foreign key (template_id) references templates (id) on delete restrict;
