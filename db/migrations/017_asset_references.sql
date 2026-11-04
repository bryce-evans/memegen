-- Scalar media references (template covers, meme source/output, packs, stickers) already
-- have foreign keys. Materialize JSON references too, so PostgreSQL's FK locking
-- arbitrates concurrent content writes and asset deletes, including uploaded fonts.
create table template_asset_references (
  template_id uuid not null references templates (id) on delete cascade,
  asset_id uuid not null references assets (id) on delete restrict,
  primary key (template_id, asset_id)
);
create index template_asset_references_asset on template_asset_references (asset_id);

create table meme_asset_references (
  meme_id uuid not null references memes (id) on delete cascade,
  asset_id uuid not null references assets (id) on delete restrict,
  primary key (meme_id, asset_id)
);
create index meme_asset_references_asset on meme_asset_references (asset_id);

create function json_asset_references(layers jsonb, panels jsonb)
returns table (asset_id uuid) language sql immutable as $$
  select (layer->>'assetId')::uuid
  from jsonb_array_elements(layers) layer
  where layer->>'type' = 'image'
  union
  select (layer->>'fontAssetId')::uuid
  from jsonb_array_elements(layers) layer
  where layer->>'type' = 'text' and layer->>'fontAssetId' is not null
  union
  select (panel->>'assetId')::uuid
  from jsonb_array_elements(panels) panel
$$;

create function templates_sync_asset_references() returns trigger language plpgsql as $$
begin
  delete from template_asset_references where template_id = new.id;
  insert into template_asset_references (template_id, asset_id)
    select new.id, asset_id from json_asset_references(new.default_layers, new.panels->'defaultPanels');
  return null;
end $$;
create trigger templates_sync_asset_references after insert or update of default_layers, panels on templates
  for each row execute function templates_sync_asset_references();

create function memes_sync_asset_references() returns trigger language plpgsql as $$
begin
  delete from meme_asset_references where meme_id = new.id;
  insert into meme_asset_references (meme_id, asset_id)
    select new.id, asset_id from json_asset_references(new.layers, new.panels->'panels');
  return null;
end $$;
create trigger memes_sync_asset_references after insert or update of layers, panels on memes
  for each row execute function memes_sync_asset_references();

-- Fail closed on pre-existing dangling references rather than silently changing saved content.
insert into template_asset_references (template_id, asset_id)
  select t.id, r.asset_id from templates t
  cross join lateral json_asset_references(t.default_layers, t.panels->'defaultPanels') r;
insert into meme_asset_references (meme_id, asset_id)
  select m.id, r.asset_id from memes m
  cross join lateral json_asset_references(m.layers, m.panels->'panels') r;
