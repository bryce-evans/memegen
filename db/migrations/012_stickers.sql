-- Stickers: small PNGs (at most 512x512, checked by the API) that anyone can drop on a meme as an image layer.
-- A sticker is a named pointer to its asset, which image layers reference directly, so the asset stays put
-- (`restrict`) while a sticker uses it. Like templates, stickers without an owner belong to `memegen`.
create table stickers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  asset_id uuid not null unique references assets (id) on delete restrict,
  owner_id uuid not null references users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index stickers_created on stickers (created_at desc, id);

-- The template trigger function only sets `new.owner_id`, so it fits any table with that column.
create trigger stickers_default_owner before insert or update of owner_id on stickers
  for each row execute function templates_default_owner();
