-- Tags shared by templates and memes. `team` tags group an org's own memes (e.g. "google", "adobe").
create type tag_kind as enum ('topic', 'team');

create table tags (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 40),
  name text not null,
  kind tag_kind not null default 'topic',
  description text not null default '',
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table template_tags (
  template_id uuid not null references templates (id) on delete cascade,
  tag_id uuid not null references tags (id) on delete cascade,
  primary key (template_id, tag_id)
);
create index template_tags_tag on template_tags (tag_id);

create table meme_tags (
  meme_id uuid not null references memes (id) on delete cascade,
  tag_id uuid not null references tags (id) on delete cascade,
  primary key (meme_id, tag_id)
);
create index meme_tags_tag on meme_tags (tag_id);

-- Top-level template ↔ tag, including tags placed on any of its variations.
create view template_tag_matches as
  select distinct coalesce(t.parent_id, t.id) as template_id, tt.tag_id
  from template_tags tt
  join templates t on t.id = tt.template_id;

-- Meme ↔ tag: tagged directly, or made from a tagged template (or that template's parent).
create view meme_tag_matches as
  select meme_id, tag_id from meme_tags
  union
  select m.id, tt.tag_id
  from memes m
  join templates t on t.id = m.template_id
  join template_tags tt on tt.template_id = t.id or tt.template_id = t.parent_id;

insert into tags (slug, name, kind, description) values
  ('oldschool', 'Oldschool', 'topic', 'Classic image macros and advice animals'),
  ('movie', 'Movie', 'topic', 'Screenshots from movies and TV');
