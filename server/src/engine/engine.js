import { db, now } from '../db.js';
import { config } from '../config.js';
import { executors } from './executors/index.js';
import { resolveGrading, sanitizeSteps, nodeSet, stepMeta } from './settings.js';
import { buildPrompt, sanitizePrompts } from './prompts.js';

/**
 * Node-based workflow engine (see WORKFLOW_SYSTEM_GUIDE.md).
 * Collections: workflow_templates / workflows / nodes.
 * Node lifecycle: ready -> pending -> completed | failed. Dependencies are node names (depends_on_inputs);
 * when an upstream node completes it is removed from depends_on_inputs_current, and an empty list = ready.
 * Fan-out work (one student = one batch) is stored in node.batches so progress survives restarts.
 */

const inFlight = new Set();
let timer = null;

/** settings: optional { grading, steps } (the teacher's saved defaults), applied to the new workflow. */
export async function createWorkflow({ template_id, org_id, application_id, reference_id, input, settings }) {
  const tpl = await db.workflow_templates.findOne({ _id: template_id });
  if (!tpl) throw new Error(`Unknown template ${template_id}`);
  const t = now();
  let steps = {};
  try { steps = sanitizeSteps(settings?.steps || {}, tpl.nodes.map((n) => n.name)); } catch { /* invalid saved defaults: ignore */ }
  const wf = await db.workflows.insert({
    template_id, org_id, application_id, reference_id, status: 'running',
    input, output: {}, settings: { grading: settings?.grading || {}, prompts: sanitizePrompts(settings?.prompts) }, created_at: t, updated_at: t,
  });
  let order = 0;
  for (const n of tpl.nodes) {
    const node = await db.nodes.insert({
      workflow_id: wf._id, org_id, application_id,
      name: n.name, type: n.type, label: n.label, description: n.description,
      status: n.depends_on_inputs.length ? 'waiting' : 'ready',
      config: n.config || {},
      depends_on_inputs: n.depends_on_inputs,
      depends_on_inputs_current: [...n.depends_on_inputs],
      batches: null, progress: { done: 0, total: 0 }, output: null,
      try_count: 0, max_try_count: n.max_try_count ?? 3, retry_interval_seconds: n.retry_interval_seconds ?? 20,
      try_at: t, logs: [], created_at: t + order++, updated_at: t,
    });
    const set = nodeSet(node, steps[n.name]);
    if (Object.keys(set).length) await db.nodes.update({ _id: node._id }, { $set: set });
  }
  return wf;
}

async function log(node, msg, level = 'info') {
  node.logs = [...(node.logs || []).slice(-150), { at: now(), msg, level }];
  await db.nodes.update({ _id: node._id }, { $set: { logs: node.logs } });
}

async function completeNode(node, output) {
  const t = now();
  await log(node, `Node completed in ${((t - (node.started_at || t)) / 1000).toFixed(1)}s`, 'success');
  await db.nodes.update({ _id: node._id }, { $set: { status: 'completed', output: null, finished_at: t, updated_at: t, error: null } });
  await db.workflows.update({ _id: node.workflow_id }, { $set: { [`output.${node.name}`]: output, updated_at: t } });
  const deps = await db.nodes.find({ workflow_id: node.workflow_id, depends_on_inputs_current: node.name });
  // $pull is atomic: several upstream nodes can complete at the same moment (fan-in)
  for (const d of deps) {
    await db.nodes.update({ _id: d._id }, { $pull: { depends_on_inputs_current: node.name } });
    const n = await db.nodes.update({ _id: d._id, status: 'waiting', depends_on_inputs_current: { $size: 0 } }, { $set: { status: 'ready', try_at: t, updated_at: t } });
    await log(node, n?.numAffected ? `Downstream node ready - ${d.name}` : `Downstream node updated - ${d.name}`);
  }
  const open = await db.nodes.count({ workflow_id: node.workflow_id, status: { $ne: 'completed' } });
  if (!open) {
    await db.workflows.update({ _id: node.workflow_id }, { $set: { status: 'completed', finished_at: t } });
  }
}

async function failNode(node, err) {
  const t = now();
  const tries = (node.try_count || 0) + 1;
  await log(node, `attempt ${tries} failed: ${err.message}`, 'error');
  if (tries < node.max_try_count) {
    await db.nodes.update({ _id: node._id }, { $set: { status: 'ready', try_count: tries, try_at: t + node.retry_interval_seconds * 1000, error: err.message } });
  } else {
    await db.nodes.update({ _id: node._id }, { $set: { status: 'failed', try_count: tries, error: err.message, finished_at: t } });
    await db.workflows.update({ _id: node.workflow_id }, { $set: { status: 'failed', error: `${node.label || node.name}: ${err.message}`, updated_at: t } });
    await db.tests.update({ _id: node.application_id }, { $set: { status: 'failed' } });
  }
}

async function runPool(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

async function runNode(node) {
  const wf = await db.workflows.findOne({ _id: node.workflow_id });
  if (!wf || wf.status !== 'running') {
    await db.nodes.update({ _id: node._id }, { $set: { status: 'ready', try_at: now() + 5000 } });
    return;
  }
  const exec = executors[node.type];
  if (!exec) throw new Error(`No executor for node type ${node.type}`);
  const missing = stepMeta(node.name).requires.find((r) => wf.output?.[r]?.skipped);
  if (node.config?.enabled === false || missing) {
    await log(node, missing ? `Skipped: needs ${missing}, which was switched off` : 'Skipped: switched off in workflow settings');
    await db.nodes.update({ _id: node._id }, { $set: { skipped: true } });
    return completeNode(node, { skipped: true, items: {} });
  }
  const ctx = { wf, node, input: wf.input, out: (name) => wf.output?.[name], log: (m) => log(node, m), grading: resolveGrading(wf.settings?.grading),
    prompt: (id, tail) => buildPrompt(id, wf.settings?.prompts, tail) };
  await log(node, node.batches ? 'Node execution resumed' : `Node execution started (try ${(node.try_count || 0) + 1}/${node.max_try_count})`);

  if (!exec.plan) {
    const output = await exec.run(ctx);
    return completeNode(node, output);
  }

  const concurrency = node.config?.concurrency || exec.concurrency || 3;
  if (!node.batches) {
    const plan = await exec.plan(ctx);
    node.batches = plan.map((p, index) => ({ index, key: p.key, meta: p.meta || null, status: 'pending', tries: 0, output: null, error: null }));
    node.progress = { done: 0, total: node.batches.length };
    await log(node, `Planned ${node.batches.length} batch(es), up to ${concurrency} at a time`);
    await db.nodes.update({ _id: node._id }, { $set: { batches: node.batches, progress: node.progress } });
  }

  const todo = node.batches.filter((b) => b.status !== 'completed');
  await runPool(todo, concurrency, async (b) => {
    // stop early if the workflow was stopped
    const cur = await db.workflows.findOne({ _id: node.workflow_id }, { status: 1 });
    if (!cur || cur.status !== 'running') return;
    const maxTries = node.max_try_count;
    while (b.tries < maxTries) {
      try {
        b.status = 'running';
        b.started_at = now();
        await db.nodes.update({ _id: node._id }, { $set: { batches: node.batches } });
        b.output = await exec.run(ctx, b);
        b.status = 'completed';
        b.finished_at = now();
        b.error = null;
        await log(node, `Batch ${b.meta?.label || b.key} completed in ${((b.finished_at - b.started_at) / 1000).toFixed(1)}s`);
        break;
      } catch (e) {
        b.tries++;
        b.error = e.message;
        await log(node, `Batch ${b.meta?.label || b.key} try ${b.tries}/${maxTries} failed: ${e.message}`, 'error');
        if (/Ollama is not running|not found\. Run: ollama pull|is a thinking model|OLLAMA_API_KEY|not available on Ollama Cloud|Cannot reach Ollama Cloud/.test(e.message)) b.tries = maxTries; // not retryable
        else await new Promise((r) => setTimeout(r, Math.min(30000, node.retry_interval_seconds * 1000)));
      }
    }
    if (b.status !== 'completed') {
      // degrade gracefully: one failing student must not sink the whole class
      b.status = 'completed';
      b.failed = true;
      b.finished_at = now();
      b.output = { error: b.error || 'failed' };
    }
    node.progress = { done: node.batches.filter((x) => x.status === 'completed').length, total: node.batches.length };
    await db.nodes.update({ _id: node._id }, { $set: { batches: node.batches, progress: node.progress, updated_at: now() } });
  });

  const cur = await db.workflows.findOne({ _id: node.workflow_id }, { status: 1 });
  if (!cur || cur.status !== 'running') {
    await db.nodes.update({ _id: node._id }, { $set: { status: 'ready', try_at: now() + 5000 } });
    return;
  }
  const items = {};
  node.batches.forEach((b) => (items[b.key] = b.output));
  const output = exec.combine ? await exec.combine(items, ctx) : { items };
  await db.nodes.update({ _id: node._id }, { $set: { batches: node.batches.map((b) => ({ ...b, output: null })) } });
  await completeNode(node, output);
}

async function tick() {
  if (inFlight.size >= config.engine.maxNodesInFlight) return;
  const ready = await db.nodes.find({ status: 'ready', try_at: { $lte: now() } }, { sort: { created_at: 1 }, limit: config.engine.maxNodesInFlight });
  for (const n of ready) {
    if (inFlight.size >= config.engine.maxNodesInFlight) break;
    if (inFlight.has(n._id)) continue;
    inFlight.add(n._id);
    n.started_at = n.started_at || now();
    await db.nodes.update({ _id: n._id }, { $set: { status: 'pending', started_at: n.started_at } });
    runNode(n)
      .catch((e) => {
        console.error(`[engine] node ${n.name} error:`, e);
        return failNode(n, e);
      })
      .finally(() => inFlight.delete(n._id));
  }
}

export async function startEngine() {
  // Recover from a crash/restart: anything mid-flight goes back to ready.
  await db.nodes.update({ status: 'pending' }, { $set: { status: 'ready', try_at: now() } }, { multi: true });
  const orphan = await db.nodes.find({ batches: { $ne: null } });
  for (const n of orphan) {
    if (n.status === 'completed' || !n.batches) continue;
    n.batches.forEach((b) => { if (b.status === 'running') b.status = 'pending'; });
    await db.nodes.update({ _id: n._id }, { $set: { batches: n.batches } });
  }
  timer = setInterval(() => tick().catch((e) => console.error('[engine] tick', e)), config.engine.tickMs);
}

export function stopEngine() { clearInterval(timer); }

export async function retryNode(nodeId) {
  const n = await db.nodes.findOne({ _id: nodeId });
  if (!n) throw new Error('Node not found');
  await db.nodes.update({ _id: n._id }, { $set: { status: 'ready', try_count: 0, error: null, try_at: now() } });
  await db.workflows.update({ _id: n.workflow_id }, { $set: { status: 'running', error: null } });
}

export async function stopWorkflow(wfId) {
  await db.workflows.update({ _id: wfId }, { $set: { status: 'stopped', updated_at: now() } });
}

/**
 * Re-runs a step and everything downstream of it (e.g. after changing settings).
 * The step's own inputs must be finished, and none of the affected steps may be executing right now.
 */
export async function rerunFrom(wfId, name) {
  const nodes = await db.nodes.find({ workflow_id: wfId });
  const start = nodes.find((n) => n.name === name);
  if (!start) throw new Error('Node not found');
  const blocked = start.depends_on_inputs.filter((d) => nodes.find((n) => n.name === d)?.status !== 'completed');
  if (blocked.length) throw new Error(`Finish ${blocked.join(', ')} first`);
  const reset = new Set([name]);
  for (let grew = true; grew;) {
    grew = false;
    for (const n of nodes) if (!reset.has(n.name) && n.depends_on_inputs.some((d) => reset.has(d))) { reset.add(n.name); grew = true; }
  }
  const busy = nodes.filter((n) => reset.has(n.name) && (n.status === 'pending' || inFlight.has(n._id)));
  if (busy.length) throw new Error(`${busy.map((n) => n.name).join(', ')} is running right now. Pause the workflow, wait for it to stop, then re-run.`);
  const t = now();
  const done = new Set(nodes.filter((x) => x.status === 'completed' && !reset.has(x.name)).map((x) => x.name));
  for (const n of nodes.filter((x) => reset.has(x.name))) {
    const first = n.name === name;
    n.logs = [...(n.logs || []).slice(-150), { at: t, msg: first ? 'Re-run requested' : `Reset: re-running from ${name}`, level: 'info' }];
    await db.nodes.update({ _id: n._id }, {
      $set: {
        // keep waiting on every input that is not finished, including ones another re-run is redoing
        status: first ? 'ready' : 'waiting', depends_on_inputs_current: first ? [] : n.depends_on_inputs.filter((d) => !done.has(d)),
        batches: null, progress: { done: 0, total: 0 }, output: null, try_count: 0, try_at: t, error: null, skipped: false, logs: n.logs, updated_at: t,
      },
      $unset: { started_at: true, finished_at: true },
    });
  }
  await db.workflows.update({ _id: wfId }, { $set: { status: 'running', error: null, updated_at: t }, $unset: { finished_at: true, ...Object.fromEntries([...reset].map((r) => [`output.${r}`, true])) } });
  return [...reset];
}

export async function resumeWorkflow(wfId) {
  await db.workflows.update({ _id: wfId }, { $set: { status: 'running', error: null, updated_at: now() } });
  await db.nodes.update({ workflow_id: wfId, status: 'failed' }, { $set: { status: 'ready', try_count: 0, try_at: now(), error: null } }, { multi: true });
}
