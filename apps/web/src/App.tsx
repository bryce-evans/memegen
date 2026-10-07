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
  Text,
  Wordmark,
  useSkinFavicon,
} from "@memegen/ui";
import { AuthProvider, useAuth, useUser } from "./auth.tsx";
import { GalleryFilters, feedKindFor } from "./components/feed.tsx";
import { TagSidebar } from "./components/tagNav.tsx";
import { DEV_MODE } from "./mode.ts";
import { Editor } from "./pages/Editor.tsx";
import { Popular, Recent } from "./pages/Gallery.tsx";
import { Leaderboard } from "./pages/Leaderboard.tsx";
import { MemeDetail } from "./pages/MemeDetail.tsx";
import { Profile } from "./pages/Profile.tsx";
import { SignIn } from "./pages/SignIn.tsx";
import { TagPage } from "./pages/TagPage.tsx";

const BRAND = "memegen";
/** Prod pins this skin (`?skin=` and stored choices ignored); dev lets the sign-in page's dev tools switch it. */
const SKIN = "default";

function SiteHeader() {
  const user = useUser();
  const { signOut } = useAuth();
  return (
    <Header
      brand={
        <Link to="/">
          <Wordmark text={BRAND} />
        </Link>
      }
    >
      <Text as="span" size="sm">
        Signed in as{" "}
        <Link to={`/u/${user.username}`} data-testid="current-user">
          {user.username}
        </Link>
      </Text>
      <Button size="sm" onClick={signOut} data-testid="sign-out">
        Sign out
      </Button>
    </Header>
  );
}

function SideColumn() {
  const user = useUser();
  const { pathname } = useLocation();
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
          <NavItem as={NavLink} to={`/u/${user.username}`} icon={<Icon name="user" />} data-testid="nav-profile">
            Profile
          </NavItem>
        </NavList>
      </SidebarSection>
      {feedKind && <GalleryFilters kind={feedKind} placement="sidebar" />}
      <TagSidebar />
    </Sidebar>
  );
}

/** Signed out, every URL shows the sign-in page; signing in renders the app at that same URL. */
function Root() {
  const { user } = useAuth();
  // The tab icon is the wordmark's first letter, drawn in the skin's wordmark style.
  useSkinFavicon(BRAND[0]!);
  if (!user) return <SignIn brand={BRAND} />;
  return (
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
  );
}

export default function App() {
  return (
    <SkinProvider locked={DEV_MODE ? undefined : SKIN} fallback={SKIN}>
      <AuthProvider>
        <BrowserRouter>
          <Root />
        </BrowserRouter>
      </AuthProvider>
    </SkinProvider>
  );
}
