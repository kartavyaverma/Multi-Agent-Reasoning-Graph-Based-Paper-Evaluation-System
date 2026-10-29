import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config.js';
import { authRouter } from './auth.js';
import { api } from './api.js';
import { ensureTemplates } from './engine/templates.js';
import { startEngine } from './engine/engine.js';
import { checkModels } from './ai/llm.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', async (req, res) => {
  const m = config.ai.mock ? { ok: true } : await checkModels();
  res.json({ ok: true, ai: config.ai.mock ? 'mock' : m.ok ? 'ollama' : 'not-configured', models: [config.ai.visionModel, config.ai.textModel, config.ai.embedModel], missing: m.missing });
});
app.use('/api/auth', authRouter);
app.use('/api', api);

const dist = path.join(config.root, 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const msg = err.code === 'LIMIT_FILE_SIZE' ? 'A file is larger than 60 MB' : err.message || 'Server error';
  res.status(err.status || 400).json({ error: msg });
});

await ensureTemplates();
await startEngine();
app.listen(config.port, async () => {
  console.log(`PaperCheck running on http://localhost:${config.port}`);
  if (config.ai.mock) return console.log('AI: MOCK mode (no real grading)');
  const m = await checkModels();
  const c = config.ai;
  if (m.auth) console.log('AI: Ollama Cloud rejected the request - set a valid OLLAMA_API_KEY (ollama.com/settings/keys)');
  else if (m.down) console.log(c.cloud ? 'AI: cannot reach Ollama Cloud (https://ollama.com) - check your connection' : `AI: Ollama not reachable at ${c.host} - start the Ollama app`);
  else if (m.missing.length) console.log(c.cloud ? `AI: not available on Ollama Cloud: ${m.missing.join(', ')} - pick a model tagged "vision" at ollama.com/search?c=cloud` : `AI: missing models - run: ${m.missing.map((x) => `ollama pull ${x}`).join(' && ')}`);
  else console.log(`AI: ${c.cloud ? 'Ollama Cloud' : 'Ollama'} (${[...new Set([c.visionModel, c.textModel])].join(', ')}, embed: ${c.embedModel ? `${c.embedModel}${m.embedMissing ? ' - not available, using lexical matching' : ''}` : 'off'})`);
  if (c.cloud && !c.apiKey) console.log('AI: OLLAMA_API_KEY is empty - Ollama Cloud requests will be rejected');
});
