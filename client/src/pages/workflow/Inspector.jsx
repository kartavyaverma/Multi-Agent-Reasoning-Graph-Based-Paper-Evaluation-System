import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../api.js';
import { Bar, Switch } from '../../components/ui.jsx';
import { stateOf, dur, clock, stamp, tryOf, NodeIcon, Ico } from './util.jsx';
import { NodePrompts } from './Prompts.jsx';

function JsonView({ testId, node, part }) {
  const [state, setState] = useState({ loading: true });
  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    api.get(`/tests/${testId}/workflow/nodes/${node.id}/${part}`)
      .then((d) => setState({ data: d.data }))
      .catch((e) => setState({ error: e.message }));
  }, [testId, node.id, part]);
  useEffect(load, [load]);
  const text = state.data === undefined ? '' : JSON.stringify(state.data, null, 2);
  return (
    <div className="wf-json">
      <div className="flex" style={{ marginBottom: 8 }}>
        <span className="muted small" style={{ flex: 1 }}>{part === 'output' && node.status !== 'completed' ? 'Step has not finished: showing finished students only, if any.' : part === 'input' ? 'Outputs of the upstream steps this step reads.' : part === 'config' ? 'Effective configuration (read-only).' : ''}</span>
        <button className="btn sm ghost" onClick={load} disabled={state.loading}>{state.loading ? 'Loading…' : 'Refresh'}</button>
        <button className="btn sm ghost" onClick={() => navigator.clipboard?.writeText(text)} disabled={!text}>Copy</button>
      </div>
      {state.error ? <div className="err">{state.error}</div> : state.data === null ? <div className="empty">Nothing yet.</div> : <pre className="box mono wf-pre">{text}</pre>}
    </div>
  );
}

function StepSettings({ testId, node, onChanged, notify }) {
  const init = { enabled: node.enabled, max_try_count: node.max_try_count, retry_interval_seconds: node.retry_interval_seconds, concurrency: node.concurrency };
  const [d, setD] = useState(init);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => setD(init), [node.id, node.enabled, node.max_try_count, node.retry_interval_seconds, node.concurrency]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(d) !== JSON.stringify(init);
  const save = async () => {
    setBusy(true); setErr('');
    try {
      await api.put(`/tests/${testId}/workflow/settings`, { steps: { [node.name]: d } });
      notify(`Saved settings for ${node.label}`);
      onChanged();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div>
      {err && <div className="err">{err}</div>}
      <div className="form-grid">
        <div className="fg-row">
          <div><b>Run this step</b><div className="hint">{node.optional ? 'When off, the step is skipped and the steps after it use what is available.' : 'Required: the workflow cannot run without it.'}</div></div>
          <Switch checked={d.enabled} disabled={!node.optional} label="Run this step" onChange={(v) => setD({ ...d, enabled: v })} />
        </div>
        <div className="fg-row">
          <div><b>Attempts</b><div className="hint">How many times to try before the step fails.</div></div>
          <input type="number" min="1" max="10" value={d.max_try_count} onChange={(e) => setD({ ...d, max_try_count: Number(e.target.value) })} />
        </div>
        <div className="fg-row">
          <div><b>Wait between attempts</b><div className="hint">Seconds.</div></div>
          <input type="number" min="0" max="600" value={d.retry_interval_seconds} onChange={(e) => setD({ ...d, retry_interval_seconds: Number(e.target.value) })} />
        </div>
        {node.fan_out && (
          <div className="fg-row">
            <div><b>Students in parallel</b><div className="hint">Higher is faster only if your GPU can serve several requests at once.</div></div>
            <input type="number" min="1" max="8" value={d.concurrency} onChange={(e) => setD({ ...d, concurrency: Number(e.target.value) })} />
          </div>
        )}
      </div>
      <div className="flex" style={{ justifyContent: 'flex-end', margin: '12px 0 18px' }}>
        {dirty && <button className="btn sm ghost" onClick={() => setD(init)}>Undo</button>}
        <button className="btn sm primary" onClick={save} disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save step settings'}</button>
      </div>
      <div className="sec-title">Raw configuration</div>
      <JsonView testId={testId} node={node} part="config" />
    </div>
  );
}

export default function Inspector({ testId, data, name, now, initialTab, onSelect, onClose, onRetry, onRerun, onChanged, notify }) {
  const n = data.nodes.find((x) => x.name === name);
  const [tab, setTab] = useState(initialTab || 'logs');
  useEffect(() => setTab(initialTab || 'logs'), [name, initialTab]);
  if (!n) return null;
  const st = stateOf(n, data.workflow, now);
  const downstream = data.nodes.filter((x) => x.depends_on.includes(n.name));
  const depsDone = n.depends_on.every((d) => data.nodes.find((x) => x.name === d)?.status === 'completed');
  const canRerun = depsDone && ['completed', 'failed'].includes(n.status);
  const tabs = [['logs', `Logs (${n.logs.length})`], ...(n.fan_out ? [['batches', `Students (${n.batches.length})`]] : []), ['input', 'Input'], ['output', 'Output'], ...(n.prompt?.ai ? [['prompt', n.prompt.added ? `Prompt +${n.prompt.added}` : 'Prompt']] : []), ['settings', 'Settings']];
  const levelCls = { error: 'b-bad', success: 'b-ok', info: 'b-info' };
  const toggle = async (enabled) => {
    try {
      await api.put(`/tests/${testId}/workflow/settings`, { steps: { [n.name]: { enabled } } });
      if (!enabled && n.status === 'failed') await onRetry(n.id);
      notify(enabled ? `${n.label} will run` : `${n.label} will be skipped`);
      onChanged();
    } catch (e) { notify(e.message, 'bad'); }
  };

  return (
    <aside className="wf-side card" aria-label={n.label}>
      <div className="wf-side-head">
        <NodeIcon type={n.type} size={18} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0 }} className="ell">{n.label}</h2>
          <div className="muted small mono ell">{n.name} · {n.type}</div>
        </div>
        <button className="x" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="wf-side-body">
        <div className="wf-meta">
          <span className={`wf-st s-${st.k}`}><i className={`wf-dot s-${st.k}`} /> {st.t}</span>
          {(n.started_at || n.try_count > 0) && !n.skipped && <span>Try {tryOf(n)}/{n.max_try_count}</span>}
          {n.started_at && <span>Started {stamp(n.started_at)}</span>}
          {n.started_at && <span>Took {dur((n.finished_at || now) - n.started_at)}</span>}
        </div>
        <p className="muted" style={{ margin: '10px 0 12px' }}>{n.description}</p>
        {n.progress?.total > 1 && <div style={{ marginBottom: 12 }}><div className="flex small muted" style={{ marginBottom: 4 }}><span style={{ flex: 1 }}>Progress</span>{n.progress.done}/{n.progress.total} students</div><Bar value={(n.progress.done / n.progress.total) * 100} cls="" /></div>}
        {n.error && <div className="err">{n.error}</div>}

        <div className="wf-deps">
          <span className="sec-title">Depends on</span>
          {n.depends_on.length ? n.depends_on.map((d) => <button key={d} className={`wf-chip btn-chip ${n.depends_on_current.includes(d) ? 'wait' : 'ok'}`} onClick={() => onSelect(d)} title={n.depends_on_current.includes(d) ? 'Not finished yet' : 'Finished'}>{d}</button>) : <span className="wf-chip src">uploaded files</span>}
        </div>
        <div className="wf-deps">
          <span className="sec-title">Feeds into</span>
          {downstream.length ? downstream.map((d) => <button key={d.name} className="wf-chip btn-chip" onClick={() => onSelect(d.name)}>{d.name}</button>) : <span className="muted small">nothing: final step</span>}
        </div>

        <div className="tabs" style={{ margin: '14px 0 12px' }}>
          {tabs.map(([k, l]) => <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
        </div>

        {tab === 'logs' && (n.logs.length ? (
          <div className="wf-logs">
            {[...n.logs].reverse().map((l, i) => {
              const lvl = l.level || (/fail|error/i.test(l.msg) ? 'error' : 'info');
              return <div key={i} className="log-row"><span className="muted small mono nowrap">{clock(l.at)}</span><span className={`badge ${levelCls[lvl] || 'b-info'}`}>{lvl}</span><span className="small wf-msg">{l.msg}</span></div>;
            })}
          </div>
        ) : <div className="empty">No logs yet. This step has not started.</div>)}

        {tab === 'batches' && (
          <div className="scroll wf-logs"><table>
            <thead><tr><th>Student</th><th>Status</th><th>Tries</th><th>Time</th></tr></thead>
            <tbody>{n.batches.map((b) => {
              const k = b.failed ? 'failed' : b.status === 'completed' ? 'completed' : b.status === 'running' ? (data.workflow.status === 'running' ? 'running' : 'paused') : 'waiting';
              return (
                <tr key={b.key}>
                  <td className="small">{b.label}{b.error && <div className="small" style={{ color: 'var(--bad)' }}>{b.error}</div>}</td>
                  <td><span className={`wf-st s-${k}`}><i className={`wf-dot s-${k}`} /> {b.failed ? 'Failed' : k[0].toUpperCase() + k.slice(1)}</span></td>
                  <td className="small">{b.tries}</td>
                  <td className="small muted nowrap">{b.started_at ? dur((b.finished_at || now) - b.started_at) : '-'}</td>
                </tr>
              );
            })}</tbody>
          </table>{!n.batches.length && <div className="empty">Students are assigned when this step starts.</div>}</div>
        )}

        {['input', 'output'].includes(tab) && <JsonView key={`${n.id}-${tab}`} testId={testId} node={n} part={tab} />}
        {tab === 'prompt' && <NodePrompts key={n.id} testId={testId} node={n} onChanged={onChanged} notify={notify} />}
        {tab === 'settings' && <StepSettings testId={testId} node={n} onChanged={onChanged} notify={notify} />}
      </div>
      <div className="wf-side-foot">
        {n.status === 'failed' && <button className="btn sm primary" onClick={() => onRetry(n.id)}><Ico name="refresh" size={13} /> Retry</button>}
        {n.optional && n.status !== 'completed' && (n.enabled
          ? <button className="btn sm" onClick={() => toggle(false)} title="Skip this step and continue"><Ico name="skip" size={13} /> {n.status === 'failed' ? 'Skip & continue' : 'Skip step'}</button>
          : <button className="btn sm" onClick={() => toggle(true)}><Ico name="play" size={13} /> Turn on</button>)}
        {canRerun && <button className="btn sm" onClick={() => onRerun(n)} title="Run this step and every step after it again"><Ico name="rerun" size={13} /> Re-run from here</button>}
        <div className="spacer" />
        <button className="btn sm ghost" onClick={onClose}>Close</button>
      </div>
    </aside>
  );
}
