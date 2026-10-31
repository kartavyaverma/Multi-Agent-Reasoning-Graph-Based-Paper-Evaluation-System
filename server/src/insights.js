import { db } from './db.js';
import { config } from './config.js';
import { testAnalytics, gradeOf } from './analytics.js';

/**
 * Cross-test views for the dashboard and the student pages.
 * Tests carry an academic_year ("2025-26") and a semester (1-12); both are optional.
 * A student is identified across tests by roll number, or by name when no roll number was read.
 */

const r1 = (x) => Math.round(x * 10) / 10;
const SEV = { high: 0, medium: 1, low: 2 };
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const studentKey = (r) => (norm(r.roll_no) ? `r-${norm(r.roll_no)}` : `n-${norm(r.name) || r._id}`);

/** Normalises year/semester input from forms. */
export function termOf(body = {}) {
  const year = String(body.academic_year ?? '').trim().slice(0, 20);
  const sem = Number(body.semester);
  return { academic_year: year || null, semester: Number.isInteger(sem) && sem >= 1 && sem <= 12 ? sem : null };
}

/** query: { year, semester, subject_id }; 'none' matches tests without a year / semester. */
function matches(t, q) {
  if (q.year && (q.year === 'none' ? t.academic_year : t.academic_year !== q.year)) return false;
  if (q.semester && (q.semester === 'none' ? t.semester : String(t.semester) !== String(q.semester))) return false;
  if (q.subject_id && t.subject_id !== q.subject_id) return false;
  return true;
}

async function load(userId, q = {}) {
  const all = await db.tests.find({ user_id: userId }, { sort: { created_at: -1 } });
  const subjects = await db.subjects.find({ user_id: userId });
  const sname = Object.fromEntries(subjects.map((s) => [s._id, s.name]));
  const tests = all.filter((t) => matches(t, q));
  const results = tests.length ? await db.results.find({ test_id: { $in: tests.map((t) => t._id) } }) : [];
  const byTest = {};
  results.forEach((r) => (byTest[r.test_id] ||= []).push(r));
  return { all, subjects, sname, tests, results, byTest };
}

/** Per-student totals over a set of results. */
function aggregateStudents(results, testsById) {
  const map = {};
  for (const r of results) {
    if (r.total == null) continue;
    const k = studentKey(r);
    const t = testsById[r.test_id];
    const s = (map[k] ||= { key: k, name: r.name, roll_no: r.roll_no || null, section: r.section || null, pcts: [], last_at: 0, last: null, subjects: new Set(), review: 0 });
    s.pcts.push({ p: r.percentage, at: t?.created_at || r.created_at });
    if ((t?.created_at || 0) >= s.last_at) { s.last_at = t?.created_at || 0; s.last = r.percentage; s.name = r.name || s.name; s.section = r.section || s.section; }
    if (t) s.subjects.add(t.subject_id);
    if (r.status === 'needs_review') s.review++;
  }
  return Object.values(map).map((s) => {
    const ordered = s.pcts.sort((a, b) => a.at - b.at).map((x) => x.p);
    return {
      key: s.key, name: s.name, roll_no: s.roll_no, section: s.section, tests: ordered.length,
      average: r1(mean(ordered)), best: Math.max(...ordered), latest: s.last, trend: ordered.slice(-6),
      change: ordered.length > 1 ? r1(ordered[ordered.length - 1] - ordered[ordered.length - 2]) : null,
      subjects: s.subjects.size, needs_review: s.review, last_at: s.last_at,
    };
  });
}

export async function dashboard(userId, q = {}) {
  const { all, subjects, sname, tests, results, byTest } = await load(userId, q);
  const testsById = Object.fromEntries(all.map((t) => [t._id, t]));
  const pass = config.grading.passPercent;
  const rows = tests.map((t) => {
    const a = testAnalytics(byTest[t._id] || []);
    return {
      id: t._id, title: t.title, subject_id: t.subject_id, subject_name: sname[t.subject_id] || '-', academic_year: t.academic_year || null, semester: t.semester || null,
      status: t.status, created_at: t.created_at, students: a.students || t.student_count || 0, average: a.average, pass_rate: a.pass_rate, needs_review: a.needs_review, highest: a.highest, lowest: a.lowest,
    };
  });
  const scored = results.filter((r) => r.total != null);
  const pcts = scored.map((r) => r.percentage);
  const students = aggregateStudents(results, testsById);
  const subjectRows = subjects.map((s) => {
    const ts = rows.filter((t) => t.subject_id === s._id);
    const ps = scored.filter((r) => testsById[r.test_id]?.subject_id === s._id).map((r) => r.percentage);
    return { id: s._id, name: s.name, tests: ts.length, students: new Set(scored.filter((r) => testsById[r.test_id]?.subject_id === s._id).map(studentKey)).size, average: r1(mean(ps)), pass_rate: r1((ps.filter((p) => p >= pass).length / (ps.length || 1)) * 100) };
  }).filter((s) => s.tests > 0).sort((a, b) => b.tests - a.tests);
  const terms = {};
  all.forEach((t) => {
    const k = `${t.academic_year || ''}|${t.semester || ''}`;
    (terms[k] ||= { academic_year: t.academic_year || null, semester: t.semester || null, tests: 0, last_at: 0 }).tests++;
    terms[k].last_at = Math.max(terms[k].last_at, t.created_at);
  });
  return {
    filters: {
      years: [...new Set(all.map((t) => t.academic_year).filter(Boolean))].sort().reverse(),
      semesters: [...new Set(all.map((t) => t.semester).filter(Boolean))].sort((a, b) => a - b),
      subjects: subjects.map((s) => ({ id: s._id, name: s.name })).sort((a, b) => a.name.localeCompare(b.name)),
      unassigned: all.some((t) => !t.academic_year || !t.semester),
    },
    totals: {
      tests: rows.length, completed: rows.filter((t) => t.status === 'completed').length, running: rows.filter((t) => t.status === 'processing').length,
      students: students.length, scripts: results.length, average: r1(mean(pcts)), pass_rate: r1((pcts.filter((p) => p >= pass).length / (pcts.length || 1)) * 100),
      needs_review: results.filter((r) => r.status === 'needs_review').length, pass_percent: pass,
    },
    tests: rows,
    trend: rows.filter((t) => t.status === 'completed' && t.students).sort((a, b) => a.created_at - b.created_at).map((t) => ({ id: t.id, title: t.title, subject_name: t.subject_name, date: t.created_at, average: t.average, pass_rate: t.pass_rate })),
    subjects: subjectRows,
    attention: students.filter((s) => s.average < pass + 10 || s.needs_review).sort((a, b) => a.average - b.average).slice(0, 6),
    top: [...students].sort((a, b) => b.average - a.average).slice(0, 5),
    terms: Object.values(terms).sort((a, b) => b.last_at - a.last_at),
  };
}

export async function studentList(userId, q = {}) {
  const { all, results } = await load(userId, q);
  const testsById = Object.fromEntries(all.map((t) => [t._id, t]));
  return aggregateStudents(results, testsById).sort((a, b) => a.name.localeCompare(b.name));
}

export async function studentProfile(userId, key) {
  const mine = (await db.results.find({ user_id: userId })).filter((r) => studentKey(r) === key);
  if (!mine.length) return null;
  const tests = await db.tests.find({ _id: { $in: [...new Set(mine.map((r) => r.test_id))] } });
  const testsById = Object.fromEntries(tests.map((t) => [t._id, t]));
  const subjects = Object.fromEntries((await db.subjects.find({ user_id: userId })).map((s) => [s._id, s.name]));
  const classes = await db.results.find({ test_id: { $in: tests.map((t) => t._id) } });
  const byTest = {};
  classes.forEach((r) => (byTest[r.test_id] ||= []).push(r));

  const rows = mine.filter((r) => testsById[r.test_id]).map((r) => {
    const t = testsById[r.test_id];
    const cls = (byTest[t._id] || []).filter((x) => x.total != null).sort((a, b) => b.total - a.total);
    return {
      id: r._id, test_id: t._id, title: t.title, subject_id: t.subject_id, subject_name: subjects[t.subject_id] || '-', academic_year: t.academic_year || null, semester: t.semester || null,
      date: t.created_at, total: r.total, max_total: r.max_total, percentage: r.percentage, grade: r.percentage != null ? gradeOf(r.percentage) : null, status: r.status,
      review_count: r.review_count || 0, rank: r.total != null ? cls.findIndex((x) => x._id === r._id) + 1 : null, class_size: cls.length, class_average: testAnalytics(byTest[t._id] || []).average,
    };
  }).sort((a, b) => a.date - b.date);
  const scored = rows.filter((r) => r.percentage != null);
  const pcts = scored.map((r) => r.percentage);
  const latest = mine.slice().sort((a, b) => (testsById[b.test_id]?.created_at || 0) - (testsById[a.test_id]?.created_at || 0))[0];

  const group = (keyOf, extra) => {
    const g = {};
    scored.forEach((r) => (g[keyOf(r)] ||= { ...extra(r), pcts: [] }).pcts.push(r.percentage));
    return Object.values(g).map(({ pcts: p, ...rest }) => ({ ...rest, tests: p.length, average: r1(mean(p)), best: Math.max(...p) }));
  };

  // skill profile from the four grading agents, and performance by question type
  const skills = { logic: [], concept: [], coverage: [], factcheck: [] };
  const types = {};
  const qstats = { total: 0, full: 0, zero: 0, unattempted: 0, reviewed: 0 };
  for (const r of mine) {
    for (const q of r.questions || []) {
      if (!q.counted) continue;
      qstats.total++;
      if (!q.attempted) qstats.unattempted++;
      else if (q.marks >= q.max) qstats.full++;
      else if (q.marks === 0) qstats.zero++;
      if (q.status === 'teacher_reviewed') qstats.reviewed++;
      if (q.attempted) Object.entries(q.agents || {}).forEach(([k, a]) => skills[k]?.push(a.fraction));
      (types[q.type || 'other'] ||= []).push(q.max ? q.marks / q.max : 0);
    }
  }
  const topics = {};
  const strengths = {};
  for (const r of mine) {
    const g = r.gaps;
    if (!g || g.error) continue;
    const title = testsById[r.test_id]?.title;
    (g.weaknesses || []).forEach((w) => {
      const k = String(w.topic || '').trim();
      if (!k) return;
      const t = (topics[k.toLowerCase()] ||= { topic: k, count: 0, severity: 'low', tests: [] });
      t.count++;
      if ((SEV[w.severity] ?? 2) < SEV[t.severity]) t.severity = w.severity;
      if (title && !t.tests.includes(title)) t.tests.push(title);
    });
    (g.strengths || []).forEach((s) => { const k = String(s).trim(); if (k && !/^Q\d/i.test(k)) strengths[k] = (strengths[k] || 0) + 1; });
  }

  return {
    student: { key, name: latest.name, roll_no: latest.roll_no || null, section: latest.section || null, names: [...new Set(mine.map((r) => r.name).filter(Boolean))] },
    summary: {
      tests: rows.length, graded: scored.length, average: r1(mean(pcts)), best: pcts.length ? Math.max(...pcts) : null, worst: pcts.length ? Math.min(...pcts) : null,
      latest: pcts.length ? pcts[pcts.length - 1] : null, change: pcts.length > 1 ? r1(pcts[pcts.length - 1] - pcts[pcts.length - 2]) : null,
      passed: pcts.filter((p) => p >= config.grading.passPercent).length, pass_percent: config.grading.passPercent,
      needs_review: rows.filter((r) => r.status === 'needs_review').length,
      above_class: scored.filter((r) => r.percentage > r.class_average).length,
    },
    results: rows,
    by_subject: group((r) => r.subject_id, (r) => ({ subject_id: r.subject_id, name: r.subject_name })).sort((a, b) => b.average - a.average),
    by_term: group((r) => `${r.academic_year}|${r.semester}`, (r) => ({ academic_year: r.academic_year, semester: r.semester })),
    skills: Object.fromEntries(Object.entries(skills).map(([k, v]) => [k, v.length ? r1(mean(v) * 100) : null])),
    by_type: Object.entries(types).map(([type, v]) => ({ type, questions: v.length, average: r1(mean(v) * 100) })).sort((a, b) => b.questions - a.questions),
    questions: qstats,
    weaknesses: Object.values(topics).sort((a, b) => SEV[a.severity] - SEV[b.severity] || b.count - a.count).slice(0, 10),
    strengths: Object.entries(strengths).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([topic, count]) => ({ topic, count })),
    study_plan: latest.gaps && !latest.gaps.error ? latest.gaps.study_plan || [] : [],
  };
}
