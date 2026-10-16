import { useState } from "react";
import { Spinner } from "@memegen/ui";
import { getLimits } from "../../api.ts";
import { useAsync } from "../../useAsync.ts";
import { AiImageForm } from "../ai.tsx";
import { ErrorView } from "../common.tsx";
import { AddContent, HotTemplates, TemplateBrowser } from "../templateBrowse.tsx";

/**
 * `/create` without a source, as floating cards on the page itself (no main sheet or page title): Upload, the AI
 * image form, Hot templates, then all templates.
 */
export function CreateStart() {
  const limits = useAsync("limits", getLimits);
  const [templateSearch, setTemplateSearch] = useState("");

  return (
    <section className="editor-start create-start">
      {limits.loading && <Spinner label="Loading…" />}
      {limits.error !== null && <ErrorView error={limits.error} testId="editor-error" />}
      <AddContent limits={limits.data} />
      <AiImageForm limits={limits.data} />
      <HotTemplates />
      <TemplateBrowser search={templateSearch} onSearchChange={setTemplateSearch} />
    </section>
  );
}
