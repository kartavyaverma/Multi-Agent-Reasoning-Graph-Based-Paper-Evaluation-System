import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BarChart, Bar as RBar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';
import { api } from '../api.js';
import { Stat, Status, Bar, Tabs, fmtDate, fmtDur, pctClass } from '../components/ui.jsx';

const COLORS = { ok: '#22a55b', warn: '#e19a1c', bad: '#dc4444' };

function Pipeline({ testId, data, onRetry, onStop, onResume }) {
  const { nodes, workflow, eta_seconds } = data;
  const done = nodes.filter((n) => n.status === 'completed').length;
  return (
    <div className="card">
      <div className="flex" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0, flex: 1 }}>Evaluation pipeline <span className="muted small">({done}/{nodes.length} stages)</span></h2>
        {workflow.status === 'running' && <><span className="muted small">Estimated time left: ~{fmtDur(eta_seconds)}</span><button className="btn sm" onClick={onStop}>Pause</button></>}
        {['stopped', 'failed'].includes(workflow.status) && <button className="btn sm primary" onClick={onResume}>Resume</button>}
        <Link className="btn sm" to={`/tests/${testId}/workflow`}>Open live workflow view</Link>
      </div>
      <Bar value={(done / nodes.length) * 100} cls="" />
      {workflow.error && <div className="err" style={{ marginTop: 12 }}>{workflow.error}</div>}
      <div style={{ marginTop: 8 }}>
        {nodes.map((n, i) => {
          const st = n.status === 'completed' ? 'completed' : n.status === 'failed' ? 'failed' : ['pending', 'ready'].includes(n.status) && n.started_at ? 'running' : 'waiting';
          const p = n.progress;
          return (
            <div key={n.id} className="stage">
              <div className={`dot ${st}`}>{st === 'completed' ? '✓' : st === 'failed' ? '!' : i + 1}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="flex"><b>{n.label}</b>{p?.total > 0 && <span className="muted small">{p.done}/{p.total}</span>}{n.try_count > 0 && n.status !== 'completed' && <span className="badge b-warn">retry {n.try_count}</span>}</div>
                <div className="muted small">{n.description}</div>
                {p?.total > 1 && st !== 'completed' && <div style={{ marginTop: 4, maxWidth: 360 }}><Bar value={(p.done / p.total) * 100} cls="" /></div>}
                {n.error && <div className="small" style={{ color: 'var(--bad)', marginTop: 4 }}>{n.error}</div>}
                {st === 'failed' && <button className="btn sm" style={{ marginTop: 6 }} onClick={() => onRetry(n.id)}>Retry this stage</button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Overview({ a }) {
  if (!a.graded) return <div className="card empty">No graded students yet.</div>;
  return (
    <>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat label="Students" value={a.students} sub={a.errors ? `${a.errors} failed to process` : undefined} />
        <Stat label="Average" value={`${a.average}%`} sub={`Median ${a.median}%`} />
        <Stat label="Highest / Lowest" value={`${a.highest}% / ${a.lowest}%`} />
        <Stat label="Pass rate" value={`${a.pass_rate}%`} sub={`Pass mark ${a.pass_percent}%`} />
      </div>
      <div className="grid g2">
        <div className="card">
          <h2>Marks distribution (% of total)</h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={a.distribution}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="range" fontSize={12} /><YAxis allowDecimals={false} fontSize={12} /><Tooltip formatter={(v) => [`${v} students`, '']} />
              <RBar dataKey="count" radius={[5, 5, 0, 0]}>{a.distribution.map((d, i) => <Cell key={i} fill={COLORS[pctClass(d.from + 5)]} />)}</RBar></BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <h2>Question-wise average (%)</h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={a.questions.map((q) => ({ ...q, name: `Q${q.q_id}` }))}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" fontSize={12} /><YAxis domain={[0, 100]} fontSize={12} /><Tooltip formatter={(v) => [`${v}%`, 'Average']} />
              <RBar dataKey="avg_percent" radius={[5, 5, 0, 0]}>{a.questions.map((q, i) => <Cell key={i} fill={COLORS[pctClass(q.avg_percent)]} />)}</RBar></BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="grid g2" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Grades</h2>
          <div className="flex">{a.grades.sort((x, y) => x.grade.localeCompare(y.grade)).map((g) => <div key={g.grade} className="card stat" style={{ minWidth: 80, textAlign: 'center' }}><div className="v">{g.count}</div><div className="l">{g.grade}</div></div>)}</div>
          <h3 style={{ marginTop: 18 }}>Top performers</h3>
          <table><tbody>{a.toppers.map((t, i) => <tr key={t.id}><td>{i + 1}</td><td>{t.name}</td><td className="right"><b>{t.total}</b> <span className="muted">({t.percentage}%)</span></td></tr>)}</tbody></table>
        </div>
        <div className="card">
          <h2>Question details</h2>
          <div className="scroll"><table>
            <thead><tr><th>Q</th><th>Avg</th><th>Attempted</th><th>Full</th><th>Zero</th></tr></thead>
            <tbody>{a.questions.map((q) => (
              <tr key={q.q_id} title={q.text}><td><b>{q.q_id}</b></td><td style={{ minWidth: 110 }}>{q.avg_marks}/{q.max}<Bar value={q.avg_percent} /></td><td>{q.attempt_rate}%</td><td>{q.full_marks}</td><td>{q.zero_marks}</td></tr>
            ))}</tbody>
          </table></div>
        </div>
      </div>
    </>
  );
}

function Students({ testId, results }) {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('total');
  const [onlyReview, setOnlyReview] = useState(false);
  const qids = results.find((r) => r.questions.length)?.questions.map((x) => x.q_id) || [];
  const rows = useMemo(() => {
    let r = results.filter((x) => (x.name || '').toLowerCase().includes(q.toLowerCase()) || (x.roll_no || '').toLowerCase().includes(q.toLowerCase()));
    if (onlyReview) r = r.filter((x) => x.review_count > 0 || x.status === 'error');
    return [...r].sort((a, b) => (sort === 'name' ? (a.name || '').localeCompare(b.name || '') : (b.total ?? -1) - (a.total ?? -1)));
  }, [results, q, sort, onlyReview]);
  return (
    <div className="card">
      <div className="flex" style={{ marginBottom: 12 }}>
        <input style={{ maxWidth: 260 }} placeholder="Search name or roll no..." value={q} onChange={(e) => setQ(e.target.value)} />
        <select style={{ width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value)}><option value="total">Sort by marks</option><option value="name">Sort by name</option></select>
        <label className="flex" style={{ margin: 0, fontWeight: 500 }}><input type="checkbox" style={{ width: 'auto' }} checked={onlyReview} onChange={(e) => setOnlyReview(e.target.checked)} /> Needs review only</label>
        <div className="spacer" style={{ flex: 1 }} />
        <button className="btn sm" onClick={() => api.download(`/tests/${testId}/export.csv`, 'results.csv')}>Export CSV</button>
      </div>
      <div className="scroll"><table>
        <thead><tr><th>#</th><th>Student</th><th>Roll no</th><th>Total</th><th>%</th><th>Grade</th>{qids.map((id) => <th key={id}>Q{id}</th>)}<th>Status</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className="click" onClick={() => nav(`/tests/${testId}/students/${r.id}`)}>
              <td className="muted">{i + 1}</td>
              <td><Link to={`/tests/${testId}/students/${r.id}`} onClick={(e) => e.stopPropagation()}><b>{r.name}</b></Link></td>
              <td className="muted">{r.roll_no || '-'}</td>
              <td><b>{r.total ?? '-'}</b><span className="muted"> / {r.max_total}</span></td>
              <td>{r.percentage ?? '-'}</td><td>{r.grade || '-'}</td>
              {qids.map((id) => { const x = r.questions.find((y) => y.q_id === id); return <td key={id} style={{ color: x && !x.counted ? 'var(--muted)' : undefined }}>{x ? x.marks : '-'}<span className="muted small">/{x?.max}</span></td>; })}
              <td><Status s={r.status} />{r.review_count > 0 && <span className="muted small"> ({r.review_count})</span>}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {!rows.length && <div className="empty">No students match.</div>}
    </div>
  );
}

export default function TestPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [an, setAn] = useState(null);
  const [results, setResults] = useState([]);
  const [tab, setTab] = useState(null);
  const [err, setErr] = useState('');

  const load = async () => {
    try {
      const d = await api.get(`/tests/${id}`);
      setData(d);
      if (d.test.status === 'completed') {
        const [a, r] = await Promise.all([api.get(`/tests/${id}/analytics`), api.get(`/tests/${id}/results`)]);
        setAn(a.analytics); setResults(r.results);
      }
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); }, [id]);
  useEffect(() => {
    if (!data || data.test.status === 'completed') return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [data?.test.status, id]);

  if (err) return <div className="err">{err}</div>;
  if (!data) return <p className="muted">Loading...</p>;
  const { test } = data;
  const done = test.status === 'completed';
  const active = tab || (done ? 'overview' : 'pipeline');
  const act = (p) => async () => { await api.post(`/tests/${id}/${p}`); load(); };

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <div className="muted small"><Link to="/">Dashboard</Link> / <Link to={`/subjects/${test.subject_id}`}>{test.subject_name}</Link></div>
          <h1>{test.title} <Status s={test.status} /></h1>
          <div className="muted">{test.student_count || '?'} student script{test.student_count === 1 ? '' : 's'} - started {fmtDate(test.created_at)}</div>
        </div>
        <div className="flex">
          {test.files?.has_question_paper && <a className="btn sm" href={api.fileUrl(`/tests/${id}/files/question_paper`)} target="_blank" rel="noreferrer">Question paper</a>}
          {test.files?.has_model_answer && <a className="btn sm" href={api.fileUrl(`/tests/${id}/files/model_answer`)} target="_blank" rel="noreferrer">Model answer</a>}
          {data.workflow && <Link className="btn sm" to={`/tests/${id}/workflow`}>Workflow</Link>}
          <button className="btn sm danger" onClick={async () => { if (window.confirm('Delete this test and all its results?')) { await api.del(`/tests/${id}`); nav('/'); } }}>Delete</button>
        </div>
      </div>

      {!done && data.workflow?.status === 'running' && <div className="note">Your papers are being evaluated. This page updates automatically - it is safe to leave and return later.</div>}
      {done && an?.needs_review > 0 && <div className="warnbox"><b>{an.needs_review} student{an.needs_review > 1 ? 's have' : ' has'} answers the AI was not confident about.</b> Open the <button className="btn sm" onClick={() => setTab('students')}>Students</button> tab, filter by "Needs review" and confirm those marks.</div>}

      <Tabs value={active} onChange={setTab} tabs={[...(done ? [['overview', 'Overview'], ['students', 'Students']] : []), ['pipeline', 'Pipeline']]} />
      {active === 'overview' && an && <Overview a={an} />}
      {active === 'students' && <Students testId={id} results={results} />}
      {active === 'pipeline' && <Pipeline testId={id} data={data} onStop={act('stop')} onResume={act('resume')} onRetry={async (nid) => { await api.post(`/tests/${id}/nodes/${nid}/retry`); load(); }} />}
    </>
  );
}
