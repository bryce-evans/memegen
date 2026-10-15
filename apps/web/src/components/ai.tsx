import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AI_PROMPT_MAX_LENGTH, AI_PROVIDERS, extensionForMime, IMAGE_ACCEPT, type AiProviderId, type UploadLimits } from "@memegen/shared";
import { Badge, Button, FileButton, Icon, Inline, Panel, SelectField, Stack, Text, TextArea, TextField } from "@memegen/ui";
import { generateAiImage, uploadAsset } from "../api.ts";
import { useAiKeys } from "../aiKeys.ts";
import { useUser } from "../auth.tsx";
import { fileSlug, precheckStillImage } from "../media.ts";
import { useAction } from "../useAction.ts";
import { ErrorView } from "./common.tsx";

/** A blob's object URL for `<img>`, revoked when the blob changes or the component unmounts. */
function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return setUrl(null);
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

/** Profile (owner only): connect AI image providers with the user's own API keys, kept in this browser. */
export function AiKeysPanel() {
  const user = useUser();
  const [keys, setKey] = useAiKeys(user.id);
  const [drafts, setDrafts] = useState<Partial<Record<AiProviderId, string>>>({});

  return (
    <Panel heading="AI image providers" data-testid="ai-keys">
      <Text tone="muted">
        Add your own API key to generate images from a prompt and a background on the Create page. Keys stay in this
        browser and are sent only with your AI requests; memegen never stores them.
      </Text>
      <Stack>
        {AI_PROVIDERS.map((p) => {
          const connected = Boolean(keys[p.id]);
          const draft = drafts[p.id] ?? "";
          return (
            <form
              key={p.id}
              className="ai-key-row"
              onSubmit={(e) => {
                e.preventDefault();
                setKey(p.id, draft);
                setDrafts((d) => ({ ...d, [p.id]: "" }));
              }}
            >
              <Inline>
                <Text as="span">{p.label}</Text>
                <Badge tone={connected ? "success" : "neutral"} data-testid={`ai-key-status-${p.id}`} data-connected={connected}>
                  {connected ? "Connected" : "Not connected"}
                </Badge>
                <a href={p.keyUrl} target="_blank" rel="noreferrer">
                  Get a key
                </a>
              </Inline>
              <Inline>
                <TextField
                  type="password"
                  autoComplete="off"
                  aria-label={`${p.label} API key`}
                  placeholder={connected ? "Replace key…" : "Paste API key…"}
                  value={draft}
                  onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                  data-testid={`ai-key-input-${p.id}`}
                />
                <Button type="submit" disabled={!draft.trim()} data-testid={`ai-key-save-${p.id}`}>
                  Save
                </Button>
                {connected && (
                  <Button variant="quiet" onClick={() => setKey(p.id, null)} data-testid={`ai-key-remove-${p.id}`}>
                    Remove
                  </Button>
                )}
              </Inline>
            </form>
          );
        })}
      </Stack>
    </Panel>
  );
}

/**
 * Create page: a prompt and a background image go to the chosen provider (the user's own key); a result the user
 * keeps is uploaded and opens in the Template Editor, like any new template media.
 */
export function AiImageForm({ limits }: { limits: UploadLimits | null }) {
  const user = useUser();
  const navigate = useNavigate();
  const [keys] = useAiKeys(user.id);
  const [provider, setProvider] = useState<AiProviderId>(() => AI_PROVIDERS.find((p) => keys[p.id])?.id ?? AI_PROVIDERS[0].id);
  const [background, setBackground] = useState<File | null>(null);
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<Blob | null>(null);
  const backgroundUrl = useObjectUrl(background);
  const resultUrl = useObjectUrl(result);
  const pick = useAction();
  const generate = useAction();
  const use = useAction();
  const apiKey = keys[provider];

  function choose(file: File, caps: UploadLimits) {
    void pick.run(async () => {
      await precheckStillImage(file, caps);
      setBackground(file);
    });
  }

  function run(image: Blob, key: string) {
    setResult(null);
    void generate.run(async (signal) => setResult(await generateAiImage({ provider, prompt }, image, key, signal)));
  }

  function keep(image: Blob) {
    void use.run(async (signal) => {
      // The Template Editor names a new template after its file, so the file is named after the prompt.
      const asset = await uploadAsset(image, `${fileSlug(prompt)}${extensionForMime(image.type) ?? ".png"}`, undefined, signal);
      navigate(`/create?newTemplate=${asset.id}`);
    });
  }

  return (
    <Panel heading="AI image" className="upload-form" data-testid="ai-image">
      <Text tone="muted">Describe a change to a background image and use the result as a new template.</Text>
      <Stack>
        <SelectField
          label="Provider"
          value={provider}
          onChange={(e) => setProvider(AI_PROVIDERS.find((p) => p.id === e.target.value)?.id ?? provider)}
          data-testid="ai-provider"
        >
          {AI_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
              {keys[p.id] ? "" : " (no key)"}
            </option>
          ))}
        </SelectField>
        {!apiKey && (
          <Text size="sm" tone="muted" data-testid="ai-no-key">
            <Link to={`/u/${encodeURIComponent(user.username)}?tab=ai`}>Add your API key</Link> in your profile to use this provider.
          </Text>
        )}
        <Inline>
          <FileButton
            icon={<Icon name="image" />}
            accept={IMAGE_ACCEPT}
            disabled={!limits || pick.busy}
            data-testid="ai-background-file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file && limits) choose(file, limits);
            }}
          >
            {background ? "Change background" : "Background image"}
          </FileButton>
          {backgroundUrl && <img src={backgroundUrl} alt="Background" className="ai-thumb" data-testid="ai-background" />}
        </Inline>
        {pick.error !== null && <ErrorView error={pick.error} testId="ai-background-error" />}
        <TextArea
          label="Prompt"
          rows={3}
          maxLength={AI_PROMPT_MAX_LENGTH}
          placeholder="Put a party hat on the dog"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          data-testid="ai-prompt"
        />
        <Inline>
          <Button
            variant="primary"
            icon={<Icon name="sparkle" />}
            disabled={!background || !apiKey || !prompt.trim() || generate.busy}
            onClick={() => background && apiKey && run(background, apiKey)}
            data-testid="ai-generate"
          >
            {generate.busy ? "Generating…" : result ? "Generate again" : "Generate"}
          </Button>
          {generate.busy && (
            <Button variant="quiet" onClick={generate.cancel} data-testid="ai-cancel">
              Cancel
            </Button>
          )}
        </Inline>
        {generate.error !== null && <ErrorView error={generate.error} testId="ai-error" />}
        {result && resultUrl && (
          <>
            <img src={resultUrl} alt="Generated" className="ai-result" data-testid="ai-result" />
            <Inline>
              <Button variant="primary" icon={<Icon name="check" />} disabled={use.busy} onClick={() => keep(result)} data-testid="ai-use-result">
                {use.busy ? "Uploading…" : "Use as template"}
              </Button>
            </Inline>
            {use.error !== null && <ErrorView error={use.error} testId="ai-use-error" />}
          </>
        )}
      </Stack>
    </Panel>
  );
}
