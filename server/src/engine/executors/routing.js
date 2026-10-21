import { db, now } from '../../db.js';
import { generateJson } from '../../ai/llm.js';
import { nid, questionsOf, modelOf, unitsOf, itemsOf, upstreamError, mean, stdev, clamp, round05, JSON_RULES } from './util.js';
import { unitPlan } from './student.js';

const AGENTS = ['logic', 'concept', 'coverage', 'factcheck'];
const AGENT_NODE = { logic: 'agent_logic', concept: 'agent_concept', coverage: 'agent_coverage', factcheck: 'agent_factcheck' };

/** Max total for the paper, honouring "attempt any N of group" rules. */
export function maxTotal(questions, rules = []) {
  const pick = Object.fromEntries(rules.map((r) => [r.group, Number(r.pick) || 1]));
  let total = 0;
  const groups = {};
  for (const q of questions) {
    if (q.choice_group && pick[q.choice_group]) (groups[q.choice_group] ||= []).push(q.marks);
    else total += q.marks;
  }
  for (const [g, marks] of Object.entries(groups)) total += marks.sort((a, b) => b - a).slice(0, pick[g]).reduce((s, x) => s + x, 0);
  return total;
}

/* ───────────── Confidence router (sync) ───────────── */
export const confidenceRouter = {
  async run(ctx) {
    const { highConfidence, lowConfidence, weights: W } = ctx.grading;
    // agents switched off in the workflow settings are left out of the panel, not counted as missing
    const active = AGENTS.filter((k) => !ctx.out(AGENT_NODE[k])?.skipped);
    const model = modelOf(ctx);
    const items = {};
    for (const u of unitsOf(ctx)) {
      const id = u.unit_id;
      const tr = itemsOf(ctx, 'transcribe_text')[id];
      const err = tr?.error ? `transcribe_text: ${tr.error}` : upstreamError(ctx, id, ['analyze_figures', 'graph_compare', ...Object.values(AGENT_NODE)]);
      if (err) { items[id] = { error: err }; continue; }

      const questions = {};
      for (const a of tr.answers) {
        if (!a.attempted) { questions[a.q_id] = { route: 'unattempted', fraction: 0, confidence: 1 }; continue; }
        const agents = {};
        for (const k of active) {
          const e = (itemsOf(ctx, AGENT_NODE[k])[id]?.evaluations || []).find((x) => x.q_id === a.q_id);
          if (e) agents[k] = e;
        }
        const present = Object.keys(agents);
        if (!present.length) { questions[a.q_id] = { route: 'review', reason: 'No agent produced an evaluation', fraction: 0, confidence: 0, agents }; continue; }
        const wsum = present.reduce((s, k) => s + W[k], 0);
        const fraction = wsum > 0 ? present.reduce((s, k) => s + W[k] * agents[k].fraction, 0) / wsum : mean(present.map((k) => agents[k].fraction));
        const spread = stdev(present.map((k) => agents[k].fraction));
        const agreement = clamp(1 - spread / 0.5);
        let conf = mean(present.map((k) => agents[k].confidence)) * (0.25 + 0.75 * agreement);
        const reasons = [];
        if (spread > 0.15) reasons.push(`agents disagree (spread ${spread.toFixed(2)})`);
        if (a.legibility < 0.6) { conf *= 0.6 + 0.4 * (a.legibility / 0.6); reasons.push('hard-to-read handwriting'); }
        const g = itemsOf(ctx, 'graph_compare')[id]?.comparisons?.[a.q_id];
        if (g && Math.abs(g.structure_score - fraction) > 0.45) { conf *= 0.9; reasons.push('reasoning-graph score differs from panel'); }
        const fig = (itemsOf(ctx, 'analyze_figures')[id]?.figures || []).find((f) => f.q_id === a.q_id);
        if (fig?.figure_present) conf *= 0.7 + 0.3 * (fig.confidence ?? 0.7);
        if (model[a.q_id]?.missing_in_model) { conf *= 0.8; reasons.push('question missing from model answer'); }
        if (present.length < active.length) { conf *= 0.9; reasons.push('not all agents responded'); }
        conf = clamp(conf);
        const route = conf >= highConfidence ? 'auto' : conf >= lowConfidence ? 're_evaluate' : 'review';
        questions[a.q_id] = { route, fraction, spread, agreement, confidence: conf, reason: reasons.join('; '), agents };
      }
      items[id] = { questions };
    }
    const counts = { auto: 0, re_evaluate: 0, review: 0, unattempted: 0 };
    Object.values(items).forEach((it) => Object.values(it.questions || {}).forEach((q) => counts[q.route]++));
    return { items, counts };
  },
};

/* ───────────── Arbiter re-evaluation for medium-confidence answers ───────────── */
export const reEvaluate = {
  concurrency: 2,
  plan(ctx) {
    const items = ctx.out('confidence_router').items;
    return unitsOf(ctx)
      .map((u) => ({ id: u.unit_id, qids: Object.entries(items[u.unit_id]?.questions || {}).filter(([, q]) => q.route === 're_evaluate').map(([k]) => k) }))
      .filter((x) => x.qids.length)
      .map((x) => ({ key: x.id, meta: { qids: x.qids } }));
  },
  async run(ctx, batch) {
    const id = batch.key;
    const routed = ctx.out('confidence_router').items[id].questions;
    const qs = Object.fromEntries(questionsOf(ctx).map((q) => [q.id, q]));
    const model = modelOf(ctx);
    const tr = itemsOf(ctx, 'transcribe_text')[id];
    const block = batch.meta.qids.map((qid) => {
      const r = routed[qid];
      const a = tr.answers.find((x) => x.q_id === qid);
      return `### Q${qid} (${qs[qid].marks} marks): ${qs[qid].text}
MODEL ANSWER: ${model[qid]?.model_answer}
KEY POINTS: ${(model[qid]?.key_points || []).map((k) => `${k.id}: ${k.text} (${k.marks})`).join(' | ')}
STUDENT ANSWER:\n${a.text || '(figure only)'}
PANEL VERDICTS (fraction of full marks):
${Object.entries(r.agents).map(([k, e]) => `- ${k}: ${e.fraction.toFixed(2)} (conf ${e.confidence.toFixed(2)}) issues: ${(e.issues || []).join('; ') || 'none'} | ${e.feedback}`).join('\n')}
Why flagged: ${r.reason || 'low overall confidence'}`;
    }).join('\n\n');
    const res = await generateJson({
      task: `arbiter:${id}`,
      parts: [{ text: ctx.prompt('re_evaluate', `${JSON_RULES}
Schema: {"decisions":[{"q_id":string,"fraction":number,"confidence":number,"reasoning":string,"feedback":string}]}

${block}`) }],
      mock: () => ({ decisions: batch.meta.qids.map((qid) => ({ q_id: qid, fraction: routed[qid].fraction, confidence: 0.8, reasoning: 'Mock arbiter.', feedback: 'Mock arbiter feedback.' })) }),
    });
    return { decisions: Object.fromEntries((res.decisions || []).map((d) => [nid(d.q_id), { ...d, fraction: clamp(Number(d.fraction)), confidence: clamp(Number(d.confidence ?? 0.5)) }])) };
  },
};

/* ───────────── Finalize marks + persist results (sync) ───────────── */
export const finalizeMarks = {
  async run(ctx) {
    const { test_id, user_id } = ctx.input;
    const qlist = questionsOf(ctx);
    const parsed = ctx.out('parse_questions');
    const model = modelOf(ctx);
    const routed = ctx.out('confidence_router').items;
    const arbiter = itemsOf(ctx, 're_evaluate');
    const pickRules = Object.fromEntries((parsed.choice_rules || []).map((r) => [r.group, Number(r.pick) || 1]));
    const maxT = ctx.input.total_marks_override || maxTotal(qlist, parsed.choice_rules);

    await db.results.remove({ test_id }, { multi: true });
    const out = [];
    for (const u of unitsOf(ctx)) {
      const id = u.unit_id;
      const tr = itemsOf(ctx, 'transcribe_text')[id];
      const base = { test_id, user_id, unit_id: id, label: u.label, max_total: maxT, created_at: now() };
      const r = routed[id];
      if (!r || r.error || !tr || tr.error) {
        const doc = await db.results.insert({ ...base, name: tr?.student?.name || u.label, roll_no: tr?.student?.roll_no || null, status: 'error', error: r?.error || tr?.error || 'processing failed', total: null, percentage: null, review_count: 0, questions: [] });
        out.push(doc._id);
        continue;
      }
      const g = itemsOf(ctx, 'graph_compare')[id]?.comparisons || {};
      const figs = Object.fromEntries((itemsOf(ctx, 'analyze_figures')[id]?.figures || []).map((f) => [f.q_id, f]));
      const rows = qlist.map((q) => {
        const a = tr.answers.find((x) => x.q_id === q.id);
        const rt = r.questions[q.id] || { route: 'unattempted', fraction: 0, confidence: 1 };
        let fraction = rt.fraction, status = 'auto', confidence = rt.confidence, reasoning = null, extraFeedback = null;
        if (rt.route === 'unattempted') status = 'unattempted';
        else if (rt.route === 'review') status = 'review';
        else if (rt.route === 're_evaluate') {
          const d = arbiter[id]?.decisions?.[q.id];
          if (d) {
            fraction = d.fraction; confidence = d.confidence; reasoning = d.reasoning; extraFeedback = d.feedback;
            status = d.confidence >= ctx.grading.arbiterAccept ? 'reevaluated' : 'review';
          } else status = 'review';
        }
        const agents = rt.agents || {};
        const near = Object.values(agents).sort((x, y) => Math.abs(x.fraction - fraction) - Math.abs(y.fraction - fraction))[0];
        const uniq = (k) => [...new Set(Object.values(agents).flatMap((e) => e[k] || []))].slice(0, 6);
        const marks = round05(clamp(fraction) * q.marks);
        const gc = g[q.id];
        return {
          q_id: q.id, text: q.text, max: q.marks, type: q.type, choice_group: q.choice_group || null,
          marks, ai_marks: marks, fraction: clamp(fraction), status, confidence: +confidence.toFixed(2), spread: rt.spread != null ? +rt.spread.toFixed(2) : null,
          flag_reason: status === 'review' ? rt.reason || 'low confidence' : null,
          counted: true,
          answer_text: a?.text || '', struck_out: a?.struck_out || '', legibility: a?.legibility ?? null, attempted: !!a?.attempted,
          model_answer: model[q.id]?.model_answer || '', key_points: model[q.id]?.key_points || [],
          agents: Object.fromEntries(Object.entries(agents).map(([k, e]) => [k, { fraction: e.fraction, confidence: e.confidence, feedback: e.feedback, issues: e.issues || [], strengths: e.strengths || [], key_points_covered: e.key_points_covered, key_points_partial: e.key_points_partial }])),
          feedback: extraFeedback || near?.feedback || (status === 'unattempted' ? 'Not attempted.' : ''),
          issues: uniq('issues'), strengths: uniq('strengths'), arbiter_reasoning: reasoning,
          graph: gc ? { node_coverage: gc.node_coverage, edge_alignment: gc.edge_alignment, structure_score: gc.structure_score, matched: gc.matched, missing: gc.missing, extra: gc.extra, method: gc.method } : null,
          figure: figs[q.id] || null, teacher_comment: null, teacher_marks: null,
        };
      });
      // "attempt any N" groups: count only the best N attempted answers
      for (const [grp, pick] of Object.entries(pickRules)) {
        const members = rows.filter((x) => x.choice_group === grp).sort((a, b) => b.marks - a.marks);
        members.slice(pick).forEach((x) => { x.counted = false; });
      }
      const total = rows.filter((x) => x.counted).reduce((s, x) => s + x.marks, 0);
      const doc = await db.results.insert({
        ...base, name: tr.student.name || u.label, roll_no: tr.student.roll_no, section: tr.student.section,
        identity_confidence: tr.student.identity_confidence, status: rows.some((x) => x.status === 'review') ? 'needs_review' : 'graded',
        review_count: rows.filter((x) => x.status === 'review').length,
        total, percentage: maxT ? +((total / maxT) * 100).toFixed(1) : 0, questions: rows, gaps: null, notes: tr.notes || '',
      });
      out.push(doc._id);
    }
    return { result_ids: out, max_total: maxT };
  },
};

export { unitPlan };
