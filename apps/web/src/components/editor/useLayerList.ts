import { useMemo, useReducer } from "react";
import { moveLayer, newTopSectionLayer, topSectionLayer, type Layer } from "@memegen/shared";

interface LayerList {
  layers: Layer[];
  selectedId: string | null;
}

type LayerListAction =
  | { type: "select"; id: string | null }
  | { type: "update"; id: string; update: (layer: Layer) => Layer }
  /** Append `layer` (drawn on top) and select it. */
  | { type: "add"; layer: Layer }
  /** Insert the top section's text as layer 0 and select it, unless there already is one. */
  | { type: "add-top-section"; layer: Layer }
  | { type: "remove"; id: string }
  /** Remove the top section's text, and with it the band. */
  | { type: "remove-top-section" }
  | { type: "move"; id: string; delta: -1 | 1 };

function reduce(state: LayerList, action: LayerListAction): LayerList {
  switch (action.type) {
    case "select":
      return { ...state, selectedId: action.id };
    case "update":
      return { ...state, layers: state.layers.map((l) => (l.id === action.id ? action.update(l) : l)) };
    case "add":
      return { layers: [...state.layers, action.layer], selectedId: action.layer.id };
    case "add-top-section":
      if (topSectionLayer(state.layers)) return state;
      return { layers: [action.layer, ...state.layers], selectedId: action.layer.id };
    case "remove":
    case "remove-top-section": {
      const id = action.type === "remove" ? action.id : topSectionLayer(state.layers)?.id;
      if (id === undefined) return state;
      return { layers: state.layers.filter((l) => l.id !== id), selectedId: state.selectedId === id ? null : state.selectedId };
    }
    case "move":
      return { ...state, layers: moveLayer(state.layers, action.id, action.delta) };
  }
}

export interface LayerListEdits {
  select: (id: string | null) => void;
  update: (id: string, update: (layer: Layer) => Layer) => void;
  add: (layer: Layer) => void;
  remove: (id: string) => void;
  move: (id: string, delta: -1 | 1) => void;
  /** On adds the band's text as layer 0 (selected); off removes it, and with it the band. */
  setTopSection: (on: boolean) => void;
}

/** The media editor's layers and selection; the edits are stable across renders. */
export function useLayerList(initial: Layer[]): LayerList & LayerListEdits {
  const [state, dispatch] = useReducer(reduce, { layers: initial, selectedId: initial[0]?.id ?? null });
  const edits = useMemo<LayerListEdits>(
    () => ({
      select: (id) => dispatch({ type: "select", id }),
      update: (id, update) => dispatch({ type: "update", id, update }),
      add: (layer) => dispatch({ type: "add", layer }),
      remove: (id) => dispatch({ type: "remove", id }),
      move: (id, delta) => dispatch({ type: "move", id, delta }),
      setTopSection: (on) => {
        if (on) dispatch({ type: "add-top-section", layer: newTopSectionLayer() });
        else dispatch({ type: "remove-top-section" });
      },
    }),
    [],
  );
  return { ...state, ...edits };
}
