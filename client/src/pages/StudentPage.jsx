import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Stat, Status, Bar, Tabs, Modal, pctClass } from '../components/ui.jsx';
import MarkedScript from './MarkedScript.jsx';

const AGENT_NAMES = { logic: 'Logic', concept: 'Concept', coverage: 'Coverage', factcheck: 'Fact-check' };

function Override({ q, testId, rid, onSaved }) {
  const [marks, setMarks] = useState(q.marks);
  const [comment, setComment] = useState(q.teacher_comment || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    setBusy(true); setErr('');
    try { const d = await api.put(`/tests/${testId}/results/${rid}/questions/${q.q_id}`, { marks, comment }); onSaved(d.result); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div>
      <div className="sec-title">Teacher review</div>
      {err && <div className="err">{err}</div>}
      <div className="flex">
        <input type="number" step="0.5" min="0" max={q.max} value={marks} onChange={(e) => setMarks(e.target.value)} style={{ width: 90 }} /> <span className="muted">/ {q.max}</span>
        <input placeholder="Optional comment for the student" value={comment} onChange={(e) => setComment(e.target.value)} style={{ flex: 1, minWidth: 180, width: 'auto' }} />
        <button className="btn sm primary" disabled={busy} onClick={save}>{q.status === 'review' ? 'Confirm marks' : 'Save'}</button>
      </div>
    </div>
  );
}

function Question({ q, testId, rid, onSaved, openByDefault }) {
  const [open, setOpen] = useState(openByDefault);
  const p = (q.marks / (q.max || 1)) * 100;
  return (
    <div className="q" style={!q.counted ? { opacity: 0.6 } : undefined}>
      <div className="q-head" onClick={() => setOpen(!open)}>
        <div style={{ width: 54 }}><b>Q{q.q_id}</b></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{q.text}</div>
          <div style={{ maxWidth: 220, marginTop: 4 }}><Bar value={p} /></div>
        </div>
        {!q.counted && <span className="badge b-gray">Not counted (choice)</span>}
        <Status s={q.status} />
        <div style={{ width: 76, textAlign: 'right' }}><b style={{ fontSize: 17 }}>{q.marks}</b><span className="muted"> / {q.max}</span></div>
        <span className="muted">{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div className="q-body">
          {q.flag_reason && <div className="warnbox" style={{ margin: 0 }}>Flagged for review: {q.flag_reason}</div>}
          <div className="grid g2">
            <div><div className="sec-title">Student's answer {q.legibility != null && <span className="muted">(OCR legibility {Math.round(q.legibility * 100)}%)</span>}</div><div className="box">{q.answer_text || <span className="muted">No text answer</span>}</div>
              {q.struck_out && <div className="hint">Struck out by student: {q.struck_out}</div>}</div>
            <div><div className="sec-title">Model answer</div><div className="box">{q.model_answer || '-'}</div>
              {q.key_points?.length > 0 && <div className="hint">Key points: {q.key_points.map((k) => `${k.text} (${k.marks})`).join(' - ')}</div>}</div>
          </div>
          {q.feedback && <div><div className="sec-title">Feedback</div><div>{q.feedback}</div></div>}
          <div className="grid g2">
            {q.strengths?.length > 0 && <div><div className="sec-title">Strengths</div><ul className="tight">{q.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
            {q.issues?.length > 0 && <div><div className="sec-title">Issues</div><ul className="tight">{q.issues.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
          </div>

          <div className="grid g2">
            <div>
              <div className="sec-title">Agent panel - confidence {Math.round(q.confidence * 100)}%{q.spread != null && ` - spread ${q.spread}`}</div>
              {Object.entries(q.agents || {}).map(([k, a]) => (
                <div className="agent" key={k} title={a.feedback}><span>{AGENT_NAMES[k]}</span><Bar value={a.fraction * 100} /><span className="right">{(a.fraction * q.max).toFixed(1)} <span className="muted">({Math.round(a.confidence * 100)}%)</span></span></div>
              ))}
              {q.arbiter_reasoning && <div className="box" style={{ marginTop: 8 }}><b>Senior re-evaluation:</b> {q.arbiter_reasoning}</div>}
            </div>
            {q.graph && (
              <div>
                <div className="sec-title">Reasoning graph vs model - nodes {Math.round(q.graph.node_coverage * 100)}%, flow {Math.round(q.graph.edge_alignment * 100)}%</div>
                {q.graph.matched.map((m, i) => <span key={i} className={`pill ${m.full ? 'm' : 'e'}`} title={`Student wrote: ${m.student}`}>{m.full ? '✓' : '~'} {m.ref}</span>)}
                {q.graph.missing.map((m, i) => <span key={i} className="pill x" title="Missing from the student's reasoning">✗ {m}</span>)}
                {q.graph.extra.length > 0 && <div className="hint">Extra steps: {q.graph.extra.join(' | ')}</div>}
              </div>
            )}
          </div>

          {q.figure && (
            <div>
              <div className="sec-title">Diagram / figure analysis</div>
              {q.figure.figure_present ? (
                <div className="box">
                  <b>{q.figure.kind}</b> - correctness {Math.round(q.figure.correctness * 100)}% (confidence {Math.round((q.figure.confidence || 0) * 100)}%)<br />{q.figure.description}
                  {q.figure.labels_missing?.length > 0 && <div>Missing labels: {q.figure.labels_missing.join(', ')}</div>}
                  {q.figure.errors?.length > 0 && <div>Errors: {q.figure.errors.join('; ')}</div>}
                </div>
              ) : <div className="box">Expected figure was not drawn.</div>}
            </div>
          )}
          {q.teacher_comment && <div className="note">Teacher comment: {q.teacher_comment}</div>}
          {q.status !== 'unattempted' && <Override q={q} testId={testId} rid={rid} onSaved={onSaved} />}
        </div>
      )}
    </div>
  );
}

function Learning({ g }) {
  if (!g) return <div className="card empty">Learning pack not generated yet.</div>;
  if (g.error) return <div className="err">Could not generate learning pack: {g.error}</div>;
  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card"><h2>Summary</h2><p style={{ marginTop: 0 }}>{g.summary}</p>
        {g.strengths?.length > 0 && <><div className="sec-title">Strengths</div>{g.strengths.map((s, i) => <span key={i} className="pill m">{s}</span>)}</>}
        {g.study_plan?.length > 0 && <><div className="sec-title" style={{ marginTop: 12 }}>Study plan</div><ol className="tight">{g.study_plan.map((s, i) => <li key={i}>{s}</li>)}</ol></>}</div>
      {g.weaknesses?.length > 0 && <div className="card"><h2>Knowledge gaps</h2><table><tbody>{g.weaknesses.map((w, i) => <tr key={i}><td><b>{w.topic}</b><div className="muted small">{w.evidence}</div></td><td><span className={`badge ${w.severity === 'high' ? 'b-bad' : w.severity === 'medium' ? 'b-warn' : 'b-gray'}`}>{w.severity}</span></td><td className="muted">{(w.q_ids || []).map((x) => `Q${x}`).join(', ')}</td></tr>)}</tbody></table></div>}
      {g.step_explanations?.length > 0 && <div className="card"><h2>Where the reasoning went wrong</h2>{g.step_explanations.map((s, i) => <div key={i} style={{ marginBottom: 12 }}><b>Q{s.q_id}</b><div className="box" style={{ marginTop: 4 }}><b>Issue:</b> {s.where_it_went_wrong}{'\n'}<b>Correct reasoning:</b> {s.correct_reasoning}</div></div>)}</div>}
      {g.notes?.length > 0 && <div className="card"><h2>Revision notes</h2>{g.notes.map((n, i) => <div key={i} style={{ marginBottom: 12 }}><b>{n.topic}</b><div className="md box" style={{ marginTop: 4 }}>{n.content}</div></div>)}</div>}
      {g.practice_questions?.length > 0 && <div className="card"><h2>Practice questions</h2><ol>{g.practice_questions.map((p, i) => <li key={i} style={{ marginBottom: 8 }}>{p.question} <span className="badge b-gray">{p.difficulty}</span><div className="muted small">{p.topic}{p.hint ? ` - Hint: ${p.hint}` : ''}</div></li>)}</ol></div>}
      {g.videos?.length > 0 && <div className="card"><h2>Video lessons</h2>{g.videos.map((v, i) => <div key={i}><a href={v.url} target="_blank" rel="noreferrer">▶ {v.topic}</a> <span className="muted small">- search: "{v.query}"</span></div>)}</div>}
    </div>
  );
}

export default function StudentPage() {
  const { id, rid } = useParams();
  const [d, setD] = useState(null);
  const [tab, setTab] = useState('script');
  const [scan, setScan] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { api.get(`/tests/${id}/results/${rid}`).then(setD).catch((e) => setErr(e.message)); }, [id, rid]);
  if (err) return <div className="err">{err}</div>;
  if (!d) return <p className="muted">Loading...</p>;
  const r = d.result;
  const onSaved = (nr) => setD({ ...d, result: { ...d.result, ...nr } });
  const isPdf = true;

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <div className="crumbs"><Link to="/">Dashboard</Link><span>/</span><Link to={`/tests/${id}`}>{d.test.title}</Link><span>/</span>{r.name}</div>
          <h1>{r.name} <Status s={r.status} /></h1>
          <div className="muted">{r.roll_no ? `Roll no ${r.roll_no}` : 'Roll number not found'}{r.section ? ` - Section ${r.section}` : ''}{r.identity_confidence != null && r.identity_confidence < 0.6 ? ' - (name read with low confidence, please verify)' : ''}</div>
        </div>
        {r.total != null && <Link className="btn" to={`/students/${r.student_key}`}>All tests &amp; analytics →</Link>}
        <button className="btn" onClick={() => setScan(true)}>View original scan</button>
      </div>
      {r.status === 'error' && <div className="err">This script could not be processed: {r.error}. Re-upload the file in a new test, or retry from the Pipeline tab.</div>}
      {r.total != null && (
        <div className="grid g4" style={{ marginBottom: 16 }}>
          <Stat label="Total marks" value={<>{r.total}<span className="muted" style={{ fontSize: 16 }}> / {r.max_total}</span></>} sub={`${r.percentage}% - Grade ${r.grade}`} />
          <Stat label="Class rank" value={`${d.rank} / ${d.class_size}`} sub={`Class average ${d.class_average}%`} />
          <Stat label="Questions needing review" value={r.review_count} />
          <div className="card stat"><div className="l">Score</div><div style={{ marginTop: 14 }}><Bar value={r.percentage} cls={pctClass(r.percentage)} /></div></div>
        </div>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[['script', 'Marked script'], ['questions', 'Question-wise marks'], ['learning', 'Learning pack']]} />
      {tab === 'questions' && r.questions.map((q) => <Question key={q.q_id} q={q} testId={id} rid={rid} onSaved={onSaved} openByDefault={q.status === 'review'} />)}
      {tab === 'learning' && <Learning g={r.gaps} />}
      {tab === 'script' && <MarkedScript testId={id} rid={rid} result={r} test={d.test} rank={d.rank} classSize={d.class_size} onSaved={onSaved} />}
      {r.notes && <div className="hint">Transcriber notes: {r.notes}</div>}
      {scan && <Modal title={`Original script - ${r.name}`} onClose={() => setScan(false)}>{isPdf && <iframe title="scan" src={api.fileUrl(`/tests/${id}/files/unit/${r.unit_id}`)} />}</Modal>}
    </>
  );
}
