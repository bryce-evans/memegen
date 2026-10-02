-- Template usage history: one row per meme created from a template, and one when it is posted.
-- Kept separately from memes so history survives meme deletion and powers "hot" rankings.
create type template_use_kind as enum ('created', 'posted');

create table template_uses (
  id bigint generated always as identity primary key,
  template_id uuid not null references templates (id) on delete cascade,
  -- The top-level template (itself, or the parent of a variation) for rollups.
  root_template_id uuid not null references templates (id) on delete cascade,
  meme_id uuid references memes (id) on delete set null,
  user_id uuid references users (id) on delete set null,
  kind template_use_kind not null,
  created_at timestamptz not null default now()
);
create index template_uses_root_time on template_uses (root_template_id, created_at desc);
create index template_uses_template_time on template_uses (template_id, created_at desc);
create index template_uses_time on template_uses (created_at desc);
create unique index template_uses_once on template_uses (meme_id, kind) where meme_id is not null;

create function record_template_use(m memes, use_kind template_use_kind, at timestamptz) returns void
language sql as $$
  insert into template_uses (template_id, root_template_id, meme_id, user_id, kind, created_at)
  select t.id, coalesce(t.parent_id, t.id), m.id, m.owner_id, use_kind, at
  from templates t where t.id = m.template_id
  on conflict do nothing;
$$;

create function memes_template_use() returns trigger language plpgsql as $$
begin
  if new.template_id is null then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform record_template_use(new, 'created', new.created_at);
  end if;
  if new.posted_at is not null and (tg_op = 'INSERT' or old.posted_at is null) then
    perform record_template_use(new, 'posted', new.posted_at);
  end if;
  return null;
end $$;
create trigger memes_template_use after insert or update of posted_at on memes
  for each row execute function memes_template_use();

-- Backfill from memes that already exist.
select record_template_use(m, 'created', m.created_at) from memes m where m.template_id is not null;
select record_template_use(m, 'posted', m.posted_at) from memes m where m.template_id is not null and m.posted_at is not null;
