import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { Meme } from "@memegen/shared";
import { Button, PageHeader, Spinner, Text } from "@memegen/ui";
import { getUser, getUserMemes, type UserProfile } from "../api.ts";
import { useAuth } from "../auth.tsx";
import { ErrorView } from "../components/common.tsx";
import { MemeGrid } from "../components/memes.tsx";
import { usePaged } from "../usePaged.ts";

export function Profile() {
  const { username = "" } = useParams();
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<unknown>(null);
  const memes = usePaged<Meme>(`${username}:${user?.id ?? ""}`, (offset) => getUserMemes(username, offset));

  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    setError(null);
    getUser(username).then(
      (p) => !cancelled && setProfile(p),
      (err) => !cancelled && setError(err),
    );
    return () => {
      cancelled = true;
    };
  }, [username]);

  if (error !== null) return <ErrorView error={error} />;

  return (
    <section>
      <header className="profile-head">
        <PageHeader title={`@${username}`} />
        {profile && (
          <dl className="stats">
            <div>
              <dt>Memes</dt>
              <dd data-testid="stat-meme-count">{profile.stats.memeCount}</dd>
            </div>
            <div>
              <dt>High score</dt>
              <dd data-testid="stat-high-score">{profile.stats.highScore}</dd>
            </div>
            <div>
              <dt title="h memes with a score of at least h">h-score</dt>
              <dd data-testid="stat-h-score">{profile.stats.hScore}</dd>
            </div>
          </dl>
        )}
        {profile && <Text tone="muted">Joined {new Date(profile.user.createdAt).toLocaleDateString()}</Text>}
      </header>
      {memes.error !== null && <ErrorView error={memes.error} />}
      <div className="meme-feed" data-testid="meme-feed" aria-busy={memes.loading}>
        {!(memes.loading && memes.items.length === 0) && (
          <MemeGrid memes={memes.items} onChange={(m) => memes.setItems((items) => items.map((x) => (x.id === m.id ? m : x)))} />
        )}
        {memes.loading && <Spinner label="Loading…" />}
        {memes.hasMore && !memes.loading && (
          <div className="load-more">
            <Button data-testid="load-more" onClick={memes.loadMore}>
              Load more
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
