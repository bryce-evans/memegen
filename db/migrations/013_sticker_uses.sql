-- Sticker usage history, like template_uses: a `created` row when a saved meme first carries a sticker (an image
-- layer on the sticker's asset) and a `posted` row when a meme carrying it is posted. A meme counts once per sticker
-- and kind however many times it places that sticker. Kept apart from memes so history survives meme deletion; the
-- sticker picker ranks by it (posts first, then saves).
create table sticker_uses (
  id bigint generated always as identity primary key,
  sticker_id uuid not null references stickers (id) on delete cascade,
  meme_id uuid references memes (id) on delete set null,
  user_id uuid references users (id) on delete set null,
  kind template_use_kind not null,
  created_at timestamptz not null default now()
);
create index sticker_uses_sticker_kind on sticker_uses (sticker_id, kind);
create unique index sticker_uses_once on sticker_uses (sticker_id, meme_id, kind) where meme_id is not null;

-- One row per distinct sticker in the meme's layers; ones the meme already recorded are skipped.
create function record_sticker_uses(m memes, use_kind template_use_kind, at timestamptz) returns void
language sql as $$
  insert into sticker_uses (sticker_id, meme_id, user_id, kind, created_at)
  select distinct s.id, m.id, m.owner_id, use_kind, at
  from jsonb_array_elements(m.layers) l
  join stickers s on s.asset_id::text = l->>'assetId'
  where l->>'type' = 'image'
  on conflict do nothing;
$$;

-- Fires on save and on every layer edit, so a sticker added to a meme later (even an already posted one) counts too.
-- Removing a sticker keeps its history, as with templates.
create function memes_sticker_use() returns trigger language plpgsql as $$
begin
  perform record_sticker_uses(new, 'created', case when tg_op = 'INSERT' then new.created_at else now() end);
  if new.posted_at is not null then
    perform record_sticker_uses(new, 'posted',
      case when tg_op = 'INSERT' or old.posted_at is null then new.posted_at else now() end);
  end if;
  return null;
end $$;
create trigger memes_sticker_use after insert or update of layers, posted_at on memes
  for each row execute function memes_sticker_use();

-- Backfill from memes that already exist.
select record_sticker_uses(m, 'created', m.created_at) from memes m;
select record_sticker_uses(m, 'posted', m.posted_at) from memes m where m.posted_at is not null;
