import { useParams, useSearchParams } from "react-router-dom";
import type { Meme, Page, Template, UserProfile } from "@memegen/shared";
import { EmptyState, Icon, PageHeader, Panel, SegmentedControl, Spinner, Stat, StatGroup, Text, useSkin } from "@memegen/ui";
import { getMyActivity, getMyFavorites, getUser, getUserMemes, getUserTemplates, type PageParams } from "../api.ts";
import { useUser } from "../auth.tsx";
import { AiAgentsPanel } from "../components/ai.tsx";
import { ErrorView } from "../components/common.tsx";
import { MemeFeed } from "../components/memes.tsx";
import { TemplateGrid } from "../components/templates.tsx";
import { TieredStat } from "../components/users.tsx";
import { useDarkModeSetting } from "../darkMode.ts";
import { useAsync } from "../useAsync.ts";
import { usePaged } from "../usePaged.ts";

/**
 * Two tab groups under the name: the account (Profile: stats and badges; Settings and API Keys, owner only; Settings
 * only while the skin has a dark variant, its one setting), then the content (Memes and Templates are public;
 * Favorites and Recent activity (votes) are the owner's own).
 */
const ACCOUNT_TABS = ["profile", "settings", "ai"] as const;
const PUBLIC_CONTENT_TABS = ["memes", "templates"] as const;
const CONTENT_TABS = [...PUBLIC_CONTENT_TABS, "favorites", "activity"] as const;
type ProfileTab = (typeof ACCOUNT_TABS)[number] | (typeof CONTENT_TABS)[number];
type MemeTab = Exclude<ProfileTab, "profile" | "ai" | "settings" | "templates">;
const TAB_LABELS: Record<ProfileTab, string> = {
  profile: "Profile",
  ai: "API Keys",
  settings: "Settings",
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
  const { hasDark } = useSkin();
  const { data: profile, error } = useAsync(username, () => getUser(username));
  const isOwner = user.username === username;
  const accountTabs: readonly ProfileTab[] = isOwner ? ACCOUNT_TABS.filter((t) => t !== "settings" || hasDark) : ["profile"];
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
      ) : tab === "settings" ? (
        <ProfileSettings userId={user.id} />
      ) : tab === "templates" ? (
        <ProfileTemplates username={username} editable={isOwner} />
      ) : (
        <ProfileMemes username={username} tab={tab} />
      )}
    </section>
  );
}

/** Stats (tiered ones outlined and starred in their tier's color) and join date. */
function ProfileOverview({ profile }: { profile: UserProfile }) {
  return (
    <div data-testid="profile-overview">
      <StatGroup className="profile-stats">
        <TieredStat stats={profile.stats} stat="memeCount" testId="stat-meme-count" />
        <TieredStat stats={profile.stats} stat="highScore" testId="stat-high-score" />
        <TieredStat stats={profile.stats} stat="hScore" testId="stat-h-score" />
        <Stat
          label="Templates"
          hint="Public templates this user added, variations included"
          value={profile.templateCount}
          valueProps={{ "data-testid": "stat-template-count" }}
        />
      </StatGroup>
      <Text tone="muted">Joined {new Date(profile.user.createdAt).toLocaleDateString()}</Text>
    </div>
  );
}

/** The owner's browser-local settings: dark mode, for skins that have a dark variant. */
function ProfileSettings({ userId }: { userId: string }) {
  const { on, set } = useDarkModeSetting(userId);
  return (
    <Panel heading="Appearance" data-testid="profile-settings">
      <SegmentedControl
        aria-label="Dark mode"
        value={on ? "dark" : "light"}
        onChange={(value) => set(value === "dark")}
        options={[
          { value: "light", label: "Light", testId: "dark-mode-off" },
          { value: "dark", label: "Dark", testId: "dark-mode-on" },
        ]}
      />
      <Text size="sm" tone="muted">
        Saved in this browser for your account.
      </Text>
    </Panel>
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
