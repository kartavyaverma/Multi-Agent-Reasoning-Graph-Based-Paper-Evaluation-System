import { config } from '../../config.js';
import { generateJson } from '../../ai/llm.js';
import { nid, questionsOf, modelOf, unitsOf, itemsOf, chunk, mergeChunks, JSON_RULES, clamp } from './util.js';
import { mockQuality } from './student.js';

const AGENT_DEPS = ['transcribe_text', 'analyze_figures', 'graph_compare'];

const ROLES = {
  logic: {
    title: 'LOGIC AGENT',
    focus: `Judge the REASONING FLOW. Is the answer organised in a valid order? Does each step follow from the previous one? Are derivations/calculations internally consistent (apply "error carried forward": a wrong early value followed by correct method still earns method credit)? Are there logical jumps, circular statements, contradictions or irrelevant detours? For numerical/derivation questions check each line of working.`,
  },
  concept: {
    title: 'CONCEPT AGENT',
    focus: `Judge CONCEPTUAL CORRECTNESS and depth. Are definitions and principles right? Does the student actually understand (vs. reciting keywords)? Identify misconceptions, confusion between related ideas, and correct-but-differently-worded understanding. Credit valid alternative explanations listed in the scheme or evidently correct.`,
  },
  coverage: {
    title: 'COVERAGE AGENT',
    focus: `Judge COMPLETENESS against the marking scheme. Go through every key point one by one and decide whether the student covered it fully, partially (half credit) or not at all; use the reasoning-graph comparison (missing nodes) as supporting evidence but verify it yourself since it is automatic. Report which key point ids were fully/partially covered.`,
  },
  factcheck: {
    title: 'FACT-CHECK AGENT',
    focus: `Judge FACTUAL ACCURACY independently of the model answer's wording: check every formula, number, unit, name, date, symbol, and statement the student made against established knowledge in the subject. The model answer may be incomplete, so a correct fact absent from it is NOT an error. Also assess the student's figure (if any) for factual/technical correctness using the figure evaluation provided. Penalise wrong facts, missing/incorrect units, and wrong values.`,
  },
};

function evidenceFor(ctx, unitId, qid) {
  const q = questionsOf(ctx).find((x) => x.id === qid);
  const m = modelOf(ctx)[qid] || {};
  const ans = itemsOf(ctx, 'transcribe_text')[unitId].answers.find((a) => a.q_id === qid);
  const g = itemsOf(ctx, 'graph_compare')[unitId]?.comparisons?.[qid];
  const fig = (itemsOf(ctx, 'analyze_figures')[unitId]?.figures || []).find((f) => f.q_id === qid);
  return { q, m, ans, g, fig };
}

function renderEvidence(ev) {
  const { q, m, ans, g, fig } = ev;
  const lines = [
    `### Question ${q.id} - ${q.marks} marks - ${q.type || ''}`,
    `QUESTION: ${q.text}`,
    `MODEL ANSWER: ${m.model_answer || '(not provided)'}${m.missing_in_model ? '  [NOTE: model answer did not cover this; use standard knowledge]' : ''}`,
    `KEY POINTS (marks): ${(m.key_points || []).map((k) => `${k.id}: ${k.text} (${k.marks})`).join(' | ') || '(none)'}`,
  ];
  if (m.rubric) lines.push(`RUBRIC NOTES: ${m.rubric}`);
  if ((m.acceptable_alternatives || []).length) lines.push(`ACCEPTABLE ALTERNATIVES: ${m.acceptable_alternatives.join(' | ')}`);
  if ((m.common_mistakes || []).length) lines.push(`COMMON MISTAKES: ${m.common_mistakes.join(' | ')}`);
  lines.push(`STUDENT ANSWER (OCR legibility ${(ans.legibility * 100).toFixed(0)}%):\n${ans.text || '(no text - figure only)'}`);
  if (ans.struck_out) lines.push(`(Struck-out by student, ignore for marks: ${ans.struck_out})`);
  if (g) {
    lines.push(`AUTOMATIC GRAPH COMPARISON: node coverage ${(g.node_coverage * 100).toFixed(0)}%, edge/flow alignment ${(g.edge_alignment * 100).toFixed(0)}%. Reference steps NOT found in the student's answer: ${g.missing.join(' | ') || 'none'}. Student steps not in reference: ${g.extra.join(' | ') || 'none'}.`);
  }
  if (fig?.figure_present) {
    lines.push(`FIGURE ANALYSIS: ${fig.kind}; correctness ${(fig.correctness * 100).toFixed(0)}%; ${fig.description}. Missing labels: ${(fig.labels_missing || []).join(', ') || 'none'}. Errors: ${(fig.errors || []).join('; ') || 'none'}.`);
  } else if (fig && !fig.figure_present) {
    lines.push('FIGURE ANALYSIS: the student did not draw the expected figure.');
  }
  return lines.join('\n');
}

function makeAgent(role) {
  const R = ROLES[role];
  return {
    concurrency: 2,
    plan(ctx) {
      const per = config.grading.questionsPerCall;
      const batches = [];
      const tr = itemsOf(ctx, 'transcribe_text');
      for (const u of unitsOf(ctx)) {
        const bad = AGENT_DEPS.find((n) => itemsOf(ctx, n)[u.unit_id]?.error);
        const t = tr[u.unit_id];
        const qids = bad || !t ? [] : t.answers.filter((a) => a.attempted).map((a) => a.q_id);
        if (bad || !qids.length) batches.push({ key: `${u.unit_id}::0`, meta: { qids: [], error: bad ? `${bad} failed for this student` : null } });
        else chunk(qids, per).forEach((c, i) => batches.push({ key: `${u.unit_id}::${i}`, meta: { qids: c } }));
      }
      return batches;
    },
    async run(ctx, batch) {
      if (batch.meta.error) return { error: batch.meta.error };
      if (!batch.meta.qids.length) return { evaluations: [] };
      const unitId = batch.key.split('::')[0];
      const evs = batch.meta.qids.map((qid) => evidenceFor(ctx, unitId, qid));
      const text = `You are the ${R.title} in a panel of independent examiners grading ONE student's answers. Other agents judge other aspects; do not try to cover their job - but your final mark fraction must still reflect the answer's overall deserved credit as seen through your lens.

YOUR FOCUS: ${R.focus}

GRADING RULES:
- "fraction" = marks the answer deserves ÷ maximum marks for that question (0.0-1.0). Use finer steps than 0.25 when justified.
- Blank, irrelevant or entirely wrong answers get 0. Do not reward length, neat handwriting or keyword-stuffing. Do not penalise correct answers that are worded differently from the model answer.
- Be consistent: the same quality of answer must always get the same fraction.
- "confidence" (0-1) = how sure you are of YOUR fraction. Lower it when the transcription is unclear (low legibility), the question is ambiguous, the answer is partially correct in a way hard to judge, or evidence conflicts.
- "feedback" = 1-3 sentences addressed to the student, specific (what was right, what was missing/wrong, how to fix).
- "issues" = short list of concrete problems; "strengths" = short list of what was good.
${role === 'coverage' ? '- "key_points_covered": ids of key points fully covered; "key_points_partial": ids partially covered.' : ''}
${JSON_RULES}

Schema: {"evaluations":[{"q_id":string,"fraction":number,"confidence":number,"feedback":string,"strengths":[string],"issues":[string]${role === 'coverage' ? ',"key_points_covered":[string],"key_points_partial":[string]' : ''}}]}

${evs.map(renderEvidence).join('\n\n')}`;
      const res = await generateJson({
        task: `agent:${role}:${batch.key}`, parts: [{ text }], temperature: 0.1,
        mock: () => {
          const q = mockQuality(unitId);
          const bias = { logic: 0.05, concept: -0.05, coverage: 0, factcheck: 0.1 }[role];
          return {
            evaluations: batch.meta.qids.map((qid) => {
              // student #4 gets a deliberately split panel on question 2 to exercise re-evaluation / review routing
              const split = unitId === 's4' && qid === '2' ? { logic: 0.9, concept: 0.3, coverage: 0.5, factcheck: 0.8 }[role] - q : 0;
              return { q_id: qid, fraction: clamp(q + bias + split), confidence: 0.85, feedback: `Mock feedback from ${role}.`, strengths: [], issues: q < 0.5 ? ['Incomplete'] : [], ...(role === 'coverage' ? { key_points_covered: q > 0.5 ? ['k1', 'k2'] : [], key_points_partial: [] } : {}) };
            }),
          };
        },
      });
      return { evaluations: (res.evaluations || []).map((e) => ({ ...e, q_id: nid(e.q_id), fraction: clamp(Number(e.fraction)), confidence: clamp(Number(e.confidence ?? 0.6)) })) };
    },
    combine: (items) => mergeChunks(items, 'evaluations'),
  };
}

export const agentLogic = makeAgent('logic');
export const agentConcept = makeAgent('concept');
export const agentCoverage = makeAgent('coverage');
export const agentFactcheck = makeAgent('factcheck');
