import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ''));

/** The four agents describe the same mistake in different words; keep one note per mistake. */
const STOP = new Set(['missing', 'missed', 'omitted', 'omits', 'the', 'a', 'an', 'of', 'no', 'not', 'and', 'or', 'to', 'in', 'is', 'incorrect', 'wrong', 'lacks', 'lack', 'did', 'does', 'student']);
const words = (s) => new Set(String(s).toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1').replace(/\bthird\b/g, '3').replace(/\bsecond\b/g, '2').replace(/\bfirst\b/g, '1').split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w)));
function dedupeNotes(list = []) {
  const kept = [];
  for (const s of list) {
    const w = words(s);
    const dup = kept.some((k) => { const kw = words(k); const common = [...w].filter((x) => kw.has(x)).length; return common && common / Math.min(w.size, kw.size) >= 0.6; });
    if (!dup) kept.push(s);
  }
  return kept.slice(0, 5);
}

/** How a question's marks break down by key point, from the coverage agent's verdict. */
function breakdown(q) {
  const kps = q.key_points || [];
  const cov = q.agents?.coverage;
  if (!kps.length || !cov) return null;
  const full = new Set(cov.key_points_covered || []), part = new Set(cov.key_points_partial || []);
  return kps.map((k) => {
    const m = Number(k.marks) || 0;
    if (full.has(k.id)) return { ...k, state: 'ok', got: m };
    if (part.has(k.id)) return { ...k, state: 'part', got: m / 2 };
    return { ...k, state: 'miss', got: 0 };
  });
}

/** The circled red mark; click to change it (saved immediately, like a teacher overriding). */
function MarkCircle({ q, testId, rid, onSaved }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(q.marks);
  const [busy, setBusy] = useState(false);
  useEffect(() => setV(q.marks), [q.marks]);
  const save = async () => {
    if (Number(v) === q.marks) return setEdit(false);
    setBusy(true);
    try { const d = await api.put(`/tests/${testId}/results/${rid}/questions/${q.q_id}`, { marks: v }); onSaved(d.result); setEdit(false); } catch (e) { window.alert(e.message); } finally { setBusy(false); }
  };
  if (q.status === 'unattempted') return <span className="ms-circle na">NA</span>;
  if (edit) {
    return (
      <span className="ms-circle editing">
        <input type="number" step="0.5" min="0" max={q.max} value={v} autoFocus disabled={busy}
          onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setV(q.marks); setEdit(false); } }} aria-label={`Marks for Q${q.q_id}`} />
      </span>
    );
  }
  return (
    <button type="button" className={`ms-circle ${q.status === 'teacher_reviewed' ? 'teacher' : ''}`} onClick={() => setEdit(true)} title="Click to change the marks">
      <b>{fmt(q.marks)}</b><span>/{q.max}</span>
    </button>
  );
}

function QuestionMarks({ q, testId, rid, onSaved }) {
  const bd = breakdown(q);
  const lost = Math.max(0, q.max - q.marks);
  return (
    <section className={`ms-q ${q.counted ? '' : 'not-counted'}`}>
      <div className="ms-q-head">
        <span className="ms-qno">Q{q.q_id}</span>
        <div className="ms-qtext">{q.text}</div>
        <MarkCircle q={q} testId={testId} rid={rid} onSaved={onSaved} />
      </div>
      {!q.counted && <div className="ms-note">Not counted: a better-scoring choice question was used instead.</div>}
      {q.flag_reason && <div className="ms-flag">⚑ Needs your review: {q.flag_reason}</div>}

      {q.status === 'unattempted' ? <div className="ms-blank">— not attempted —</div> : (
        <>
          <div className="ms-answer">{q.answer_text || <i>(diagram only)</i>}</div>
          {q.struck_out && <div className="ms-struck">{q.struck_out}</div>}
        </>
      )}

      {bd && (
        <ul className="ms-points">
          {bd.map((k) => (
            <li key={k.id} className={k.state}>
              <span className="ms-tick">{k.state === 'ok' ? '✓' : k.state === 'part' ? '½' : '✗'}</span>
              <span className="ms-kp">{k.text}</span>
              <span className="ms-kpm">{k.state === 'ok' ? `+${fmt(k.got)}` : k.state === 'part' ? `${fmt(k.got)} of ${fmt(Number(k.marks))}` : `−${fmt(Number(k.marks))}`}</span>
            </li>
          ))}
        </ul>
      )}

      {q.figure && (
        <div className={`ms-fig ${q.figure.figure_present ? '' : 'missing'}`}>
          <b>Diagram:</b> {q.figure.figure_present
            ? <>{Math.round((q.figure.correctness || 0) * 100)}% correct{q.figure.labels_missing?.length ? ` · missing labels: ${q.figure.labels_missing.join(', ')}` : ''}{q.figure.errors?.length ? ` · ${q.figure.errors.join('; ')}` : ''}</>
            : 'expected diagram not drawn'}
        </div>
      )}

      {(lost > 0 && (q.issues?.length > 0)) && (
        <div className="ms-deduct">
          <div className="ms-deduct-title">Marks lost: −{fmt(lost)}</div>
          <ul>{dedupeNotes(q.issues).map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      )}
      {q.feedback && <div className="ms-remark">{q.feedback}</div>}
      {q.teacher_comment && <div className="ms-remark teacher">Teacher: {q.teacher_comment}</div>}
    </section>
  );
}

/** Student's own script next to a red-pen marksheet: marks, ticks on key points and every deduction. */
export default function MarkedScript({ testId, rid, result: r, test, rank, classSize, onSaved }) {
  const [pages, setPages] = useState(null);
  const [showScan, setShowScan] = useState(true);
  const [err, setErr] = useState('');
  useEffect(() => {
    setPages(null);
    api.get(`/tests/${testId}/units/${r.unit_id}/pages`).then((d) => setPages(d.count)).catch((e) => setErr(e.message));
  }, [testId, r.unit_id]);
  const qs = r.questions || [];
  const counted = qs.filter((q) => q.counted);
  const lost = counted.reduce((s, q) => s + Math.max(0, q.max - q.marks), 0);

  return (
    <div className="ms-wrap">
      <div className="ms-toolbar">
        <div className="seg sm">
          <button className={showScan ? 'on' : ''} onClick={() => setShowScan(true)}>Script + marks</button>
          <button className={!showScan ? 'on' : ''} onClick={() => setShowScan(false)}>Marksheet only</button>
        </div>
        <span className="muted small">Click a circled mark to change it. Changes save instantly.</span>
        <div className="spacer" />
        <button className="btn sm" onClick={() => window.print()}>Print marksheet</button>
      </div>

      <div className={`ms-grid ${showScan ? '' : 'solo'}`}>
        {showScan && (
          <div className="ms-scan">
            {err && <div className="err">{err}</div>}
            {!pages && !err && <div className="empty">Preparing the answer sheet…</div>}
            {Array.from({ length: pages || 0 }, (_, i) => (
              <figure key={i} className="ms-page">
                <img src={api.fileUrl(`/tests/${testId}/units/${r.unit_id}/pages/${i + 1}`)} alt={`Answer sheet page ${i + 1}`} loading="lazy" />
                <figcaption>Page {i + 1} of {pages}</figcaption>
              </figure>
            ))}
          </div>
        )}

        <article className="ms-paper">
          <header className="ms-top">
            <div>
              <div className="ms-test">{test.title}</div>
              <div className="ms-name">{r.name}</div>
              <div className="ms-meta">{r.roll_no ? `Roll no ${r.roll_no}` : 'Roll no not read'}{r.section ? ` · Section ${r.section}` : ''}{rank ? ` · Rank ${rank} of ${classSize}` : ''}</div>
            </div>
            <div className="ms-total">
              <b>{fmt(r.total ?? 0)}</b><span>out of {r.max_total}</span>
              <em>{r.percentage}% · Grade {r.grade}</em>
            </div>
          </header>

          <table className="ms-grid-table">
            <tbody>
              <tr><th>Q</th>{qs.map((q) => <th key={q.q_id}>{q.q_id}</th>)}<th>Total</th></tr>
              <tr><th>Max</th>{qs.map((q) => <td key={q.q_id}>{q.max}</td>)}<td>{r.max_total}</td></tr>
              <tr className="got"><th>Marks</th>{qs.map((q) => <td key={q.q_id} className={!q.counted ? 'nc' : q.marks >= q.max ? 'full' : q.marks === 0 ? 'zero' : ''}>{q.status === 'unattempted' ? 'NA' : fmt(q.marks)}</td>)}<td><b>{fmt(r.total ?? 0)}</b></td></tr>
            </tbody>
          </table>
          {lost > 0 && <div className="ms-summary">Marks lost across the paper: <b>−{fmt(lost)}</b>. Every deduction is explained under its question.</div>}

          {qs.map((q) => <QuestionMarks key={q.q_id} q={q} testId={testId} rid={rid} onSaved={onSaved} />)}

          <footer className="ms-sign">Evaluated by PaperCheck · AI marks{qs.some((q) => q.status === 'teacher_reviewed') ? ', teacher-reviewed' : ''}</footer>
        </article>
      </div>
    </div>
  );
}
