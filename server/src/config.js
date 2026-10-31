import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
dotenv.config({ path: path.join(root, '.env') });

const dataDir = path.resolve(root, process.env.DATA_DIR || 'data');
fs.mkdirSync(path.join(dataDir, 'db'), { recursive: true });
fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });

// JWT secret: env wins, otherwise generate once and persist.
let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  const f = path.join(dataDir, 'jwt.secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(48).toString('hex'));
  jwtSecret = fs.readFileSync(f, 'utf8').trim();
}

// Ollama Cloud has no local VRAM limits, so it gets much larger defaults
const CLOUD = /(^|\/\/)([a-z0-9-]+\.)*ollama\.com/i.test(process.env.OLLAMA_HOST || '');
const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

export const config = {
  root,
  dataDir,
  port: num(process.env.PORT, 4000),
  jwtSecret,
  ai: {
    host: (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, ''),
    // Ollama Cloud: OLLAMA_HOST=https://ollama.com plus a key from ollama.com/settings/keys (sent as a Bearer token).
    apiKey: process.env.OLLAMA_API_KEY || '',
    cloud: /(^|\.)ollama\.com$/i.test((() => { try { return new URL(process.env.OLLAMA_HOST || 'http://x').hostname; } catch { return ''; } })()),
    // Embeddings can come from a different Ollama (e.g. a local one) than chat; defaults to OLLAMA_HOST.
    embedHost: (process.env.OLLAMA_EMBED_HOST || process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, ''),
    // One vision model for everything avoids reloading models in VRAM between calls.
    visionModel: process.env.OLLAMA_VISION_MODEL || 'qwen3-vl:2b-instruct',
    textModel: process.env.OLLAMA_TEXT_MODEL || process.env.OLLAMA_VISION_MODEL || 'qwen3-vl:2b-instruct',
    embedModel: process.env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text',
    numCtx: num(process.env.OLLAMA_NUM_CTX, CLOUD ? 262144 : 8192), // scanned pages are ~1k tokens each; locally, bigger = more VRAM
    // max reply length; cloud models have no VRAM cost for this, and a 10-question model answer needs ~6k tokens
    numPredict: num(process.env.OLLAMA_NUM_PREDICT, CLOUD ? 65536 : 4096),
    parallel: num(process.env.OLLAMA_PARALLEL, 1), // concurrent requests sent to Ollama
    pdfScale: num(process.env.OLLAMA_PDF_SCALE, 1.5), // PDF render scale; higher = sharper OCR, slower
    maxPages: num(process.env.OLLAMA_MAX_PAGES, CLOUD ? 60 : 20),
    keepAlive: process.env.OLLAMA_KEEP_ALIVE || '30m',
    timeoutMs: num(process.env.OLLAMA_TIMEOUT_SEC, CLOUD ? 1800 : 900) * 1000,
    secondsPerCall: num(process.env.AI_SECONDS_PER_CALL, 20), // only used for the ETA shown in the UI
    mock: process.env.MOCK_AI === '1',
    mockDelayMs: num(process.env.MOCK_AI_DELAY_MS, 20), // slow the mock down to watch the workflow page live
  },
  grading: {
    weights: { logic: 0.25, concept: 0.3, coverage: 0.3, factcheck: 0.15 },
    highConfidence: num(process.env.CONF_HIGH, 0.7),
    lowConfidence: num(process.env.CONF_LOW, 0.5),
    arbiterAccept: num(process.env.CONF_ARBITER, 0.65),
    questionsPerCall: num(process.env.QUESTIONS_PER_CALL, 8),
    nodeMatch: num(process.env.NODE_MATCH, 0.7),
    nodePartial: num(process.env.NODE_PARTIAL, 0.55),
    passPercent: num(process.env.PASS_PERCENT, 40),
  },
  engine: {
    tickMs: 1000,
    maxNodesInFlight: 8,
  },
};
