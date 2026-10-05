import { useEffect, useRef, useState, type ComponentPropsWithoutRef, type FormEvent } from "react";
import type { Asset } from "@memegen/shared";
import { Alert, Button, TextField } from "@memegen/ui";
import { ApiError, contentUrl } from "../api.ts";
import { useAuth } from "../auth.tsx";
import { timeAgo } from "../time.ts";
import { useAction } from "../useAction.ts";

/** The sign-in page's form (dev login: any username). */
export function LoginForm() {
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

/**
 * Renders any thrown value, listing `details[]`. A 401 needs no special case: `api.ts` signs out on one, which swaps
 * the app for the sign-in page.
 */
export function ErrorView({ error, testId }: { error: unknown; testId?: string }) {
  const message = error instanceof Error ? error.message : String(error);
  const details = error instanceof ApiError ? error.details : [];
  return (
    <Alert tone="danger" data-testid={testId}>
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

/** An asset as `<img>` or (muted, looping) `<video>`; `controls` adds the video's native controls. */
export function MediaView({ asset, alt, testId, controls }: { asset: Asset; alt: string; testId?: string; controls?: boolean }) {
  if (asset.kind === "video") {
    return (
      <video data-testid={testId} src={contentUrl(asset)} controls={controls} muted loop autoPlay playsInline aria-label={alt} />
    );
  }
  return <img data-testid={testId} src={contentUrl(asset)} alt={alt} loading="lazy" />;
}

/** Relative time ("3m ago") with the full local date and time as its tooltip. */
export function TimeAgo({ iso, ...rest }: { iso: string } & Omit<ComponentPropsWithoutRef<"time">, "dateTime" | "title" | "children">) {
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString()} {...rest}>
      {timeAgo(iso)}
    </time>
  );
}

interface LoadMoreProps {
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
}

/**
 * Click-to-page: meme feeds (the e2e `loadAll` helper drives their `load-more` button) and lists with more
 * content after them (a section below, a comment form), which auto-loading would keep pushing away. A list that
 * ends the page uses `LoadMoreSentinel` instead.
 */
export function LoadMoreButton({ hasMore, loading, onLoadMore, label = "Load more", testId }: LoadMoreProps & { label?: string; testId?: string }) {
  if (!hasMore || loading) return null;
  return (
    <div className="load-more">
      <Button data-testid={testId} onClick={onLoadMore}>
        {label}
      </Button>
    </div>
  );
}

/**
 * Invisible marker at the end of an auto-loading list: calls `onLoadMore` while it is in (or near) the viewport.
 * The observer is rebuilt after every page, and a fresh observer reports the current intersection right away,
 * so a short page that leaves the marker on screen keeps loading until it scrolls away or the list ends.
 */
export function LoadMoreSentinel({ hasMore, loading, onLoadMore }: LoadMoreProps) {
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
