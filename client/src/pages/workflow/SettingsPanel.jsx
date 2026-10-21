import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import { Switch } from '../../components/ui.jsx';
import { NodeIcon, Ico } from './util.jsx';
import { PromptList, toDraft } from './Prompts.jsx';

const AGENTS = [['logic', 'agent_logic', 'Logic', 'Reasoning flow and working'], ['concept', 'agent_concept', 'Concept', 'Conceptual correctness'], ['coverage', 'agent_coverage', 'Coverage', 'Key points covered'], ['factcheck', 'agent_factcheck', 'Fact-check', 'Formulas, values, units']];
// which finished step has to run again for a grading setting to take effect
const AFFECTS = { weights: 'confidence_router', highConfidence: 'confidence_router', lowConfidence: 'confidence_router', arbiterAccept: 'finalize_marks', nodeMatch: 'graph_compare', nodePartial: 'graph_compare' };
const pct = (x) => `${Math.round(x * 100)}%`;

function Range({ label, hint, value, onChange, min = 0, max = 1, step = 0.01, fmt = pct }) {
  return (
    <div className="range-row">
      <div className="range-head"><span>{label}</span><b className="mono">{fmt(value)}</b></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

const draftOf = (s) => ({
  grading: JSON.parse(JSON.stringify(s.grading)),
  steps: Object.fromEntries(s.steps.map((x) => [x.name, { enabled: x.enabled, max_try_count: x.max_try_count, retry_interval_seconds: x.retry_interval_seconds, concurrency: x.concurrency }])),
  prompts: Object.fromEntries(s.prompts.map((p) => [p.id, toDraft(p)])),
});

/** Turning a step off also turns off optional steps that cannot run without it (mirrors the server rule). */
function withStep(draft, steps, name, patch) {
  const next = { ...draft.steps, [name]: { ...draft.steps[name], ...patch } };
  if (patch.enabled === false) steps.filter((s) => s.requires.includes(name)).forEach((s) => (next[s.name] = { ...next[s.name], enabled: false }));
  if (patch.enabled === true) steps.find((s) => s.name === name).requires.forEach((r) => (next[r] = { ...next[r], enabled: true }));
  return { ...draft, steps: next };
}

export default function SettingsPanel({ testId, data, onClose, onChanged, notify, onRerun }) {
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [suggest, setSuggest] = useState(null); // step to re-run so finished work picks up the new settings
  const [tab, setTab] = useState('grading');

  useEffect(() => {
    api.get(`/tests/${testId}/workflow/settings`).then((s) => { setSaved(s); setDraft(draftOf(s)); }).catch((e) => setErr(e.message));
  }, [testId]);

  const status = useMemo(() => Object.fromEntries(data.nodes.map((n) => [n.name, n.status])), [data.nodes]);
  if (err && !draft) return <aside className="wf-side card"><div className="err">{err}</div></aside>;
  if (!draft) return <aside className="wf-side card"><p className="muted" style={{ padding: 20 }}>Loading settings…</p></aside>;

  const g = draft.grading;
  const setG = (patch) => setDraft({ ...draft, grading: { ...g, ...patch } });
  const wsum = AGENTS.reduce((s, [k, node]) => s + (draft.steps[node]?.enabled ? g.weights[k] : 0), 0) || 1;
  const enabledAgents = AGENTS.filter(([, node]) => draft.steps[node]?.enabled).length;
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(saved));

  const apply = async () => {
    setBusy('apply'); setErr('');
    try {
      const before = draftOf(saved);
      const s = await api.put(`/tests/${testId}/workflow/settings`, draft);
      setSaved(s); setDraft(draftOf(s));
      const touched = new Set();
      Object.keys(AFFECTS).forEach((k) => JSON.stringify(before.grading[k]) !== JSON.stringify(s.grading[k]) && touched.add(AFFECTS[k]));
      s.steps.forEach((x) => before.steps[x.name].enabled !== x.enabled && touched.add(x.name));
      s.prompts.forEach((x) => JSON.stringify(before.prompts[x.id]) !== JSON.stringify(toDraft(x)) && touched.add(x.node));
      const first = data.nodes.find((n) => touched.has(n.name) && ['completed', 'failed'].includes(n.status));
      setSuggest(first || null);
      notify(first ? 'Settings saved. Some finished steps used the old settings.' : 'Settings saved for this test');
      onChanged();
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  };
  const saveDefault = async () => {
    setBusy('default'); setErr('');
    try {
      await api.put('/workflow-defaults', draft);
      setSaved({ ...saved, has_user_defaults: true });
      notify('Saved as your default for new tests');
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  };
  const forgetDefault = async () => {
    await api.del('/workflow-defaults');
    setSaved({ ...saved, has_user_defaults: false });
    notify('Your defaults were cleared. New tests use the built-in settings.');
  };
  const resetAll = () => setDraft({
    grading: JSON.parse(JSON.stringify(saved.defaults)),
    steps: Object.fromEntries(saved.steps.map((x) => [x.name, { ...draft.steps[x.name], enabled: true, max_try_count: 3, retry_interval_seconds: 20 }])),
    prompts: Object.fromEntries(saved.prompts.map((p) => [p.id, { text: '', extra: '', blocks: [] }])),
  });
  const edits = { steps: saved.steps.filter((x) => !draft.steps[x.name].enabled).length, prompts: Object.values(draft.prompts).filter((p) => p.text.trim() || p.blocks.some((b) => b.enabled && b.text.trim())).length };

  return (
    <aside className="wf-side card" aria-label="Workflow settings">
      <div className="wf-side-head">
        <span className="wf-ico c-route"><Ico name="gear" size={16} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0 }}>Workflow settings</h2>
          <div className="muted small">For this test. Applies to steps that have not run yet.</div>
        </div>
        <button className="x" onClick={onClose} aria-label="Close settings">×</button>
      </div>

      <div className="wf-side-body">
        {err && <div className="err">{err}</div>}
        {suggest && (
          <div className="note flex" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 180 }}><b>{suggest.label}</b> already ran with the old settings. Re-run it (and every step after it) to apply them.</div>
            <button className="btn sm primary" onClick={() => onRerun(suggest, () => setSuggest(null))}><Ico name="rerun" size={13} /> Re-run</button>
          </div>
        )}

        <div className="tabs side-tabs">
          {[['grading', 'Grading'], ['steps', 'Steps', edits.steps ? `${edits.steps} off` : null], ['prompts', 'AI prompts', edits.prompts || null]].map(([k, l, c]) => (
            <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}{c ? <span className="count">{c}</span> : null}</button>
          ))}
        </div>

        {tab === 'prompts' && <PromptList nodes={data.nodes} prompts={saved.prompts} draft={draft.prompts} notify={notify} onChange={(p) => setDraft({ ...draft, prompts: p })} />}

        {tab === 'grading' && <>
        <section className="set-sec">
          <div className="set-title"><h3>Grading panel</h3><span className="muted small">How much each agent counts toward the mark</span></div>
          <div className="wbar" aria-hidden="true">
            {AGENTS.map(([k, node]) => draft.steps[node]?.enabled && g.weights[k] > 0 && <i key={k} className={`w-${k}`} style={{ flexGrow: g.weights[k] }} title={`${k} ${pct(g.weights[k] / wsum)}`} />)}
          </div>
          {AGENTS.map(([k, node, label, desc]) => {
            const on = draft.steps[node]?.enabled;
            return (
              <div key={k} className={`agent-row ${on ? '' : 'off'}`}>
                <Switch checked={on} label={`${label} agent`} disabled={on && enabledAgents === 1} title={on && enabledAgents === 1 ? 'At least one agent must stay on' : undefined}
                  onChange={(v) => setDraft(withStep(draft, saved.steps, node, { enabled: v }))} />
                <div className="agent-name"><span className={`wdot w-${k}`} /><b>{label}</b><div className="muted small">{desc}</div></div>
                <input type="range" min="0" max="1" step="0.05" value={g.weights[k]} disabled={!on} aria-label={`${label} weight`}
                  onChange={(e) => setG({ weights: { ...g.weights, [k]: Number(e.target.value) } })} />
                <b className="mono share">{on ? pct(g.weights[k] / wsum) : 'off'}</b>
              </div>
            );
          })}
        </section>

        <section className="set-sec">
          <div className="set-title"><h3>Confidence routing</h3><span className="muted small">Where each answer goes after the panel</span></div>
          <div className="zones" aria-hidden="true">
            <i className="z-review" style={{ width: pct(g.lowConfidence) }}>Teacher review</i>
            <i className="z-re" style={{ width: pct(Math.max(0, g.highConfidence - g.lowConfidence)) }}>Re-evaluate</i>
            <i className="z-auto" style={{ flex: 1 }}>Auto-accept</i>
          </div>
          <Range label="Auto-accept when confidence is at least" value={g.highConfidence} onChange={(v) => setG({ highConfidence: v, lowConfidence: Math.min(v, g.lowConfidence) })} />
          <Range label="Send to teacher review below" value={g.lowConfidence} onChange={(v) => setG({ lowConfidence: Math.min(v, g.highConfidence) })}
            hint="Answers in between go to the senior examiner for a second opinion." />
          <Range label="Accept the senior examiner's mark at confidence" value={g.arbiterAccept} onChange={(v) => setG({ arbiterAccept: v })}
            hint="Below this the answer is flagged for you instead." />
        </section>

        <section className="set-sec">
          <div className="set-title"><h3>Reasoning-graph matching</h3><span className="muted small">How close a student's step must be to a model step</span></div>
          <Range label="Counts as a match at similarity" value={g.nodeMatch} onChange={(v) => setG({ nodeMatch: v, nodePartial: Math.min(v, g.nodePartial) })} />
          <Range label="Counts as partly covered at similarity" value={g.nodePartial} onChange={(v) => setG({ nodePartial: Math.min(v, g.nodeMatch) })} />
        </section>

        <section className="set-sec">
          <div className="set-title"><h3>AI batching</h3></div>
          <Range label="Questions graded per AI call" value={g.questionsPerCall} min={1} max={20} step={1} fmt={(v) => v} onChange={(v) => setG({ questionsPerCall: v })}
            hint="Fewer questions per call is slower, but small models grade more carefully." />
        </section>
        </>}

        {tab === 'steps' && (
        <section className="set-sec">
          <div className="set-title"><h3>Steps</h3><span className="muted small">Switch off optional steps, tune retries and parallel work</span></div>
          <div className="steps-table">
            <div className="st-head muted small"><span>Step</span><span title="Attempts before the step fails">Tries</span><span title="Seconds between attempts">Wait (s)</span><span title="Students processed at the same time">Parallel</span></div>
            {saved.steps.map((s) => {
              const d = draft.steps[s.name];
              const agentLast = s.name.startsWith('agent_') && d.enabled && enabledAgents === 1;
              const set = (patch) => setDraft(withStep(draft, saved.steps, s.name, patch));
              return (
                <div key={s.name} className={`st-row ${d.enabled ? '' : 'off'}`}>
                  <div className="st-name">
                    {s.optional ? <Switch checked={d.enabled} label={`Run ${s.label}`} disabled={agentLast} onChange={(v) => set({ enabled: v })} /> : <span className="switch-ph" title="Required step" />}
                    <NodeIcon type={s.type} size={13} />
                    <div style={{ minWidth: 0 }}>
                      <div className="ell">{s.label}</div>
                      <div className="muted small ell">{!s.optional ? 'Required' : s.requires.length ? `Needs ${s.requires.join(', ')}` : 'Optional'}{status[s.name] === 'completed' ? ' · done' : ''}</div>
                    </div>
                  </div>
                  <input type="number" min="1" max="10" value={d.max_try_count} onChange={(e) => set({ max_try_count: Number(e.target.value) })} aria-label={`${s.label} tries`} />
                  <input type="number" min="0" max="600" value={d.retry_interval_seconds} onChange={(e) => set({ retry_interval_seconds: Number(e.target.value) })} aria-label={`${s.label} retry wait`} />
                  {s.fan_out ? <input type="number" min="1" max="8" value={d.concurrency} onChange={(e) => set({ concurrency: Number(e.target.value) })} aria-label={`${s.label} parallel`} /> : <span className="muted small center">-</span>}
                </div>
              );
            })}
          </div>
        </section>)}
      </div>

      <div className="wf-side-foot">
        <button className="btn sm ghost" onClick={resetAll} title="Built-in settings">Reset</button>
        {saved.has_user_defaults && <button className="btn sm ghost" onClick={forgetDefault} title="New tests will use the built-in settings">Clear my default</button>}
        <div className="spacer" />
        <button className="btn sm" onClick={saveDefault} disabled={!!busy} title="Use these settings for every new test">{busy === 'default' ? 'Saving…' : 'Save as my default'}</button>
        <button className="btn sm primary" onClick={apply} disabled={!dirty || !!busy}>{busy === 'apply' ? 'Applying…' : dirty ? 'Apply to this test' : 'Saved'}</button>
      </div>
    </aside>
  );
}
