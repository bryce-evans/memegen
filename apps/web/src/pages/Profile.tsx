import { useParams, useSearchParams } from "react-router-dom";
import { badgesFor, type Meme, type Page } from "@memegen/shared";
import { Badge, PageHeader, SegmentedControl, Text } from "@memegen/ui";
import { getMyActivity, getMyFavorites, getUser, getUserMemes, type PageParams } from "../api.ts";
import { useAuth } from "../auth.tsx";
import { ErrorView } from "../components/common.tsx";
import { MemeFeed } from "../components/memes.tsx";
import { useAsync } from "../useAsync.ts";
import { usePaged } from "../usePaged.ts";

const PROFILE_TABS = ["memes", "favorites", "activity"] as const;
type ProfileTab = (typeof PROFILE_TABS)[number];
const TAB_LABELS: Record<ProfileTab, string> = { memes: "Memes", favorites: "Favorites", activity: "Recent activity" };
const LOADERS: Record<Exclude<ProfileTab, "memes">, (page: PageParams) => Promise<Page<Meme>>> = {
  favorites: getMyFavorites,
  activity: getMyActivity,
};

export function Profile() {
  const { username = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const { data: profile, error } = useAsync(username, () => getUser(username));
  // Favorites and recent activity (votes) are the owner's own; everyone else only sees the memes tab.
  const isOwner = user?.username === username;
  const tabParam = params.get("tab");
  const tab: ProfileTab = (isOwner && PROFILE_TABS.find((t) => t === tabParam)) || "memes";
  const memes = usePaged<Meme>(`${username}:${tab}:${user?.id ?? ""}`, (offset) =>
    tab === "memes" ? getUserMemes(username, { offset }) : LOADERS[tab]({ offset }),
  );

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
            <div>
              <dt title="Public templates this user added, variations included">Templates</dt>
              <dd data-testid="stat-template-count">{profile.templateCount}</dd>
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
      <MemeFeed list={memes} data-tab={tab} />
    </section>
  );
}
