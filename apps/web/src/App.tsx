import { useEffect, useState, type FormEvent } from "react";
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  AppShell,
  Button,
  Dropdown,
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
  TextField,
  Wordmark,
  useNarrowScreen,
  useSkinFavicon,
} from "@memegen/ui";
import { AuthProvider, useAuth, useUser } from "./auth.tsx";
import { GalleryFilters, feedKindFor } from "./components/feed.tsx";
import { TagSidebar } from "./components/tagNav.tsx";
import { DEV_MODE } from "./mode.ts";
import { Editor } from "./pages/Editor.tsx";
import { Popular, Recent, Search } from "./pages/Gallery.tsx";
import { Leaderboard } from "./pages/Leaderboard.tsx";
import { MemeDetail } from "./pages/MemeDetail.tsx";
import { Profile } from "./pages/Profile.tsx";
import { SignIn } from "./pages/SignIn.tsx";
import { TagPage } from "./pages/TagPage.tsx";

const BRAND = "memegen";
/** Prod pins this skin (`?skin=` and stored choices ignored); dev lets the sign-in page's dev tools switch it. */
const SKIN = "default";

/** Meme search in the header: submitting opens `/search?q=`; on that page the box shows the current query. */
function SiteSearch() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const current = pathname === "/search" ? (params.get("q") ?? "") : "";
  const [value, setValue] = useState(current);
  useEffect(() => setValue(current), [current]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = value.trim();
    if (q) navigate(`/search?${new URLSearchParams({ q })}`);
  }

  return (
    <form role="search" className="site-search" onSubmit={submit}>
      <TextField
        type="search"
        placeholder="Search"
        aria-label="Search memes"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        data-testid="meme-search"
      />
    </form>
  );
}

/** The user's profile entry: in the side column, or on narrow screens in the account dropdown. */
function ProfileNavItem() {
  const user = useUser();
  return (
    <NavItem as={NavLink} to={`/u/${user.username}`} icon={<Icon name="user" />} data-testid="nav-profile">
      Profile
    </NavItem>
  );
}

function SiteHeader() {
  const user = useUser();
  const { signOut } = useAuth();
  const narrow = useNarrowScreen();
  return (
    <Header
      brand={
        <Link to="/">
          <Wordmark text={BRAND} />
        </Link>
      }
      center={<SiteSearch />}
      accountButtonProps={{ "data-testid": "account-button" }}
    >
      <Text as="span" size="sm">
        Signed in as{" "}
        <Link to={`/u/${user.username}`} data-testid="current-user">
          {user.username}
        </Link>
      </Text>
      {narrow && <ProfileNavItem />}
      <Button size="sm" onClick={signOut} data-testid="sign-out">
        Sign out
      </Button>
    </Header>
  );
}

/** The gallery pages; Profile joins them only in the wide side column. */
function GalleryNavItems() {
  return (
    <>
      <NavItem as={NavLink} to="/recent" icon={<Icon name="clock" />} data-testid="nav-recent">
        Recent
      </NavItem>
      <NavItem as={NavLink} to="/" end icon={<Icon name="flame" />} data-testid="nav-popular">
        Popular
      </NavItem>
      <NavItem as={NavLink} to="/leaderboard" icon={<Icon name="chart" />} data-testid="nav-leaderboard">
        Leaderboard
      </NavItem>
    </>
  );
}

/** Wide screens: Create, the pages, feed filters, and tags. Narrow screens: one row of Create and a Gallery dropdown. */
function SideColumn() {
  const { pathname } = useLocation();
  const feedKind = feedKindFor(pathname);
  const narrow = useNarrowScreen();
  const create = (
    <LinkButton
      as={NavLink}
      to="/create"
      variant="special"
      icon={<Icon name="plus" />}
      className="sidebar-action"
      data-testid="nav-create"
    >
      Create
    </LinkButton>
  );
  if (narrow) {
    return (
      <Sidebar>
        {create}
        <Dropdown label="Gallery" buttonProps={{ className: "sidebar-action", "data-testid": "gallery-menu" }}>
          <nav aria-label="Pages">
            <NavList>
              <GalleryNavItems />
            </NavList>
          </nav>
        </Dropdown>
      </Sidebar>
    );
  }
  return (
    <Sidebar>
      {create}
      <SidebarSection as="nav" aria-label="Pages">
        <NavList>
          <GalleryNavItems />
          <ProfileNavItem />
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
        <Route path="/search" element={<Search />} />
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
