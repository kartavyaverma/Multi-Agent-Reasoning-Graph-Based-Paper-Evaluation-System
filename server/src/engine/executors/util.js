/** Question ids become object keys in the DB, which forbids '.' and '$'. */
export const nid = (s) => String(s).replace(/[.$\s]/g, '');

/** Canonical question id: "Q1" -> "1", "Q.2a" -> "2a", "q10" -> "10" (the app adds its own "Q" when displaying). */
export const qid = (s) => nid(s).replace(/^(?:question|ques|que|q)+\.?(?=\d)/i, '') || nid(s);

/** Loose form of a question label: "Q1", "QQ1", "Q.2 (a)", "Ans 2a", "Question 4." -> "1", "1", "2a", "2a", "4". */
const loose = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^(?:question|ques|que|answer|ans|q)+(?=\d)/, '');

/** Returns a function mapping a question label written by the model to the paper's question id. */
export function qidMap(questions) {
  const m = new Map((questions || []).map((q) => [loose(q.id), q.id]));
  return (raw) => m.get(loose(raw)) ?? nid(raw);
}
export const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, Number.isFinite(x) ? x : lo));
export const round05 = (x) => Math.round(x * 2) / 2;
export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
export const stdev = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
};

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export const questionsOf = (ctx) => ctx.out('parse_questions').questions;
export const modelOf = (ctx) => Object.fromEntries((ctx.out('parse_model_answers').answers || []).map((a) => [a.q_id, a]));
export const unitsOf = (ctx) => ctx.out('ingest').units;

/** Items of a per-student node, keyed by unit id. */
export const itemsOf = (ctx, node) => ctx.out(node)?.items || {};

/** Returns an error string if any upstream node failed for this unit. */
export function upstreamError(ctx, unitId, nodes) {
  for (const n of nodes) {
    const it = itemsOf(ctx, n)[unitId];
    if (it?.error) return `${n}: ${it.error}`;
  }
  return null;
}

/** Merge chunked batch outputs ("unit::chunk") back into one record per unit. */
export function mergeChunks(items, field) {
  const merged = {};
  for (const [key, val] of Object.entries(items)) {
    const unit = key.split('::')[0];
    merged[unit] ||= { [field]: [] };
    if (val?.error) merged[unit].error = merged[unit].error || val.error;
    else merged[unit][field].push(...(val?.[field] || []));
  }
  return { items: merged };
}

export const JSON_RULES = 'Respond with a single valid JSON object only. No markdown, no commentary.';

export function fmtQuestion(q) {
  return `Q${q.id} [${q.marks} marks]${q.type ? ` (${q.type})` : ''}: ${q.text}`;
}
