#Multi-Agent-Reasoning-Graph-Based-Paper-Evaluation-System


Teacher signs up -> creates a subject/test -> uploads **question paper + model answer + student answer sheets** ->
the workflow engine evaluates every student -> analytics + question-wise marks per student.

## Run it with Ollama Cloud (no local GPU)
Create a key at [ollama.com/settings/keys](https://ollama.com/settings/keys), pick a model tagged **vision** at
[ollama.com/search?c=cloud](https://ollama.com/search?c=cloud), and put this in `.env` (no `MOCK_AI`):
```
OLLAMA_HOST=https://ollama.com
OLLAMA_API_KEY=your-key-here
OLLAMA_VISION_MODEL=gemma4:31b
OLLAMA_EMBED_MODEL=
OLLAMA_NUM_CTX=262144
OLLAMA_NUM_PREDICT=65536
OLLAMA_MAX_PAGES=60
```
The free tier has session/weekly usage limits; about 9-10 AI calls per student. On HTTP 429 the server backs off and retries.
Embeddings are optional: left empty, reasoning graphs are compared lexically; set `OLLAMA_EMBED_HOST` to use a local Ollama for them.

## Run it locally
1. Install Ollama: https://ollama.com/download, then pull the models:
   `ollama pull qwen3-vl:2b-instruct` and `ollama pull nomic-embed-text`
2. `copy .env.example .env`
3. ```
   npm run install:all
   npm run build
   npm start          # http://localhost:4000
   ```
   Dev mode: `npm run dev:server` and `npm run dev:client` (UI on :5173).
4. No model yet? `MOCK_AI=1` in `.env` runs the full pipeline with fake AI output (UI/engine testing only).
   `node server/src/selftest.js http://localhost:4000` runs an end-to-end check against a MOCK_AI server.

## Free stack
Node/Express, NeDB (embedded Mongo-style DB, nothing to install), React + Vite + Recharts, pdf-lib,
a local Ollama vision model (default `qwen3-vl:2b-instruct`) for OCR, reasoning and grading, `nomic-embed-text` for embeddings.
PDFs are rendered to page images (pdf-to-img) and read by the vision model, so diagrams, tables, equations and text are read in one pass.

## Workflow (server/src/engine/templates.js, follows WORKFLOW_SYSTEM_GUIDE.md)
`ingest` -> `parse_questions` -> `parse_model_answers` -> `build_reference_graph`
`transcribe_text` (OCR) -> `analyze_figures` (diagrams) / `extract_reasoning` (student graph) -> `graph_compare` (embeddings, edge alignment, missing steps)
-> 4 parallel agents `agent_logic | concept | coverage | factcheck` -> `confidence_router` (auto / re-evaluate / teacher review)
-> `re_evaluate` (senior arbiter) -> `finalize_marks` -> `knowledge_gaps` (notes, practice questions, video links) -> `publish_results`.
Nodes live in the `workflow_templates / workflows / nodes` collections with `depends_on_inputs`, batches (one per student),
retries, and restart-recovery. A student whose script fails is marked "error" without sinking the class.

## Appearance
Palette icon in the sidebar: themes **Midnight** (dark glass, default), **Graphite** (dark solid), **Frost** (light glass),
**Paper** (light solid), and an accent colour (Mono, Indigo, Emerald, Amber, Rose). Type: Geist for the interface,
Geist Mono for numbers and labels, Instrument Serif for page titles. Saved per browser (`client/src/theme.jsx`).

## Dashboard, terms and students
- Every test has an **academic year** (e.g. `2026-27`) and **semester** (1-8), set on the New test page or later via "Edit details".
- The dashboard filters by year, semester and subject (kept in the URL), and "+ New test" pre-fills the selected term.
- **Students** (`/students`) lists everyone evaluated, matched across tests by roll number (or name when none was read).
  Each student's page shows progress vs class average, a skill profile from the four grading agents,
  results by subject / question type / term, recurring knowledge gaps and the test history.

## Live workflow page (`/tests/:id/workflow`)
- **Graph**: drag steps to rearrange (saved per browser), drag the background or scroll to pan, Ctrl + scroll to zoom,
  vertical / horizontal layout, minimap, "Find a step", Fit and Auto-arrange. Click a step for logs, students, input/output and its settings.
- **Timeline** (how long each step took) and **Activity** (every log line, filterable).
- **Settings** (per test): agent weights, confidence-routing thresholds, reasoning-graph match thresholds, questions per AI call,
  and per step: on/off (optional steps only), attempts, retry wait, students in parallel. "Save as my default" applies them to new tests.
  **AI prompts**: every AI step has a **base prompt** (the default, editable) and any number of **added prompts**
  (title + text, switch on/off, reorder, save to your prompt library, insert from library or suggestions), plus a **preview**
  of exactly what the model receives. The ✎ chip on a step in the graph opens its prompt directly.
  Defaults live in `server/src/engine/prompts.js`; the data and JSON output format are appended automatically.
  Changes apply to steps that have not run yet; **Re-run from here** re-runs a step and everything after it with the new settings
  (re-running at or before "Finalize marks" replaces teacher edits to marks).

## Tuning
- Model / speed: `OLLAMA_VISION_MODEL`, `OLLAMA_TEXT_MODEL`, `OLLAMA_NUM_CTX`, `OLLAMA_PDF_SCALE` (see `.env.example`).
  Roughly 9-10 AI calls per student; speed depends on your GPU. With 6GB+ VRAM, `qwen3-vl:4b-instruct` grades noticeably better. Always use `-instruct` tags (the plain tags are slow thinking models).
- Confidence thresholds: `CONF_HIGH` (0.7), `CONF_LOW` (0.5), `CONF_ARBITER` (0.65).
- Marks = weighted mean of the four agents (logic .25, concept .30, coverage .30, fact .15), rounded to 0.5.

## Notes / limits
- One file = one student. For a stack scanned into one PDF, set "pages per student".
- Teacher can override any question; flagged answers ("Needs review") are surfaced first.
- Video lessons are YouTube search links (free), not generated videos.
- HEIC photos are not supported by Ollama: convert them to JPG first.
