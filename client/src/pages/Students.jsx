import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { Sparkline, Delta, Bar, pctClass, SEMESTERS } from '../components/ui.jsx';

/** Every student the teacher has evaluated, across tests, with year / semester / subject filters. */
export default function Students() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const f = { year: params.get('year') || '', semester: params.get('semester') || '', subject_id: params.get('subject_id') || params.get('subject') || '' };
  const [list, setList] = useState(null);
  const [filters, setFilters] = useState(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('name');
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();

  useEffect(() => {
    api.get(`/students${qs ? `?${qs}` : ''}`).then((d) => setList(d.students)).catch((e) => setErr(e.message));
  }, [qs]);
  useEffect(() => { api.get('/dashboard').then((d) => setFilters(d.filters)).catch(() => {}); }, []);

  const setF = (k, v) => {
    const p = new URLSearchParams(params);
    if (k === 'subject_id') p.delete('subject');
    v ? p.set(k, v) : p.delete(k);
    setParams(p, { replace: true });
  };
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const r = (list || []).filter((x) => !s || `${x.name} ${x.roll_no || ''}`.toLowerCase().includes(s));
    const by = { name: (a, b) => a.name.localeCompare(b.name), high: (a, b) => b.average - a.average, low: (a, b) => a.average - b.average, recent: (a, b) => b.last_at - a.last_at };
    return [...r].sort(by[sort]);
  }, [list, q, sort]);

  if (err) return <div className="err">{err}</div>;
  return (
    <>
      <div className="page-head">
        <div className="grow">
          <div className="crumbs"><Link to="/">Dashboard</Link><span>/</span>Students</div>
          <h1>Your <em>students</em></h1>
          <div className="muted">Everyone you have evaluated, matched across tests by roll number. Click a student for their full analytics.</div>
        </div>
      </div>

      <div className="card filterbar">
        <div className="fb-group">
          <label htmlFor="sy">Academic year</label>
          <select id="sy" value={f.year} onChange={(e) => setF('year', e.target.value)}>
            <option value="">All years</option>
            {(filters?.years || []).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="fb-group">
          <label htmlFor="ss">Semester</label>
          <select id="ss" value={f.semester} onChange={(e) => setF('semester', e.target.value)}>
            <option value="">All semesters</option>
            {SEMESTERS.map((s) => <option key={s} value={s}>Semester {s}</option>)}
          </select>
        </div>
        <div className="fb-group">
          <label htmlFor="sb">Subject</label>
          <select id="sb" value={f.subject_id} onChange={(e) => setF('subject_id', e.target.value)}>
            <option value="">All subjects</option>
            {(filters?.subjects || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="fb-group grow">
          <label htmlFor="sq">Search</label>
          <input id="sq" placeholder="Name or roll number…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="fb-group">
          <label htmlFor="so">Sort</label>
          <select id="so" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="name">Name</option><option value="high">Highest average</option><option value="low">Lowest average</option><option value="recent">Most recent</option>
          </select>
        </div>
      </div>

      <div className="card">
        {!list ? <p className="muted">Loading…</p> : !rows.length ? <div className="empty">{list.length ? 'No students match your search.' : 'No evaluated students in this selection yet.'}</div> : (
          <div className="scroll"><table>
            <thead><tr><th>Student</th><th>Roll no</th><th>Tests</th><th>Average</th><th>Latest</th><th>Trend</th><th /></tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.key} className="click" onClick={() => nav(`/students/${s.key}`)}>
                <td><div className="flex" style={{ gap: 10, flexWrap: 'nowrap' }}><span className="avatar sm">{s.name.slice(0, 1)}</span><div><Link to={`/students/${s.key}`} onClick={(e) => e.stopPropagation()}><b>{s.name}</b></Link>{s.section && <div className="muted small">Section {s.section}</div>}</div></div></td>
                <td className="mono small">{s.roll_no || <span className="muted">-</span>}</td>
                <td>{s.tests}</td>
                <td style={{ minWidth: 120 }}><b className={`pct ${pctClass(s.average)}`}>{s.average}%</b><Bar value={s.average} /></td>
                <td>{s.latest}% <Delta v={s.change} /></td>
                <td><Sparkline values={s.trend} /></td>
                <td>{s.needs_review > 0 && <span className="badge b-warn">{s.needs_review} to review</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}
