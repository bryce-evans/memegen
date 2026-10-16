import { useParams, useSearchParams } from "react-router-dom";
import type { Meme, Page, Template, UserProfile } from "@memegen/shared";
import { EmptyState, Icon, PageHeader, SegmentedControl, Spinner, Stat, StatGroup, Text } from "@memegen/ui";
import { getMyActivity, getMyFavorites, getUser, getUserMemes, getUserTemplates, type PageParams } from "../api.ts";
import { useUser } from "../auth.tsx";
import { AiAgentsPanel } from "../components/ai.tsx";
import { ErrorView } from "../components/common.tsx";
import { MemeFeed } from "../components/memes.tsx";
import { TemplateGrid } from "../components/templates.tsx";
import { STAT_HINTS, STAT_LABELS, UserBadges } from "../components/users.tsx";
import { useAsync } from "../useAsync.ts";
import { usePaged } from "../usePaged.ts";

/**
 * Two tab groups under the name: the account (Profile: stats and badges; AI agents, owner only), then the content
 * (Memes and Templates are public; Favorites and Recent activity (votes) are the owner's own).
 */
const ACCOUNT_TABS = ["profile", "ai"] as const;
const PUBLIC_CONTENT_TABS = ["memes", "templates"] as const;
const CONTENT_TABS = [...PUBLIC_CONTENT_TABS, "favorites", "activity"] as const;
type ProfileTab = (typeof ACCOUNT_TABS)[number] | (typeof CONTENT_TABS)[number];
type MemeTab = Exclude<ProfileTab, "profile" | "ai" | "templates">;
const TAB_LABELS: Record<ProfileTab, string> = {
  profile: "Profile",
  ai: "AI agents",
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
  const accountTabs: readonly ProfileTab[] = isOwner ? ACCOUNT_TABS : ["profile"];
  const contentTabs: readonly ProfileTab[] = isOwner ? CONTENT_TABS : PUBLIC_CONTENT_TABS;
  const tabParam = params.get("tab");
  const tab: ProfileTab = [...accountTabs, ...contentTabs].find((t) => t === tabParam) ?? "profile";
  const show = (next: ProfileTab) => setParams(next === "profile" ? {} : { tab: next });
  const options = (tabs: readonly ProfileTab[]) => tabs.map((t) => ({ value: t, label: TAB_LABELS[t], testId: `profile-tab-${t}` }));

  if (error !== null) return <ErrorView error={error} />;

  return (
    <section>
      <header className="profile-head">
        <PageHeader title={`@${username}`} />
        <nav className="profile-nav" aria-label="Profile sections">
          <SegmentedControl aria-label="Account" value={tab} onChange={show} options={options(accountTabs)} />
          <SegmentedControl aria-label="Content" value={tab} onChange={show} options={options(contentTabs)} />
        </nav>
      </header>
      {tab === "profile" ? (
        profile ? <ProfileOverview profile={profile} /> : <Spinner label="Loading…" />
      ) : tab === "ai" ? (
        <AiAgentsPanel />
      ) : tab === "templates" ? (
        <ProfileTemplates username={username} editable={isOwner} />
      ) : (
        <ProfileMemes username={username} tab={tab} />
      )}
    </section>
  );
}

/** Stats, badges, and join date. */
function ProfileOverview({ profile }: { profile: UserProfile }) {
  return (
    <div data-testid="profile-overview">
      <StatGroup className="profile-stats">
        <Stat label={STAT_LABELS.memeCount} value={profile.stats.memeCount} valueProps={{ "data-testid": "stat-meme-count" }} />
        <Stat label={STAT_LABELS.highScore} value={profile.stats.highScore} valueProps={{ "data-testid": "stat-high-score" }} />
        <Stat label={STAT_LABELS.hScore} hint={STAT_HINTS.hScore} value={profile.stats.hScore} valueProps={{ "data-testid": "stat-h-score" }} />
        <Stat
          label="Templates"
          hint="Public templates this user added, variations included"
          value={profile.templateCount}
          valueProps={{ "data-testid": "stat-template-count" }}
        />
      </StatGroup>
      <UserBadges stats={profile.stats} />
      <Text tone="muted">Joined {new Date(profile.user.createdAt).toLocaleDateString()}</Text>
    </div>
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
