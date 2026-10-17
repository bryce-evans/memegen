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
import { useStoredDarkMode } from "./darkMode.ts";
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

/**
 * The header search's placeholders: a random one when the page loads, then every `CYCLE_MS` the shown one is erased
 * from the end a character at a time (backspacing), and after a pause a different random one types itself out.
 */
const SEARCH_PLACEHOLDERS = [
  "all your memes are belong to us",
  "one does not simply search...",
  "much search. very meme. wow.",
  "a meme a day...",
  "whatcha lookin' for?",
  "tell me without telling me",
  "it's giving...",
  "IYKYK...",
  "hello there...",
  "show me what you got",
  "sir, this is a search bar",
  "what's the meme, precious?",
  "I need this for... reasons",
  "*aggressively searches*",
  "chat, is this real?",
  "gimme the good stuff",
  "y'all got any more of them templates",
];
const randomPlaceholder = (except?: string) => {
  const choices = SEARCH_PLACEHOLDERS.filter((p) => p !== except);
  return choices[Math.floor(Math.random() * choices.length)]!;
};
const firstPlaceholder = randomPlaceholder();
const CYCLE_MS = 6 * 60_000;
const ERASE_MS = 700;
const PAUSE_MS = 500;
const TYPE_MS = 700;

/** The search placeholder as it cycles; with reduced motion, the next phrase just replaces the last. */
function useCyclingPlaceholder(): string {
  const [text, setText] = useState(firstPlaceholder);
  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const sleep = (ms: number) => new Promise<void>((resolve) => (timer = window.setTimeout(resolve, ms)));
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    void (async () => {
      let shown = firstPlaceholder;
      for (;;) {
        await sleep(CYCLE_MS);
        if (cancelled) return;
        const next = randomPlaceholder(shown);
        if (reducedMotion) {
          setText(next);
        } else {
          for (let i = shown.length - 1; i >= 0; i--) {
            await sleep(ERASE_MS / shown.length);
            if (cancelled) return;
            setText(shown.slice(0, i));
          }
          await sleep(PAUSE_MS);
          for (let i = 1; i <= next.length; i++) {
            await sleep(TYPE_MS / next.length);
            if (cancelled) return;
            setText(next.slice(0, i));
          }
        }
        shown = next;
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);
  return text;
}

/**
 * Site search in the header: submitting opens `/search?q=` (keeping the shown type, on that page); there the box
 * shows the current query.
 */
function SiteSearch() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const current = pathname === "/search" ? (params.get("q") ?? "") : "";
  const [value, setValue] = useState(current);
  useEffect(() => setValue(current), [current]);
  const placeholder = useCyclingPlaceholder();

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = value.trim();
    const type = pathname === "/search" ? params.get("type") : null;
    if (q) navigate(`/search?${new URLSearchParams(type ? { q, type } : { q })}`);
  }

  return (
    <form role="search" className="site-search" onSubmit={submit}>
      <TextField
        type="search"
        placeholder={placeholder}
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
  useStoredDarkMode(user?.id ?? null);
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
