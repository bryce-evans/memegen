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
} from "@memegen/ui";
import { AuthProvider, useAuth } from "./auth.tsx";
import { LoginForm } from "./components/common.tsx";
import { TagSearch, TagSidebar } from "./components/tags.tsx";
import { Editor } from "./pages/Editor.tsx";
import { Gallery, GalleryFilters } from "./pages/Gallery.tsx";
import { MemeDetail } from "./pages/MemeDetail.tsx";
import { Profile } from "./pages/Profile.tsx";
import { Templates } from "./pages/Templates.tsx";
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
  const { layout } = useSkin();
  const feedPeriod = pathname === "/" ? "week" : pathname.startsWith("/t/") ? "all" : null;
  return (
    <Sidebar>
      {layout.sidebarAction && (
        <LinkButton as={Link} to="/create" variant="primary" icon={<Icon name="plus" />} className="sidebar-action">
          Create meme
        </LinkButton>
      )}
      <SidebarSection as="nav" aria-label="Pages" heading="Browse">
        <NavList>
          <NavItem as={NavLink} to="/" end icon={<Icon name="grid" />} data-testid="nav-gallery">
            Gallery
          </NavItem>
          <NavItem as={NavLink} to="/templates" icon={<Icon name="image" />} data-testid="nav-templates">
            Templates
          </NavItem>
          <NavItem as={NavLink} to="/create" icon={<Icon name="plus" />} data-testid="nav-create">
            Create
          </NavItem>
          {user && (
            <NavItem as={NavLink} to={`/u/${user.username}`} icon={<Icon name="user" />} data-testid="nav-profile">
              My profile
            </NavItem>
          )}
        </NavList>
      </SidebarSection>
      {layout.filters === "sidebar" && feedPeriod && <GalleryFilters defaultPeriod={feedPeriod} placement="sidebar" />}
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
              <Route path="/" element={<Gallery />} />
              <Route path="/m/:id" element={<MemeDetail />} />
              <Route path="/u/:username" element={<Profile />} />
              <Route path="/templates" element={<Templates />} />
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
