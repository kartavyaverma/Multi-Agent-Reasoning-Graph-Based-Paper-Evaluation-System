import { ingest, parseQuestions, parseModelAnswers, buildReferenceGraph } from './parse.js';
import { transcribeText, analyzeFigures, extractReasoning } from './student.js';
import { graphCompare } from './graph.js';
import { agentLogic, agentConcept, agentCoverage, agentFactcheck } from './agents.js';
import { confidenceRouter, reEvaluate, finalizeMarks } from './routing.js';
import { knowledgeGaps, publishResults } from './learning.js';

// node type -> executor.  Executors with plan() fan out into batches (one per student).
export const executors = {
  'paper.ingest': ingest,
  'paper.parse_questions': parseQuestions,
  'paper.parse_model_answers': parseModelAnswers,
  'paper.reference_graph': buildReferenceGraph,
  'student.transcribe': transcribeText,
  'student.figures': analyzeFigures,
  'student.reasoning': extractReasoning,
  'graph.compare': graphCompare,
  'agent.logic': agentLogic,
  'agent.concept': agentConcept,
  'agent.coverage': agentCoverage,
  'agent.factcheck': agentFactcheck,
  'route.confidence': confidenceRouter,
  'route.reevaluate': reEvaluate,
  'grade.finalize': finalizeMarks,
  'learn.gaps': knowledgeGaps,
  'publish.results': publishResults,
};
