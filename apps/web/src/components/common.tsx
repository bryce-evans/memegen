import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Asset } from "@memegen/shared";
import { Alert, Button, TextField } from "@memegen/ui";
import { ApiError, contentUrl } from "../api.ts";
import { useAuth } from "../auth.tsx";

/** `inHeader` marks the header instance, which carries the e2e test ids (prompts elsewhere reuse the form). */
export function LoginForm({ inHeader = false }: { inHeader?: boolean }) {
  const { signIn } = useAuth();
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(username.trim());
      setUsername("");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={inHeader ? "login login-compact" : "login"} onSubmit={submit}>
      <TextField
        size={inHeader ? "sm" : "md"}
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="username"
        aria-label="Username"
        autoComplete="username"
        data-testid={inHeader ? "login-username" : undefined}
      />
      <Button
        type="submit"
        variant="primary"
        size={inHeader ? "sm" : "md"}
        disabled={busy || !username.trim()}
        data-testid={inHeader ? "login-submit" : undefined}
      >
        Sign in
      </Button>
      {error !== null && <ErrorView error={error} />}
    </form>
  );
}

export function SignInPrompt({ action = "do that" }: { action?: string }) {
  return (
    <Alert tone="info">
      <p>Sign in to {action}. (Dev login: pick any username.)</p>
      <LoginForm />
    </Alert>
  );
}

/** Renders any thrown value; API 401s become a sign-in prompt, `details[]` are listed. */
export function ErrorView({ error, testId }: { error: unknown; testId?: string }) {
  if (error instanceof ApiError && error.status === 401) return <SignInPrompt />;
  const message = error instanceof Error ? error.message : String(error);
  const details = error instanceof ApiError ? error.details : [];
  return (
    <Alert tone="error" data-testid={testId}>
      <strong>{message}</strong>
      {details.length > 0 && (
        <ul>
          {details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
    </Alert>
  );
}

export function MediaView({ asset, alt, testId }: { asset: Asset; alt: string; testId?: string }) {
  if (asset.kind === "video") {
    return <video data-testid={testId} src={contentUrl(asset)} muted loop autoPlay playsInline aria-label={alt} />;
  }
  return <img data-testid={testId} src={contentUrl(asset)} alt={alt} loading="lazy" />;
}

/**
 * Invisible marker at the end of an auto-loading list: calls `onLoadMore` while it is in (or near) the viewport.
 * The observer is rebuilt after every page, and a fresh observer reports the current intersection right away,
 * so a short page that leaves the marker on screen keeps loading until it scrolls away or the list ends.
 */
export function LoadMoreSentinel({ hasMore, loading, onLoadMore }: { hasMore: boolean; loading: boolean; onLoadMore: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const loadRef = useRef(onLoadMore);
  loadRef.current = onLoadMore;

  useEffect(() => {
    const el = ref.current;
    if (!el || !hasMore || loading) return;
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && loadRef.current(), {
      rootMargin: "0px 0px 200px 0px",
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading]);

  if (!hasMore) return null;
  return <div ref={ref} className="load-more-sentinel" data-testid="load-more-sentinel" aria-hidden />;
}
