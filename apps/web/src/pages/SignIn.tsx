import { Panel, Stack, Text, Wordmark } from "@memegen/ui";
import { LoginForm } from "../components/common.tsx";

/** Shown at every URL while signed out; the app replaces it in place once a user is stored. */
export function SignIn({ brand }: { brand: string }) {
  return (
    <main className="sign-in-page" data-testid="sign-in-page">
      <Panel className="sign-in">
        <Stack gap="lg" align="center">
          <Wordmark text={brand} />
          <Text size="sm">Sign in with any username to continue. (Dev login: no password yet.)</Text>
          <LoginForm />
        </Stack>
      </Panel>
    </main>
  );
}
