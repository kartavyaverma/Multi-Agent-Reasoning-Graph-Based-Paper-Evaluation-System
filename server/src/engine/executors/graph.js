import { embed } from '../../ai/llm.js';
import { itemsOf, upstreamError } from './util.js';
import { unitPlan } from './student.js';

const STOP = new Set('a an the of to is are was were be been and or in on at for with by as that this it its from which then so than into can will not no'.split(' '));
const toks = (s) => (String(s).toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => !STOP.has(w)).map((w) => w.replace(/(ing|ed|es|s)$/, ''));

function lexical(a, b) {
  const A = new Set(toks(a));
  const B = new Set(toks(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((x) => B.has(x) && inter++);
  return inter / Math.min(A.size, B.size) * 0.6 + (inter / (A.size + B.size - inter)) * 0.4;
}

function cosine(a, b) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na * nb) || 1);
}

function reachable(edges, from, to) {
  const adj = {};
  edges.forEach((e) => (adj[e.from] ||= []).push(e.to));
  const seen = new Set([from]);
  const stack = [from];
  while (stack.length) {
    const x = stack.pop();
    if (x === to) return true;
    for (const y of adj[x] || []) if (!seen.has(y)) { seen.add(y); stack.push(y); }
  }
  return false;
}

/** Compare a student reasoning graph to the reference graph. sim(i,j) = similarity of ref node i and student node j. */
export function compareGraphs(ref, stu, sim, thresholds) {
  const { match, partial } = thresholds;
  const pairs = [];
  ref.nodes.forEach((_, i) => stu.nodes.forEach((__, j) => pairs.push([sim(i, j), i, j])));
  pairs.sort((x, y) => y[0] - x[0]);
  const refMap = {}, stuUsed = new Set();
  for (const [s, i, j] of pairs) {
    if (s < partial) break;
    if (refMap[i] !== undefined || stuUsed.has(j)) continue;
    refMap[i] = { j, s };
    stuUsed.add(j);
  }
  const credit = (s) => (s >= match ? 1 : 0.5);
  const R = ref.nodes.length || 1;
  const nodeCoverage = Object.values(refMap).reduce((t, m) => t + credit(m.s), 0) / R;
  const nodePrecision = stu.nodes.length ? Object.values(refMap).filter((m) => m.s >= match).length / stu.nodes.length : 0;

  const idxOf = Object.fromEntries(ref.nodes.map((n, i) => [n.id, i]));
  const stuIdx = Object.fromEntries(stu.nodes.map((n, j) => [n.id, j]));
  let edgeScore = 0;
  ref.edges.forEach((e) => {
    const a = refMap[idxOf[e.from]], b = refMap[idxOf[e.to]];
    if (!a || !b) return;
    const sa = stu.nodes[a.j].id, sb = stu.nodes[b.j].id;
    if (reachable(stu.edges, sa, sb)) edgeScore += 1;
    else if (stuIdx[sa] < stuIdx[sb]) edgeScore += 0.5; // right order, link not made explicit
  });
  const edgeAlignment = ref.edges.length ? edgeScore / ref.edges.length : nodeCoverage;
  const structure = ref.edges.length ? 0.65 * nodeCoverage + 0.35 * edgeAlignment : nodeCoverage;

  return {
    node_coverage: +nodeCoverage.toFixed(3),
    node_precision: +nodePrecision.toFixed(3),
    edge_alignment: +edgeAlignment.toFixed(3),
    structure_score: +structure.toFixed(3),
    matched: ref.nodes.map((n, i) => (refMap[i] ? { ref: n.text, student: stu.nodes[refMap[i].j].text, similarity: +refMap[i].s.toFixed(2), full: refMap[i].s >= match } : null)).filter(Boolean),
    missing: ref.nodes.filter((_, i) => !refMap[i]).map((n) => n.text),
    extra: stu.nodes.filter((_, j) => !stuUsed.has(j)).map((n) => n.text),
  };
}

export const graphCompare = {
  concurrency: 4,
  plan: unitPlan,
  async run(ctx, batch) {
    const id = batch.key;
    const err = upstreamError(ctx, id, ['extract_reasoning']);
    if (err) return { error: err };
    const refs = ctx.out('build_reference_graph').graphs;
    const stuGraphs = itemsOf(ctx, 'extract_reasoning')[id].graphs;
    const qids = Object.keys(stuGraphs).filter((q) => refs[q]?.nodes?.length);

    // one embedding call per student covering all graph nodes (reference vectors are cached across students)
    const texts = [];
    qids.forEach((q) => { refs[q].nodes.forEach((n) => texts.push(n.text)); stuGraphs[q].nodes.forEach((n) => texts.push(n.text)); });
    const vecs = texts.length ? await embed(texts) : null;
    const method = vecs ? 'embedding-cosine' : 'lexical-overlap';
    const th = vecs ? { match: ctx.grading.nodeMatch, partial: ctx.grading.nodePartial } : { match: 0.5, partial: 0.3 };

    let off = 0;
    const comparisons = {};
    for (const q of qids) {
      const r = refs[q], s = stuGraphs[q];
      const rOff = off, sOff = off + r.nodes.length;
      off = sOff + s.nodes.length;
      const sim = vecs ? (i, j) => cosine(vecs[rOff + i], vecs[sOff + j]) : (i, j) => lexical(r.nodes[i].text, s.nodes[j].text);
      comparisons[q] = { ...compareGraphs(r, s, sim, th), method };
    }
    return { comparisons };
  },
};

