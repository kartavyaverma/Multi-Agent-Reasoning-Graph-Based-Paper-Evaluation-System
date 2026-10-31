import React, { useMemo, useState } from 'react';
import { stateOf, dur, clock, NodeIcon } from './util.jsx';

/** Gantt-style view: when each step started and how long it took. */
export function Timeline({ data, now, selected, onSelect }) {
  const { nodes, workflow } = data;
  const starts = nodes.map((n) => n.started_at).filter(Boolean);
  const t0 = starts.length ? Math.min(...starts) : workflow.created_at; // after a re-run, start at the earliest step still on record
  const t1 = Math.max(workflow.finished_at || now, t0 + 1000);
  const span = t1 - t0;
  const ticks = Array.from({ length: 6 }, (_, i) => i / 5);
  return (
    <div className="tl">
      <div className="tl-row tl-axis">
        <div />
        <div className="tl-track">{ticks.map((f) => <span key={f} style={{ left: `${f * 100}%` }}>{dur(f * span)}</span>)}</div>
      </div>
      {nodes.map((n) => {
        const st = stateOf(n, workflow, now);
        const s = n.started_at, e = n.finished_at || (s ? now : null);
        return (
          <button key={n.id} className={`tl-row ${selected === n.name ? 'sel' : ''}`} onClick={() => onSelect(n.name)}>
            <div className="tl-label"><NodeIcon type={n.type} size={12} /><span className="ell">{n.label}</span></div>
            <div className="tl-track">
              {ticks.map((f) => <i key={f} className="tl-grid" style={{ left: `${f * 100}%` }} />)}
              {s ? (
                <div className={`tl-bar s-${st.k}`} style={{ left: `${((s - t0) / span) * 100}%`, width: `max(4px, ${((e - s) / span) * 100}%)` }} title={`${n.label}: ${dur(e - s)}`}>
                  {(e - s) / span > 0.08 && <span>{dur(e - s)}</span>}
                </div>
              ) : <span className="tl-wait muted small">{st.t}</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** Every log line from every step, newest first. */
export function Activity({ data, onSelect }) {
  const [level, setLevel] = useState('all');
  const [q, setQ] = useState('');
  const rows = useMemo(() => data.nodes
    .flatMap((n) => n.logs.map((l) => ({ ...l, level: l.level || (/fail|error/i.test(l.msg) ? 'error' : 'info'), node: n.name, label: n.label, type: n.type })))
    .sort((a, b) => b.at - a.at), [data.nodes]);
  const s = q.trim().toLowerCase();
  const shown = rows.filter((r) => (level === 'all' || r.level === level) && (!s || `${r.msg} ${r.node} ${r.label}`.toLowerCase().includes(s)));
  const count = (l) => rows.filter((r) => r.level === l).length;
  const levelCls = { error: 'b-bad', success: 'b-ok', info: 'b-info' };
  return (
    <div className="act">
      <div className="wf-toolbar">
        <div className="seg sm" role="group" aria-label="Filter by level">
          {[['all', `All ${rows.length}`], ['info', `Info ${count('info')}`], ['success', `Success ${count('success')}`], ['error', `Errors ${count('error')}`]].map(([k, l]) => (
            <button key={k} className={level === k ? 'on' : ''} onClick={() => setLevel(k)}>{l}</button>
          ))}
        </div>
        <div className="spacer" />
        <input className="act-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search logs…" aria-label="Search logs" />
      </div>
      <div className="act-list">
        {shown.slice(0, 400).map((r, i) => (
          <div key={i} className="log-row">
            <span className="muted small mono nowrap">{clock(r.at)}</span>
            <button className="wf-chip btn-chip act-node" onClick={() => onSelect(r.node)} title={r.label}><NodeIcon type={r.type} size={11} />{r.node}</button>
            <span className={`badge ${levelCls[r.level] || 'b-info'}`}>{r.level}</span>
            <span className="small wf-msg">{r.msg}</span>
          </div>
        ))}
        {!shown.length && <div className="empty">{rows.length ? 'No log lines match.' : 'No activity yet.'}</div>}
        {shown.length > 400 && <div className="muted small" style={{ padding: 12 }}>Showing the newest 400 of {shown.length}.</div>}
      </div>
    </div>
  );
}
