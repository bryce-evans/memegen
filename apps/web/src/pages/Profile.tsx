import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { badgesFor, type Meme } from "@memegen/shared";
import { Badge, Button, PageHeader, SegmentedControl, Spinner, Text } from "@memegen/ui";
import { getMyVotes, getUser, getUserMemes, type UserProfile } from "../api.ts";
import { useAuth } from "../auth.tsx";
import { ErrorView } from "../components/common.tsx";
import { MemeGrid } from "../components/memes.tsx";
import { usePaged } from "../usePaged.ts";

const PROFILE_TABS = ["memes", "liked", "disliked"] as const;
type ProfileTab = (typeof PROFILE_TABS)[number];
const TAB_LABELS: Record<ProfileTab, string> = { memes: "Memes", liked: "Liked", disliked: "Disliked" };

export function Profile() {
  const { username = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<unknown>(null);
  // Liked/disliked are the owner's private activity; everyone else only sees the memes tab.
  const isOwner = user?.username === username;
  const tabParam = params.get("tab");
  const tab: ProfileTab = (isOwner && PROFILE_TABS.find((t) => t === tabParam)) || "memes";
  const memes = usePaged<Meme>(`${username}:${tab}:${user?.id ?? ""}`, (offset) =>
    tab === "memes" ? getUserMemes(username, offset) : getMyVotes(tab === "liked" ? "up" : "down", offset),
  );

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

  const badges = profile ? badgesFor(profile.stats) : [];

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
        {badges.length > 0 && (
          <ul className="profile-badges" aria-label="Badges">
            {badges.map((b) => (
              <li key={b.id}>
                <Badge tone="warning" title={b.description} data-testid="profile-badge" data-badge={b.id}>
                  <span aria-hidden>{b.icon}</span> {b.label}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        {profile && <Text tone="muted">Joined {new Date(profile.user.createdAt).toLocaleDateString()}</Text>}
      </header>
      {isOwner && (
        <SegmentedControl
          aria-label="Show"
          className="profile-tabs"
          value={tab}
          onChange={(next) => setParams(next === "memes" ? {} : { tab: next })}
          options={PROFILE_TABS.map((t) => ({ value: t, label: TAB_LABELS[t], testId: `profile-tab-${t}` }))}
        />
      )}
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
