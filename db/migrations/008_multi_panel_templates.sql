-- Multi-panel templates ("expanding brain"): null for single-media templates, else `{layout, defaultPanels}`.
-- Their `asset_id` is a client-rendered cover; the images panels pick from live in `template_pack_assets`.
alter table templates add column panels jsonb;

-- A multi-panel template's image pack, in display order. Images stay once added: memes reference them.
create table template_pack_assets (
  template_id uuid not null references templates (id) on delete cascade,
  asset_id uuid not null references assets (id),
  position int not null,
  primary key (template_id, asset_id)
);
-- Storage's "is this asset in use" check on delete.
create index template_pack_assets_asset on template_pack_assets (asset_id);

-- A multi-panel meme's content, `{layout, panels}` (its `layers` are empty); null for every other meme.
alter table memes add column panels jsonb;
