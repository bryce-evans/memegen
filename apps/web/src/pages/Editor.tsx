import { useLocation, useSearchParams } from "react-router-dom";
import { aiCaptionSchema, type AiCaption } from "@memegen/shared";
import { PageHeader, Spinner } from "@memegen/ui";
import { ErrorView } from "../components/common.tsx";
import { CreateStart } from "../components/editor/CreateStart.tsx";
import { MediaWorkspace } from "../components/editor/MediaWorkspace.tsx";
import { PanelWorkspace } from "../components/editor/PanelWorkspace.tsx";
import { EDITOR_TITLES, sourceRef, useEditorSession, type SourceRef } from "../components/editor/session.ts";

/** The AI Creator's captions from history state (`{ captions }`); anything else (no state, stale shapes) is none. */
function stateCaptions(state: unknown): AiCaption[] | null {
  if (typeof state !== "object" || state === null || !("captions" in state)) return null;
  const parsed = aiCaptionSchema.array().safeParse(state.captions);
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
  return ref ? <EditorSession key={location.search} source={ref} captions={stateCaptions(location.state)} /> : <CreateStart />;
}

function EditorSession({ source, captions }: { source: SourceRef; captions: AiCaption[] | null }) {
  const { session, error } = useEditorSession(source, captions);
  if (session) return session.type === "panels" ? <PanelWorkspace session={session} /> : <MediaWorkspace session={session} />;
  return (
    <section className="editor-start">
      <PageHeader title={EDITOR_TITLES[source.kind]} />
      {error === null ? <Spinner label="Loading…" /> : <ErrorView error={error} testId="editor-error" />}
    </section>
  );
}
