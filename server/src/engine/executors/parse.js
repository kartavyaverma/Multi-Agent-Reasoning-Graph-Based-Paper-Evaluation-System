import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { config } from '../../config.js';
import { generateJson, filePart } from '../../ai/llm.js';
import { nid, questionsOf, modelOf, JSON_RULES, fmtQuestion } from './util.js';

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
    let id = nid(q.id || i + 1) || String(i + 1);
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
    return readQuestionPaper(ctx.input.question_paper);
  },
};

/** Reads a question paper file with the vision model. Also used by the "Read questions" preview on the New Test page. */
export async function readQuestionPaper(qp) {
  {
    const parts = [
      { text: `You are reading an exam QUESTION PAPER. Extract every question that a student must answer.

Rules:
- Work at the LEAF level: if a question has sub-parts (a), (b), (c) each with their own marks, emit each sub-part as its own question with id like "1a", "1b". If a question has no sub-parts, use its number ("2").
- "id" must be short, unique, and exactly how a student would label it (e.g. "1a", "4", "5ii").
- Keep the full question text (including any given data, tables or code). Describe any figure the question shows inside text in [square brackets].
- "marks" is a number. If marks are not printed, estimate from total marks / question count and set "marks_estimated": true.
- "type": one of "definition","short","long","numerical","derivation","diagram","mcq","code","other".
- "has_figure": true if the question asks the student to draw/label/plot a diagram, graph, circuit, flowchart, etc., OR provides a figure to interpret.
- "choice_group": if the paper says "attempt any N" / "answer either A or B", give the same short string to all questions in that group (e.g. "Q3-or-Q4"), else null.
- "choice_rules": for each choice group, how many of its questions must be counted, e.g. [{"group":"Q3-or-Q4","pick":1}] ("attempt any 2 of 3" -> pick 2). Empty array if none.
- "instructions": general instructions printed on the paper (string).
${JSON_RULES}

Schema: {"title": string, "subject_guess": string, "total_marks": number, "instructions": string, "choice_rules":[{"group":string,"pick":number}], "questions":[{"id":string,"text":string,"marks":number,"marks_estimated":boolean,"type":string,"has_figure":boolean,"choice_group":string|null}]}` },
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
    const questions = (res.questions || []).map((q) => ({ ...q, id: nid(q.id), marks: Number(q.marks) || 0 }));
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
    const typed = Object.fromEntries((ctx.input.manual_questions || []).map((q) => [nid(q.id), q]));
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
        parts: [{ text: `A teacher typed the MODEL ANSWER for each exam question. Turn each into a marking scheme.

${qs.map((q) => `${fmtQuestion(q)}
TEACHER'S MODEL ANSWER: ${typed[q.id]?.model_answer || '(blank)'}
TEACHER'S KEY POINTS: ${(typed[q.id]?.key_points || []).map((k) => `${k.text} (${k.marks})`).join(' | ') || '(none given)'}`).join('\n\n')}

For EACH question id produce: "key_points" (use the teacher's key points as-is if given; otherwise split the answer into distinct creditworthy points whose marks sum to the question's marks), "rubric" (string, may be empty), "acceptable_alternatives", "common_mistakes", "figure_spec" {"required","description","labels"}. Do NOT change the teacher's "model_answer" text.
${JSON_RULES}
Schema: {"answers":[{"q_id":string,"key_points":[{"id":string,"text":string,"marks":number}],"rubric":string,"acceptable_alternatives":[string],"common_mistakes":[string],"figure_spec":{"required":boolean,"description":string,"labels":[string]}}]}` }],
        mock: () => ({ answers: qs.map((q) => ({ q_id: q.id, key_points: [{ id: 'k1', text: 'Core idea', marks: q.marks / 2 }, { id: 'k2', text: 'Explanation', marks: q.marks / 2 }], rubric: '', acceptable_alternatives: [], common_mistakes: [], figure_spec: { required: !!q.has_figure, description: '', labels: [] } })) }),
      });
      const by = Object.fromEntries((res.answers || []).map((a) => [nid(a.q_id), a]));
      return { answers: qs.map((q) => ({ ...asAnswer(q), ...(by[q.id] || {}), q_id: q.id, model_answer: asAnswer(q).model_answer, missing_in_model: asAnswer(q).missing_in_model })) };
    }
    const parts = [
      { text: `You are reading the TEACHER'S MODEL ANSWER / MARKING SCHEME for an exam. Align it to this list of questions:

${qs.map(fmtQuestion).join('\n')}

For EACH question id produce:
- "model_answer": the complete ideal answer in plain text (keep equations/working).
- "key_points": the distinct things an answer must contain to earn marks, each {"id":"k1","text":string,"marks":number}. If the scheme prints a mark split, use it; otherwise divide the question's marks sensibly. Sum of key_point marks should equal the question's marks.
- "rubric": any marking guidance printed (string, may be empty), e.g. "accept alternative method", "1 mark for units".
- "acceptable_alternatives": other valid approaches/wordings that deserve credit (array of strings).
- "common_mistakes": typical errors (array of strings; infer if not printed).
- "figure_spec": {"required": boolean, "description": string describing exactly what the ideal diagram/graph shows, "labels": [string required labels/parts/axes]}.
If the model answer does not cover a question, still emit it with "missing_in_model": true and best-effort content derived from the question using standard textbook knowledge.
${JSON_RULES}

Schema: {"answers":[{"q_id":string,"model_answer":string,"key_points":[{"id":string,"text":string,"marks":number}],"rubric":string,"acceptable_alternatives":[string],"common_mistakes":[string],"figure_spec":{"required":boolean,"description":string,"labels":[string]},"missing_in_model":boolean}]}` },
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
    const byId = Object.fromEntries((res.answers || []).map((a) => [nid(a.q_id), a]));
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
      parts: [{ text: `Convert each model answer into a REASONING GRAPH: a directed graph of the ideal chain of reasoning.
- Each node is ONE atomic idea/step (a definition, principle, intermediate step, calculation, fact, or conclusion) written as a short self-contained sentence (max 25 words).
- Edges show logical flow: "leads_to" (step order), "supports", "depends_on", "contradicts".
- Node ids: "n1","n2",... unique within each question. 3-12 nodes per question depending on marks; include every key point as at least one node.
- Do not invent content that is not in the model answer.
${JSON_RULES}
Schema: ${GRAPH_SCHEMA}

${body}` }],
      mock: () => ({
        graphs: qs.map((q) => ({
          q_id: q.id,
          nodes: [{ id: 'n1', type: 'definition', text: 'Concept A' }, { id: 'n2', type: 'principle', text: 'Principle B' }, { id: 'n3', type: 'conclusion', text: 'Conclusion C' }],
          edges: [{ from: 'n1', to: 'n2', relation: 'leads_to' }, { from: 'n2', to: 'n3', relation: 'leads_to' }],
        })),
      }),
    });
    return { graphs: Object.fromEntries((res.graphs || []).map((g) => [nid(g.q_id), { nodes: g.nodes || [], edges: g.edges || [] }])) };
  },
};

