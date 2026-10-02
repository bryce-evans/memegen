import { BrowserRouter, Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth.tsx";
import { LoginForm } from "./components/common.tsx";
import { TagSidebar } from "./components/tags.tsx";
import { Editor } from "./pages/Editor.tsx";
import { Gallery, GalleryFilters } from "./pages/Gallery.tsx";
import { MemeDetail } from "./pages/MemeDetail.tsx";
import { Profile } from "./pages/Profile.tsx";
import { Templates } from "./pages/Templates.tsx";
import { TagPage } from "./pages/TagPage.tsx";

function Header() {
  const { user, signOut } = useAuth();
  return (
    <header className="site-header">
      <Link to="/" className="brand">
        memegen
      </Link>
      <div className="session">
        {user ? (
          <>
            <span>
              Signed in as{" "}
              <Link to={`/u/${user.username}`} data-testid="current-user">
                {user.username}
              </Link>
            </span>
            <button type="button" onClick={signOut} data-testid="sign-out">
              Sign out
            </button>
          </>
        ) : (
          <LoginForm inHeader />
        )}
      </div>
    </header>
  );
}

function SideColumn() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const itemClass = ({ isActive }: { isActive: boolean }) => (isActive ? "side-item active" : "side-item");
  return (
    <aside className="side">
      <nav className="side-group" aria-label="Pages">
        <h4>Browse</h4>
        <NavLink to="/" end className={itemClass} data-testid="nav-gallery">
          Gallery
        </NavLink>
        <NavLink to="/templates" className={itemClass} data-testid="nav-templates">
          Templates
        </NavLink>
        <NavLink to="/create" className={itemClass} data-testid="nav-create">
          Create
        </NavLink>
        {user && (
          <NavLink to={`/u/${user.username}`} className={itemClass} data-testid="nav-profile">
            My profile
          </NavLink>
        )}
      </nav>
      {pathname === "/" && <GalleryFilters defaultPeriod="week" />}
      {pathname.startsWith("/t/") && <GalleryFilters defaultPeriod="all" />}
      <TagSidebar />
    </aside>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Header />
        <div className="shell">
          <SideColumn />
          <main>
            <Routes>
              <Route path="/" element={<Gallery />} />
              <Route path="/m/:id" element={<MemeDetail />} />
              <Route path="/u/:username" element={<Profile />} />
              <Route path="/templates" element={<Templates />} />
              <Route path="/create" element={<Editor />} />
              <Route path="/t/:slug" element={<TagPage />} />
              <Route path="*" element={<p className="muted">Page not found.</p>} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}
