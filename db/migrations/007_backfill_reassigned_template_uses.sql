-- 006 gave one-off memes a template with a plain UPDATE, which the usage trigger (insert or update of
-- posted_at) never saw: record their 'created'/'posted' uses like 002's backfill did. Idempotent
-- (record_template_use skips uses already logged), so it only fills what is missing.
select record_template_use(m, 'created', m.created_at) from memes m;
select record_template_use(m, 'posted', m.posted_at) from memes m where m.posted_at is not null;

-- memes.template_id is not null since 006, so the trigger no longer needs its null guard.
create or replace function memes_template_use() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    perform record_template_use(new, 'created', new.created_at);
  end if;
  if new.posted_at is not null and (tg_op = 'INSERT' or old.posted_at is null) then
    perform record_template_use(new, 'posted', new.posted_at);
  end if;
  return null;
end $$;
