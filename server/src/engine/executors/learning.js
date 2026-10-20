import { db, now } from '../../db.js';
import { generateJson } from '../../ai/llm.js';
import { JSON_RULES } from './util.js';

const yt = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;

/* ───────────── Knowledge-gap analysis + adaptive learning content (per student) ───────────── */
export const knowledgeGaps = {
  concurrency: 2,
  async plan(ctx) {
    const rs = await db.results.find({ test_id: ctx.input.test_id, status: { $ne: 'error' } });
    return rs.map((r) => ({ key: r.unit_id, meta: { result_id: r._id } }));
  },
  async run(ctx, batch) {
    const r = await db.results.findOne({ _id: batch.meta.result_id });
    const attempted = r.questions.filter((q) => q.counted);
    const weak = attempted.filter((q) => q.fraction < 0.9);
    if (!weak.length) {
      return { summary: 'Excellent work - no significant gaps found.', strengths: attempted.map((q) => `Q${q.q_id}`), weaknesses: [], notes: [], practice_questions: [], step_explanations: [], videos: [], study_plan: [] };
    }
    const block = weak.map((q) => `### Q${q.q_id} (${q.marks}/${q.max}) ${q.text}
Student answer: ${q.answer_text || '(none)'}
Model answer: ${q.model_answer}
Issues found: ${q.issues.join('; ') || 'n/a'}
Reference steps missing from the student's reasoning: ${q.graph?.missing?.join(' | ') || 'n/a'}
Examiner feedback: ${q.feedback}`).join('\n\n');
    const res = await generateJson({
      task: `gaps:${batch.key}`, temperature: 0.3,
      parts: [{ text: `You are a supportive tutor. A student lost marks on the questions below. Analyse the pattern across them and build a PERSONALISED learning pack that targets exactly what this student got wrong or left out.

Return:
- "summary": 2-3 encouraging but honest sentences on overall performance.
- "strengths": short list of what the student does well (from the questions where they scored well: ${attempted.filter((q) => q.fraction >= 0.7).map((q) => 'Q' + q.q_id).join(', ') || 'none'}).
- "weaknesses": [{"topic": string (a concept, not a question number), "severity": "high"|"medium"|"low", "evidence": string, "q_ids": [string]}]  - group related errors into concepts; missing reasoning steps and logical errors count too.
- "notes": [{"topic": string, "content": string}] concise revision notes (markdown, 80-150 words each) for each high/medium weakness, written to fix the specific misconception or missing step.
- "practice_questions": [{"topic": string, "question": string, "difficulty": "easy"|"medium"|"hard", "hint": string}] 2 per weakness, targeting the missing reasoning steps; do not repeat the exam questions verbatim.
- "step_explanations": [{"q_id": string, "where_it_went_wrong": string, "correct_reasoning": string}] step-by-step contrast of the student's reasoning vs the correct reasoning for the 3 costliest questions.
- "video_queries": [{"topic": string, "query": string}] good YouTube search phrases for each weakness.
- "study_plan": 3-5 ordered action items.
${JSON_RULES}

${block}` }],
      mock: () => ({
        summary: 'Mock summary.', strengths: ['Basic definitions'],
        weaknesses: [{ topic: 'Conservation principle', severity: 'high', evidence: 'Missing step B', q_ids: weak.map((q) => q.q_id) }],
        notes: [{ topic: 'Conservation principle', content: '**Remember**: principle B leads to conclusion C.' }],
        practice_questions: [{ topic: 'Conservation principle', question: 'Explain principle B with an example.', difficulty: 'medium', hint: 'Start from the definition.' }],
        step_explanations: weak.slice(0, 1).map((q) => ({ q_id: q.q_id, where_it_went_wrong: 'Skipped principle B.', correct_reasoning: 'A then B then C.' })),
        video_queries: [{ topic: 'Conservation principle', query: 'conservation principle explained' }], study_plan: ['Revise principle B'],
      }),
    });
    return {
      summary: res.summary || '', strengths: res.strengths || [], weaknesses: res.weaknesses || [], notes: res.notes || [],
      practice_questions: res.practice_questions || [], step_explanations: res.step_explanations || [],
      videos: (res.video_queries || []).map((v) => ({ topic: v.topic, query: v.query, url: yt(v.query) })), study_plan: res.study_plan || [],
    };
  },
};

/* ───────────── Publish (sync): attach learning packs, mark the test complete ───────────── */
export const publishResults = {
  async run(ctx) {
    const items = ctx.out('knowledge_gaps')?.items || {};
    for (const [unit, gaps] of Object.entries(items)) {
      await db.results.update({ test_id: ctx.input.test_id, unit_id: unit }, { $set: { gaps: gaps.error ? { error: gaps.error } : gaps } });
    }
    await db.tests.update({ _id: ctx.input.test_id }, { $set: { status: 'completed', completed_at: now() } });
    return { published: Object.keys(items).length };
  },
};
