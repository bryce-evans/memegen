create table users (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  created_at timestamptz not null default now()
);
create unique index users_username_key on users (lower(username));

create type asset_kind as enum ('image', 'gif', 'video', 'font');

create table assets (
  id uuid primary key default gen_random_uuid(),
  kind asset_kind not null,
  mime text not null,
  name text not null,
  filename text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text not null,
  provider text not null,
  storage_key text not null,
  owner_id uuid references users (id) on delete set null,
  width int,
  height int,
  duration_ms int,
  frame_count int,
  fps real,
  created_at timestamptz not null default now(),
  unique (provider, storage_key)
);
create index assets_kind_created on assets (kind, created_at desc);

create table templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  parent_id uuid references templates (id) on delete cascade,
  owner_id uuid references users (id) on delete set null,
  asset_id uuid not null references assets (id),
  default_layers jsonb not null default '[]',
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  check (parent_id is null or parent_id <> id)
);
create index templates_parent on templates (parent_id);
create index templates_name on templates (lower(name));

-- Exactly one level of hierarchy: template -> variations.
create function templates_one_level() returns trigger language plpgsql as $$
begin
  if new.parent_id is not null then
    if exists (select 1 from templates where id = new.parent_id and parent_id is not null) then
      raise exception 'template % is a variation and cannot have variations', new.parent_id
        using errcode = 'check_violation';
    end if;
    if exists (select 1 from templates where parent_id = new.id) then
      raise exception 'template % has variations and cannot become a variation', new.id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger templates_one_level before insert or update of parent_id on templates
  for each row execute function templates_one_level();

create type visibility as enum ('public', 'private');

create table memes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users (id) on delete cascade,
  template_id uuid references templates (id) on delete set null,
  source_asset_id uuid not null references assets (id),
  output_asset_id uuid not null references assets (id),
  title text not null default '',
  layers jsonb not null default '[]',
  visibility visibility not null default 'public',
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  upvotes int not null default 0,
  downvotes int not null default 0,
  score int generated always as (upvotes - downvotes) stored
);
create index memes_owner on memes (owner_id, created_at desc);
create index memes_gallery_new on memes (posted_at desc) where visibility = 'public' and posted_at is not null;
create index memes_gallery_best on memes (score desc, posted_at desc) where visibility = 'public' and posted_at is not null;

create table votes (
  user_id uuid not null references users (id) on delete cascade,
  meme_id uuid not null references memes (id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (user_id, meme_id)
);
create index votes_meme on votes (meme_id);

-- Keep memes.upvotes/downvotes in sync with votes.
create function votes_tally() returns trigger language plpgsql as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update memes set
      upvotes = upvotes - (old.value = 1)::int,
      downvotes = downvotes - (old.value = -1)::int
    where id = old.meme_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    update memes set
      upvotes = upvotes + (new.value = 1)::int,
      downvotes = downvotes + (new.value = -1)::int
    where id = new.meme_id;
  end if;
  return null;
end $$;
create trigger votes_tally after insert or update or delete on votes
  for each row execute function votes_tally();
