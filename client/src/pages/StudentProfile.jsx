import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, RadarChart, PolarGrid, PolarAngleAxis, Radar } from 'recharts';
import { api } from '../api.js';
import { useTheme } from '../theme.jsx';
import { Status, Bar, TermBadge, Delta, fmtTerm, fmtDate, pctClass } from '../components/ui.jsx';

const SKILLS = [['logic', 'Logic & working'], ['concept', 'Concepts'], ['coverage', 'Coverage'], ['factcheck', 'Facts & units']];
const TYPE_LABEL = { definition: 'Definitions', short: 'Short answer', long: 'Long answer', numerical: 'Numericals', derivation: 'Derivations', diagram: 'Diagrams', mcq: 'MCQ', code: 'Code', other: 'Other' };

function Kpi({ label, value, sub, tone }) {
  return <div className={`card kpi ${tone || ''}`}><div className="l">{label}</div><div className="v">{value}</div>{sub && <div className="muted small">{sub}</div>}</div>;
}

export default function StudentProfile() {
  const { key } = useParams();
  const nav = useNavigate();
  const { colors: C } = useTheme();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => { setD(null); api.get(`/students/${key}`).then(setD).catch((e) => setErr(e.message)); }, [key]);

  const terms = useMemo(() => (d ? [...new Set(d.results.map((r) => `${r.academic_year || ''}|${r.semester || ''}`))] : []), [d]);
  if (err) return <div className="err">{err}</div>;
  if (!d) return <p className="muted">Loading…</p>;
  const s = d.summary;
  const rows = d.results.filter((r) => !term || `${r.academic_year || ''}|${r.semester || ''}` === term);
  const chart = rows.filter((r) => r.percentage != null).map((r) => ({ name: r.title.length > 12 ? `${r.title.slice(0, 11)}…` : r.title, title: r.title, Student: r.percentage, Class: r.class_average }));
  const skills = SKILLS.filter(([k]) => d.skills[k] != null).map(([k, label]) => ({ skill: label, value: d.skills[k] }));
  const weakestSkill = skills.length ? [...skills].sort((a, b) => a.value - b.value)[0] : null;

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <div className="crumbs"><Link to="/">Dashboard</Link><span>/</span><Link to="/students">Students</Link><span>/</span>{d.student.name}</div>
          <div className="flex" style={{ gap: 14, flexWrap: 'nowrap' }}>
            <span className="avatar lg">{d.student.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
            <div style={{ minWidth: 0 }}>
              <h1 style={{ margin: 0 }}>{d.student.name}</h1>
              <div className="muted">{d.student.roll_no ? <span className="mono">{d.student.roll_no}</span> : 'Roll number not read'}{d.student.section ? ` · Section ${d.student.section}` : ''} · {s.tests} test{s.tests === 1 ? '' : 's'}</div>
              {d.student.names.length > 1 && <div className="muted small">Also read as: {d.student.names.filter((n) => n !== d.student.name).join(', ')}</div>}
              {s.needs_review > 0 && <span className="badge b-warn" style={{ marginTop: 6 }}>{s.needs_review} result{s.needs_review > 1 ? 's have' : ' has'} answers to review</span>}
            </div>
          </div>
        </div>
        {terms.length > 1 && (
          <select style={{ width: 'auto' }} value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Term">
            <option value="">All terms</option>
            {terms.map((t) => { const [y, sm] = t.split('|'); return <option key={t} value={t}>{fmtTerm(y, sm)}</option>; })}
          </select>
        )}
      </div>

      <div className="kpis">
        <Kpi label="Average" value={`${s.average}%`} tone={pctClass(s.average)} sub={<Bar value={s.average} />} />
        <Kpi label="Latest" value={s.latest != null ? `${s.latest}%` : '-'} sub={<Delta v={s.change} />} />
        <Kpi label="Best / lowest" value={s.best != null ? `${s.best}% / ${s.worst}%` : '-'} />
        <Kpi label="Passed" value={`${s.passed} / ${s.graded}`} sub={`Pass mark ${s.pass_percent}%`} />
        <Kpi label="Above class average" value={`${s.above_class} / ${s.graded}`} sub="tests" />
      </div>

      <div className="grid g2" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-head"><h2>Progress across tests</h2><span className="muted small">vs class average</span></div>
          {chart.length > 1 ? (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={chart} margin={{ left: -18, right: 8, top: 6 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" fontSize={11} /><YAxis domain={[0, 100]} fontSize={11} />
                <Tooltip formatter={(v) => `${v}%`} labelFormatter={(_, p) => p?.[0]?.payload.title || ''} /><Legend />
                <Line type="monotone" dataKey="Student" stroke={C.accent} strokeWidth={2.5} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="Class" stroke={C.muted} strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : <div className="empty">One test so far. The progress chart appears after the next one.</div>}
        </div>
        <div className="card">
          <div className="card-head"><h2>Skill profile</h2><span className="muted small">from the four grading agents</span></div>
          {skills.length ? (
            <div className="skill-wrap">
              <ResponsiveContainer width="100%" height={210}>
                <RadarChart data={skills} outerRadius="58%" margin={{ left: 48, right: 48, top: 12, bottom: 12 }}>
                  <PolarGrid stroke={C.grid} /><PolarAngleAxis dataKey="skill" fontSize={11} />
                  <Radar dataKey="value" stroke={C.accent} fill={C.accent} fillOpacity={0.25} />
                </RadarChart>
              </ResponsiveContainer>
              <div>
                {skills.map((x) => <div key={x.skill} className="skill-row"><span>{x.skill}</span><Bar value={x.value} /><b>{x.value}%</b></div>)}
                {weakestSkill && <div className="hint">Weakest area: <b>{weakestSkill.skill}</b>.</div>}
              </div>
            </div>
          ) : <div className="empty">No graded answers yet.</div>}
        </div>
      </div>

      <div className="grid g3" style={{ marginBottom: 16 }}>
        <div className="card">
          <h2>By subject</h2>
          {d.by_subject.map((x) => <div key={x.subject_id} className="skill-row"><span className="ell">{x.name}</span><Bar value={x.average} /><b>{x.average}%</b></div>)}
        </div>
        <div className="card">
          <h2>By question type</h2>
          {d.by_type.map((x) => <div key={x.type} className="skill-row" title={`${x.questions} questions`}><span>{TYPE_LABEL[x.type] || x.type}</span><Bar value={x.average} /><b>{x.average}%</b></div>)}
          <div className="hint">{d.questions.full} full marks · {d.questions.zero} zero · {d.questions.unattempted} not attempted of {d.questions.total} questions</div>
        </div>
        <div className="card">
          <h2>By term</h2>
          {d.by_term.map((x) => <div key={`${x.academic_year}|${x.semester}`} className="skill-row"><span>{fmtTerm(x.academic_year, x.semester)}</span><Bar value={x.average} /><b>{x.average}%</b></div>)}
        </div>
      </div>

      <div className="grid g2" style={{ marginBottom: 16 }}>
        <div className="card">
          <h2>Recurring knowledge gaps</h2>
          {!d.weaknesses.length ? <div className="muted small">No gaps recorded yet (learning packs appear after the knowledge-gap step runs).</div> : (
            <table><tbody>{d.weaknesses.map((w) => (
              <tr key={w.topic}><td><b>{w.topic}</b><div className="muted small">{w.tests.join(', ')}</div></td><td><span className={`badge ${w.severity === 'high' ? 'b-bad' : w.severity === 'medium' ? 'b-warn' : 'b-gray'}`}>{w.severity}</span></td><td className="muted small nowrap">{w.count}×</td></tr>
            ))}</tbody></table>
          )}
        </div>
        <div className="card">
          <h2>Strengths & next steps</h2>
          {d.strengths.length > 0 && <div style={{ marginBottom: 12 }}>{d.strengths.map((x) => <span key={x.topic} className="pill m">{x.topic}</span>)}</div>}
          {d.study_plan.length ? <><div className="sec-title">Latest study plan</div><ol className="tight">{d.study_plan.map((p, i) => <li key={i}>{p}</li>)}</ol></> : <div className="muted small">No study plan yet.</div>}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Test history</h2><span className="muted small">click a test for question-wise marks and the learning pack</span></div>
        <div className="scroll"><table>
          <thead><tr><th>Test</th><th>Term</th><th>Marks</th><th>%</th><th>Grade</th><th>Rank</th><th>Class avg</th><th>Status</th></tr></thead>
          <tbody>{[...rows].reverse().map((r) => (
            <tr key={r.id} className="click" onClick={() => nav(`/tests/${r.test_id}/students/${r.id}`)}>
              <td><Link to={`/tests/${r.test_id}/students/${r.id}`} onClick={(e) => e.stopPropagation()}><b>{r.title}</b></Link><div className="muted small">{r.subject_name} · {fmtDate(r.date)}</div></td>
              <td><TermBadge year={r.academic_year} sem={r.semester} /></td>
              <td>{r.total ?? '-'}<span className="muted"> / {r.max_total}</span></td>
              <td><b className={`pct ${r.percentage != null ? pctClass(r.percentage) : ''}`}>{r.percentage ?? '-'}</b></td>
              <td>{r.grade || '-'}</td>
              <td>{r.rank ? `${r.rank} / ${r.class_size}` : '-'}</td>
              <td className="muted">{r.class_average}%</td>
              <td><Status s={r.status} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>
    </>
  );
}
