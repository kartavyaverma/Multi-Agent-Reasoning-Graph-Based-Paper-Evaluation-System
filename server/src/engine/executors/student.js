import { generateJson, filePart } from '../../ai/llm.js';
import { qidMap, questionsOf, modelOf, unitsOf, itemsOf, upstreamError, JSON_RULES, fmtQuestion } from './util.js';
import { GRAPH_SCHEMA } from './parse.js';

const unitPlan = (ctx) => unitsOf(ctx).map((u) => ({ key: u.unit_id, meta: { label: u.label } }));
const unitNo = (id) => Number(String(id).replace(/\D/g, '')) || 1;
/** Deterministic fake quality per student, used only by the offline mock mode. */
export const mockQuality = (id) => [0.9, 0.6, 0.3, 0.75, 0.5][(unitNo(id) - 1) % 5];

/* ───────────── Transcription: handwriting / print → text (OCR) ───────────── */
export const transcribeText = {
  concurrency: 3,
  plan: unitPlan,
  async run(ctx, batch) {
    const unit = unitsOf(ctx).find((u) => u.unit_id === batch.key);
    const qs = questionsOf(ctx);
    const parts = [
      { text: ctx.prompt('transcribe_text', `Questions on the paper:
${qs.map(fmtQuestion).join('\n')}

${JSON_RULES}

Schema: {"student":{"name":string|null,"roll_no":string|null,"section":string|null,"identity_confidence":number},"answers":[{"q_id":string,"attempted":boolean,"text":string,"struck_out":string,"has_figure":boolean,"figure_note":string,"legibility":number}],"unmapped_text":string,"page_count":number,"script_quality_notes":string}`) },
      await filePart(unit.path, unit.mime),
    ];
    const res = await generateJson({
      task: `transcribe:${unit.unit_id}`, parts,
      mock: () => {
        const q = mockQuality(unit.unit_id);
        return {
          student: { name: `Student ${unitNo(unit.unit_id)} Name`, roll_no: `1JS23IS${String(unitNo(unit.unit_id)).padStart(3, '0')}`, section: 'A', identity_confidence: 0.9 },
          answers: qs.map((x, i) => ({
            q_id: x.id, attempted: !(q < 0.35 && i === qs.length - 1), has_figure: !!x.has_figure, figure_note: x.has_figure ? 'Sketch of a circuit on page 2' : '',
            text: q > 0.5 ? `Concept A is defined. Principle B applies so conclusion C follows. (quality ${q})` : 'Some vague statement about B.',
            struck_out: '', legibility: q > 0.35 ? 0.9 : 0.5,
          })),
          unmapped_text: '', page_count: 2, script_quality_notes: '',
        };
      },
    });
    const byId = Object.fromEntries((res.answers || []).map((a) => [qidMap(qs)(a.q_id), a]));
    return {
      student: { name: res.student?.name || null, roll_no: res.student?.roll_no || null, section: res.student?.section || null, identity_confidence: res.student?.identity_confidence ?? 0.5 },
      answers: qs.map((q) => {
        const a = byId[q.id] || {};
        const text = (a.text || '').trim();
        return {
          q_id: q.id, attempted: a.attempted !== false && (text.length > 0 || !!a.has_figure),
          text, struck_out: a.struck_out || '', has_figure: !!a.has_figure, figure_note: a.figure_note || '',
          legibility: typeof a.legibility === 'number' ? a.legibility : 0.7,
        };
      }),
      unmapped_text: res.unmapped_text || '', page_count: res.page_count || unit.pages || null, notes: res.script_quality_notes || '',
    };
  },
};

/* ───────────── Figures: diagrams / graphs / images / tables ───────────── */
export const analyzeFigures = {
  concurrency: 3,
  plan: unitPlan,
  async run(ctx, batch) {
    const id = batch.key;
    const err = upstreamError(ctx, id, ['transcribe_text']);
    if (err) return { error: err };
    const unit = unitsOf(ctx).find((u) => u.unit_id === id);
    const qs = questionsOf(ctx);
    const model = modelOf(ctx);
    const tr = itemsOf(ctx, 'transcribe_text')[id];
    const trBy = Object.fromEntries(tr.answers.map((a) => [a.q_id, a]));
    // Only questions where a figure is expected or the student drew one
    const targets = qs.filter((q) => q.has_figure || model[q.id]?.figure_spec?.required || trBy[q.id]?.has_figure);
    if (!targets.length) return { figures: [], skipped: 'no figure-based questions' };

    const parts = [
      { text: ctx.prompt('analyze_figures', `${targets.map((q) => `### Q${q.id} [${q.marks} marks] ${q.text}
Expected figure: ${model[q.id]?.figure_spec?.description || '(not specified - use standard textbook expectations)'}
Required labels/parts: ${(model[q.id]?.figure_spec?.labels || []).join(', ') || '(not specified)'}
Student's text answer (transcribed): ${trBy[q.id]?.text || '(none)'}
Transcriber note: ${trBy[q.id]?.figure_note || '(none)'}`).join('\n\n')}

${JSON_RULES}

Schema: {"figures":[{"q_id":string,"figure_present":boolean,"kind":string,"description":string,"labels_present":[string],"labels_missing":[string],"errors":[string],"correctness":number,"neatness":number,"confidence":number}]}`) },
      await filePart(unit.path, unit.mime),
    ];
    const res = await generateJson({
      task: `figures:${id}`, parts,
      mock: () => ({ figures: targets.map((q) => ({ q_id: q.id, figure_present: true, kind: 'circuit', description: 'Mock sketch', labels_present: ['cell'], labels_missing: ['ammeter'], errors: [], correctness: 0.4 + 0.5 * (unitNo(id) % 2), neatness: 0.7, confidence: 0.8 })) }),
    });
    return { figures: (res.figures || []).map((f) => ({ ...f, q_id: qidMap(qs)(f.q_id) })) };
  },
};

/* ───────────── Reasoning extraction: answer → reasoning graph ───────────── */
export const extractReasoning = {
  concurrency: 3,
  plan: unitPlan,
  async run(ctx, batch) {
    const id = batch.key;
    const err = upstreamError(ctx, id, ['transcribe_text']);
    if (err) return { error: err };
    const tr = itemsOf(ctx, 'transcribe_text')[id];
    const answered = tr.answers.filter((a) => a.attempted && a.text);
    if (!answered.length) return { graphs: {} };
    const qs = Object.fromEntries(questionsOf(ctx).map((q) => [q.id, q]));
    const res = await generateJson({
      task: `reasoning:${id}`,
      parts: [{ text: ctx.prompt('extract_reasoning', `${JSON_RULES}
Schema: ${GRAPH_SCHEMA}

${answered.map((a) => `### Q${a.q_id}: ${qs[a.q_id]?.text}\nSTUDENT ANSWER:\n${a.text}`).join('\n\n')}`) }],
      mock: () => ({
        graphs: answered.map((a) => {
          const q = mockQuality(id);
          return q > 0.5
            ? { q_id: a.q_id, nodes: [{ id: 'n1', type: 'definition', text: 'Concept A' }, { id: 'n2', type: 'principle', text: 'Principle B' }, { id: 'n3', type: 'conclusion', text: 'Conclusion C' }], edges: [{ from: 'n1', to: 'n2', relation: 'leads_to' }, { from: 'n2', to: 'n3', relation: 'leads_to' }] }
            : { q_id: a.q_id, nodes: [{ id: 'n1', type: 'fact', text: 'Something about B' }], edges: [] };
        }),
      }),
    });
    return { graphs: Object.fromEntries((res.graphs || []).map((g) => [qidMap(Object.values(qs))(g.q_id), { nodes: g.nodes || [], edges: g.edges || [] }])) };
  },
  combine: (items) => ({ items }),
};

export { unitPlan };
