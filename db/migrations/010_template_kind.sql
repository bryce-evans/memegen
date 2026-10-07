-- Every template is one kind, fixed when it is created, and each kind has its own editor:
--   single: one still image with text boxes      gif: a GIF or video with (animated) text boxes
--   multi:  an image pack filled into panels (`panels` set)
alter table templates add column kind text;
update templates t set kind = case
    when t.panels is not null then 'multi'
    when a.kind = 'image' then 'single'
    else 'gif'
  end
  from assets a where a.id = t.asset_id;
alter table templates
  alter column kind set not null,
  add constraint templates_kind_check check (kind in ('single', 'multi', 'gif'));
create index templates_kind on templates (kind);

-- Classify on insert from what the template is made of, so every write path (API, seeds, scripts) agrees.
-- Never re-run on update: a template keeps its kind (a multi-panel template's cover asset is replaced on edit).
create function templates_classify() returns trigger language plpgsql as $$
begin
  new.kind := case
    when new.panels is not null then 'multi'
    when (select kind from assets where id = new.asset_id) = 'image' then 'single'
    else 'gif'
  end;
  return new;
end $$;
create trigger templates_classify before insert on templates
  for each row execute function templates_classify();
