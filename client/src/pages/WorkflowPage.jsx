import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Bar, fmtDur } from '../components/ui.jsx';

const NW = 236, NH = 104, GX = 40, GY = 70, PAD = 24;
const POLL_LIVE = 2000, POLL_IDLE = 10000;

/* ───────────── helpers ───────────── */
const dur = (ms) => {
  if (ms == null || ms < 0) return '-';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
};
const clock = (t) => (t ? new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-');
const tryOf = (n) => Math.max(1, n.try_count + (['completed', 'failed'].includes(n.status) ? 0 : 1));
const stamp = (t) => (t ? new Date(t).toLocaleString(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-');

/** Display state of a node, derived from engine status + workflow status. */
function stateOf(n, wf, now) {
  const failedBatches = n.batches.filter((b) => b.failed).length;
  if (n.status === 'completed') return failedBatches ? { k: 'partial', t: `Completed · ${failedBatches} failed` } : { k: 'completed', t: 'Completed' };
  if (n.status === 'failed') return { k: 'failed', t: 'Failed' };
  if (wf.status !== 'running' && (n.status === 'pending' || (n.status === 'ready' && n.started_at))) return { k: 'paused', t: 'Paused' };
  if (n.status === 'pending') return { k: 'running', t: 'Running' };
  if (n.status === 'ready') {
    if (n.try_count > 0 && n.try_at > now) return { k: 'retry', t: `Retry in ${dur(n.try_at - now)}` };
    return { k: 'queued', t: 'Queued' };
  }
  return { k: 'waiting', t: 'Waiting' };
}

/** Layered DAG layout: level = longest path from a root; order inside a level by parents' position. */
function layout(nodes) {
  const byName = Object.fromEntries(nodes.map((n) => [n.name, n]));
  const level = {};
  const lv = (name, seen = new Set()) => {
    if (level[name] != null) return level[name];
    if (seen.has(name)) return 0;
    seen.add(name);
    const deps = (byName[name]?.depends_on || []).filter((d) => byName[d]);
    return (level[name] = deps.length ? 1 + Math.max(...deps.map((d) => lv(d, seen))) : 0);
  };
  nodes.forEach((n) => lv(n.name));
  const rows = [];
  nodes.forEach((n) => (rows[level[n.name]] ||= []).push(n.name));
  const cols = Math.max(...rows.map((r) => r.length));
  const W = cols * NW + (cols - 1) * GX + PAD * 2;
  const pos = {};
  rows.forEach((row, r) => {
    if (r > 0) {
      const bary = (name) => {
        const xs = byName[name].depends_on.filter((d) => pos[d]).map((d) => pos[d].x);
        return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
      };
      row.sort((a, b) => bary(a) - bary(b));
    }
    const rowW = row.length * NW + (row.length - 1) * GX;
    const x0 = (W - rowW) / 2;
    row.forEach((name, i) => (pos[name] = { x: x0 + i * (NW + GX), y: PAD + r * (NH + GY) }));
  });
  const H = PAD * 2 + rows.length * NH + (rows.length - 1) * GY;
  const edges = nodes.flatMap((n) => n.depends_on.filter((d) => pos[d]).map((d) => ({ from: d, to: n.name })));
  return { pos, W, H, edges };
}

function edgePath(a, b, i, total) {
  // spread the start/end points of a node's edges so fan-in / fan-out lines don't sit on top of each other
  const sx = a.x + NW / 2 + (total.out > 1 ? (i.out - (total.out - 1) / 2) * 14 : 0);
  const tx = b.x + NW / 2 + (total.in > 1 ? (i.in - (total.in - 1) / 2) * 14 : 0);
  const sy = a.y + NH, ty = b.y;
  const my = ty - GY / 2;
  if (Math.abs(sx - tx) < 1) return `M${sx},${sy} L${tx},${ty}`;
  // orthogonal routing like a flowchart: down, across just above the target row, down
  return `M${sx},${sy} L${sx},${my} L${tx},${my} L${tx},${ty}`;
}

/* ───────────── graph ───────────── */
function Graph({ data, now, selected, onSelect }) {
  const wrap = useRef(null);
  const { nodes, workflow } = data;
  const g = useMemo(() => layout(nodes), [nodes.map((n) => n.name + n.depends_on.join()).join('|')]);
  const [zoom, setZoom] = useState(null);
  const [fit, setFit] = useState(1);
  const [hover, setHover] = useState(null);

  useLayoutEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => setFit(Math.max(0.5, Math.min(1, (e.contentRect.width - 2) / g.W))));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [g.W]);
  const scale = zoom ?? fit;

  const byName = Object.fromEntries(nodes.map((n) => [n.name, n]));
  const states = Object.fromEntries(nodes.map((n) => [n.name, stateOf(n, workflow, now)]));
  const focus = hover || selected;
  const outCount = {}, inCount = {}, outIdx = {}, inIdx = {};
  g.edges.forEach((e) => { outCount[e.from] = (outCount[e.from] || 0) + 1; inCount[e.to] = (inCount[e.to] || 0) + 1; });
  const sortedOut = [...g.edges].sort((a, b) => g.pos[a.to].x - g.pos[b.to].x);
  const sortedIn = [...g.edges].sort((a, b) => g.pos[a.from].x - g.pos[b.from].x);
  const ek = (e) => `${e.from}>${e.to}`;
  const tmpO = {}, tmpI = {};
  sortedOut.forEach((e) => (outIdx[ek(e)] = (tmpO[e.from] = (tmpO[e.from] ?? -1) + 1)));
  sortedIn.forEach((e) => (inIdx[ek(e)] = (tmpI[e.to] = (tmpI[e.to] ?? -1) + 1)));

  return (
    <div className="wf-canvas-wrap">
      <div className="wf-zoom">
        <button className="btn sm" onClick={() => setZoom(Math.max(0.3, +(scale - 0.1).toFixed(2)))} aria-label="Zoom out">−</button>
        <button className="btn sm" onClick={() => setZoom(null)}>{Math.round(scale * 100)}%</button>
        <button className="btn sm" onClick={() => setZoom(Math.min(1.6, +(scale + 0.1).toFixed(2)))} aria-label="Zoom in">+</button>
      </div>
      <div className="wf-canvas" ref={wrap}>
        <div style={{ width: g.W * scale, height: g.H * scale }}>
          <div style={{ width: g.W, height: g.H, transform: `scale(${scale})`, transformOrigin: '0 0', position: 'relative' }}>
            <svg width={g.W} height={g.H} className="wf-edges">
              <defs>
                {['idle', 'done', 'live'].map((k) => (
                  <marker key={k} id={`arr-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0,0 L10,5 L0,10 z" className={`wf-arrow ${k}`} />
                  </marker>
                ))}
              </defs>
              {g.edges.map((e) => {
                const src = states[e.from].k, dst = states[e.to].k;
                const done = ['completed', 'partial'].includes(src);
                const live = done && ['running', 'queued'].includes(dst);
                const k = live ? 'live' : done ? 'done' : 'idle';
                const dim = focus && e.from !== focus && e.to !== focus;
                const hl = focus && !dim;
                return (
                  <path key={ek(e)} d={edgePath(g.pos[e.from], g.pos[e.to], { out: outIdx[ek(e)], in: inIdx[ek(e)] }, { out: outCount[e.from], in: inCount[e.to] })}
                    className={`wf-edge ${k} ${dim ? 'dim' : ''} ${hl ? 'hl' : ''}`} markerEnd={`url(#arr-${k})`} />
                );
              })}
            </svg>
            {nodes.map((n) => {
              const p = g.pos[n.name];
              const st = states[n.name];
              const dim = focus && focus !== n.name && !byName[focus]?.depends_on.includes(n.name) && !n.depends_on.includes(focus);
              const pr = n.progress;
              return (
                <button key={n.id} className={`wf-node s-${st.k} ${selected === n.name ? 'sel' : ''} ${dim ? 'dim' : ''}`}
                  style={{ left: p.x, top: p.y, width: NW, height: NH }}
                  onClick={() => onSelect(n.name)} onMouseEnter={() => setHover(n.name)} onMouseLeave={() => setHover(null)}>
                  <div className="wf-node-top"><i className={`wf-dot s-${st.k}`} /><b className="mono">{n.name}</b></div>
                  <div className="wf-node-type mono">{n.type}</div>
                  <div className="wf-node-st">
                    <span className={`wf-st s-${st.k}`}>{st.t}</span>
                    {(n.started_at || n.try_count > 0) && <span className="muted"> · try {tryOf(n)}/{n.max_try_count}</span>}
                    {n.started_at && <span className="muted"> · {dur((n.finished_at || now) - n.started_at)}</span>}
                  </div>
                  {pr?.total > 1 && n.status !== 'completed' ? (
                    <div className="wf-node-prog"><Bar value={(pr.done / pr.total) * 100} cls="" /><span className="small muted">{pr.done}/{pr.total}</span></div>
                  ) : (
                    <div className="wf-node-deps">
                      {n.depends_on.length ? <span className="muted small">↳ </span> : null}
                      {n.depends_on.slice(0, 2).map((d) => <span key={d} className={`wf-chip ${n.depends_on_current.includes(d) ? 'wait' : 'ok'}`}>{d}</span>)}
                      {n.depends_on.length > 2 && <span className="wf-chip">+{n.depends_on.length - 2}</span>}
                      {!n.depends_on.length && <span className="wf-chip src">uploads</span>}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────── node detail panel ───────────── */
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
        <span className="muted small" style={{ flex: 1 }}>{part === 'output' && node.status !== 'completed' ? 'Node has not finished: showing finished batches only, if any.' : part === 'input' ? 'Outputs of the upstream nodes this node reads.' : ''}</span>
        <button className="btn sm" onClick={load} disabled={state.loading}>{state.loading ? 'Loading…' : 'Refresh'}</button>
        <button className="btn sm" onClick={() => navigator.clipboard?.writeText(text)} disabled={!text}>Copy</button>
      </div>
      {state.error ? <div className="err">{state.error}</div> : state.data === null ? <div className="empty">Nothing yet.</div> : <pre className="box mono wf-pre">{text}</pre>}
    </div>
  );
}

function Detail({ testId, data, name, now, onSelect, onClose, onRetry }) {
  const n = data.nodes.find((x) => x.name === name);
  const [tab, setTab] = useState('logs');
  useEffect(() => setTab('logs'), [name]);
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  if (!n) return null;
  const st = stateOf(n, data.workflow, now);
  const downstream = data.nodes.filter((x) => x.depends_on.includes(n.name));
  const tabs = [['logs', `Logs (${n.logs.length})`], ...(n.fan_out ? [['batches', `Students (${n.batches.length})`]] : []), ['input', 'Input'], ['output', 'Output'], ['config', 'Config']];
  const levelCls = { error: 'b-bad', success: 'b-ok', info: 'b-info' };

  return (
    <div className="wf-drawer-bg" onClick={onClose}>
      <aside className="wf-drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={n.name}>
        <div className="wf-drawer-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 className="mono" style={{ margin: 0 }}>{n.name}</h2>
            <div className="muted small">{n.label}</div>
          </div>
          <button className="x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="wf-drawer-body">
          <div className="wf-meta">
            <span className={`wf-st s-${st.k}`}><i className={`wf-dot s-${st.k}`} /> {st.t}</span>
            <span className="mono muted">{n.id}</span>
            <span className="mono">{n.type}</span>
            {(n.started_at || n.try_count > 0) && <span>Try {tryOf(n)}/{n.max_try_count}</span>}
            {n.started_at && <span>Started: {stamp(n.started_at)}</span>}
            {n.finished_at && <span className="ok-t">Completed: {stamp(n.finished_at)}</span>}
            {n.started_at && <span>Duration: {dur((n.finished_at || now) - n.started_at)}</span>}
          </div>
          <p style={{ margin: '10px 0 12px' }}>{n.description}</p>
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
            <div className="scroll wf-logs"><table>
              <thead><tr><th>Time</th><th>Level</th><th>Message</th></tr></thead>
              <tbody>{[...n.logs].reverse().map((l, i) => (
                <tr key={i}><td className="muted small nowrap">{clock(l.at)}</td><td><span className={`badge ${levelCls[l.level] || (/fail|error/i.test(l.msg) ? 'b-bad' : 'b-info')}`}>{l.level || (/fail|error/i.test(l.msg) ? 'error' : 'info')}</span></td><td className="small wf-msg">{l.msg}</td></tr>
              ))}</tbody>
            </table></div>
          ) : <div className="empty">No logs yet. This node has not started.</div>)}

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
            </table>{!n.batches.length && <div className="empty">Students are assigned when this node starts.</div>}</div>
          )}

          {['input', 'output', 'config'].includes(tab) && <JsonView key={`${n.id}-${tab}`} testId={testId} node={n} part={tab} />}
        </div>
        <div className="wf-drawer-foot">
          {n.status === 'failed' && <button className="btn" onClick={() => onRetry(n.id)}>↻ Retry</button>}
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </aside>
    </div>
  );
}

/* ───────────── page ───────────── */
const WF_BADGE = { running: ['Running', 'b-info'], completed: ['Completed', 'b-ok'], failed: ['Failed', 'b-bad'], stopped: ['Paused', 'b-gray'] };

export default function WorkflowPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState(() => new URLSearchParams(window.location.search).get('node'));
  const [offset, setOffset] = useState(0); // server clock - browser clock
  const [lastAt, setLastAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const d = await api.get(`/tests/${id}/workflow`);
      setOffset(d.server_time - Date.now());
      setData(d);
      setLastAt(Date.now());
      setErr('');
    } catch (e) {
      setErr(e.message);
    } finally {
      busy.current = false;
    }
  }, [id]);

  const live = data?.workflow.status === 'running';
  useEffect(() => { load(); }, [load]);
  // polling: fast while running, slow otherwise, paused while the tab is hidden
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load(); }, live ? POLL_LIVE : POLL_IDLE);
    const vis = () => !document.hidden && load();
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [live, load]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const u = new URL(window.location.href);
    selected ? u.searchParams.set('node', selected) : u.searchParams.delete('node');
    window.history.replaceState(null, '', u);
  }, [selected]);

  if (err && !data) return <div className="err">{err}</div>;
  if (!data) return <p className="muted">Loading workflow…</p>;

  const srvNow = now + offset;
  const { nodes, workflow, test, ai } = data;
  const states = nodes.map((n) => ({ n, st: stateOf(n, workflow, srvNow) }));
  const done = states.filter((x) => ['completed', 'partial'].includes(x.st.k)).length;
  const running = states.filter((x) => x.st.k === 'running');
  const next = states.filter((x) => ['queued', 'retry'].includes(x.st.k));
  const failed = states.filter((x) => x.st.k === 'failed');
  const [wfT, wfC] = WF_BADGE[workflow.status] || [workflow.status, 'b-gray'];
  const act = (p) => async () => { await api.post(`/tests/${id}/${p}`); load(); };
  const ago = Math.max(0, Math.round((now - lastAt) / 1000));

  return (
    <div className="wf-page">
      <div className="page-head" style={{ marginBottom: 14 }}>
        <div className="grow">
          <div className="muted small"><Link to="/">Dashboard</Link> / <Link to={`/tests/${id}`}>{test.title}</Link> / Workflow</div>
          <h1>Evaluation workflow <span className={`badge ${wfC}`}>{wfT}</span></h1>
          <div className="muted small mono">{workflow.template_id} · {workflow.id} · {test.student_count} student{test.student_count === 1 ? '' : 's'}</div>
        </div>
        <div className="flex">
          <span className={`wf-live ${live ? 'on' : ''}`}><i />{live ? 'Live' : 'Idle'} · updated {ago < 2 ? 'just now' : `${ago}s ago`}</span>
          <button className="btn sm" onClick={load}>Refresh</button>
          {live && <button className="btn sm" onClick={act('stop')}>Pause</button>}
          {['stopped', 'failed'].includes(workflow.status) && <button className="btn sm primary" onClick={act('resume')}>Resume</button>}
          <Link className="btn sm" to={`/tests/${id}`}>Results</Link>
        </div>
      </div>

      {err && <div className="warnbox">Connection problem, retrying: {err}</div>}
      {workflow.error && <div className="err">{workflow.error}</div>}

      <div className="wf-stats">
        <div className="card wf-stat">
          <div className="sec-title">Progress</div>
          <div className="wf-big">{done}<span className="muted">/{nodes.length} steps</span></div>
          <Bar value={(done / nodes.length) * 100} cls={workflow.status === 'failed' ? 'bad' : workflow.status === 'completed' ? 'ok' : ''} />
        </div>
        <div className="card wf-stat wf-now">
          <div className="sec-title">{workflow.status === 'completed' ? 'Finished' : 'Now running'}</div>
          {workflow.status === 'completed' ? <div>All {nodes.length} steps completed.</div>
            : running.length ? running.map(({ n }) => (
              <button key={n.id} className="wf-now-item" onClick={() => setSelected(n.name)}>
                <i className="wf-dot s-running" /><b>{n.label}</b>
                <span className="muted small nowrap">{n.progress?.total > 1 ? `${n.progress.done}/${n.progress.total} · ` : ''}{dur(srvNow - n.started_at)}</span>
              </button>
            )) : failed.length ? <div style={{ color: 'var(--bad)' }}>Stopped at {failed.map(({ n }) => n.label).join(', ')}</div>
            : <div className="muted">{workflow.status === 'stopped' ? 'Paused' : next.length ? 'Starting next step…' : '-'}</div>}
          {next.length > 0 && workflow.status === 'running' && <div className="muted small" style={{ marginTop: 4 }}>Up next: {next.map(({ n, st }) => (st.k === 'retry' ? `${n.label} (${st.t.toLowerCase()})` : n.label)).join(', ')}</div>}
        </div>
        <div className="card wf-stat">
          <div className="sec-title">Elapsed</div>
          <div className="wf-big">{dur((workflow.finished_at || srvNow) - workflow.created_at)}</div>
          <div className="muted small">{live ? `About ${fmtDur(data.eta_seconds)} left (${data.remaining_ai_calls} AI calls)` : `Started ${stamp(workflow.created_at)}`}</div>
        </div>
        <div className="card wf-stat">
          <div className="sec-title">Local AI <span className="mono" style={{ textTransform: 'none' }}>({ai.model})</span></div>
          {ai.running.length ? ai.running.map((r, i) => (
            <div key={i} className="small"><i className="wf-dot s-running" /> <span className="mono">{r.task}</span> <span className="muted">· {dur(srvNow - r.started_at)}</span></div>
          )) : <div className="muted small">Idle</div>}
          {ai.queued > 0 && <div className="muted small">{ai.queued} request{ai.queued > 1 ? 's' : ''} queued</div>}
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="wf-legend">
          {[['completed', 'Completed'], ['running', 'Running'], ['queued', 'Queued'], ['retry', 'Retrying'], ['waiting', 'Waiting'], ['paused', 'Paused'], ['failed', 'Failed']].map(([k, l]) => <span key={k}><i className={`wf-dot s-${k}`} />{l}</span>)}
          <span className="muted" style={{ marginLeft: 'auto' }}>Click a step for logs, input and output</span>
        </div>
        <Graph data={data} now={srvNow} selected={selected} onSelect={setSelected} />
      </div>

      {selected && (
        <Detail testId={id} data={data} name={selected} now={srvNow} onSelect={setSelected} onClose={() => setSelected(null)}
          onRetry={async (nid) => { await api.post(`/tests/${id}/nodes/${nid}/retry`); load(); }} />
      )}
    </div>
  );
}
