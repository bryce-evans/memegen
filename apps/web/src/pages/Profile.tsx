import { useParams, useSearchParams } from "react-router-dom";
import { badgesFor, type Meme, type Page, type Template } from "@memegen/shared";
import { Badge, EmptyState, Icon, PageHeader, SegmentedControl, Text } from "@memegen/ui";
import { getMyActivity, getMyFavorites, getUser, getUserMemes, getUserTemplates, type PageParams } from "../api.ts";
import { useUser } from "../auth.tsx";
import { ErrorView, LoadMoreButton } from "../components/common.tsx";
import { MemeFeed } from "../components/memes.tsx";
import { TemplateGrid } from "../components/templates.tsx";
import { useAsync } from "../useAsync.ts";
import { usePaged } from "../usePaged.ts";

/** Memes and Templates are public; Favorites and Recent activity (votes) are the owner's own. */
const PUBLIC_TABS = ["memes", "templates"] as const;
const PROFILE_TABS = [...PUBLIC_TABS, "favorites", "activity"] as const;
type ProfileTab = (typeof PROFILE_TABS)[number];
type MemeTab = Exclude<ProfileTab, "templates">;
const TAB_LABELS: Record<ProfileTab, string> = {
  memes: "Memes",
  templates: "Templates",
  favorites: "Favorites",
  activity: "Recent activity",
};
const LOADERS: Record<Exclude<MemeTab, "memes">, (page: PageParams) => Promise<Page<Meme>>> = {
  favorites: getMyFavorites,
  activity: getMyActivity,
};

export function Profile() {
  const { username = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const user = useUser();
  const { data: profile, error } = useAsync(username, () => getUser(username));
  const isOwner = user.username === username;
  const tabs: readonly ProfileTab[] = isOwner ? PROFILE_TABS : PUBLIC_TABS;
  const tabParam = params.get("tab");
  const tab: ProfileTab = tabs.find((t) => t === tabParam) ?? "memes";

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
      <SegmentedControl
        aria-label="Show"
        className="profile-tabs"
        value={tab}
        onChange={(next) => setParams(next === "memes" ? {} : { tab: next })}
        options={tabs.map((t) => ({ value: t, label: TAB_LABELS[t], testId: `profile-tab-${t}` }))}
      />
      {tab === "templates" ? (
        <ProfileTemplates username={username} editable={isOwner} />
      ) : (
        <ProfileMemes username={username} tab={tab} />
      )}
    </section>
  );
}

function ProfileMemes({ username, tab }: { username: string; tab: MemeTab }) {
  const memes = usePaged<Meme>(`${username}:${tab}`, (offset) =>
    tab === "memes" ? getUserMemes(username, { offset }) : LOADERS[tab]({ offset }),
  );
  return <MemeFeed list={memes} data-tab={tab} />;
}

/** Templates the user added; on their own profile each one opens in the template editor. */
function ProfileTemplates({ username, editable }: { username: string; editable: boolean }) {
  const templates = usePaged<Template>(username, (offset) => getUserTemplates(username, { offset }));
  return (
    <>
      <TemplateGrid
        list={templates}
        editable={editable}
        empty={<EmptyState icon={<Icon name="image" />} title="No templates yet." />}
        data-testid="profile-templates"
      />
      <LoadMoreButton hasMore={templates.hasMore} loading={templates.loading} onLoadMore={templates.loadMore} label="More templates" />
    </>
  );
}
