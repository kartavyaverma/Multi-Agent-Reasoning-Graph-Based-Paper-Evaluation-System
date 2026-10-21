import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Bar, fmtDur, ConfirmDialog, Toast } from '../components/ui.jsx';
import { stateOf, dur, stamp, Ico } from './workflow/util.jsx';
import Canvas from './workflow/Canvas.jsx';
import Inspector from './workflow/Inspector.jsx';
import SettingsPanel from './workflow/SettingsPanel.jsx';
import { Timeline, Activity } from './workflow/Views.jsx';

const POLL_LIVE = 2000, POLL_IDLE = 10000;
const WF_BADGE = { running: ['Running', 'b-info'], completed: ['Completed', 'b-ok'], failed: ['Failed', 'b-bad'], stopped: ['Paused', 'b-gray'] };

export default function WorkflowPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState(() => new URLSearchParams(window.location.search).get('node'));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState(null);
  const [view, setView] = useState('graph');
  const [offset, setOffset] = useState(0); // server clock - browser clock
  const [lastAt, setLastAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [confirm, setConfirm] = useState(null);
  const [toast, setToast] = useState(null);
  const busy = useRef(false);
  const toastTimer = useRef(null);

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

  const notify = useCallback((msg, kind = 'ok') => {
    clearTimeout(toastTimer.current);
    setToast({ msg, kind });
    toastTimer.current = setTimeout(() => setToast(null), 3800);
  }, []);

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
  useEffect(() => {
    const k = (e) => {
      if (e.key !== 'Escape' || confirm) return;
      if (settingsOpen) setSettingsOpen(false);
      else setSelected(null);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [settingsOpen, confirm]);

  if (err && !data) return <div className="err">{err}</div>;
  if (!data) return <p className="muted">Loading workflow…</p>;

  const srvNow = now + offset;
  const { nodes, workflow, test, ai } = data;
  const states = nodes.map((n) => ({ n, st: stateOf(n, workflow, srvNow) }));
  const done = nodes.filter((n) => n.status === 'completed').length;
  const running = states.filter((x) => x.st.k === 'running');
  const next = states.filter((x) => ['queued', 'retry'].includes(x.st.k));
  const failed = states.filter((x) => x.st.k === 'failed');
  const off = nodes.filter((n) => !n.enabled).length;
  const errors = nodes.reduce((s, n) => s + n.logs.filter((l) => l.level === 'error').length, 0);
  const [wfT, wfC] = WF_BADGE[workflow.status] || [workflow.status, 'b-gray'];
  const act = (p, msg) => async () => {
    try { await api.post(`/tests/${id}/${p}`); notify(msg); } catch (e) { notify(e.message, 'bad'); }
    load();
  };
  const ago = Math.max(0, Math.round((now - lastAt) / 1000));

  const select = (name, tab = null) => { setSettingsOpen(false); setSelected(name); setInspectorTab(tab); };
  const retry = async (nid) => {
    try { await api.post(`/tests/${id}/nodes/${nid}/retry`); notify('Retrying step'); } catch (e) { notify(e.message, 'bad'); }
    load();
  };
  const rerun = (n, after) => {
    const idx = nodes.findIndex((x) => x.name === n.name);
    const replacesMarks = idx <= nodes.findIndex((x) => x.name === 'finalize_marks');
    setConfirm({
      title: `Re-run from “${n.label}”?`,
      body: <>This step and every step after it run again with the current settings.{replacesMarks && <><br /><br /><b>Marks are recalculated</b>, so any marks or comments you changed by hand on this test will be replaced.</>}</>,
      confirm: 'Re-run',
      danger: replacesMarks,
      onConfirm: async () => {
        try {
          const r = await api.post(`/tests/${id}/nodes/${n.id}/rerun`);
          notify(`Re-running ${r.reset.length} step${r.reset.length === 1 ? '' : 's'}`);
          after?.();
        } catch (e) { notify(e.message, 'bad'); }
        load();
      },
    });
  };

  const side = settingsOpen
    ? <SettingsPanel testId={id} data={data} onClose={() => setSettingsOpen(false)} onChanged={load} notify={notify} onRerun={rerun} />
    : selected && nodes.some((n) => n.name === selected)
      ? <Inspector testId={id} data={data} name={selected} now={srvNow} initialTab={inspectorTab} onSelect={select} onClose={() => setSelected(null)} onRetry={retry} onRerun={rerun} onChanged={load} notify={notify} />
      : null;

  return (
    <div className="wf-page">
      <div className="page-head" style={{ marginBottom: 16 }}>
        <div className="grow">
          <div className="crumbs"><Link to="/">Dashboard</Link><span>/</span><Link to={`/tests/${id}`}>{test.title}</Link><span>/</span>Workflow</div>
          <h1 className="flex" style={{ gap: 12 }}><span>Evaluation <em>workflow</em></span> <span className={`badge ${wfC}`}>{wfT}</span></h1>
          <div className="muted small">{test.student_count} student{test.student_count === 1 ? '' : 's'} · {nodes.length} steps{off ? ` · ${off} switched off` : ''} · <span className="mono">{workflow.template_id}</span></div>
        </div>
        <div className="flex">
          <span className={`wf-live ${live ? 'on' : ''}`}><i />{live ? 'Live' : 'Idle'} · {ago < 2 ? 'just now' : `${ago}s ago`}</span>
          <button className="btn sm ghost" onClick={load} title="Refresh"><Ico name="refresh" size={14} /></button>
          {live && <button className="btn sm" onClick={act('stop', 'Workflow paused')}><Ico name="pause" size={13} /> Pause</button>}
          {['stopped', 'failed'].includes(workflow.status) && <button className="btn sm primary" onClick={act('resume', 'Workflow resumed')}><Ico name="play" size={13} /> Resume</button>}
          <button className={`btn sm ${settingsOpen ? 'on' : ''}`} onClick={() => { setSelected(null); setSettingsOpen(!settingsOpen); }} aria-pressed={settingsOpen}>
            <Ico name="gear" size={14} /> Settings{off > 0 && <span className="count">{off} off</span>}
          </button>
          <Link className="btn sm primary" to={`/tests/${id}`}>Results →</Link>
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
              <button key={n.id} className="wf-now-item" onClick={() => select(n.name)}>
                <i className="wf-dot s-running" /><b>{n.label}</b>
                <span className="muted small nowrap">{n.progress?.total > 1 ? `${n.progress.done}/${n.progress.total} · ` : ''}{dur(srvNow - n.started_at)}</span>
              </button>
            )) : failed.length ? <div style={{ color: 'var(--bad)' }}>Stopped at {failed.map(({ n }) => <button key={n.id} className="linkbtn" style={{ color: 'inherit' }} onClick={() => select(n.name)}>{n.label}</button>)}</div>
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

      <div className={`wf-main ${side ? 'with-side' : ''}`}>
        <div className="card wf-card">
          <div className="wf-views">
            {[['graph', 'Graph'], ['timeline', 'Timeline'], ['activity', 'Activity']].map(([k, l]) => (
              <button key={k} className={`tab ${view === k ? 'active' : ''}`} onClick={() => setView(k)}>
                {l}{k === 'activity' && errors > 0 && <span className="count bad">{errors}</span>}
              </button>
            ))}
          </div>
          {view === 'graph' && <Canvas data={data} now={srvNow} selected={selected} onSelect={(n, tab) => (n ? select(n, tab) : setSelected(null))} />}
          {view === 'timeline' && <Timeline data={data} now={srvNow} selected={selected} onSelect={select} />}
          {view === 'activity' && <Activity data={data} onSelect={select} />}
        </div>
        {side}
      </div>

      <ConfirmDialog opts={confirm} onClose={() => setConfirm(null)} />
      <Toast toast={toast} />
    </div>
  );
}
