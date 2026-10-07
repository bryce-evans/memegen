-- Multi-panel content gained `grid` (draw the black rules between captions and images) and `fontSize` (max caption
-- size in units). Panels stored before them were drawn with the grid at 0.16, so they keep exactly that look.
update templates set panels = jsonb_build_object('grid', true, 'fontSize', 0.16) || panels where panels is not null;
update memes set panels = jsonb_build_object('grid', true, 'fontSize', 0.16) || panels where panels is not null;
