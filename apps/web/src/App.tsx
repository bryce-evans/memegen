import { BrowserRouter, Link, NavLink, Route, Routes, useLocation, useSearchParams } from "react-router-dom";
import {
  AppShell,
  Button,
  EmptyState,
  Header,
  Icon,
  LinkButton,
  NavItem,
  NavList,
  Sidebar,
  SidebarSection,
  SkinProvider,
  SkinSwitcher,
  Text,
  Wordmark,
  useSkin,
} from "@memegen/ui";
import { AuthProvider, useAuth } from "./auth.tsx";
import { LoginForm } from "./components/common.tsx";
import { TagSearch, TagSidebar } from "./components/tags.tsx";
import { Editor } from "./pages/Editor.tsx";
import { GalleryFilters, Popular, Recent, feedKindFor, hasFeedControls } from "./pages/Gallery.tsx";
import { Leaderboard } from "./pages/Leaderboard.tsx";
import { MemeDetail } from "./pages/MemeDetail.tsx";
import { Profile } from "./pages/Profile.tsx";
import { TagPage } from "./pages/TagPage.tsx";

function SiteHeader() {
  const { user, signOut } = useAuth();
  const { layout } = useSkin();
  return (
    <Header
      brand={
        <Link to="/">
          <Wordmark text="memegen" />
        </Link>
      }
      center={layout.search === "header" ? <TagSearch placement="header" /> : undefined}
    >
      <SkinSwitcher data-testid="skin-select" />
      {user ? (
        <>
          <Text as="span" size="sm">
            Signed in as{" "}
            <Link to={`/u/${user.username}`} data-testid="current-user">
              {user.username}
            </Link>
          </Text>
          <Button size="sm" onClick={signOut} data-testid="sign-out">
            Sign out
          </Button>
        </>
      ) : (
        <LoginForm inHeader />
      )}
    </Header>
  );
}

function SideColumn() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const { layout } = useSkin();
  const feedKind = feedKindFor(pathname);
  // Profile and favorites share a path, so mark them by hand instead of letting NavLink match both.
  const onOwnProfile = user !== null && pathname === `/u/${user.username}`;
  const favoritesActive = onOwnProfile && params.get("tab") === "liked";
  return (
    <Sidebar>
      {layout.sidebarAction && (
        <LinkButton as={Link} to="/create" variant="primary" icon={<Icon name="plus" />} className="sidebar-action">
          Create meme
        </LinkButton>
      )}
      <SidebarSection as="nav" aria-label="Pages" heading="Browse">
        <NavList>
          <NavItem as={NavLink} to="/create" icon={<Icon name="plus" />} data-testid="nav-create">
            Create
          </NavItem>
          <NavItem as={NavLink} to="/recent" icon={<Icon name="clock" />} data-testid="nav-recent">
            Recent
          </NavItem>
          <NavItem as={NavLink} to="/" end icon={<Icon name="flame" />} data-testid="nav-popular">
            Popular
          </NavItem>
          <NavItem as={NavLink} to="/leaderboard" icon={<Icon name="chart" />} data-testid="nav-leaderboard">
            Leaderboard
          </NavItem>
          {user && (
            <>
              <NavItem
                as={Link}
                to={`/u/${user.username}`}
                active={onOwnProfile && !favoritesActive}
                icon={<Icon name="user" />}
                data-testid="nav-profile"
              >
                Profile
              </NavItem>
              <NavItem
                as={Link}
                to={`/u/${user.username}?tab=liked`}
                active={favoritesActive}
                icon={<Icon name="star" />}
                data-testid="nav-favorites"
              >
                Your favorites
              </NavItem>
            </>
          )}
        </NavList>
      </SidebarSection>
      {layout.filters === "sidebar" && feedKind && hasFeedControls(feedKind) && (
        <GalleryFilters kind={feedKind} placement="sidebar" />
      )}
      {layout.search === "sidebar" && <TagSearch placement="sidebar" />}
      <TagSidebar />
    </Sidebar>
  );
}

export default function App() {
  return (
    <SkinProvider>
      <AuthProvider>
        <BrowserRouter>
          <AppShell header={<SiteHeader />} sidebar={<SideColumn />}>
            <Routes>
              <Route path="/" element={<Popular />} />
              <Route path="/recent" element={<Recent />} />
              <Route path="/leaderboard" element={<Leaderboard />} />
              <Route path="/m/:id" element={<MemeDetail />} />
              <Route path="/u/:username" element={<Profile />} />
              <Route path="/create" element={<Editor />} />
              <Route path="/t/:slug" element={<TagPage />} />
              <Route path="*" element={<EmptyState icon={<Icon name="search" />} title="Page not found." />} />
            </Routes>
          </AppShell>
        </BrowserRouter>
      </AuthProvider>
    </SkinProvider>
  );
}
