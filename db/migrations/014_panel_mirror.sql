-- Multi-panel content gained `mirror` (image before its caption). Panels stored before it put the caption first.
update templates set panels = jsonb_build_object('mirror', false) || panels where panels is not null;
update memes set panels = jsonb_build_object('mirror', false) || panels where panels is not null;
