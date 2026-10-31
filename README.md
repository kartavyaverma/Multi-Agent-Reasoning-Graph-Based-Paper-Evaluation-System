#Multi-Agent-Reasoning-Graph-Based-Paper-Evaluation-System


Teacher signs up -> creates a subject/test -> uploads **question paper + model answer + student answer sheets** ->
the workflow engine evaluates every student -> analytics + question-wise marks per student.

## Run it
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
