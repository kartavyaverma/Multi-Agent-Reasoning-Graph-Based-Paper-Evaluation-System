# PaperCheck: Multi-Agent & Reasoning Graph-Based Paper Evaluation System

**AI evaluation of handwritten exam answer sheets, using multiple AI agents and reasoning graphs.**

Upload a question paper, a model answer and scanned student scripts. PaperCheck reads the handwriting and diagrams, grades every answer, explains every deduction and builds class and student analytics. The teacher can review and change any mark.

Final-year project, Department of ISE, JSS Academy of Technical Education, Bengaluru.

## Features

- **Reads scanned scripts:** handwriting, equations, tables and diagrams
- **Reasoning-graph comparison:** checks the steps of an answer and their order, not just its words
- **Four grading agents:** logic, concept, coverage and fact-check
- **Confidence routing:** auto-accept, senior-examiner re-check, or teacher review
- **Marked script:** the student's scan beside a red-pen marksheet with every deduction; marks are editable and printable
- **Live workflow view:** drag-and-drop graph, timeline, logs, per-step input and output
- **Configurable:** agent weights, thresholds, per-step settings, editable AI prompts
- **Learning packs:** knowledge gaps, revision notes and practice questions per student
- **Analytics:** by test, student, subject, academic year and semester, plus CSV export
- **Themes:** four themes (two glass) with accent colours

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, React Router, Recharts |
| Backend | Node.js, Express, JWT auth, Multer |
| Database | NeDB (embedded, nothing to install) |
| Workflow | Custom node-based engine with batches, retries and crash recovery |
| AI | Ollama API: Ollama Cloud or a local model (default `gemma4:31b` on cloud) |
| PDF | pdf-to-img, pdf-lib |

## Setup

**Requirements:** Node.js 20 or newer (developed on 22), and either a free [Ollama](https://ollama.com) account or a local Ollama install.

```bash
git clone https://github.com/kartavyaverma/PaperEval.git
cd PaperEval
npm run install:all
```

Create the config file:

```bash
cp .env.example .env
```

On Windows Command Prompt, use `copy .env.example .env`.

### Option A: Ollama Cloud (no GPU needed)

Create a key at [ollama.com/settings/keys](https://ollama.com/settings/keys), then set this in `.env`:

```env
OLLAMA_HOST=https://ollama.com
OLLAMA_API_KEY=your-key-here
OLLAMA_VISION_MODEL=gemma4:31b
OLLAMA_EMBED_MODEL=
```

The free tier has usage limits. Each student takes roughly 10–15 AI calls, depending on the number of questions.

### Option B: Local Ollama (nothing leaves your machine)

```bash
ollama pull qwen3-vl:2b-instruct
ollama pull nomic-embed-text
```

Keep the defaults from `.env.example`. A GPU is strongly recommended.

### Option C: Demo mode (no AI)

Add `MOCK_AI=1` to `.env`. The full pipeline runs with fake marks, for trying the interface only.

## Run

```bash
npm run build
npm start
```

Open http://localhost:4000 and create an account.

For development, run these in two terminals (UI on http://localhost:5173):

```bash
npm run dev:server
```

```bash
npm run dev:client
```

## Try it

Sample papers are in `test/` (Physics) and `test/chemistry/` (Chemistry, 50 marks, with diagrams). Each folder has a README with expected marks.

1. Click **New test**, then choose a subject, year and semester.
2. Upload `question_paper.pdf` and `model_answer.pdf`.
3. Upload the student PDFs and click **Start evaluation**.
4. Watch the **Workflow** page, then open a student's **Marked script**.

## The pipeline

```text
ingest → parse_questions → parse_model_answers → build_reference_graph ─┐
              └→ transcribe_text → extract_reasoning ─→ graph_compare ──┤
                       └→ analyze_figures ──────────────────────────────┤
                                                                        ▼
         agent_logic | agent_concept | agent_coverage | agent_factcheck
                                       ▼
   confidence_router → re_evaluate → finalize_marks → knowledge_gaps → publish_results
```

See [docs/GUIDE.md](docs/GUIDE.md) for how it works.

## Configuration

| Variable | Purpose |
|---|---|
| `OLLAMA_HOST`, `OLLAMA_API_KEY` | Where the model runs, and the cloud key |
| `OLLAMA_VISION_MODEL`, `OLLAMA_TEXT_MODEL` | Models for reading and grading |
| `OLLAMA_EMBED_MODEL`, `OLLAMA_EMBED_HOST` | Optional embeddings; empty means word-based matching |
| `OLLAMA_PARALLEL` | How many AI requests run at once (default 1) |
| `OLLAMA_NUM_CTX`, `OLLAMA_NUM_PREDICT` | Context and reply limits |
| `OLLAMA_MAX_PAGES`, `OLLAMA_PDF_SCALE` | Pages per script and render quality |
| `CONF_HIGH`, `CONF_LOW`, `CONF_ARBITER` | Default confidence thresholds |
| `PORT`, `DATA_DIR`, `MOCK_AI` | Server port, data folder, demo mode |

Grading settings and prompts can also be changed per test in the app under **Workflow → Settings**.

## Project structure

```text
client/src/          React pages and components
server/src/api.js    REST API
server/src/ai/       Ollama client
server/src/engine/   Workflow engine, templates, prompts, settings
server/src/engine/executors/   The code for each pipeline step
test/                Sample papers and scripts
docs/                Guide, video script, poster
```

Uploads and the database are stored in `data/`, which is not committed.

## Troubleshooting

| Problem | Fix |
|---|---|
| `Cannot find package 'express'` | Run `npm run install:all` |
| Blank page at `localhost:4000` | Run `npm run build` |
| Port 4000 already in use | Set `PORT=4100` in `.env` |
| "Needs OLLAMA_API_KEY" or key rejected | Check the key in `.env`, then restart |
| Model "not available on Ollama Cloud" | Pick a model tagged **vision** at [ollama.com/search?c=cloud](https://ollama.com/search?c=cloud) |
| "Usage limit reached" | Wait for the limit to reset, or switch off optional steps |
| Marks look fake | Remove `MOCK_AI=1` from `.env` and restart |

## Team

Madhura Padaki, Mahi Singh, Mayank Dhaundiyal, Punith Kumar

**Guide:** Dr. Rekha PM, Professor & Dean, Department of ISE, JSSATE
