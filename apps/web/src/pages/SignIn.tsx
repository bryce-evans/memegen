import { Button, Panel, SkinSwitcher, Stack, Wordmark } from "@memegen/ui";
import { LoginForm } from "../components/common.tsx";
import { DEV_MODE } from "../mode.ts";

/** Shown at every URL while signed out; the app replaces it in place once a user is stored. */
export function SignIn({ brand }: { brand: string }) {
  return (
    <main className="sign-in-page" data-testid="sign-in-page">
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
