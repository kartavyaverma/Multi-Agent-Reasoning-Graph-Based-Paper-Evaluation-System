import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { ThemeMenu } from '../theme.jsx';

export default function Auth({ mode, onAuth }) {
  const signup = mode === 'signup';
  const [f, setF] = useState({ name: '', email: '', password: '', institution: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { onAuth(await api.post(signup ? '/auth/signup' : '/auth/login', f)); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-theme"><ThemeMenu /></div>
      <div className="auth-card">
        <div className="hero">
          <div className="logo"><span className="logo-mark">P</span><span className="logo-word">Paper<i>check</i></span></div>
          <p className="muted">Upload the question paper, model answers and student scripts. Get marks, reasoning and class analytics.</p>
          <div className="hero-pills"><span>Multi-agent grading</span><span>Reasoning graphs</span><span>Runs locally</span></div>
        </div>
        <form className="card auth-form" onSubmit={submit}>
          <h2>{signup ? 'Create teacher account' : 'Sign in'}</h2>
          {err && <div className="err">{err}</div>}
          {signup && <div className="field"><label>Full name</label><input value={f.name} onChange={set('name')} required /></div>}
          {signup && <div className="field"><label>Institution <span className="muted">(optional)</span></label><input value={f.institution} onChange={set('institution')} /></div>}
          <div className="field"><label>Email</label><input type="email" value={f.email} onChange={set('email')} required /></div>
          <div className="field"><label>Password</label><input type="password" value={f.password} onChange={set('password')} minLength={signup ? 8 : undefined} required />{signup && <div className="hint">At least 8 characters</div>}</div>
          <button className="btn primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Please wait...' : signup ? 'Sign up' : 'Sign in'}</button>
          <p className="muted small" style={{ textAlign: 'center', marginBottom: 0 }}>
            {signup ? <>Already registered? <Link to="/login">Sign in</Link></> : <>New here? <Link to="/signup">Create an account</Link></>}
          </p>
        </form>
      </div>
    </div>
  );
}
