import { useState, type FormEvent } from "react";
import { Button, Panel, SelectField, SkinSwitcher, Spinner, Stack, Text, TextField, Wordmark } from "@memegen/ui";
import { useAuth } from "../auth.tsx";
import { ErrorView } from "../components/common.tsx";
import { Intro } from "../components/Intro.tsx";
import { useIntroChoice } from "../introChoice.ts";
import { INTROS, type IntroKind } from "../intros.ts";
import { DEV_MODE } from "../mode.ts";
import { useAction } from "../useAction.ts";

/** Shown at every URL while signed out; authentication never changes the requested local route. */
export function SignIn({ brand }: { brand: string }) {
  const { intro, setIntro } = useIntroChoice();
  const { config, loading, error, retry } = useAuth();
  return (
    <main className="sign-in-page" data-testid="sign-in-page">
      <Intro kind={intro}>
        <Panel className="sign-in" data-testid="sign-in-card">
          <Stack gap="lg" align="center">
            <Wordmark text={brand} />
            {loading ? (
              <Stack align="center" data-testid="auth-loading">
                <Spinner />
                <Text>Checking sign-in…</Text>
              </Stack>
            ) : error !== null ? (
              <Stack gap="sm">
                <ErrorView error={error} testId="auth-error" />
                <Text>Unable to check authentication. Retry, or contact your administrator if this continues.</Text>
                <Button onClick={retry} data-testid="auth-retry">Retry sign-in setup</Button>
              </Stack>
            ) : config?.mode === "dev" ? <LoginForm /> : config?.mode === "oidc" ? <SsoSignIn /> : null}
          </Stack>
        </Panel>
      </Intro>
      {DEV_MODE && (
        <Panel className="dev-tools" heading="Dev tools" data-testid="dev-tools">
          <Stack gap="sm">
            <SkinSwitcher data-testid="dev-skin" />
            <SelectField
              size="sm"
              aria-label="Intro"
              value={intro}
              onChange={(e) => setIntro(e.target.value as IntroKind)}
              data-testid="dev-intro"
            >
              {INTROS.map((kind) => (
                <option key={kind} value={kind}>
                  Intro: {kind}
                </option>
              ))}
            </SelectField>
          </Stack>
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
      <Button type="submit" variant="special" size="md" disabled={busy} data-testid="login-submit">
        Sign in
      </Button>
      {error !== null && <ErrorView error={error} />}
    </form>
  );
}

function SsoSignIn() {
  function signIn() {
    const { pathname, search, hash, origin } = window.location;
    let returnTo = `${pathname}${search}${hash}`;
    try {
      const decoded = decodeURIComponent(returnTo);
      if (!returnTo.startsWith("/") || decoded.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(decoded)
        || new URL(returnTo, origin).origin !== origin) returnTo = "/";
    } catch {
      returnTo = "/";
    }
    window.location.assign(`/api/auth/login?${new URLSearchParams({ returnTo })}`);
  }

  return (
    <Button variant="special" size="md" onClick={signIn} data-testid="sso-sign-in">
      Sign in with SSO
    </Button>
  );
}
