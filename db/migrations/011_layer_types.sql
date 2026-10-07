-- Layers became a union tagged by `type`: "text" (captions) or "image" (a still image asset drawn over the
-- media). Every layer stored before that is a text layer, so tag each one in place, keeping layer order (it is
-- the draw order). Layers that somehow already carry a `type` keep it.
update memes set layers = (
    select jsonb_agg(jsonb_build_object('type', 'text') || l order by i)
    from jsonb_array_elements(layers) with ordinality as e(l, i)
  )
  where jsonb_array_length(layers) > 0;
update templates set default_layers = (
    select jsonb_agg(jsonb_build_object('type', 'text') || l order by i)
    from jsonb_array_elements(default_layers) with ordinality as e(l, i)
  )
  where jsonb_array_length(default_layers) > 0;
