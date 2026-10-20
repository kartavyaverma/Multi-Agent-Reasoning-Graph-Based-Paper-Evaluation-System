import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Stat, Status, fmtDate } from '../components/ui.jsx';

export default function Dashboard() {
  const [d, setD] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [err, setErr] = useState('');

  const load = () => Promise.all([api.get('/dashboard'), api.get('/subjects')]).then(([a, b]) => { setD(a); setSubjects(b.subjects); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, []);

  if (err) return <div className="err">{err}</div>;
  if (!d) return <p className="muted">Loading...</p>;
  const t = d.totals;

  return (
    <>
      <div className="page-head">
        <div className="grow"><h1>Dashboard</h1><div className="muted">Your subjects, past tests and class performance at a glance.</div></div>
        <Link to="/tests/new" className="btn primary">+ New test</Link>
      </div>
      {!d.ai_configured && <div className="warnbox">The local AI is not ready. Start <b>Ollama</b> and pull the models listed in the server console (e.g. <span className="mono">ollama pull qwen3-vl:2b-instruct</span>) before creating a test.</div>}

      <div className="grid g4" style={{ marginBottom: 20 }}>
        <Stat label="Subjects" value={t.subjects} />
        <Stat label="Tests" value={t.tests} sub={t.running ? `${t.running} processing now` : undefined} />
        <Stat label="Students evaluated" value={t.students} />
        <Stat label="Overall average" value={`${t.average}%`} sub={t.needs_review ? `${t.needs_review} students need review` : 'No pending reviews'} />
      </div>

      <div className="grid g2">
        <div className="card">
          <h2>Subjects</h2>
          {!subjects.length ? <div className="empty">No subjects yet. Create a test to add your first subject.</div> : (
            <table><tbody>
              {subjects.map((s) => (
                <tr key={s._id}><td><Link to={`/subjects/${s._id}`}><b>{s.name}</b></Link></td><td className="muted">{s.test_count} test{s.test_count === 1 ? '' : 's'}</td><td className="right"><Link to={`/subjects/${s._id}`}>Analytics</Link></td></tr>
              ))}
            </tbody></table>
          )}
        </div>
        <div className="card">
          <h2>Recent tests</h2>
          {!d.recent.length ? <div className="empty">Nothing here yet.</div> : (
            <table><tbody>
              {d.recent.map((x) => (
                <tr key={x._id}>
                  <td><Link to={`/tests/${x._id}`}><b>{x.title}</b></Link><div className="muted small">{x.subject_name} - {fmtDate(x.created_at)}</div></td>
                  <td><Status s={x.status} /></td>
                  <td className="right">{x.status === 'completed' ? <><b>{x.analytics.average}%</b><div className="muted small">{x.analytics.students} students</div></> : null}</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </div>
      </div>
    </>
  );
}
