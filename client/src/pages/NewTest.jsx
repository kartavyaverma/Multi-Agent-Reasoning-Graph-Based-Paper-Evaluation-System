import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.heic';
const sizeMb = (f) => (f.size < 1024 * 1024 ? `${Math.max(1, Math.round(f.size / 1024))} KB` : `${(f.size / 1024 / 1024).toFixed(1)} MB`);

/* ───────── drag & drop file zone ───────── */
function Drop({ multiple, files, onChange, title, sub, accept = ACCEPT, numbered }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);
  const add = (list) => {
    const incoming = [...list];
    if (!incoming.length) return;
    onChange(multiple ? [...files, ...incoming.filter((n) => !files.some((f) => f.name === n.name && f.size === n.size))] : [incoming[0]]);
  };
  return (
    <div>
      <div
        className={`dz ${over ? 'over' : ''} ${files.length ? 'has' : ''}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
      >
        <div className="dz-icon">⬆</div>
        <div><b>{title}</b></div>
        <div className="muted small">{sub} Click or drag and drop.</div>
        <input ref={input} type="file" accept={accept} multiple={multiple} hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
      </div>
      {files.length > 0 && (
        <div className="filelist">
          {files.slice(0, 60).map((f, i) => (
            <div key={`${f.name}-${i}`} className="fileitem">
              {numbered && <span className="muted small nowrap">Student {i + 1}</span>}
              <span className="fname">{f.name}</span><span className="muted small">{sizeMb(f)}</span>
              <button type="button" className="x" onClick={() => onChange(files.filter((_, j) => j !== i))} aria-label="Remove">×</button>
            </div>
          ))}
          {files.length > 60 && <div className="muted small">...and {files.length - 60} more</div>}
        </div>
      )}
    </div>
  );
}

function Seg({ value, onChange, options }) {
  return <div className="seg">{options.map(([k, l]) => <button type="button" key={k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{l}</button>)}</div>;
}

function Step({ n, title, sub, done, children }) {
  return (
    <section className="card step">
      <div className="step-head"><div className={`step-n ${done ? 'done' : ''}`}>{done ? '✓' : n}</div><div><h2 style={{ margin: 0 }}>{title}</h2>{sub && <div className="muted small">{sub}</div>}</div></div>
      {children}
    </section>
  );
}

const blank = (n) => ({ id: String(n), text: '', marks: '', has_figure: false, model_answer: '', key_points: [], _open: true });

/* ───────── one editable question ───────── */
function QRow({ q, i, typedAnswers, onChange, onRemove }) {
  const set = (patch) => onChange({ ...q, ...patch });
  const kpSum = q.key_points.reduce((s, k) => s + (Number(k.marks) || 0), 0);
  return (
    <div className="qrow">
      <div className="qrow-top">
        <input className="qid" value={q.id} onChange={(e) => set({ id: e.target.value })} aria-label="Question number" title="Question number, e.g. 1a" />
        <textarea className="qtext" rows={2} placeholder="Question text" value={q.text} onChange={(e) => set({ text: e.target.value })} />
        <div className="qmarks"><input type="number" min="0" step="0.5" placeholder="Marks" value={q.marks} onChange={(e) => set({ marks: e.target.value })} /></div>
        <button type="button" className="x" onClick={onRemove} aria-label="Remove question" title="Remove question">×</button>
      </div>
      <div className="qrow-opts">
        <label className="chk"><input type="checkbox" checked={q.has_figure} onChange={(e) => set({ has_figure: e.target.checked })} /> Needs a diagram / figure</label>
        <button type="button" className="linkbtn" onClick={() => set({ _open: !q._open })}>{q._open ? 'Hide' : 'Show'} {typedAnswers ? 'model answer & marking points' : 'marking points'}</button>
      </div>
      {q._open && (
        <div className="qrow-more">
          {typedAnswers && (
            <div className="field"><label>Model answer</label><textarea rows={4} placeholder="Type the ideal answer a student should write" value={q.model_answer} onChange={(e) => set({ model_answer: e.target.value })} /></div>
          )}
          <label>Marking points <span className="muted">(optional - what earns marks)</span></label>
          {q.key_points.map((k, j) => (
            <div className="kp" key={j}>
              <input placeholder={`Point ${j + 1}, e.g. "States Newton's first law"`} value={k.text} onChange={(e) => set({ key_points: q.key_points.map((x, m) => (m === j ? { ...x, text: e.target.value } : x)) })} />
              <input type="number" min="0" step="0.5" placeholder="Marks" style={{ width: 84 }} value={k.marks} onChange={(e) => set({ key_points: q.key_points.map((x, m) => (m === j ? { ...x, marks: e.target.value } : x)) })} />
              <button type="button" className="x" onClick={() => set({ key_points: q.key_points.filter((_, m) => m !== j) })} aria-label="Remove point">×</button>
            </div>
          ))}
          <div className="flex">
            <button type="button" className="btn sm" onClick={() => set({ key_points: [...q.key_points, { text: '', marks: '' }] })}>+ Add point</button>
            {q.key_points.length > 0 && Math.abs(kpSum - (Number(q.marks) || 0)) > 0.001 && <span className="small" style={{ color: 'var(--warn)' }}>Points add up to {kpSum}, question is {q.marks || 0} marks</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function NewTest() {
  const nav = useNavigate();
  const [subjects, setSubjects] = useState([]);
  const [subject, setSubject] = useState('');
  const [newSubject, setNewSubject] = useState('');
  const [title, setTitle] = useState('');

  const [qMode, setQMode] = useState('upload'); // upload | type
  const [qFile, setQFile] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [choiceRules, setChoiceRules] = useState([]);
  const [reading, setReading] = useState(false);
  const [readMsg, setReadMsg] = useState('');

  const [mMode, setMMode] = useState('upload'); // upload | type
  const [mFile, setMFile] = useState([]);

  const [sMode, setSMode] = useState('each'); // each: one file per student | combined: one PDF split by pages
  const [students, setStudents] = useState([]);
  const [pps, setPps] = useState('');
  const [total, setTotal] = useState('');

  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(0);
  const [err, setErr] = useState('');

  useEffect(() => { api.get('/subjects').then((d) => { setSubjects(d.subjects); if (!d.subjects.length) setSubject('__new'); }); }, []);

  const readQuestions = async () => {
    setReading(true); setErr(''); setReadMsg('');
    const fd = new FormData();
    fd.append('question_paper', qFile[0]);
    try {
      const d = await api.upload('/preview/questions', fd);
      setQuestions(d.questions.map((q) => ({ ...blank(q.id), ...q, marks: q.marks, _open: false })));
      setChoiceRules(d.choice_rules || []);
      setReadMsg(`Found ${d.questions.length} questions - check the text and marks below, then edit anything that is wrong.`);
    } catch (e) { setErr(e.message); } finally { setReading(false); }
  };

  const updateQ = (i, q) => setQuestions(questions.map((x, j) => (j === i ? q : x)));
  const addQ = () => setQuestions([...questions, blank(nextId(questions))]);
  const nextId = (qs) => { const n = qs.map((q) => parseInt(q.id, 10)).filter(Number.isFinite); return (n.length ? Math.max(...n) : 0) + 1; };

  const typedAnswers = mMode === 'type';
  const sumMarks = questions.reduce((s, q) => s + (Number(q.marks) || 0), 0);
  const single = sMode === 'combined' && students.length === 1 && students[0].name.toLowerCase().endsWith('.pdf');
  const studentCount = sMode === 'each' ? students.length : 0;

  const problems = useMemo(() => {
    const p = [];
    if (!title.trim()) p.push('Enter a test name');
    if (!subject || (subject === '__new' && !newSubject.trim())) p.push('Choose or create a subject');
    if (!questions.length && !qFile.length) p.push(qMode === 'upload' ? 'Upload the question paper' : 'Add at least one question');
    if (questions.length && questions.some((q) => !q.text.trim() || !(Number(q.marks) > 0))) p.push('Every question needs text and marks');
    if (typedAnswers && questions.length && questions.some((q) => !q.model_answer.trim())) p.push('Add a model answer for every question');
    if (typedAnswers && !questions.length) p.push('Add questions before typing model answers');
    if (!typedAnswers && !mFile.length) p.push('Upload the model answer');
    if (!students.length) p.push(sMode === 'each' ? 'Add the student answer PDFs' : 'Add the combined student PDF');
    if (sMode === 'combined' && students.length && !(Number(pps) > 0)) p.push('Enter pages per student');
    return p;
  }, [title, subject, newSubject, questions, qFile, qMode, typedAnswers, mFile, students, sMode, pps]);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    const fd = new FormData();
    fd.append('title', title);
    if (subject === '__new') fd.append('subject_name', newSubject); else fd.append('subject_id', subject);
    if (total) fd.append('total_marks', total);
    if (pps && single) fd.append('pages_per_student', pps);
    if (questions.length) fd.append('questions', JSON.stringify({ questions: questions.map(({ _open, ...q }) => q), choice_rules: choiceRules }));
    if (qFile[0] && qMode === 'upload') fd.append('question_paper', qFile[0]);
    if (!typedAnswers && mFile[0]) fd.append('model_answer', mFile[0]);
    students.forEach((f) => fd.append('student_answers', f));
    setBusy(true);
    try {
      const { test } = await api.upload('/tests', fd, setProg);
      nav(`/tests/${test._id}`);
    } catch (x) { setErr(x.message); setBusy(false); }
  };

  const qDone = questions.length > 0 && questions.every((q) => q.text.trim() && Number(q.marks) > 0);
  const mDone = typedAnswers ? qDone && questions.every((q) => q.model_answer.trim()) : mFile.length > 0;

  return (
    <form onSubmit={submit}>
      <div className="page-head"><div className="grow"><h1>New test</h1><div className="muted">Set up the paper, the model answers and the student sheets. Evaluation starts when you submit.</div></div></div>
      {err && <div className="err">{err}</div>}

      <div className="nt-layout">
        <div className="nt-main">
          <Step n={1} title="Test details" done={!!title.trim() && !!subject && (subject !== '__new' || !!newSubject.trim())}>
            <div className="grid g2" style={{ gap: 14 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Subject</label>
                <select value={subject} onChange={(e) => setSubject(e.target.value)}>
                  <option value="" disabled>Select a subject</option>
                  {subjects.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
                  <option value="__new">+ Create new subject...</option>
                </select>
                {subject === '__new' && <input style={{ marginTop: 8 }} placeholder="e.g. Engineering Physics" value={newSubject} onChange={(e) => setNewSubject(e.target.value)} />}
              </div>
              <div className="field" style={{ marginBottom: 0 }}><label>Test name</label><input placeholder="e.g. Internal Assessment 1" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
            </div>
          </Step>

          <Step n={2} title="Question paper" sub="Upload the paper and let AI read it, or type the questions yourself. You can edit everything before starting." done={qDone}>
            <Seg value={qMode} onChange={setQMode} options={[['upload', 'Upload paper'], ['type', 'Type questions']]} />
            {qMode === 'upload' && (
              <>
                <Drop files={qFile} onChange={(f) => { setQFile(f); setReadMsg(''); }} title="Drop the question paper here" sub="PDF or photo." />
                <div className="flex" style={{ marginTop: 10 }}>
                  <button type="button" className="btn primary" disabled={!qFile.length || reading} onClick={readQuestions}>{reading ? 'Reading questions...' : questions.length ? 'Read again' : 'Read questions'}</button>
                  <span className="muted small">Optional - lets you review the questions before starting. If skipped, they are read automatically.</span>
                </div>
              </>
            )}
            {readMsg && <div className="note" style={{ marginTop: 12, marginBottom: 0 }}>{readMsg}</div>}
            {(qMode === 'type' || questions.length > 0) && (
              <div style={{ marginTop: 14 }}>
                {questions.map((q, i) => (
                  <QRow key={i} q={q} i={i} typedAnswers={typedAnswers} onChange={(nq) => updateQ(i, nq)} onRemove={() => setQuestions(questions.filter((_, j) => j !== i))} />
                ))}
                <button type="button" className="btn" onClick={addQ}>+ Add question</button>
              </div>
            )}
          </Step>

          <Step n={3} title="Model answers" sub="How should students' answers be judged?" done={mDone}>
            <Seg value={mMode} onChange={setMMode} options={[['upload', 'Upload model answer file'], ['type', 'Type answers per question']]} />
            {mMode === 'upload'
              ? <Drop files={mFile} onChange={setMFile} title="Drop the model answer / marking scheme here" sub="PDF or photo. Key points and mark splits make grading more accurate." />
              : <div className="muted small">Write each question's model answer (and optional marking points) in the question list above. {!questions.length && <b>Add questions in step 2 first.</b>}</div>}
          </Step>

          <Step n={4} title="Student answer sheets" sub="Handwritten or typed, with diagrams - all supported." done={students.length > 0}>
            <Seg value={sMode} onChange={(m) => { setSMode(m); setStudents([]); setPps(''); }} options={[['each', 'One PDF per student'], ['combined', 'One combined PDF']]} />
            {sMode === 'each' ? (
              <Drop multiple numbered files={students} onChange={setStudents} title="Drop all student answer PDFs here"
                sub="Select many files at once: each file is one student (the name is read from the sheet). PDF or photos." />
            ) : (
              <Drop files={students} onChange={setStudents} accept=".pdf" title="Drop the combined PDF here" sub="All students scanned into one PDF, in order." />
            )}
            {sMode === 'each' && students.length > 0 && <div className="hint">{students.length} student{students.length > 1 ? 's' : ''} added. You can drop more files to add them.</div>}
            <div className="grid g2" style={{ gap: 14, marginTop: 14 }}>
              {sMode === 'combined' && (
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Pages per student</label>
                  <input type="number" min="1" placeholder="e.g. 6" value={pps} onChange={(e) => setPps(e.target.value)} />
                  <div className="hint">Splits the combined PDF into equal blocks, one per student.</div>
                </div>
              )}
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Total marks <span className="muted">(optional)</span></label>
                <input type="number" min="1" placeholder={sumMarks ? `Auto: ${sumMarks}` : 'Leave empty: worked out from the question paper'} value={total} onChange={(e) => setTotal(e.target.value)} />
                <div className="hint">{sumMarks ? `Detected ${sumMarks} marks from the questions. Only fill this in to override it.` : 'Detected automatically when the questions are read (click "Read questions" to see it now). Only fill this in to override it.'}</div>
              </div>
            </div>
          </Step>
        </div>

        <aside className="nt-side">
          <div className="card">
            <h3>Summary</h3>
            <div className="sumrow"><span>Questions</span><b>{questions.length || (qFile.length ? 'auto' : 0)}</b></div>
            <div className="sumrow"><span>Total marks</span><b>{total || sumMarks || 'auto'}</b></div>
            <div className="sumrow"><span>Students</span><b>{sMode === 'each' ? studentCount : students.length ? (pps ? `every ${pps} pages` : 'set pages') : 0}</b></div>
            <div className="sumrow"><span>Model answers</span><b>{typedAnswers ? 'typed' : mFile.length ? 'uploaded' : '-'}</b></div>
            <ul className="todo">
              {problems.length === 0 ? <li className="okk">✓ Ready to start</li> : problems.map((p) => <li key={p}>○ {p}</li>)}
            </ul>
            {busy && <div style={{ marginBottom: 10 }}><div className="bar"><i style={{ width: `${prog * 100}%` }} /></div><div className="hint">Uploading... {Math.round(prog * 100)}%</div></div>}
            <button className="btn primary" style={{ width: '100%' }} disabled={busy || problems.length > 0}>{busy ? 'Uploading...' : 'Start evaluation'}</button>
            <div className="hint" style={{ marginTop: 10 }}>Runs on your local GPU; speed depends on your hardware (roughly 2-5 minutes per student on a laptop GPU). You can leave the page.</div>
          </div>
        </aside>
      </div>
    </form>
  );
}
