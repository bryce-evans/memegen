import { useParams, useSearchParams } from "react-router-dom";
import type { Meme, Page, Template } from "@memegen/shared";
import { EmptyState, Icon, PageHeader, SegmentedControl, Stat, StatGroup, Text } from "@memegen/ui";
import { getMyActivity, getMyFavorites, getUser, getUserMemes, getUserTemplates, type PageParams } from "../api.ts";
import { useUser } from "../auth.tsx";
import { ErrorView } from "../components/common.tsx";
import { MemeFeed } from "../components/memes.tsx";
import { TemplateGrid } from "../components/templates.tsx";
import { STAT_HINTS, STAT_LABELS, UserBadges } from "../components/users.tsx";
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

  return (
    <section>
      <header className="profile-head">
        <PageHeader title={`@${username}`} />
        {profile && (
          <StatGroup className="profile-stats">
            <Stat label={STAT_LABELS.memeCount} value={profile.stats.memeCount} valueProps={{ "data-testid": "stat-meme-count" }} />
            <Stat label={STAT_LABELS.highScore} value={profile.stats.highScore} valueProps={{ "data-testid": "stat-high-score" }} />
            <Stat
              label={STAT_LABELS.hScore}
              hint={STAT_HINTS.hScore}
              value={profile.stats.hScore}
              valueProps={{ "data-testid": "stat-h-score" }}
            />
            <Stat
              label="Templates"
              hint="Public templates this user added, variations included"
              value={profile.templateCount}
              valueProps={{ "data-testid": "stat-template-count" }}
            />
          </StatGroup>
        )}
        {profile && <UserBadges stats={profile.stats} />}
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
    <TemplateGrid
      list={templates}
      editable={editable}
      empty={<EmptyState icon={<Icon name="image" />} title="No templates yet." />}
      paging="button"
      data-testid="profile-templates"
    />
  );
}
