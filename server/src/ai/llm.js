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

const where = ai.cloud ? 'Ollama Cloud' : `Ollama at ${ai.host}`;
/** Auth header for Ollama Cloud (only ever sent to ollama.com hosts). */
const authFor = (host) => (ai.apiKey && /^https:\/\/([a-z0-9-]+\.)*ollama\.com(\/|$)/i.test(host) ? { Authorization: `Bearer ${ai.apiKey}` } : {});

async function call(route, body, timeout = ai.timeoutMs, host = ai.host) {
  const res = await fetch(`${host}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authFor(host) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) {
    const err = new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);
    err.status = res.status;
    if (res.status === 401 || res.status === 403) {
      err.message = ai.apiKey ? 'Ollama Cloud rejected OLLAMA_API_KEY. Create a new key at ollama.com/settings/keys.' : 'Ollama Cloud needs OLLAMA_API_KEY in .env (create one at ollama.com/settings/keys).';
      err.fatal = true;
    }
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
  let predict = ai.numPredict;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const t0 = Date.now();
      const data = await slot(() => call('/api/chat', {
        model, messages, stream: false, format: 'json', ...(!ai.cloud && { keep_alive: ai.keepAlive }),
        ...(think === false && { think: false }),
        options: { temperature, num_ctx: ai.numCtx, num_predict: predict },
      }), task, model);
      log(`${task}: ${model} ${((Date.now() - t0) / 1000).toFixed(1)}s${images.length ? `, ${images.length} image(s)` : ''}`);
      const out = data.message?.content || '';
      if (!out && data.message?.thinking) {
        throw Object.assign(new Error(ai.cloud
          ? `Model "${model}" spent its whole answer thinking. Pick another cloud model or raise OLLAMA_NUM_PREDICT.`
          : `Model "${model}" is a thinking model and spent its whole answer thinking. Use an -instruct model, e.g. OLLAMA_VISION_MODEL=qwen3-vl:2b-instruct`), { fatal: true });
      }
      if (!out) {
        lastErr = new Error(`Empty response (${data.done_reason || 'unknown'})`);
        continue;
      }
      try {
        return parseJson(out);
      } catch (e) {
        lastErr = e;
        // cut off by the length limit: the same request would be cut again, so allow a longer reply
        const cut = data.done_reason === 'length';
        if (cut) predict = Math.min(predict * 2, 131072, ai.numCtx);
        log(`${task}: bad JSON on attempt ${attempt} (done=${data.done_reason})${cut ? `, retrying with a ${predict}-token limit` : ''}`);
      }
    } catch (e) {
      lastErr = e;
      if (e.fatal) throw e;
      if (/does not support thinking/i.test(e.message)) { think = undefined; attempt--; continue; }
      if (e.status === 404) {
        throw new Error(ai.cloud
          ? `Model "${model}" is not available on Ollama Cloud. Pick one tagged "vision" at ollama.com/search?c=cloud and use its full name (e.g. gemma4:31b).`
          : `Ollama model "${model}" not found. Run: ollama pull ${model}`);
      }
      if (e.cause?.code === 'ECONNREFUSED' || /fetch failed/i.test(e.message)) {
        throw new Error(ai.cloud ? 'Cannot reach Ollama Cloud (https://ollama.com). Check your internet connection.' : `Ollama is not running at ${ai.host}. Start the Ollama app (or run: ollama serve).`);
      }
      // 429 = cloud usage limit or too many requests at once: back off much longer
      const wait = e.status === 429 ? 20000 * attempt : 2000 * attempt;
      if (e.status === 429) lastErr = new Error('Ollama Cloud usage limit reached (HTTP 429). Wait for the limit to reset, or lower the number of AI calls in workflow settings.');
      log(`${task}: ${e.message}, attempt ${attempt}, retrying in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  throw lastErr || new Error('Ollama call failed');
}

// ---- embeddings ----
const embedCache = new Map();
const h = (s) => crypto.createHash('sha1').update(s).digest('hex');

let embedOff = false; // set after the first failure, so an unavailable embed model costs one request, not one per student

/** Returns an array of vectors, or null when unavailable (caller falls back to lexical similarity). */
export async function embed(texts) {
  if (ai.mock || !ai.embedModel || embedOff) return null;
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
        model: ai.embedModel, input: chunk.map((c) => c.t.slice(0, 2000)), ...(!/ollama\.com/i.test(ai.embedHost) && { keep_alive: ai.keepAlive }),
      }, 120_000, ai.embedHost), 'embed', ai.embedModel);
      chunk.forEach((c, j) => {
        const v = data.embeddings?.[j];
        if (!v) return;
        embedCache.set(c.k, v);
        out[c.i] = v;
      });
    } catch (e) {
      if (e.status !== 429) embedOff = true; // a rate limit is temporary; anything else (no such model, no endpoint) is not
      log(`embed: ${e.message} (falling back to lexical similarity${embedOff ? ' for this session' : ''})`);
      return null;
    }
  }
  return out.every(Boolean) ? out : null;
}

/**
 * Quick check used at startup and on the dashboard: is Ollama reachable and are the models available?
 * The embed model is optional (lexical fallback), so a missing one does not make the AI "not ready".
 */
let checked = null;
export async function checkModels() {
  if (checked && Date.now() - checked.at < (checked.result.ok ? 60_000 : 10_000)) return checked.result;
  const result = await (async () => {
    if (ai.cloud && !ai.apiKey) return { ok: false, auth: true, missing: [] };
    try {
      const res = await fetch(`${ai.host}/api/tags`, { headers: authFor(ai.host), signal: AbortSignal.timeout(ai.cloud ? 8000 : 3000) });
      if (res.status === 401 || res.status === 403) return { ok: false, auth: true, missing: [] };
      const have = new Set((await res.json()).models.flatMap((m) => [m.name, m.model, m.name?.replace(/:latest$/, '')]).filter(Boolean));
      const missing = [...new Set([ai.visionModel, ai.textModel])].filter((m) => m && !have.has(m));
      const embedMissing = ai.embedModel && ai.embedHost === ai.host && !have.has(ai.embedModel) && !have.has(`${ai.embedModel}:latest`);
      return { ok: !missing.length, missing, embedMissing: !!embedMissing };
    } catch {
      return { ok: false, down: true, missing: [] };
    }
  })();
  checked = { at: Date.now(), result };
  return result;
}
