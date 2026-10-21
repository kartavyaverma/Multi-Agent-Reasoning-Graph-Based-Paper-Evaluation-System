import { config } from '../config.js';
import { paperCheckTemplate } from './templates.js';
import { executors } from './executors/index.js';

/**
 * Per-workflow settings.
 * - grading: stored on workflow.settings.grading (partial overrides of config.grading), read by executors via ctx.grading.
 * - steps:   stored on each node (config.enabled, config.concurrency, max_try_count, retry_interval_seconds).
 * Changes apply to steps that have not started yet; "re-run from here" applies them to finished steps.
 */

export const AGENT_NODES = ['agent_logic', 'agent_concept', 'agent_coverage', 'agent_factcheck'];
const tplNode = (name) => paperCheckTemplate.nodes.find((n) => n.name === name) || {};
export const stepMeta = (name) => ({ optional: !!tplNode(name).optional, requires: tplNode(name).requires || [] });

const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Math.min(hi, Math.max(lo, Number(v))) : d);
const r3 = (x) => Math.round(x * 1000) / 1000;

export function defaultGrading() {
  const g = config.grading;
  return {
    weights: { ...g.weights },
    highConfidence: g.highConfidence, lowConfidence: g.lowConfidence, arbiterAccept: g.arbiterAccept,
    nodeMatch: g.nodeMatch, nodePartial: g.nodePartial, questionsPerCall: g.questionsPerCall,
  };
}

/** Validates partial grading overrides and merges them onto the defaults. Weights are normalised to sum to 1. */
export function resolveGrading(over = {}) {
  const d = defaultGrading();
  const w = {};
  for (const k of Object.keys(d.weights)) w[k] = num(over.weights?.[k], 0, 1, d.weights[k]);
  const sum = Object.values(w).reduce((s, x) => s + x, 0);
  for (const k of Object.keys(w)) w[k] = r3(sum > 0 ? w[k] / sum : d.weights[k]);
  const high = num(over.highConfidence, 0, 1, d.highConfidence);
  const match = num(over.nodeMatch, 0, 1, d.nodeMatch);
  return {
    weights: w,
    highConfidence: high,
    lowConfidence: Math.min(high, num(over.lowConfidence, 0, 1, d.lowConfidence)),
    arbiterAccept: num(over.arbiterAccept, 0, 1, d.arbiterAccept),
    nodeMatch: match,
    nodePartial: Math.min(match, num(over.nodePartial, 0, 1, d.nodePartial)),
    questionsPerCall: Math.round(num(over.questionsPerCall, 1, 30, d.questionsPerCall)),
  };
}

/** Effective per-step settings as stored on a node document. */
export function stepOf(n) {
  const exec = executors[n.type] || {};
  return {
    name: n.name, label: n.label, type: n.type, status: n.status, ...stepMeta(n.name),
    enabled: n.config?.enabled !== false,
    fan_out: !!exec.plan,
    concurrency: exec.plan ? n.config?.concurrency || exec.concurrency || 3 : null,
    max_try_count: n.max_try_count,
    retry_interval_seconds: n.retry_interval_seconds,
  };
}

/**
 * Validates step overrides { name: { enabled, concurrency, max_try_count, retry_interval_seconds } }.
 * Required steps cannot be turned off; turning off a step also turns off optional steps that need its output.
 * Throws when no grading agent is left on.
 */
export function sanitizeSteps(input = {}, names = paperCheckTemplate.nodes.map((n) => n.name)) {
  const out = {};
  for (const name of names) {
    const s = input[name];
    if (!s || typeof s !== 'object') continue;
    const o = {};
    if (s.enabled !== undefined) o.enabled = stepMeta(name).optional ? !!s.enabled : true;
    if (s.concurrency != null) o.concurrency = Math.round(num(s.concurrency, 1, 8, 3));
    if (s.max_try_count != null) o.max_try_count = Math.round(num(s.max_try_count, 1, 10, 3));
    if (s.retry_interval_seconds != null) o.retry_interval_seconds = Math.round(num(s.retry_interval_seconds, 0, 600, 20));
    out[name] = o;
  }
  for (const name of names) {
    const off = stepMeta(name).requires.find((r) => out[r]?.enabled === false);
    if (off) out[name] = { ...out[name], enabled: false };
  }
  if (AGENT_NODES.every((a) => out[a]?.enabled === false)) throw new Error('Keep at least one grading agent switched on');
  return out;
}

/** Mongo-style $set for a node document from sanitized step overrides. */
export function nodeSet(node, s = {}) {
  const set = {};
  if (s.enabled !== undefined) set['config.enabled'] = s.enabled;
  if (s.concurrency !== undefined) set['config.concurrency'] = s.concurrency;
  if (s.max_try_count !== undefined) set.max_try_count = s.max_try_count;
  if (s.retry_interval_seconds !== undefined) set.retry_interval_seconds = s.retry_interval_seconds;
  return set;
}
