-- Successful sign-ins, not request/session activity. UUIDs intentionally have no
-- foreign key: deleting an account must not rewrite historical unique counts.
create table daily_user_logins (
  date date not null default ((now() at time zone 'UTC')::date),
  user_id uuid not null,
  primary key (date, user_id)
);

-- This installation's tracking boundary is persisted once, never inferred from
-- the first login (an installation may have no sign-ins for days).
create table analytics_metadata (
  singleton boolean primary key default true check (singleton),
  login_tracking_started_at timestamptz not null default now()
);
insert into analytics_metadata (singleton) values (true);

create index memes_analytics_posted on memes (posted_at) where posted_at is not null;
create index templates_analytics_created on templates (created_at);
create index users_analytics_created on users (created_at);
create index comments_analytics_created on comments (created_at) where deleted_at is null;
