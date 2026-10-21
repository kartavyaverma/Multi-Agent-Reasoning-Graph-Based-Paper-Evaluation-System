import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, now } from './db.js';
import { config } from './config.js';
import { checkModels, aiActivity } from './ai/llm.js';
import { requireAuth } from './auth.js';
import { createWorkflow, retryNode, stopWorkflow, resumeWorkflow, rerunFrom } from './engine/engine.js';
import { defaultGrading, resolveGrading, sanitizeSteps, nodeSet, stepOf } from './engine/settings.js';
import { sanitizePrompts, promptList, promptState, sanitizeLibrary } from './engine/prompts.js';
import { PAPER_CHECK_TEMPLATE_ID } from './engine/templates.js';
import { testAnalytics, subjectTrend, gradeOf } from './analytics.js';
import { dashboard, studentList, studentProfile, studentKey, termOf } from './insights.js';
import { readQuestionPaper } from './engine/executors/parse.js';
import { executors } from './engine/executors/index.js';
import os from 'node:os';

export const api = Router();
api.use(requireAuth);

const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => { console.error(e); res.status(500).json({ error: e.message || 'Server error' }); });

const MIME = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.heic': 'image/heic', '.heif': 'image/heif' };
const mimeOf = (f) => MIME[path.extname(f.originalname).toLowerCase()];

/* ───────────── uploads ───────────── */
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(config.dataDir, 'uploads', req.testId, file.fieldname === 'student_answers' ? 'students' : 'docs');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(3).toString('hex')}-${file.originalname.replace(/[^\w.\- ]/g, '_')}`),
  }),
  limits: { fileSize: 60 * 1024 * 1024, files: 300 },
  fileFilter: (req, file, cb) => (mimeOf(file) ? cb(null, true) : cb(new Error(`Unsupported file type: ${file.originalname}. Use PDF, JPG, PNG, WEBP or HEIC.`))),
});

const ownedTest = async (req) => db.tests.findOne({ _id: req.params.id, user_id: req.user._id });
const cleanup = (id) => { try { fs.rmSync(path.join(config.dataDir, 'uploads', id), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* best effort */ } };

/* ───────────── subjects ───────────── */
api.get('/subjects', h(async (req, res) => {
  const subjects = await db.subjects.find({ user_id: req.user._id }, { sort: { created_at: -1 } });
  const out = [];
  for (const s of subjects) {
    const tests = await db.tests.find({ subject_id: s._id });
    out.push({ ...s, test_count: tests.length });
  }
  res.json({ subjects: out });
}));

api.post('/subjects', h(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Subject name is required' });
  const dup = await db.subjects.findOne({ user_id: req.user._id, name_lc: name.toLowerCase() });
  if (dup) return res.json({ subject: dup });
  const s = await db.subjects.insert({ user_id: req.user._id, name, name_lc: name.toLowerCase(), code: String(req.body?.code || '').trim(), created_at: now() });
  res.json({ subject: s });
}));

api.get('/subjects/:id', h(async (req, res) => {
  const subject = await db.subjects.findOne({ _id: req.params.id, user_id: req.user._id });
  if (!subject) return res.status(404).json({ error: 'Subject not found' });
  const tests = await db.tests.find({ subject_id: subject._id }, { sort: { created_at: -1 } });
  const byTest = {};
  for (const t of tests) byTest[t._id] = await db.results.find({ test_id: t._id });
  const all = Object.values(byTest).flat();
  res.json({ subject, tests, trend: subjectTrend(tests, byTest), overall: testAnalytics(all), tests_summary: tests.map((t) => ({ id: t._id, ...(({ average, students, pass_rate }) => ({ average, students, pass_rate }))(testAnalytics(byTest[t._id])) })) });
}));

api.delete('/subjects/:id', h(async (req, res) => {
  const s = await db.subjects.findOne({ _id: req.params.id, user_id: req.user._id });
  if (!s) return res.status(404).json({ error: 'Subject not found' });
  for (const t of await db.tests.find({ subject_id: s._id })) await removeTest(t);
  await db.subjects.remove({ _id: s._id });
  res.json({ ok: true });
}));

/* ───────────── dashboard ───────────── */
api.get('/dashboard', h(async (req, res) => {
  const d = await dashboard(req.user._id, req.query);
  res.json({ ...d, ai_configured: config.ai.mock || (await checkModels()).ok, ai_mock: config.ai.mock });
}));

/* ───────────── students across tests ───────────── */
api.get('/students', h(async (req, res) => {
  res.json({ students: await studentList(req.user._id, req.query) });
}));

api.get('/students/:key', h(async (req, res) => {
  const p = await studentProfile(req.user._id, req.params.key);
  if (!p) return res.status(404).json({ error: 'Student not found' });
  res.json(p);
}));


/* ───────────── "Read questions" preview: lets the teacher check/edit before starting ───────────── */
const previewUpload = multer({ dest: path.join(os.tmpdir(), 'papercheck-preview'), limits: { fileSize: 60 * 1024 * 1024, files: 1 }, fileFilter: (req, file, cb) => (mimeOf(file) ? cb(null, true) : cb(new Error('Unsupported file type'))) });
api.post('/preview/questions', previewUpload.single('question_paper'), h(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a question paper file first' });
  try {
    const r = await readQuestionPaper({ path: req.file.path, mime: mimeOf(req.file) }, req.user.workflow_defaults?.prompts);
    res.json({ questions: r.questions.map((q) => ({ id: q.id, text: q.text, marks: q.marks, has_figure: !!q.has_figure, type: q.type, choice_group: q.choice_group || null })), choice_rules: r.choice_rules || [], total_marks: r.total_marks });
  } finally { fs.rmSync(req.file.path, { force: true }); }
}));

/* ───────────── tests ───────────── */
api.get('/tests', h(async (req, res) => {
  const q = { user_id: req.user._id };
  if (req.query.subject_id) q.subject_id = req.query.subject_id;
  const tests = await db.tests.find(q, { sort: { created_at: -1 } });
  const subjects = Object.fromEntries((await db.subjects.find({ user_id: req.user._id })).map((s) => [s._id, s.name]));
  res.json({ tests: tests.map((t) => ({ ...t, subject_name: subjects[t.subject_id] })) });
}));

api.post('/tests', (req, res, next) => { req.testId = crypto.randomBytes(8).toString('hex'); next(); },
  upload.fields([{ name: 'question_paper', maxCount: 1 }, { name: 'model_answer', maxCount: 1 }, { name: 'student_answers', maxCount: 300 }]),
  h(async (req, res) => {
    const fail = (msg) => { cleanup(req.testId); return res.status(400).json({ error: msg }); };
    const { title, subject_id, subject_name, pages_per_student, total_marks } = req.body;
    const f = req.files || {};
    if (!title?.trim()) return fail('Test name is required');

    // Questions can be typed / edited in the UI (preferred) or read from the uploaded paper by the pipeline.
    let manual = null, choice_rules = [];
    if (req.body.questions) {
      try {
        const parsed = JSON.parse(req.body.questions);
        manual = parsed.questions || parsed;
        choice_rules = parsed.choice_rules || [];
      } catch { return fail('Questions data is invalid'); }
      if (!Array.isArray(manual) || !manual.length) manual = null;
    }
    if (manual) {
      manual = manual.map((q, i) => ({
        id: String(q.id || i + 1).trim(), text: String(q.text || '').trim(), marks: Number(q.marks), has_figure: !!q.has_figure, type: q.type || 'other', choice_group: q.choice_group || null,
        model_answer: String(q.model_answer || '').trim(), figure_description: String(q.figure_description || '').trim(),
        key_points: (q.key_points || []).filter((k) => String(k.text || '').trim()).map((k) => ({ text: String(k.text).trim(), marks: Number(k.marks) || 0 })),
      }));
      const bad = manual.findIndex((q) => !q.text || !(q.marks > 0));
      if (bad >= 0) return fail(`Question ${bad + 1}: enter the question text and marks greater than 0`);
    } else if (!f.question_paper?.[0]) return fail('Upload the question paper or type the questions');

    const typedAnswers = manual && manual.every((q) => q.model_answer);
    if (!f.model_answer?.[0] && !typedAnswers) return fail(manual ? 'Add a model answer for every question, or upload a model answer file' : 'Upload the model answer');
    if (!f.student_answers?.length) return fail('Upload at least one student answer sheet');

    let subject = subject_id && (await db.subjects.findOne({ _id: subject_id, user_id: req.user._id }));
    if (!subject && subject_name?.trim()) {
      const nm = subject_name.trim();
      subject = (await db.subjects.findOne({ user_id: req.user._id, name_lc: nm.toLowerCase() })) || (await db.subjects.insert({ user_id: req.user._id, name: nm, name_lc: nm.toLowerCase(), code: '', created_at: now() }));
    }
    if (!subject) return fail('Choose or create a subject');

    const desc = (x) => ({ path: x.path, name: x.originalname, mime: mimeOf(x) });
    const files = { question_paper: f.question_paper?.[0] ? desc(f.question_paper[0]) : null, model_answer: f.model_answer?.[0] ? desc(f.model_answer[0]) : null, students: f.student_answers.map(desc) };
    const pps = Number(pages_per_student) > 0 ? Math.floor(Number(pages_per_student)) : 0;
    if (pps && !(files.students.length === 1 && files.students[0].mime === 'application/pdf')) return fail('"Pages per student" only works when you upload ONE combined PDF of all students.');

    const t = now();
    const test = await db.tests.insert({
      _id: req.testId, user_id: req.user._id, subject_id: subject._id, title: title.trim(), status: 'processing',
      ...termOf(req.body), student_count: pps ? null : files.students.length, pages_per_student: pps || null,
      total_marks_override: Number(total_marks) > 0 ? Number(total_marks) : null, files, manual_questions: !!manual, created_at: t,
    });
    const wf = await createWorkflow({
      template_id: PAPER_CHECK_TEMPLATE_ID, org_id: req.user._id, application_id: test._id, reference_id: subject._id,
      input: {
        test_id: test._id, user_id: req.user._id, question_paper: files.question_paper, model_answer: files.model_answer,
        student_files: files.students, pages_per_student: pps || null, total_marks_override: test.total_marks_override,
        manual_questions: manual, choice_rules,
      },
      settings: req.user.workflow_defaults,
    });
    await db.tests.update({ _id: test._id }, { $set: { workflow_id: wf._id } });
    res.json({ test: { ...test, workflow_id: wf._id } });
  }));

api.get('/tests/:id', h(async (req, res) => {
  const test = await ownedTest(req);
  if (!test) return res.status(404).json({ error: 'Test not found' });
  const subject = await db.subjects.findOne({ _id: test.subject_id });
  const wf = test.workflow_id && (await db.workflows.findOne({ _id: test.workflow_id }, { output: 0, input: 0 }));
  const nodes = wf ? await db.nodes.find({ workflow_id: wf._id }, { sort: { created_at: 1 } }) : [];
  const units = wf ? (await db.workflows.findOne({ _id: wf._id }))?.output?.ingest?.units?.length : null;
  const studentCount = units || test.student_count || 0;

  const { calls, eta } = estimate(nodes, wf, studentCount);

  res.json({
    test: { ...test, files: { has_question_paper: !!test.files?.question_paper, has_model_answer: !!test.files?.model_answer }, subject_name: subject?.name, student_count: studentCount },
    workflow: wf && { id: wf._id, status: wf.status, error: wf.error || null, created_at: wf.created_at, finished_at: wf.finished_at || null },
    nodes: nodes.map((n) => ({ id: n._id, name: n.name, type: n.type, label: n.label, description: n.description, status: n.status, depends_on: n.depends_on_inputs, progress: n.progress, error: n.error || null, started_at: n.started_at || null, finished_at: n.finished_at || null, try_count: n.try_count, logs: (n.logs || []).slice(-4) })),
    eta_seconds: eta, remaining_ai_calls: calls,
  });
}));

function estimate(nodes, wf, studentCount) {
  const PER_STUDENT = new Set(['student.transcribe', 'student.figures', 'student.reasoning', 'graph.compare', 'agent.logic', 'agent.concept', 'agent.coverage', 'agent.factcheck', 'route.reevaluate', 'learn.gaps']);
  const SYNC = new Set(['paper.ingest', 'route.confidence', 'grade.finalize', 'publish.results', 'graph.compare']);
  let calls = 0;
  for (const n of nodes) {
    if (n.status === 'completed') continue;
    if (PER_STUDENT.has(n.type)) {
      if (n.type === 'graph.compare') continue; // local compute + one cheap embedding request
      const total = n.progress?.total || (n.type === 'route.reevaluate' ? Math.ceil(studentCount * 0.3) : studentCount);
      calls += Math.max(0, total - (n.progress?.done || 0));
    } else if (!SYNC.has(n.type)) calls += 1;
  }
  return { calls, eta: wf?.status === 'running' ? Math.round(calls * config.ai.secondsPerCall) : 0 };
}

/* ───────────── live workflow view ───────────── */
api.get('/tests/:id/workflow', h(async (req, res) => {
  const test = await ownedTest(req);
  if (!test?.workflow_id) return res.status(404).json({ error: 'This test has no workflow yet' });
  const wf = await db.workflows.findOne({ _id: test.workflow_id }, { output: 0, input: 0 });
  if (!wf) return res.status(404).json({ error: 'Workflow not found' });
  const nodes = await db.nodes.find({ workflow_id: wf._id }, { sort: { created_at: 1 } });
  const ingest = nodes.find((n) => n.type === 'paper.ingest');
  const studentCount = ingest?.status === 'completed' ? (await db.workflows.findOne({ _id: wf._id }))?.output?.ingest?.units?.length : test.student_count;
  const { calls, eta } = estimate(nodes, wf, studentCount || 0);
  res.json({
    server_time: now(),
    test: { id: test._id, title: test.title, status: test.status, student_count: studentCount || 0 },
    workflow: { id: wf._id, template_id: wf.template_id, status: wf.status, error: wf.error || null, created_at: wf.created_at, finished_at: wf.finished_at || null },
    nodes: nodes.map((n) => ({
      id: n._id, name: n.name, type: n.type, label: n.label, description: n.description, status: n.status,
      depends_on: n.depends_on_inputs, depends_on_current: n.depends_on_inputs_current || [],
      progress: n.progress, error: n.error || null, try_count: n.try_count || 0, max_try_count: n.max_try_count, try_at: n.try_at,
      started_at: n.started_at || null, finished_at: n.finished_at || null, fan_out: !!executors[n.type]?.plan,
      optional: stepOf(n).optional, enabled: n.config?.enabled !== false, skipped: !!n.skipped,
      concurrency: stepOf(n).concurrency, retry_interval_seconds: n.retry_interval_seconds, prompt: promptState(wf.settings?.prompts, n.name),
      batches: (n.batches || []).map((b) => ({ key: b.key, label: b.meta?.label || b.key, status: b.status, failed: !!b.failed, tries: b.tries, error: b.error, started_at: b.started_at || null, finished_at: b.finished_at || null })),
      logs: n.logs || [],
    })),
    ai: { ...aiActivity(), model: config.ai.mock ? 'mock' : config.ai.visionModel },
    eta_seconds: eta, remaining_ai_calls: calls,
  });
}));

/** Keeps big JSON readable in the browser: long strings and arrays are clipped. */
const clip = (v, depth = 0) => {
  if (typeof v === 'string') return v.length > 4000 ? `${v.slice(0, 4000)}… [${v.length - 4000} more chars]` : v;
  if (Array.isArray(v)) return v.length > 300 ? [...v.slice(0, 300).map((x) => clip(x, depth + 1)), `… ${v.length - 300} more items`] : v.map((x) => clip(x, depth + 1));
  if (v && typeof v === 'object') {
    if (depth > 12) return '[nested]';
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Array.isArray(x) && x.length > 64 && x.every((y) => typeof y === 'number') ? `[vector of ${x.length} numbers]` : clip(x, depth + 1)]));
  }
  return v;
};

api.get('/tests/:id/workflow/nodes/:nodeId/:part(input|output|config)', h(async (req, res) => {
  const test = await ownedTest(req);
  const n = test && (await db.nodes.findOne({ _id: req.params.nodeId, workflow_id: test.workflow_id }));
  if (!n) return res.status(404).json({ error: 'Node not found' });
  const wf = await db.workflows.findOne({ _id: n.workflow_id });
  const exec = executors[n.type] || {};
  let data;
  if (req.params.part === 'config') {
    data = { name: n.name, type: n.type, description: n.description, depends_on_inputs: n.depends_on_inputs, max_try_count: n.max_try_count, retry_interval_seconds: n.retry_interval_seconds, fan_out_per_student: !!exec.plan, batch_concurrency: stepOf(n).concurrency, config: n.config, grading: resolveGrading(wf.settings?.grading), ai_model: config.ai.mock ? 'mock' : config.ai.visionModel };
  } else if (req.params.part === 'input') {
    data = n.depends_on_inputs.length ? Object.fromEntries(n.depends_on_inputs.map((d) => [d, wf.output?.[d] ?? null])) : { workflow_input: wf.input };
  } else if (n.status === 'completed') {
    data = wf.output?.[n.name] ?? null;
  } else {
    const partial = (n.batches || []).filter((b) => b.output);
    data = partial.length ? { partial: true, note: 'Node still running - finished batches so far', items: Object.fromEntries(partial.map((b) => [b.meta?.label || b.key, b.output])) } : null;
  }
  res.json({ part: req.params.part, node: n.name, data: clip(data) });
}));

/* ───────────── workflow settings ───────────── */
const settingsOf = async (wf, user) => {
  const nodes = await db.nodes.find({ workflow_id: wf._id }, { sort: { created_at: 1 } });
  return { grading: resolveGrading(wf.settings?.grading), defaults: defaultGrading(), steps: nodes.map(stepOf), prompts: promptList(wf.settings?.prompts), has_user_defaults: !!user.workflow_defaults };
};

/** Validates { grading, steps } from the client; anything missing from the body keeps its current value. */
const parseSettings = (body, nodes, grading = {}, prompts = {}) => {
  const current = Object.fromEntries(nodes.map((n) => [n.name, stepOf(n)]));
  const steps = sanitizeSteps(Object.fromEntries(nodes.map((n) => [n.name, { ...current[n.name], ...(body?.steps?.[n.name] || {}) }])), nodes.map((n) => n.name));
  const g = body?.grading || {};
  const p = { ...prompts };
  for (const [id, v] of Object.entries(body?.prompts || {})) p[id] = { ...(prompts[id] || {}), ...v };
  return { grading: resolveGrading({ ...grading, ...g, weights: { ...grading.weights, ...g.weights } }), steps, prompts: sanitizePrompts(p) };
};

api.get('/tests/:id/workflow/settings', h(async (req, res) => {
  const test = await ownedTest(req);
  const wf = test?.workflow_id && (await db.workflows.findOne({ _id: test.workflow_id }, { output: 0, input: 0 }));
  if (!wf) return res.status(404).json({ error: 'Workflow not found' });
  res.json(await settingsOf(wf, req.user));
}));

api.put('/tests/:id/workflow/settings', h(async (req, res) => {
  const test = await ownedTest(req);
  const wf = test?.workflow_id && (await db.workflows.findOne({ _id: test.workflow_id }, { output: 0, input: 0 }));
  if (!wf) return res.status(404).json({ error: 'Workflow not found' });
  const nodes = await db.nodes.find({ workflow_id: wf._id });
  let s;
  try { s = parseSettings(req.body, nodes, resolveGrading(wf.settings?.grading), wf.settings?.prompts); } catch (e) { return res.status(400).json({ error: e.message }); }
  await db.workflows.update({ _id: wf._id }, { $set: { 'settings.grading': s.grading, 'settings.prompts': s.prompts, updated_at: now() } });
  for (const n of nodes) {
    const set = nodeSet(n, s.steps[n.name]);
    if (Object.keys(set).length) await db.nodes.update({ _id: n._id }, { $set: set });
  }
  res.json(await settingsOf({ ...wf, settings: { grading: s.grading, prompts: s.prompts } }, req.user));
}));

// The teacher's defaults, applied to every new test.
api.put('/workflow-defaults', h(async (req, res) => {
  const tpl = await db.workflow_templates.findOne({ _id: PAPER_CHECK_TEMPLATE_ID });
  let s;
  try { s = parseSettings(req.body, tpl.nodes.map((n) => ({ ...n, config: {} }))); } catch (e) { return res.status(400).json({ error: e.message }); }
  await db.users.update({ _id: req.user._id }, { $set: { workflow_defaults: s } });
  res.json({ ok: true });
}));

// reusable prompt snippets, shared across tests and steps
api.get('/prompt-library', h(async (req, res) => res.json({ items: req.user.prompt_library || [] })));

api.put('/prompt-library', h(async (req, res) => {
  const items = sanitizeLibrary(req.body?.items);
  await db.users.update({ _id: req.user._id }, { $set: { prompt_library: items } });
  res.json({ items });
}));

api.delete('/workflow-defaults', h(async (req, res) => {
  await db.users.update({ _id: req.user._id }, { $unset: { workflow_defaults: true } });
  res.json({ ok: true });
}));

api.post('/tests/:id/nodes/:nodeId/rerun', h(async (req, res) => {
  const t = await ownedTest(req);
  const n = t && (await db.nodes.findOne({ _id: req.params.nodeId, workflow_id: t.workflow_id }));
  if (!n) return res.status(404).json({ error: 'Node not found' });
  let reset;
  try { reset = await rerunFrom(t.workflow_id, n.name); } catch (e) { return res.status(409).json({ error: e.message }); }
  await db.tests.update({ _id: t._id }, { $set: { status: 'processing' }, $unset: { completed_at: true } });
  res.json({ ok: true, reset });
}));

const removeTest = async (t) => {
  if (t.workflow_id) {
    await db.nodes.remove({ workflow_id: t.workflow_id }, { multi: true });
    await db.workflows.remove({ _id: t.workflow_id });
  }
  await db.results.remove({ test_id: t._id }, { multi: true });
  await db.tests.remove({ _id: t._id });
  cleanup(t._id);
};

// rename a test or move it to another academic year / semester
api.put('/tests/:id', h(async (req, res) => {
  const t = await ownedTest(req);
  if (!t) return res.status(404).json({ error: 'Test not found' });
  const set = termOf({ academic_year: t.academic_year, semester: t.semester, ...req.body });
  if (req.body?.title !== undefined) {
    const title = String(req.body.title).trim();
    if (!title) return res.status(400).json({ error: 'Test name is required' });
    set.title = title.slice(0, 200);
  }
  await db.tests.update({ _id: t._id }, { $set: set });
  res.json({ test: { ...t, ...set } });
}));

api.delete('/tests/:id', h(async (req, res) => {
  const t = await ownedTest(req);
  if (!t) return res.status(404).json({ error: 'Test not found' });
  if (t.workflow_id) await stopWorkflow(t.workflow_id);
  await removeTest(t);
  res.json({ ok: true });
}));

api.post('/tests/:id/stop', h(async (req, res) => {
  const t = await ownedTest(req);
  if (!t?.workflow_id) return res.status(404).json({ error: 'Test not found' });
  await stopWorkflow(t.workflow_id);
  await db.tests.update({ _id: t._id }, { $set: { status: 'stopped' } });
  res.json({ ok: true });
}));

api.post('/tests/:id/resume', h(async (req, res) => {
  const t = await ownedTest(req);
  if (!t?.workflow_id) return res.status(404).json({ error: 'Test not found' });
  await resumeWorkflow(t.workflow_id);
  await db.tests.update({ _id: t._id }, { $set: { status: 'processing' } });
  res.json({ ok: true });
}));

api.post('/tests/:id/nodes/:nodeId/retry', h(async (req, res) => {
  const t = await ownedTest(req);
  const n = t && (await db.nodes.findOne({ _id: req.params.nodeId, workflow_id: t.workflow_id }));
  if (!n) return res.status(404).json({ error: 'Node not found' });
  await retryNode(n._id);
  await db.tests.update({ _id: t._id }, { $set: { status: 'processing' } });
  res.json({ ok: true });
}));

/* ───────────── results & analytics ───────────── */
const light = (r) => ({
  id: r._id, unit_id: r.unit_id, student_key: studentKey(r), name: r.name, roll_no: r.roll_no, status: r.status, error: r.error || null,
  total: r.total, max_total: r.max_total, percentage: r.percentage, grade: r.percentage != null ? gradeOf(r.percentage) : null,
  review_count: r.review_count, questions: (r.questions || []).map((q) => ({ q_id: q.q_id, marks: q.marks, max: q.max, status: q.status, counted: q.counted })),
});

api.get('/tests/:id/results', h(async (req, res) => {
  const t = await ownedTest(req);
  if (!t) return res.status(404).json({ error: 'Test not found' });
  res.json({ results: (await db.results.find({ test_id: t._id })).map(light) });
}));

api.get('/tests/:id/analytics', h(async (req, res) => {
  const t = await ownedTest(req);
  if (!t) return res.status(404).json({ error: 'Test not found' });
  res.json({ analytics: testAnalytics(await db.results.find({ test_id: t._id })) });
}));

api.get('/tests/:id/results/:rid', h(async (req, res) => {
  const t = await ownedTest(req);
  const r = t && (await db.results.findOne({ _id: req.params.rid, test_id: t._id }));
  if (!r) return res.status(404).json({ error: 'Result not found' });
  const all = await db.results.find({ test_id: t._id });
  const ranked = all.filter((x) => x.total != null).sort((a, b) => b.total - a.total);
  res.json({ result: { ...r, grade: r.percentage != null ? gradeOf(r.percentage) : null, student_key: studentKey(r) }, test: { id: t._id, title: t.title, academic_year: t.academic_year || null, semester: t.semester || null }, rank: ranked.findIndex((x) => x._id === r._id) + 1, class_size: ranked.length, class_average: testAnalytics(all).average });
}));

api.put('/tests/:id/results/:rid/questions/:qid', h(async (req, res) => {
  const t = await ownedTest(req);
  const r = t && (await db.results.findOne({ _id: req.params.rid, test_id: t._id }));
  const q = r?.questions.find((x) => x.q_id === req.params.qid);
  if (!q) return res.status(404).json({ error: 'Question result not found' });
  const { marks, comment } = req.body || {};
  if (marks !== undefined && marks !== null && marks !== '') {
    const m = Number(marks);
    if (!Number.isFinite(m) || m < 0 || m > q.max) return res.status(400).json({ error: `Marks must be between 0 and ${q.max}` });
    q.marks = Math.round(m * 2) / 2;
    q.teacher_marks = q.marks;
  }
  if (comment !== undefined) q.teacher_comment = String(comment).slice(0, 1000) || null;
  q.status = 'teacher_reviewed';
  q.flag_reason = null;
  const total = r.questions.filter((x) => x.counted).reduce((s, x) => s + x.marks, 0);
  const review = r.questions.filter((x) => x.status === 'review').length;
  const set = { questions: r.questions, total, percentage: r.max_total ? +((total / r.max_total) * 100).toFixed(1) : 0, review_count: review, status: review ? 'needs_review' : 'graded' };
  await db.results.update({ _id: r._id }, { $set: set });
  res.json({ result: { ...r, ...set } });
}));

api.get('/tests/:id/export.csv', h(async (req, res) => {
  const t = await ownedTest(req);
  if (!t) return res.status(404).json({ error: 'Test not found' });
  const rs = (await db.results.find({ test_id: t._id })).sort((a, b) => (b.total ?? -1) - (a.total ?? -1));
  const qids = rs.find((r) => r.questions?.length)?.questions.map((q) => q.q_id) || [];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Name', 'Roll No', 'Total', 'Max', 'Percentage', 'Grade', 'Status', ...qids.map((q) => `Q${q}`)].map(esc).join(',')];
  rs.forEach((r) => lines.push([r.name, r.roll_no, r.total, r.max_total, r.percentage, r.percentage != null ? gradeOf(r.percentage) : '', r.status, ...qids.map((id) => r.questions.find((q) => q.q_id === id)?.marks ?? '')].map(esc).join(',')));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${t.title.replace(/[^\w]+/g, '_')}_results.csv"`);
  res.send(lines.join('\n'));
}));

/* ───────────── original scans (for verifying OCR) ───────────── */
api.get('/tests/:id/files/:kind/:unit?', h(async (req, res) => {
  const t = await ownedTest(req);
  if (!t) return res.status(404).json({ error: 'Test not found' });
  let f;
  if (req.params.kind === 'question_paper' || req.params.kind === 'model_answer') f = t.files[req.params.kind];
  else if (req.params.kind === 'unit') {
    const wf = await db.workflows.findOne({ _id: t.workflow_id });
    f = wf?.output?.ingest?.units?.find((u) => u.unit_id === req.params.unit);
  }
  if (!f || !fs.existsSync(f.path)) return res.status(404).json({ error: 'File not found' });
  res.setHeader('Content-Type', f.mime);
  res.sendFile(path.resolve(f.path));
}));
