import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { api } from '../api.js';
import { useUser } from '../App.jsx';
import { useTheme } from '../theme.jsx';
import { Status, Bar, TermBadge, Sparkline, fmtTerm, fmtDate, currentAcademicYear, pctClass, SEMESTERS } from '../components/ui.jsx';

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

function Kpi({ label, value, sub, tone, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} className={`card kpi ${tone || ''} ${onClick ? 'click' : ''}`} onClick={onClick}>
      <div className="l">{label}</div>
      <div className="v">{value}</div>
      {sub && <div className="muted small">{sub}</div>}
    </Tag>
  );
}

export default function Dashboard() {
  const user = useUser();
  const { colors: C } = useTheme();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const f = { year: params.get('year') || '', semester: params.get('semester') || '', subject_id: params.get('subject') || '' };
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const qs = new URLSearchParams(Object.entries({ year: f.year, semester: f.semester, subject_id: f.subject_id }).filter(([, v]) => v)).toString();

  useEffect(() => {
    let live = true;
    const load = () => api.get(`/dashboard${qs ? `?${qs}` : ''}`).then((x) => live && setD(x)).catch((e) => live && setErr(e.message));
    load();
    const t = setInterval(load, 8000);
    return () => { live = false; clearInterval(t); };
  }, [qs]);

  const setF = (k, v) => {
    const p = new URLSearchParams(params);
    v ? p.set(k, v) : p.delete(k);
    setParams(p, { replace: true });
  };
  const newTestUrl = `/tests/new?${new URLSearchParams({ year: f.year && f.year !== 'none' ? f.year : currentAcademicYear(), ...(f.semester && f.semester !== 'none' ? { semester: f.semester } : {}), ...(f.subject_id ? { subject: f.subject_id } : {}) })}`;

  if (err && !d) return <div className="err">{err}</div>;
  if (!d) return <p className="muted">Loading…</p>;
  const t = d.totals;
  const filtered = !!(f.year || f.semester || f.subject_id);
  const scope = filtered ? [f.year === 'none' ? 'No year' : f.year, f.semester === 'none' ? 'No semester' : f.semester && `Semester ${f.semester}`, d.filters.subjects.find((s) => s.id === f.subject_id)?.name].filter(Boolean).join(' · ') : 'All terms';
  const tests = d.tests.filter((x) => !q || `${x.title} ${x.subject_name}`.toLowerCase().includes(q.toLowerCase()));
  const first = user?.name?.split(' ')[0];

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <div className="eyebrow">Overview <span className="scope-pill">{scope}</span></div>
          <h1>{greeting()}{first ? <>, <em>{first}</em></> : ''}</h1>
          <div className="muted">Here is how your classes are doing.</div>
        </div>
        <Link to="/students" className="btn">Students</Link>
        <Link to={newTestUrl} className="btn primary">+ New test{f.semester && f.semester !== 'none' ? ` in Sem ${f.semester}` : ''}</Link>
      </div>

      {!d.ai_configured && <div className="warnbox">The local AI is not ready. Start <b>Ollama</b> and pull the models listed in the server console (e.g. <span className="mono">ollama pull qwen3-vl:2b-instruct</span>) before creating a test.</div>}
      {d.ai_mock && <div className="note small">Demo mode: the AI is simulated (<span className="mono">MOCK_AI=1</span>), so marks are not real.</div>}

      <div className="card filterbar">
        <div className="fb-group">
          <label htmlFor="fy">Academic year</label>
          <select id="fy" value={f.year} onChange={(e) => setF('year', e.target.value)}>
            <option value="">All years</option>
            {d.filters.years.map((y) => <option key={y} value={y}>{y}</option>)}
            {d.filters.unassigned && <option value="none">No year set</option>}
          </select>
        </div>
        <div className="fb-group grow">
          <label>Semester</label>
          <div className="chips" role="group" aria-label="Semester">
            <button className={!f.semester ? 'on' : ''} onClick={() => setF('semester', '')}>All</button>
            {SEMESTERS.map((s) => (
              <button key={s} className={`${f.semester === String(s) ? 'on' : ''} ${d.filters.semesters.includes(s) ? 'has' : ''}`} onClick={() => setF('semester', f.semester === String(s) ? '' : String(s))} title={d.filters.semesters.includes(s) ? `Semester ${s}` : `Semester ${s} (no tests yet)`}>{s}</button>
            ))}
          </div>
        </div>
        <div className="fb-group">
          <label htmlFor="fs">Subject</label>
          <select id="fs" value={f.subject_id} onChange={(e) => setF('subject', e.target.value)}>
            <option value="">All subjects</option>
            {d.filters.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        {filtered && <button className="btn sm ghost" onClick={() => setParams({}, { replace: true })}>Clear</button>}
      </div>

      <div className="kpis">
        <Kpi label="Tests" value={t.tests} sub={t.running ? `${t.running} evaluating now` : `${t.completed} completed`} />
        <Kpi label="Students" value={t.students} sub={`${t.scripts} scripts evaluated`} onClick={() => nav(`/students${qs ? `?${qs}` : ''}`)} />
        <Kpi label="Class average" value={t.scripts ? `${t.average}%` : '-'} tone={t.scripts ? pctClass(t.average) : ''} sub={<Bar value={t.average} />} />
        <Kpi label="Pass rate" value={t.scripts ? `${t.pass_rate}%` : '-'} sub={`Pass mark ${t.pass_percent}%`} />
        <Kpi label="Needs review" value={t.needs_review} tone={t.needs_review ? 'warn' : ''} sub={t.needs_review ? 'answers to confirm' : 'All confirmed'} />
      </div>

      <div className="dash-grid">
        <div className="dash-main">
          <div className="card">
            <div className="card-head">
              <h2>Tests</h2>
              <span className="muted small">{tests.length} shown</span>
              <div className="spacer" />
              <input className="search-sm" placeholder="Search tests…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tests" />
            </div>
            {!d.tests.length ? (
              <div className="empty">
                <div className="empty-icon">📝</div>
                <b>No tests {filtered ? 'in this selection' : 'yet'}</b>
                <div className="muted small" style={{ margin: '4px 0 14px' }}>{filtered ? 'Try another year or semester, or create a test here.' : 'Create your first test to start evaluating answer sheets.'}</div>
                <Link to={newTestUrl} className="btn primary sm">+ New test</Link>
              </div>
            ) : (
              <div className="scroll"><table className="tests-table">
                <thead><tr><th>Test</th><th>Term</th><th>Students</th><th>Average</th><th>Status</th></tr></thead>
                <tbody>{tests.map((x) => (
                  <tr key={x.id} className="click" onClick={() => nav(`/tests/${x.id}`)}>
                    <td><Link to={`/tests/${x.id}`} onClick={(e) => e.stopPropagation()}><b>{x.title}</b></Link><div className="muted small">{x.subject_name} · {fmtDate(x.created_at)}</div></td>
                    <td><TermBadge year={x.academic_year} sem={x.semester} /></td>
                    <td>{x.students || '-'}</td>
                    <td style={{ minWidth: 120 }}>{x.status === 'completed' && x.students ? <><b>{x.average}%</b><Bar value={x.average} /></> : <span className="muted">-</span>}</td>
                    <td><Status s={x.status} />{x.needs_review > 0 && <div className="small" style={{ color: 'var(--warn)' }}>{x.needs_review} to review</div>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </div>

          {d.trend.length > 1 && (
            <div className="card">
              <div className="card-head"><h2>Performance over time</h2><span className="muted small">class average per test</span></div>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={d.trend.map((x) => ({ ...x, label: x.title.length > 14 ? `${x.title.slice(0, 13)}…` : x.title }))} margin={{ left: -18, right: 8, top: 6 }}>
                  <defs><linearGradient id="avgfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.accent} stopOpacity={0.35} /><stop offset="100%" stopColor={C.accent} stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" fontSize={11} /><YAxis domain={[0, 100]} fontSize={11} />
                  <Tooltip formatter={(v, n) => [`${v}%`, n === 'average' ? 'Average' : 'Pass rate']} labelFormatter={(_, p) => p?.[0] ? `${p[0].payload.title} · ${p[0].payload.subject_name}` : ''} />
                  <Area type="monotone" dataKey="average" stroke={C.accent} strokeWidth={2} fill="url(#avgfill)" />
                  <Area type="monotone" dataKey="pass_rate" stroke={C.ok} strokeWidth={1.5} fill="none" strokeDasharray="4 3" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="dash-side">
          <div className="card">
            <div className="card-head"><h2>Subjects</h2></div>
            {!d.subjects.length ? <div className="muted small">No subjects in this selection.</div> : d.subjects.map((s) => (
              <Link key={s.id} to={`/subjects/${s.id}`} className="subj-row">
                <div className="subj-ico">{s.name.slice(0, 2).toUpperCase()}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="flex" style={{ gap: 6 }}><b className="ell" style={{ flex: 1 }}>{s.name}</b><span className="small">{s.average ? `${s.average}%` : '-'}</span></div>
                  <Bar value={s.average} />
                  <div className="muted small">{s.tests} test{s.tests === 1 ? '' : 's'} · {s.students} students</div>
                </div>
              </Link>
            ))}
          </div>

          <div className="card">
            <div className="card-head"><h2>Needs support</h2><Link to={`/students${qs ? `?${qs}` : ''}`} className="small">All students →</Link></div>
            {!d.attention.length ? <div className="muted small">Nobody is below the pass mark here. 🎉</div> : d.attention.map((s) => (
              <Link key={s.key} to={`/students/${s.key}`} className="stu-row">
                <span className="avatar sm">{s.name.slice(0, 1)}</span>
                <div style={{ flex: 1, minWidth: 0 }}><div className="ell"><b>{s.name}</b></div><div className="muted small">{s.roll_no || 'No roll no'}{s.needs_review ? ` · ${s.needs_review} to review` : ''}</div></div>
                <Sparkline values={s.trend} width={56} />
                <b className={`pct ${pctClass(s.average)}`}>{s.average}%</b>
              </Link>
            ))}
          </div>

          {d.top.length > 0 && (
            <div className="card">
              <div className="card-head"><h2>Top performers</h2></div>
              {d.top.map((s, i) => (
                <Link key={s.key} to={`/students/${s.key}`} className="stu-row">
                  <span className={`medal m${i}`}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}><div className="ell"><b>{s.name}</b></div><div className="muted small">{s.tests} test{s.tests === 1 ? '' : 's'}</div></div>
                  <b className={`pct ${pctClass(s.average)}`}>{s.average}%</b>
                </Link>
              ))}
            </div>
          )}

          {d.terms.length > 0 && (
            <div className="card">
              <div className="card-head"><h2>Terms</h2></div>
              <div className="term-list">
                {d.terms.slice(0, 8).map((x) => (
                  <button key={`${x.academic_year}|${x.semester}`} className="term-btn" onClick={() => setParams(new URLSearchParams({ year: x.academic_year || 'none', semester: x.semester ? String(x.semester) : 'none' }), { replace: true })}>
                    <span>{fmtTerm(x.academic_year, x.semester)}</span><span className="muted small">{x.tests} test{x.tests === 1 ? '' : 's'}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
