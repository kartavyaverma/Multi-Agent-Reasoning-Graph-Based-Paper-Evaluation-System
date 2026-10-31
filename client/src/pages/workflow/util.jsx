import React from 'react';

export const dur = (ms) => {
  if (ms == null || ms < 0) return '-';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
};
export const clock = (t) => (t ? new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-');
export const stamp = (t) => (t ? new Date(t).toLocaleString(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-');
export const tryOf = (n) => Math.max(1, n.try_count + (['completed', 'failed'].includes(n.status) ? 0 : 1));

/** Display state of a node, derived from engine status + workflow status. */
export function stateOf(n, wf, now) {
  const failedBatches = n.batches.filter((b) => b.failed).length;
  if (n.status === 'completed') {
    if (n.skipped) return { k: 'skipped', t: 'Skipped' };
    return failedBatches ? { k: 'partial', t: `Completed · ${failedBatches} failed` } : { k: 'completed', t: 'Completed' };
  }
  if (n.status === 'failed') return { k: 'failed', t: 'Failed' };
  if (!n.enabled) return { k: 'skipped', t: 'Off · will be skipped' };
  if (wf.status !== 'running' && (n.status === 'pending' || (n.status === 'ready' && n.started_at))) return { k: 'paused', t: 'Paused' };
  if (n.status === 'pending') return { k: 'running', t: 'Running' };
  if (n.status === 'ready') {
    if (n.try_count > 0 && n.try_at > now) return { k: 'retry', t: `Retry in ${dur(n.try_at - now)}` };
    return { k: 'queued', t: 'Queued' };
  }
  return { k: 'waiting', t: 'Waiting' };
}

export const LEGEND = [['completed', 'Completed'], ['running', 'Running'], ['queued', 'Queued'], ['retry', 'Retrying'], ['waiting', 'Waiting'], ['paused', 'Paused'], ['skipped', 'Skipped'], ['failed', 'Failed']];

/** Node category from its type: drives the icon and accent colour. */
export function catOf(type) {
  if (type === 'paper.ingest') return 'ingest';
  return type.split('.')[0];
}

const ICONS = {
  ingest: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5" /><path d="M12 3v12" /></>,
  paper: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></>,
  student: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>,
  graph: <><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="12" cy="18" r="2.5" /><path d="M8 7.5l3 8M16 7.5l-3 8M8.5 6h7" /></>,
  agent: <><rect x="4" y="8" width="16" height="12" rx="3" /><path d="M12 8V4M9 13v1M15 13v1M9 17h6" /></>,
  route: <><circle cx="6" cy="18" r="2.5" /><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="8" r="2.5" /><path d="M6 8.5v7M18 10.5a8 8 0 0 1-9.5 7" /></>,
  grade: <><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></>,
  learn: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>,
  publish: <><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4z" /></>,
};

export function NodeIcon({ type, size = 16 }) {
  const c = catOf(type);
  return (
    <span className={`wf-ico c-${c}`} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{ICONS[c] || ICONS.paper}</svg>
    </span>
  );
}

/** Small inline icons used in toolbars. */
const TOOL = {
  fit: <path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />,
  down: <><rect x="8" y="3" width="8" height="5" rx="1" /><rect x="8" y="16" width="8" height="5" rx="1" /><path d="M12 8v8" /></>,
  right: <><rect x="3" y="8" width="5" height="8" rx="1" /><rect x="16" y="8" width="5" height="8" rx="1" /><path d="M8 12h8" /></>,
  reset: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></>,
  map: <><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z" /><path d="M9 4v14M15 6v14" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>,
  play: <path d="M6 4l14 8-14 8z" />,
  pause: <path d="M7 4h3v16H7zM14 4h3v16h-3z" />,
  rerun: <><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></>,
  skip: <path d="M5 4l10 8-10 8zM19 5v14" />,
  refresh: <><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" /><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" /><path d="M21 3v5h-5M3 21v-5h5" /></>,
};

export function Ico({ name, size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none' }}>{TOOL[name]}</svg>
  );
}

/** Persisted canvas preferences (per browser). Storage can be unavailable, so every access is guarded. */
export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};
