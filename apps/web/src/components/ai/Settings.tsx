import { useState } from "react";
import { AI_PROVIDERS, type AiProviderId } from "@memegen/shared";
import { Button, Inline, NavItem, NavList, Panel, SelectField, Stack, Text, TextField } from "@memegen/ui";
import { ROLE_PROVIDER_IDS, useAiSettings, validModel, type AiConfig, type AiRole } from "../../aiSettings.ts";
import { useUser } from "../../auth.tsx";
/** The settings' two roles, in sidebar order, with what each is for. */
const ROLES: { role: AiRole; label: string; description: string }[] = [
  {
    role: "text",
    label: "Agent Provider",
    description:
      "The Agent Provider writes your memes in the Quick Creator on the Create page. It can also invoke the Image Generator to make changes to the image itself.",
  },
  {
    role: "image",
    label: "Image Generator",
    description: "The Image Generator is used for AI edits to images. It is invoked via the Agent Provider, but can be a separate provider.",
  },
];

const providerLabel = (config: AiConfig | null) => AI_PROVIDERS.find((p) => p.id === config?.provider)?.label;

/**
 * Profile (owner only): the user's two AI settings, the Agent Provider and the Image Generator, each a provider, the
 * user's own API key, and an optional model, kept in this browser. The sidebar picks one; the form edits it.
 */
export function AiAgentsPanel() {
  const user = useUser();
  const { settings, save } = useAiSettings(user.id);
  const [role, setRole] = useState<AiRole>("text");
  const description = ROLES.find((r) => r.role === role)!.description;

  return (
    <Panel heading="API Keys" data-testid="ai-agents">
      <Text tone="muted">API keys stay in this browser and are sent only with your AI requests. Memegen never stores them.</Text>
      <div className="ai-settings">
        <NavList className="ai-settings-roles" aria-label="AI settings">
          {ROLES.map((r) => (
            <NavItem
              key={r.role}
              as="button"
              type="button"
              className="ai-settings-role"
              active={role === r.role}
              aria-pressed={role === r.role}
              onClick={() => setRole(r.role)}
              data-testid={`ai-role-${r.role}`}
              data-set={settings[r.role] !== null}
            >
              {r.label}: {providerLabel(settings[r.role]) ?? "UNSET"}
            </NavItem>
          ))}
        </NavList>
        {role === "text" ? (
          <AiConfigForm
            key="text"
            label="Agent Provider"
            description={description}
            providers={ROLE_PROVIDER_IDS.text}
            current={settings.text}
            onSave={(c) => save("text", c)}
          />
        ) : (
          <AiConfigForm
            key="image"
            label="Image Generator"
            description={description}
            providers={ROLE_PROVIDER_IDS.image}
            current={settings.image}
            onSave={(c) => save("image", c)}
          />
        )}
      </div>
    </Panel>
  );
}

/** One role's provider (from those the role may use), key (blank keeps the stored one), and model; Clear unsets it. */
function AiConfigForm<P extends AiProviderId>({
  label,
  description,
  providers,
  current,
  onSave,
}: {
  label: string;
  /** What the role is for, shown above its fields. */
  description: string;
  providers: readonly P[];
  current: AiConfig<P> | null;
  onSave: (config: AiConfig<P> | null) => void;
}) {
  const options = AI_PROVIDERS.filter((p) => (providers as readonly AiProviderId[]).includes(p.id));
  const [provider, setProvider] = useState<P>(current?.provider ?? providers[0]!);
  const [key, setKey] = useState("");
  const [model, setModel] = useState(current?.model ?? "");
  const info = options.find((p) => p.id === provider) ?? options[0]!;
  const apiKey = key.trim() || current?.apiKey || "";
  const valid = apiKey !== "" && validModel(model);

  return (
    <form
      className="ai-settings-form"
      aria-label={label}
      data-testid="ai-config-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onSave({ provider, apiKey, model: model.trim() });
        setKey("");
      }}
    >
      <Stack>
        <Text tone="muted" data-testid="ai-role-description">
          {description}
        </Text>
        <SelectField
          label="Provider"
          value={provider}
          onChange={(e) => setProvider(providers.find((p) => p === e.target.value) ?? provider)}
          data-testid="ai-config-provider"
        >
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </SelectField>
        <TextField
          type="password"
          autoComplete="off"
          label="API key"
          placeholder={current ? "Keep the current key…" : "Paste API key…"}
          description={
            <a href={info.keyUrl} target="_blank" rel="noreferrer">
              Get an API key from {info.label}
            </a>
          }
          value={key}
          onChange={(e) => setKey(e.target.value)}
          data-testid="ai-config-key"
        />
        <TextField
          label="Model"
          placeholder="Provider default"
          value={model}
          error={validModel(model) ? undefined : "Letters, digits, and . _ : - only"}
          onChange={(e) => setModel(e.target.value)}
          data-testid="ai-config-model"
        />
        <Inline>
          <Button type="submit" variant="primary" disabled={!valid} data-testid="ai-config-save">
            Save
          </Button>
          {current && (
            <Button
              variant="quiet"
              onClick={() => {
                onSave(null);
                setKey("");
                setModel("");
              }}
              data-testid="ai-config-clear"
            >
              Clear
            </Button>
          )}
        </Inline>
      </Stack>
    </form>
  );
}
