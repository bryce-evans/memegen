import { useState, type FormEvent } from "react";
import { Button, Panel, SkinSwitcher, Stack, TextField, Wordmark } from "@memegen/ui";
import { useAuth } from "../auth.tsx";
import { ErrorView } from "../components/common.tsx";
import { IntroBurst } from "../components/IntroBurst.tsx";
import { DEV_MODE } from "../mode.ts";
import { useAction } from "../useAction.ts";

/** Shown at every URL while signed out; the app replaces it in place once a user is stored. */
export function SignIn({ brand }: { brand: string }) {
  return (
    <main className="sign-in-page" data-testid="sign-in-page">
      <IntroBurst />
      <Panel className="sign-in">
        <Stack gap="lg" align="center">
          <Wordmark text={brand} />
          {DEV_MODE ? <LoginForm /> : <SsoPlaceholder />}
        </Stack>
      </Panel>
      {DEV_MODE && (
        <Panel className="dev-tools" heading="Dev tools" data-testid="dev-tools">
          <SkinSwitcher data-testid="dev-skin" />
        </Panel>
      )}
    </main>
  );
}

/** Dev login: any username. */
function LoginForm() {
  const { signIn } = useAuth();
  const [username, setUsername] = useState("");
  const { busy, error, run } = useAction();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim()) return;
    void run(async () => {
      await signIn(username.trim());
      setUsername("");
    });
  }

  return (
    <form className="login" onSubmit={submit}>
      <TextField
        size="md"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="username"
        aria-label="Username"
        autoComplete="username"
        autoFocus
        data-testid="login-username"
      />
      <Button type="submit" variant="primary" size="md" disabled={busy || !username.trim()} data-testid="login-submit">
        Sign in
      </Button>
      {error !== null && <ErrorView error={error} />}
    </form>
  );
}

/** Prod has no identity provider yet. */
function SsoPlaceholder() {
  return (
    <Button
      variant="primary"
      size="md"
      onClick={() => alert("placeholder signin only, use dev mode")}
      data-testid="sso-sign-in"
    >
      Sign in with SSO
    </Button>
  );
}
