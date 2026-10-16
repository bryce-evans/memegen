import { useLocation, useSearchParams } from "react-router-dom";
import { layersSchema, type Layer } from "@memegen/shared";
import { PageHeader, Spinner } from "@memegen/ui";
import { ErrorView } from "../components/common.tsx";
import { CreateStart } from "../components/editor/CreateStart.tsx";
import { MediaWorkspace } from "../components/editor/MediaWorkspace.tsx";
import { PanelWorkspace } from "../components/editor/PanelWorkspace.tsx";
import { EDITOR_TITLES, sourceRef, useEditorSession, type SourceRef } from "../components/editor/session.ts";

/** The Quick Creator's edited layers from history state (`{ layers }`); anything else (no state, stale shapes) is none. */
function stateLayers(state: unknown): Layer[] | null {
  if (typeof state !== "object" || state === null || !("layers" in state)) return null;
  const parsed = layersSchema.safeParse(state.layers);
  return parsed.success ? parsed.data : null;
}

/**
 * `/create`: the start page, or the editor for `?meme=` / `?template=` / `?newTemplate=` / `?editTemplate=` /
 * `?newPanels`. Multi-panel templates (and memes made from them) open the panel editor.
 */
export function Editor() {
  const location = useLocation();
  const [params] = useSearchParams();
  const ref = sourceRef(params);
  // Remount whenever the query string changes (new template/meme/upload).
  return ref ? <EditorSession key={location.search} source={ref} aiLayers={stateLayers(location.state)} /> : <CreateStart />;
}

function EditorSession({ source, aiLayers }: { source: SourceRef; aiLayers: Layer[] | null }) {
  const { session, error } = useEditorSession(source, aiLayers);
  if (session) return session.type === "panels" ? <PanelWorkspace session={session} /> : <MediaWorkspace session={session} />;
  return (
    <section className="editor-start">
      <PageHeader title={EDITOR_TITLES[source.kind]} />
      {error === null ? <Spinner label="Loading…" /> : <ErrorView error={error} testId="editor-error" />}
    </section>
  );
}
