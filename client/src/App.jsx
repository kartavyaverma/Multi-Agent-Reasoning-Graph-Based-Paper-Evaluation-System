import React, { useEffect, useState, createContext, useContext } from 'react';
import { Routes, Route, Navigate, NavLink, Link, useNavigate } from 'react-router-dom';
import { api, getToken, setToken } from './api.js';
import Auth from './pages/Auth.jsx';
import Dashboard from './pages/Dashboard.jsx';
import NewTest from './pages/NewTest.jsx';
import TestPage from './pages/TestPage.jsx';
import StudentPage from './pages/StudentPage.jsx';
import SubjectPage from './pages/SubjectPage.jsx';
import WorkflowPage from './pages/WorkflowPage.jsx';

const UserCtx = createContext(null);
export const useUser = () => useContext(UserCtx);

function Shell({ user, onLogout, children }) {
  return (
    <>
      <div className="nav">
        <div className="nav-in">
          <Link to="/" className="logo">Paper<span>Check</span></Link>
          <NavLink to="/" end className={({ isActive }) => `link ${isActive ? 'active' : ''}`}>Dashboard</NavLink>
          <NavLink to="/tests/new" className={({ isActive }) => `link ${isActive ? 'active' : ''}`}>New test</NavLink>
          <div className="spacer" />
          <span className="muted small">{user.name}</span>
          <button className="btn sm" onClick={onLogout}>Sign out</button>
        </div>
      </div>
      <div className="page">{children}</div>
    </>
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </UserCtx.Provider>
  );
}
