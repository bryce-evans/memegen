import { useState } from "react";
import { PageHeader, Spinner } from "@memegen/ui";
import { getLimits } from "../../api.ts";
import { useAsync } from "../../useAsync.ts";
import { ErrorView } from "../common.tsx";
import { HotTemplates, NewTemplateForm, TemplateBrowser } from "../templateBrowse.tsx";

/** `/create` without a source: hot templates, upload a new template, or browse all templates. */
export function CreateStart() {
  const limits = useAsync("limits", getLimits);
  const [templateSearch, setTemplateSearch] = useState("");

  return (
    <section className="editor-start">
      <PageHeader title="Create a meme" />
      <div className="create-top">
        <HotTemplates />
        <div className="create-upload">
          <NewTemplateForm limits={limits.data} />
        </div>
      </div>
      {limits.loading && <Spinner label="Loading…" />}
      {limits.error !== null && <ErrorView error={limits.error} testId="editor-error" />}
      <TemplateBrowser search={templateSearch} onSearchChange={setTemplateSearch} />
    </section>
  );
}
