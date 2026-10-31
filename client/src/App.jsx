import React, { useEffect, useState, createContext, useContext } from 'react';
import { Routes, Route, Navigate, NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import { api, getToken, setToken } from './api.js';
import { ThemeMenu } from './theme.jsx';
import Auth from './pages/Auth.jsx';
import Dashboard from './pages/Dashboard.jsx';
import NewTest from './pages/NewTest.jsx';
import TestPage from './pages/TestPage.jsx';
import StudentPage from './pages/StudentPage.jsx';
import SubjectPage from './pages/SubjectPage.jsx';
import WorkflowPage from './pages/WorkflowPage.jsx';
import Students from './pages/Students.jsx';
import StudentProfile from './pages/StudentProfile.jsx';

const UserCtx = createContext(null);
export const useUser = () => useContext(UserCtx);

export const Logo = () => <Link to="/" className="logo"><span className="logo-mark">P</span><span className="logo-word">Paper<i>check</i></span></Link>;

const I = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9v11h14V9" /><path d="M10 20v-6h4v6" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  book: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z" /><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" /></>,
  collapse: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  out: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></>,
};
export const Icon = ({ n, size = 17 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none' }}>{I[n]}</svg>;

const COLLAPSE_KEY = 'papercheck_sidebar';

function Shell({ user, onLogout, children }) {
  const loc = useLocation();
  const wide = /\/workflow$/.test(loc.pathname);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; } });
  const [drawer, setDrawer] = useState(false);
  const [subjects, setSubjects] = useState([]);
  useEffect(() => { api.get('/subjects').then((d) => setSubjects(d.subjects)).catch(() => {}); }, [loc.pathname]);
  useEffect(() => setDrawer(false), [loc.pathname]);
  const toggle = () => { setCollapsed(!collapsed); try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '0' : '1'); } catch { /* ignore */ } };
  const initials = user.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const link = ({ isActive }) => `side-link ${isActive ? 'active' : ''}`;
  return (
    <div className={`shell ${collapsed ? 'collapsed' : ''} ${drawer ? 'drawer-open' : ''}`}>
      <aside className="sidebar glass">
        <div className="side-top">
          <Logo />
          <button className="btn ghost sm icon-btn side-collapse" onClick={toggle} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-label="Toggle sidebar"><Icon n="collapse" size={16} /></button>
        </div>
        <Link to="/tests/new" className="btn primary side-cta" title="New test"><Icon n="plus" size={16} /><span>New test</span></Link>
        <nav className="side-nav">
          <div className="side-label">Workspace</div>
          <NavLink to="/" end className={link} title="Dashboard"><Icon n="home" /><span>Dashboard</span></NavLink>
          <NavLink to="/students" className={link} title="Students"><Icon n="users" /><span>Students</span></NavLink>
          {subjects.length > 0 && <div className="side-label">Subjects</div>}
          {subjects.map((s) => (
            <NavLink key={s._id} to={`/subjects/${s._id}`} className={link} title={s.name}>
              <span className="side-dot">{s.name.slice(0, 1).toUpperCase()}</span><span className="ell">{s.name}</span><em>{s.test_count}</em>
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <ThemeMenu compact={collapsed} up />
          <div className="side-user" title={user.email}>
            <span className="avatar">{initials}</span>
            <div className="side-user-txt"><b className="ell">{user.name}</b><span className="ell">{user.email}</span></div>
            <button className="btn ghost sm icon-btn" onClick={onLogout} title="Sign out" aria-label="Sign out"><Icon n="out" size={16} /></button>
          </div>
        </div>
      </aside>
      <div className="side-scrim" onClick={() => setDrawer(false)} />
      <header className="topbar glass">
        <button className="btn ghost sm icon-btn" onClick={() => setDrawer(true)} aria-label="Open menu"><Icon n="menu" /></button>
        <Logo />
        <div className="spacer" />
        <ThemeMenu compact />
      </header>
      <main className={`page ${wide ? 'wide' : ''}`}>{children}</main>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    if (!getToken()) return setReady(true);
    api.get('/auth/me').then((d) => setUser(d.user)).catch(() => setToken(null)).finally(() => setReady(true));
  }, []);

  const login = ({ token, user }) => { setToken(token); setUser(user); nav('/'); };
  const logout = () => { setToken(null); setUser(null); nav('/login'); };

  if (!ready) return null;
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Auth mode="login" onAuth={login} />} />
        <Route path="/signup" element={<Auth mode="signup" onAuth={login} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  return (
    <UserCtx.Provider value={user}>
      <Shell user={user} onLogout={logout}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/tests/new" element={<NewTest />} />
          <Route path="/tests/:id" element={<TestPage />} />
          <Route path="/tests/:id/workflow" element={<WorkflowPage />} />
          <Route path="/tests/:id/students/:rid" element={<StudentPage />} />
          <Route path="/subjects/:id" element={<SubjectPage />} />
          <Route path="/students" element={<Students />} />
          <Route path="/students/:key" element={<StudentProfile />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </UserCtx.Provider>
  );
}
