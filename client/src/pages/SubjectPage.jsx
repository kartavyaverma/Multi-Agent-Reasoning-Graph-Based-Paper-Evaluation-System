import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { api } from '../api.js';
import { Stat, Status, fmtDate } from '../components/ui.jsx';

export default function SubjectPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.get(`/subjects/${id}`).then(setD).catch((e) => setErr(e.message)); }, [id]);
  if (err) return <div className="err">{err}</div>;
  if (!d) return <p className="muted">Loading...</p>;
  const o = d.overall;
  const sum = Object.fromEntries(d.tests_summary.map((t) => [t.id, t]));

  return (
    <>
      <div className="page-head">
        <div className="grow"><div className="muted small"><Link to="/">Dashboard</Link></div><h1>{d.subject.name}</h1><div className="muted">{d.tests.length} test{d.tests.length === 1 ? '' : 's'}</div></div>
        <Link to="/tests/new" className="btn primary">+ New test</Link>
        <button className="btn danger" onClick={async () => { if (window.confirm('Delete this subject with ALL its tests and results?')) { await api.del(`/subjects/${id}`); nav('/'); } }}>Delete subject</button>
      </div>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat label="Students evaluated" value={o.students} />
        <Stat label="Overall average" value={`${o.average}%`} />
        <Stat label="Pass rate" value={`${o.pass_rate}%`} />
        <Stat label="Best score" value={`${o.highest}%`} />
      </div>
      {d.trend.length > 1 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Performance across tests</h2>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={d.trend}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="title" fontSize={12} /><YAxis domain={[0, 100]} fontSize={12} /><Tooltip /><Legend />
              <Line type="monotone" dataKey="average" name="Average %" stroke="#4f46e5" strokeWidth={2} /><Line type="monotone" dataKey="pass_rate" name="Pass rate %" stroke="#22a55b" strokeWidth={2} /></LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="card">
        <h2>Tests</h2>
        <table>
          <thead><tr><th>Test</th><th>Date</th><th>Status</th><th>Students</th><th>Average</th><th>Pass rate</th></tr></thead>
          <tbody>{d.tests.map((t) => (
            <tr key={t._id} className="click" onClick={() => nav(`/tests/${t._id}`)}>
              <td><b>{t.title}</b></td><td className="muted">{fmtDate(t.created_at)}</td><td><Status s={t.status} /></td>
              <td>{sum[t._id]?.students || '-'}</td><td>{t.status === 'completed' ? `${sum[t._id]?.average}%` : '-'}</td><td>{t.status === 'completed' ? `${sum[t._id]?.pass_rate}%` : '-'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}
