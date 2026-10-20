// End-to-end test against a running server started with MOCK_AI=1:  node src/selftest.js http://localhost:4100
import { PDFDocument } from 'pdf-lib';
const base = process.argv[2] || 'http://localhost:4100';
const j = async (r) => { const b = await r.json(); if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(b)}`); return b; };
const pdf = async (pages = 1) => { const d = await PDFDocument.create(); for (let i = 0; i < pages; i++) d.addPage(); return new Blob([await d.save()], { type: 'application/pdf' }); };

const email = `t${Date.now()}@x.com`;
const { token } = await j(await fetch(`${base}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Teach', email, password: 'password123' }) }));
const H = { Authorization: `Bearer ${token}` };

const fd = new FormData();
fd.append('title', 'Midterm'); fd.append('subject_name', 'Physics');
fd.append('question_paper', await pdf(), 'qp.pdf'); fd.append('model_answer', await pdf(), 'ma.pdf');
fd.append('student_answers', await pdf(10), 'all.pdf'); fd.append('pages_per_student', '2'); // 5 students from one combined PDF
const { test } = await j(await fetch(`${base}/api/tests`, { method: 'POST', headers: H, body: fd }));
console.log('created test', test._id);

const t0 = Date.now();
for (;;) {
  const s = await j(await fetch(`${base}/api/tests/${test._id}`, { headers: H }));
  const line = s.nodes.map((n) => n.name.slice(0,6) + ':' + n.status[0] + (n.progress?.total ? `${n.progress.done}/${n.progress.total}` : '')).join(' ');
  process.stdout.write(`\r${s.workflow.status} ${line}   `);
  if (s.workflow.status !== 'running') { console.log('\nfinal:', s.workflow.status, s.workflow.error || ''); break; }
  if (Date.now() - t0 > 120000) throw new Error('timeout');
  await new Promise((r) => setTimeout(r, 700));
}
const { analytics } = await j(await fetch(`${base}/api/tests/${test._id}/analytics`, { headers: H }));
console.log(JSON.stringify({ ...analytics, questions: undefined, distribution: undefined }, null, 1));
const { results } = await j(await fetch(`${base}/api/tests/${test._id}/results`, { headers: H }));
results.forEach((r) => console.log(r.name, r.total, '/', r.max_total, r.status, 'review:', r.review_count, r.questions.map((q) => `${q.q_id}:${q.marks}${q.status[0]}`).join(' ')));
const d = await j(await fetch(`${base}/api/tests/${test._id}/results/${results[0].id}`, { headers: H }));
console.log('detail q1 keys:', Object.keys(d.result.questions[0]).length, 'gaps:', !!d.result.gaps, 'rank', d.rank);
const rv = results.find((r) => r.review_count);
if (rv) {
  const q = rv.questions.find((x) => x.status === 'review');
  const u = await j(await fetch(`${base}/api/tests/${test._id}/results/${rv.id}/questions/${q.q_id}`, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ marks: 2, comment: 'ok' }) }));
  console.log('override ->', u.result.total, u.result.status);
}
