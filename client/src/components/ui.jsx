import React from 'react';

export const fmtDate = (t) => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const fmtDur = (s) => {
  if (!s || s < 1) return '< 1 min';
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};
export const pctClass = (p) => (p >= 70 ? 'ok' : p >= 40 ? 'warn' : 'bad');

export function Stat({ label, value, sub }) {
  return (
    <div className="card stat">
      <div className="l">{label}</div>
      <div className="v">{value}</div>
      {sub && <div className="muted small">{sub}</div>}
    </div>
  );
}

const STATUS = {
  processing: ['Processing', 'b-info'], completed: ['Completed', 'b-ok'], failed: ['Failed', 'b-bad'], stopped: ['Stopped', 'b-gray'],
  graded: ['Graded', 'b-ok'], needs_review: ['Needs review', 'b-warn'], error: ['Error', 'b-bad'],
  auto: ['Auto-graded', 'b-ok'], reevaluated: ['Re-evaluated', 'b-info'], review: ['Needs review', 'b-warn'], teacher_reviewed: ['Teacher reviewed', 'b-brand'], unattempted: ['Not attempted', 'b-gray'],
};
export function Status({ s }) {
  const [t, c] = STATUS[s] || [s, 'b-gray'];
  return <span className={`badge ${c}`}>{t}</span>;
}

export function Bar({ value, cls }) {
  const v = Math.max(0, Math.min(100, value || 0));
  return <div className={`bar ${cls ?? pctClass(v)}`}><i style={{ width: `${v}%` }} /></div>;
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs">
      {tabs.map(([k, label]) => <button key={k} className={`tab ${value === k ? 'active' : ''}`} onClick={() => onChange(k)}>{label}</button>)}
    </div>
  );
}

export function Modal({ title, onClose, children }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex" style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)' }}>
          <strong style={{ flex: 1 }}>{title}</strong>
          <button className="btn sm" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}
