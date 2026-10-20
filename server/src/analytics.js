import { config } from './config.js';

const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r1 = (x) => Math.round(x * 10) / 10;

export function gradeOf(pct) {
  if (pct >= 90) return 'A+';
  if (pct >= 80) return 'A';
  if (pct >= 70) return 'B+';
  if (pct >= 60) return 'B';
  if (pct >= 50) return 'C';
  if (pct >= 40) return 'D';
  return 'F';
}

/** Class-level analytics for one test from its result docs. */
export function testAnalytics(results) {
  const scored = results.filter((r) => r.total != null);
  const pcts = scored.map((r) => r.percentage);
  const bins = Array.from({ length: 10 }, (_, i) => ({ range: `${i * 10}-${i === 9 ? 100 : i * 10 + 9}`, from: i * 10, count: 0 }));
  pcts.forEach((p) => { bins[Math.min(9, Math.floor(p / 10))].count++; });
  const grades = {};
  pcts.forEach((p) => { const g = gradeOf(p); grades[g] = (grades[g] || 0) + 1; });

  const qmap = {};
  scored.forEach((r) => r.questions.forEach((q) => {
    if (!q.counted) return;
    const m = (qmap[q.q_id] ||= { q_id: q.q_id, text: q.text, max: q.max, attempted: 0, sum: 0, full: 0, zero: 0 });
    if (q.attempted) m.attempted++;
    m.sum += q.marks;
    if (q.marks >= q.max) m.full++;
    if (q.marks === 0) m.zero++;
  }));
  const questions = Object.values(qmap).map((m) => ({
    q_id: m.q_id, text: m.text, max: m.max,
    avg_marks: r1(m.sum / (scored.length || 1)), avg_percent: r1((m.sum / (scored.length || 1) / (m.max || 1)) * 100),
    attempt_rate: r1((m.attempted / (scored.length || 1)) * 100), full_marks: m.full, zero_marks: m.zero,
  }));

  const sorted = [...scored].sort((a, b) => b.total - a.total);
  return {
    students: results.length,
    graded: scored.length,
    errors: results.length - scored.length,
    needs_review: results.filter((r) => r.status === 'needs_review').length,
    max_total: results[0]?.max_total ?? 0,
    average: r1(pcts.reduce((s, x) => s + x, 0) / (pcts.length || 1)),
    median: r1(median(pcts)),
    highest: pcts.length ? Math.max(...pcts) : 0,
    lowest: pcts.length ? Math.min(...pcts) : 0,
    pass_rate: r1((pcts.filter((p) => p >= config.grading.passPercent).length / (pcts.length || 1)) * 100),
    pass_percent: config.grading.passPercent,
    distribution: bins,
    grades: Object.entries(grades).map(([grade, count]) => ({ grade, count })),
    questions,
    toppers: sorted.slice(0, 5).map((r) => ({ id: r._id, name: r.name, total: r.total, percentage: r.percentage })),
    weakest_questions: [...questions].sort((a, b) => a.avg_percent - b.avg_percent).slice(0, 3).map((q) => q.q_id),
  };
}

export function subjectTrend(tests, resultsByTest) {
  return tests.filter((t) => t.status === 'completed').map((t) => {
    const a = testAnalytics(resultsByTest[t._id] || []);
    return { test_id: t._id, title: t.title, date: t.created_at, students: a.students, average: a.average, pass_rate: a.pass_rate, highest: a.highest };
  }).sort((a, b) => a.date - b.date);
}
