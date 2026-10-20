import { db, now } from '../db.js';

const N = (name, type, label, description, depends_on_inputs, extra = {}) => ({ name, type, label, description, depends_on_inputs, ...extra });

export const PAPER_CHECK_TEMPLATE_ID = 'paper_check_v1';

export const paperCheckTemplate = {
  _id: PAPER_CHECK_TEMPLATE_ID,
  org_id: 'system',
  description: 'Multi-agent, reasoning-graph based subjective paper evaluation',
  nodes: [
    N('ingest', 'paper.ingest', 'Ingest files', 'Validate uploads and split combined scans into one unit per student', []),
    N('parse_questions', 'paper.parse_questions', 'Read question paper', 'Extract every question, its marks, figures and choice rules', ['ingest']),
    N('parse_model_answers', 'paper.parse_model_answers', 'Read model answers', 'Align the model answer to each question and build the marking rubric', ['parse_questions']),
    N('build_reference_graph', 'paper.reference_graph', 'Build reference reasoning graphs', 'Turn each model answer into a graph of ideal reasoning steps', ['parse_model_answers']),
    N('transcribe_text', 'student.transcribe', 'Transcribe handwriting (OCR)', 'Vision-OCR of each student script: identity, answers, equations, tables', ['ingest', 'parse_questions']),
    N('analyze_figures', 'student.figures', 'Analyse diagrams and images', 'Evaluate drawn diagrams, graphs, circuits and tables against the expected figure', ['transcribe_text', 'parse_model_answers']),
    N('extract_reasoning', 'student.reasoning', 'Extract student reasoning graphs', 'Convert each answer into a chain of reasoning steps', ['transcribe_text']),
    N('graph_compare', 'graph.compare', 'Compare reasoning graphs', 'Node similarity (embeddings), edge alignment and missing-step detection', ['build_reference_graph', 'extract_reasoning']),
    N('agent_logic', 'agent.logic', 'Logic agent', 'Judges reasoning flow and working', ['transcribe_text', 'analyze_figures', 'graph_compare', 'parse_model_answers']),
    N('agent_concept', 'agent.concept', 'Concept agent', 'Judges conceptual correctness and understanding', ['transcribe_text', 'analyze_figures', 'graph_compare', 'parse_model_answers']),
    N('agent_coverage', 'agent.coverage', 'Coverage agent', 'Judges completeness against the key points', ['transcribe_text', 'analyze_figures', 'graph_compare', 'parse_model_answers']),
    N('agent_factcheck', 'agent.factcheck', 'Fact-check agent', 'Verifies formulas, values, units and statements', ['transcribe_text', 'analyze_figures', 'graph_compare', 'parse_model_answers']),
    N('confidence_router', 'route.confidence', 'Confidence routing', 'Aggregate the panel, measure agreement, route to auto / re-evaluate / teacher review', ['agent_logic', 'agent_concept', 'agent_coverage', 'agent_factcheck']),
    N('re_evaluate', 'route.reevaluate', 'Senior re-evaluation', 'Arbiter re-grades medium-confidence answers', ['confidence_router']),
    N('finalize_marks', 'grade.finalize', 'Finalize marks', 'Compute final marks, totals and per-question reports', ['re_evaluate']),
    N('knowledge_gaps', 'learn.gaps', 'Knowledge-gap analysis', 'Weak concepts, notes, practice questions and video suggestions per student', ['finalize_marks']),
    N('publish_results', 'publish.results', 'Publish results', 'Attach learning packs and make analytics available', ['knowledge_gaps']),
  ].map((n) => ({ max_try_count: 3, retry_interval_seconds: 20, ...n })),
};

export async function ensureTemplates() {
  const existing = await db.workflow_templates.findOne({ _id: PAPER_CHECK_TEMPLATE_ID });
  const t = now();
  // Templates are immutable per _id by convention, but the built-in one is refreshed on boot so code and DB agree.
  if (existing) await db.workflow_templates.update({ _id: PAPER_CHECK_TEMPLATE_ID }, { ...paperCheckTemplate, created_at: existing.created_at, updated_at: t });
  else await db.workflow_templates.insert({ ...paperCheckTemplate, created_at: t, updated_at: t });
}
