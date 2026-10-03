-- Every template has an author. Built-in/seeded templates (and those whose author was deleted) belong
-- to the reserved `memegen` account, which the API refuses as a login name.
create function memegen_user_id() returns uuid language plpgsql as $$
declare
  uid uuid;
begin
  select id into uid from users where lower(username) = 'memegen';
  if uid is null then
    insert into users (username) values ('memegen')
      on conflict (lower(username)) do nothing
      returning id into uid;
    if uid is null then
      select id into uid from users where lower(username) = 'memegen';
    end if;
  end if;
  return uid;
end $$;

-- Fires for inserts without an owner and for `on delete set null` from users.
create function templates_default_owner() returns trigger language plpgsql as $$
begin
  if new.owner_id is null then
    new.owner_id := memegen_user_id();
  end if;
  return new;
end $$;
create trigger templates_default_owner before insert or update of owner_id on templates
  for each row execute function templates_default_owner();

update templates set owner_id = memegen_user_id() where owner_id is null;
alter table templates alter column owner_id set not null;

-- Base tags come with the template (its author/seed); users add non-base tags on top.
alter table template_tags add column base boolean not null default true;
alter table template_tags add column added_by uuid references users (id) on delete set null;

-- A user's own vote history ("liked"/"disliked", most recent first).
create index votes_user_time on votes (user_id, created_at desc);

-- Discussion under memes: top-level comments plus one level of replies.
create table comments (
  id uuid primary key default gen_random_uuid(),
  meme_id uuid not null references memes (id) on delete cascade,
  parent_id uuid references comments (id) on delete cascade,
  author_id uuid not null references users (id) on delete cascade,
  body text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (parent_id is null or parent_id <> id)
);
create index comments_meme_time on comments (meme_id, created_at);
create index comments_parent on comments (parent_id);

-- Replies attach to a top-level comment on the same meme.
create function comments_one_level() returns trigger language plpgsql as $$
begin
  if new.parent_id is not null and not exists (
    select 1 from comments p where p.id = new.parent_id and p.meme_id = new.meme_id and p.parent_id is null
  ) then
    raise exception 'reply parent % must be a top-level comment on the same meme', new.parent_id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger comments_one_level before insert or update of parent_id, meme_id on comments
  for each row execute function comments_one_level();
