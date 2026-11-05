-- Deliberately no foreign keys: historical actors and targets outlive their accounts/content.
create table admin_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  actor_name text not null,
  action text not null check (action in ('delete', 'soft_delete')),
  target_kind text not null check (target_kind in ('memes', 'templates', 'comments', 'tags', 'stickers', 'assets', 'users')),
  target_id uuid not null,
  label text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index admin_audit_time on admin_audit (created_at desc, id desc);
create index admin_audit_target on admin_audit (target_kind, target_id);

-- Database owners/superusers remain trusted: they can disable triggers or alter the schema.
create function admin_audit_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'admin audit records are immutable' using errcode = 'insufficient_privilege';
end $$;
create trigger admin_audit_immutable before update or delete or truncate on admin_audit
  for each statement execute function admin_audit_immutable();

create function record_admin_deletion() returns trigger language plpgsql as $$
declare
  actor uuid := nullif(current_setting('memegen.admin_actor_id', true), '')::uuid;
  old_row jsonb := to_jsonb(old);
begin
  if actor is null then return null; end if;
  if tg_op = 'UPDATE' and (old_row->>'deleted_at' is not null or to_jsonb(new)->>'deleted_at' is null) then return null; end if;
  -- Explicit allowlist: never copy complete rows, session data, storage credentials, or ranking internals.
  insert into admin_audit (actor_id, actor_name, action, target_kind, target_id, label, snapshot)
  values (actor, current_setting('memegen.admin_actor_name'),
    case when tg_op = 'UPDATE' then 'soft_delete' else 'delete' end,
    tg_table_name, old.id,
    left(coalesce(old_row->>'title', old_row->>'name', old_row->>'username', old_row->>'body', ''), 200),
    jsonb_build_object('ownerId', coalesce(old_row->>'owner_id', old_row->>'author_id', old_row->>'created_by'),
      'parentId', old_row->>'parent_id', 'memeId', old_row->>'meme_id', 'assetId', old_row->>'asset_id'));
  return null;
end $$;
create trigger admin_delete_audit after delete on memes for each row execute function record_admin_deletion();
create trigger admin_delete_audit after delete on templates for each row execute function record_admin_deletion();
create trigger admin_delete_audit after delete on comments for each row execute function record_admin_deletion();
create trigger admin_soft_delete_audit after update of deleted_at on comments for each row execute function record_admin_deletion();
create trigger admin_delete_audit after delete on tags for each row execute function record_admin_deletion();
create trigger admin_delete_audit after delete on stickers for each row execute function record_admin_deletion();
create trigger admin_delete_audit after delete on assets for each row execute function record_admin_deletion();
create trigger admin_delete_audit after delete on users for each row execute function record_admin_deletion();
