import { BrowserRouter, Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
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
  useSkinFavicon,
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

const BRAND = "memegen";

function SiteHeader() {
  const { user, signOut } = useAuth();
  // The tab icon is the wordmark's first letter, drawn in the active skin's wordmark style.
  useSkinFavicon(BRAND[0]!);
  return (
    <Header
      brand={
        <Link to="/">
          <Wordmark text={BRAND} />
        </Link>
      }
      center={<TagSearch />}
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
  const { layout } = useSkin();
  const feedKind = feedKindFor(pathname);
  return (
    <Sidebar>
      <LinkButton
        as={NavLink}
        to="/create"
        variant="primary"
        icon={<Icon name="plus" />}
        className="sidebar-action"
        data-testid="nav-create"
      >
        Create
      </LinkButton>
      <SidebarSection as="nav" aria-label="Pages">
        <NavList>
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
            <NavItem as={NavLink} to={`/u/${user.username}`} icon={<Icon name="user" />} data-testid="nav-profile">
              Profile
            </NavItem>
          )}
        </NavList>
      </SidebarSection>
      {layout.filters === "sidebar" && feedKind && hasFeedControls(feedKind) && (
        <GalleryFilters kind={feedKind} placement="sidebar" />
      )}
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
