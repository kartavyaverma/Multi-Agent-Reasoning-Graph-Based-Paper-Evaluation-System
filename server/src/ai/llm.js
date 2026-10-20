import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pdf } from 'pdf-to-img';
import { config } from '../config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[ollama]', ...a);
const { ai } = config;

// ---- local GPU runs one request at a time well; queue the rest ----
let active = 0;
const waiting = [];
const running = new Map();
let seq = 0;
async function slot(fn, task = 'call', model = '') {
  const id = ++seq;
  if (active >= ai.parallel) await new Promise((r) => waiting.push(r));
  active++;
  running.set(id, { task, model, started_at: Date.now() });
  try {
    return await fn();
  } finally {
    running.delete(id);
    active--;
    waiting.shift()?.();
  }
}

/** What the local model is doing right now (shown live on the workflow page). */
export const aiActivity = () => ({ running: [...running.values()], queued: waiting.length });

async function call(route, body, timeout = ai.timeoutMs) {
  const res = await fetch(`${ai.host}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) {
    const err = new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ---- files: Ollama takes images only, so PDFs are rendered page by page ----
const fileCache = new Map();

async function toImages(filePath, mimeType) {
  if (mimeType !== 'application/pdf') return [fs.readFileSync(filePath).toString('base64')];
  const images = [];
  for await (const page of await pdf(filePath, { scale: ai.pdfScale })) {
    images.push(Buffer.from(page).toString('base64'));
    if (images.length >= ai.maxPages) {
      log(`${path.basename(filePath)}: only the first ${ai.maxPages} pages are sent (OLLAMA_MAX_PAGES)`);
      break;
    }
  }
  return images;
}

export async function filePart(filePath, mimeType) {
  if (ai.mock) return { text: `[file ${path.basename(filePath)}]` };
  const key = `${filePath}:${fs.statSync(filePath).size}`;
  if (!fileCache.has(key)) fileCache.set(key, toImages(filePath, mimeType));
  try {
    return { images: await fileCache.get(key) };
  } catch (e) {
    fileCache.delete(key);
    throw e;
  }
}

function parseJson(text) {
  let t = (text || '').trim();
  t = t.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error('Model did not return valid JSON');
  }
}

/**
 * Generate JSON from the local model.
 * `mock` is used only when MOCK_AI=1 (offline testing of the pipeline).
 */
export async function generateJson({ task, system, parts, temperature = 0.1, mock }) {
  if (ai.mock) {
    await slot(() => sleep(ai.mockDelayMs), task, 'mock');
    return mock ? mock() : {};
  }

  const text = parts.filter((p) => p.text).map((p) => p.text).join('\n\n');
  const images = parts.flatMap((p) => p.images || []);
  const model = images.length ? ai.visionModel : ai.textModel;
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: text, ...(images.length && { images }) });

  let think = false;
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const t0 = Date.now();
      const data = await slot(() => call('/api/chat', {
        model, messages, stream: false, format: 'json', keep_alive: ai.keepAlive,
        ...(think === false && { think: false }),
        options: { temperature, num_ctx: ai.numCtx, num_predict: ai.numPredict },
      }), task, model);
      log(`${task}: ${model} ${((Date.now() - t0) / 1000).toFixed(1)}s${images.length ? `, ${images.length} image(s)` : ''}`);
      const out = data.message?.content || '';
      if (!out && data.message?.thinking) {
        throw Object.assign(new Error(`Model "${model}" is a thinking model and spent its whole answer thinking. Use an -instruct model, e.g. OLLAMA_VISION_MODEL=qwen3-vl:2b-instruct`), { fatal: true });
      }
      if (!out) {
        lastErr = new Error(`Empty response (${data.done_reason || 'unknown'})`);
        continue;
      }
      try {
        return parseJson(out);
      } catch (e) {
        lastErr = e;
        log(`${task}: bad JSON on attempt ${attempt} (done=${data.done_reason})`);
      }
    } catch (e) {
      lastErr = e;
      if (e.fatal) throw e;
      if (/does not support thinking/i.test(e.message)) { think = undefined; attempt--; continue; }
      if (e.status === 404) throw new Error(`Ollama model "${model}" not found. Run: ollama pull ${model}`);
      if (e.cause?.code === 'ECONNREFUSED' || /fetch failed/i.test(e.message)) {
        throw new Error(`Ollama is not running at ${ai.host}. Start the Ollama app (or run: ollama serve).`);
      }
      log(`${task}: ${e.message}, attempt ${attempt}`);
      await sleep(2000 * attempt);
    }
  }
  throw lastErr || new Error('Ollama call failed');
}

// ---- embeddings ----
const embedCache = new Map();
const h = (s) => crypto.createHash('sha1').update(s).digest('hex');

/** Returns an array of vectors, or null when unavailable (caller falls back to lexical similarity). */
export async function embed(texts) {
  if (ai.mock || !ai.embedModel) return null;
  const out = new Array(texts.length);
  const todo = [];
  texts.forEach((t, i) => {
    const k = h(t);
    if (embedCache.has(k)) out[i] = embedCache.get(k);
    else todo.push({ i, t, k });
  });
  for (let s = 0; s < todo.length; s += 64) {
    const chunk = todo.slice(s, s + 64);
    try {
      const data = await slot(() => call('/api/embed', {
        model: ai.embedModel, input: chunk.map((c) => c.t.slice(0, 2000)), keep_alive: ai.keepAlive,
      }, 120_000), 'embed', ai.embedModel);
      chunk.forEach((c, j) => {
        const v = data.embeddings?.[j];
        if (!v) return;
        embedCache.set(c.k, v);
        out[c.i] = v;
      });
    } catch (e) {
      log(`embed: ${e.message} (falling back to lexical similarity)`);
      return null;
    }
  }
  return out.every(Boolean) ? out : null;
}

/** Quick check used at startup: is Ollama up and are the models pulled? */
export async function checkModels() {
  try {
    const res = await fetch(`${ai.host}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const have = new Set((await res.json()).models.flatMap((m) => [m.name, m.name.replace(/:latest$/, '')]));
    const missing = [...new Set([ai.visionModel, ai.textModel, ai.embedModel])].filter((m) => m && !have.has(m));
    return { ok: !missing.length, missing };
  } catch {
    return { ok: false, down: true, missing: [] };
  }
}
