import { db, now } from '../db.js';
import { config } from '../config.js';
import { executors } from './executors/index.js';

/**
 * Node-based workflow engine (see WORKFLOW_SYSTEM_GUIDE.md).
 * Collections: workflow_templates / workflows / nodes.
 * Node lifecycle: ready -> pending -> completed | failed. Dependencies are node names (depends_on_inputs);
 * when an upstream node completes it is removed from depends_on_inputs_current, and an empty list = ready.
 * Fan-out work (one student = one batch) is stored in node.batches so progress survives restarts.
 */

const inFlight = new Set();
let timer = null;

export async function createWorkflow({ template_id, org_id, application_id, reference_id, input }) {
  const tpl = await db.workflow_templates.findOne({ _id: template_id });
  if (!tpl) throw new Error(`Unknown template ${template_id}`);
  const t = now();
  const wf = await db.workflows.insert({
    template_id, org_id, application_id, reference_id, status: 'running',
    input, output: {}, created_at: t, updated_at: t,
  });
  let order = 0;
  for (const n of tpl.nodes) {
    await db.nodes.insert({
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
  const ctx = { wf, node, input: wf.input, out: (name) => wf.output?.[name], log: (m) => log(node, m) };
  await log(node, node.batches ? 'Node execution resumed' : `Node execution started (try ${(node.try_count || 0) + 1}/${node.max_try_count})`);

  if (!exec.plan) {
    const output = await exec.run(ctx);
    return completeNode(node, output);
  }

  if (!node.batches) {
    const plan = await exec.plan(ctx);
    node.batches = plan.map((p, index) => ({ index, key: p.key, meta: p.meta || null, status: 'pending', tries: 0, output: null, error: null }));
    node.progress = { done: 0, total: node.batches.length };
    await log(node, `Planned ${node.batches.length} batch(es), up to ${exec.concurrency || 3} at a time`);
    await db.nodes.update({ _id: node._id }, { $set: { batches: node.batches, progress: node.progress } });
  }

  const todo = node.batches.filter((b) => b.status !== 'completed');
  await runPool(todo, exec.concurrency || 3, async (b) => {
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
        if (/Ollama is not running|not found\. Run: ollama pull|is a thinking model/.test(e.message)) b.tries = maxTries; // not retryable
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

export async function resumeWorkflow(wfId) {
  await db.workflows.update({ _id: wfId }, { $set: { status: 'running', error: null, updated_at: now() } });
  await db.nodes.update({ workflow_id: wfId, status: 'failed' }, { $set: { status: 'ready', try_count: 0, try_at: now(), error: null } }, { multi: true });
}
