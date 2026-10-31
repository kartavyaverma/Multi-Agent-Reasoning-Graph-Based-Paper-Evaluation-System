import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { config } from '../../config.js';
import { generateJson, filePart } from '../../ai/llm.js';
import { buildPrompt } from '../prompts.js';
import { nid, qid, qidMap, questionsOf, modelOf, JSON_RULES, fmtQuestion } from './util.js';

/* ───────────── Node 1: ingest (sync) ───────────── */
export const ingest = {
  async run(ctx) {
    const { student_files = [], pages_per_student, test_id } = ctx.input;
    const outDir = path.join(config.dataDir, 'uploads', test_id, 'units');
    fs.mkdirSync(outDir, { recursive: true });
    const units = [];
    const split = Number(pages_per_student) > 0 && student_files.length === 1 && student_files[0].mime === 'application/pdf';

    if (split) {
      const f = student_files[0];
      const src = await PDFDocument.load(fs.readFileSync(f.path), { ignoreEncryption: true });
      const total = src.getPageCount();
      const n = Number(pages_per_student);
      for (let s = 0, i = 1; s < total; s += n, i++) {
        const doc = await PDFDocument.create();
        const idx = Array.from({ length: Math.min(n, total - s) }, (_, k) => s + k);
        (await doc.copyPages(src, idx)).forEach((p) => doc.addPage(p));
        const p = path.join(outDir, `s${i}.pdf`);
        fs.writeFileSync(p, await doc.save());
        units.push({ unit_id: `s${i}`, label: `Student ${i} (pages ${s + 1}-${s + idx.length})`, path: p, mime: 'application/pdf', pages: idx.length });
      }
    } else {
      student_files.forEach((f, i) => {
        units.push({ unit_id: `s${i + 1}`, label: f.name || `Student ${i + 1}`, path: f.path, mime: f.mime, pages: null });
      });
    }
    if (!units.length) throw new Error('No student answer files were uploaded');
    return { units };
  },
};

/* ───────────── Node 2: parse the question paper ───────────── */
/** Questions typed or edited by the teacher in the UI (skips the AI read entirely). */
export function normalizeManual(list, choiceRules = []) {
  const seen = new Set();
  const questions = list.map((q, i) => {
    let id = qid(q.id || i + 1) || String(i + 1);
    while (seen.has(id)) id += '_';
    seen.add(id);
    return { id, text: String(q.text || '').trim(), marks: Number(q.marks) || 0, type: q.type || 'other', has_figure: !!q.has_figure, choice_group: q.choice_group || null };
  });
  const total = questions.reduce((t, q) => t + q.marks, 0);
  return { title: 'Teacher-entered paper', total_marks: total, computed_total: total, instructions: '', choice_rules: choiceRules || [], questions };
}

export const parseQuestions = {
  async run(ctx) {
    if (ctx.input.manual_questions?.length) return normalizeManual(ctx.input.manual_questions, ctx.input.choice_rules);
    return readQuestionPaper(ctx.input.question_paper, ctx.wf.settings?.prompts);
  },
};

/** Reads a question paper file with the vision model. Also used by the "Read questions" preview on the New Test page. */
export async function readQuestionPaper(qp, prompts = {}) {
  {
    const parts = [
      { text: buildPrompt('parse_questions', prompts, `${JSON_RULES}

Schema: {"title": string, "subject_guess": string, "total_marks": number, "instructions": string, "choice_rules":[{"group":string,"pick":number}], "questions":[{"id":string,"text":string,"marks":number,"marks_estimated":boolean,"type":string,"has_figure":boolean,"choice_group":string|null}]}`) },
      await filePart(qp.path, qp.mime),
    ];
    const res = await generateJson({
      task: 'parse_questions', parts, mock: () => ({
        title: 'Mock Paper', subject_guess: 'Physics', total_marks: 15, instructions: 'Answer all.',
        questions: [
          { id: '1', text: 'State Newton\'s first law of motion and explain inertia.', marks: 5, type: 'short', has_figure: false, choice_group: null },
          { id: '2', text: 'Draw and label a simple circuit with a cell, resistor and ammeter.', marks: 5, type: 'diagram', has_figure: true, choice_group: null },
          { id: '3', text: 'Derive the equation v = u + at.', marks: 5, type: 'derivation', has_figure: false, choice_group: null },
        ],
      }),
    });
    const questions = (res.questions || []).map((q) => ({ ...q, id: qid(q.id), marks: Number(q.marks) || 0 }));
    if (!questions.length) throw new Error('No questions could be read from the question paper');
    const total = questions.reduce((s, q) => s + q.marks, 0);
    return { ...res, questions, total_marks: Number(res.total_marks) || total, computed_total: total };
  }
}

/* ───────────── Node 3: parse model answers / rubric ───────────── */
export const parseModelAnswers = {
  async run(ctx) {
    const qs = questionsOf(ctx);
    const ma = ctx.input.model_answer;
    const typed = Object.fromEntries((ctx.input.manual_questions || []).map((q, i) => [qid(q.id || i + 1), q]));
    const hasFile = !!ma?.path;
    if (!hasFile) {
      const complete = qs.every((q) => typed[q.id]?.key_points?.length);
      const asAnswer = (q) => {
        const t = typed[q.id] || {};
        return { q_id: q.id, model_answer: String(t.model_answer || '').trim(), key_points: (t.key_points || []).map((k, i) => ({ id: `k${i + 1}`, text: k.text, marks: Number(k.marks) || 0 })), rubric: t.rubric || '', acceptable_alternatives: [], common_mistakes: [], figure_spec: { required: !!q.has_figure, description: t.figure_description || '', labels: [] }, missing_in_model: !String(t.model_answer || '').trim() };
      };
      if (complete) return { answers: qs.map(asAnswer) };
      // typed answers without a mark split: let the model derive the key points / rubric from the teacher's own text
      const res = await generateJson({
        task: 'structure_typed_answers',
        parts: [{ text: ctx.prompt('structure_typed_answers', `${qs.map((q) => `${fmtQuestion(q)}
TEACHER'S MODEL ANSWER: ${typed[q.id]?.model_answer || '(blank)'}
TEACHER'S KEY POINTS: ${(typed[q.id]?.key_points || []).map((k) => `${k.text} (${k.marks})`).join(' | ') || '(none given)'}`).join('\n\n')}

${JSON_RULES}
Schema: {"answers":[{"q_id":string,"key_points":[{"id":string,"text":string,"marks":number}],"rubric":string,"acceptable_alternatives":[string],"common_mistakes":[string],"figure_spec":{"required":boolean,"description":string,"labels":[string]}}]}`) }],
        mock: () => ({ answers: qs.map((q) => ({ q_id: q.id, key_points: [{ id: 'k1', text: 'Core idea', marks: q.marks / 2 }, { id: 'k2', text: 'Explanation', marks: q.marks / 2 }], rubric: '', acceptable_alternatives: [], common_mistakes: [], figure_spec: { required: !!q.has_figure, description: '', labels: [] } })) }),
      });
      const by = Object.fromEntries((res.answers || []).map((a) => [qidMap(qs)(a.q_id), a]));
      return { answers: qs.map((q) => ({ ...asAnswer(q), ...(by[q.id] || {}), q_id: q.id, model_answer: asAnswer(q).model_answer, missing_in_model: asAnswer(q).missing_in_model })) };
    }
    const parts = [
      { text: ctx.prompt('parse_model_answers', `QUESTIONS:
${qs.map(fmtQuestion).join('\n')}

${JSON_RULES}

Schema: {"answers":[{"q_id":string,"model_answer":string,"key_points":[{"id":string,"text":string,"marks":number}],"rubric":string,"acceptable_alternatives":[string],"common_mistakes":[string],"figure_spec":{"required":boolean,"description":string,"labels":[string]},"missing_in_model":boolean}]}`) },
      await filePart(ma.path, ma.mime),
    ];
    const res = await generateJson({
      task: 'parse_model_answers', parts, mock: () => ({
        answers: qs.map((q) => ({
          q_id: q.id,
          model_answer: `Model answer for ${q.id}: concept A, then principle B, therefore conclusion C.`,
          key_points: [
            { id: 'k1', text: 'Concept A', marks: q.marks / 2 },
            { id: 'k2', text: 'Principle B and conclusion C', marks: q.marks / 2 },
          ],
          rubric: '', acceptable_alternatives: [], common_mistakes: ['Confuses A with B'],
          figure_spec: { required: !!q.has_figure, description: q.has_figure ? 'Labelled circuit diagram' : '', labels: q.has_figure ? ['cell', 'resistor', 'ammeter'] : [] },
          missing_in_model: false,
        })),
      }),
    });
    const byId = Object.fromEntries((res.answers || []).map((a) => [qidMap(qs)(a.q_id), a]));
    // guarantee an entry for every question
    const answers = qs.map((q) => ({
      q_id: q.id, model_answer: '', key_points: [], rubric: '', acceptable_alternatives: [], common_mistakes: [],
      figure_spec: { required: !!q.has_figure, description: '', labels: [] }, missing_in_model: true,
      ...(byId[q.id] || {}), q_id: q.id,
    }));
    return { answers };
  },
};

/* ───────────── Node 4: reference reasoning graph (text-only) ───────────── */
export const GRAPH_SCHEMA = `{"graphs":[{"q_id":string,"nodes":[{"id":string,"type":"definition"|"principle"|"step"|"calculation"|"example"|"fact"|"conclusion","text":string}],"edges":[{"from":string,"to":string,"relation":"leads_to"|"supports"|"depends_on"|"contradicts"}]}]}`;

export const buildReferenceGraph = {
  async run(ctx) {
    const qs = questionsOf(ctx);
    const model = modelOf(ctx);
    const body = qs.map((q) => `### Q${q.id}: ${q.text}\nMODEL ANSWER: ${model[q.id]?.model_answer || '(none)'}\nKEY POINTS: ${(model[q.id]?.key_points || []).map((k) => k.text).join(' | ')}`).join('\n\n');
    const res = await generateJson({
      task: 'reference_graph',
      parts: [{ text: ctx.prompt('build_reference_graph', `${JSON_RULES}
Schema: ${GRAPH_SCHEMA}

${body}`) }],
      mock: () => ({
        graphs: qs.map((q) => ({
          q_id: q.id,
          nodes: [{ id: 'n1', type: 'definition', text: 'Concept A' }, { id: 'n2', type: 'principle', text: 'Principle B' }, { id: 'n3', type: 'conclusion', text: 'Conclusion C' }],
          edges: [{ from: 'n1', to: 'n2', relation: 'leads_to' }, { from: 'n2', to: 'n3', relation: 'leads_to' }],
        })),
      }),
    });
    return { graphs: Object.fromEntries((res.graphs || []).map((g) => [qidMap(qs)(g.q_id), { nodes: g.nodes || [], edges: g.edges || [] }])) };
  },
};

