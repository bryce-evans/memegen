-- Favorites: memes a user saved with the star, separate from votes (a favorite is not a like).
create table favorites (
  user_id uuid not null references users (id) on delete cascade,
  meme_id uuid not null references memes (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, meme_id)
);
-- The owner's Favorites tab, most recently saved first.
create index favorites_user_time on favorites (user_id, created_at desc);
