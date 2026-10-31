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

export function Switch({ checked, onChange, disabled, label, title }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} title={title} disabled={disabled}
      className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}><i /></button>
  );
}

/** Small confirmation dialog. opts: { title, body, confirm, danger, onConfirm } */
export function ConfirmDialog({ opts, onClose }) {
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  if (!opts) return null;
  const go = async () => {
    setBusy(true);
    try { await opts.onConfirm(); onClose(); } finally { setBusy(false); }
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="dialog" role="alertdialog" aria-label={opts.title} onClick={(e) => e.stopPropagation()}>
        <h2>{opts.title}</h2>
        <div className="muted">{opts.body}</div>
        <div className="flex" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className={`btn ${opts.danger ? 'danger-fill' : 'primary'}`} onClick={go} disabled={busy} autoFocus>{busy ? 'Working…' : opts.confirm || 'Confirm'}</button>
        </div>
      </div>
    </div>
  );
}

export function Toast({ toast }) {
  if (!toast) return null;
  return <div className={`toast t-${toast.kind || 'ok'}`} role="status">{toast.msg}</div>;
}

/* ───────────── academic terms ───────────── */
/** Academic year that is running now, e.g. "2026-27" (years start in June). */
export function currentAcademicYear(d = new Date()) {
  const y = d.getMonth() >= 5 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}
export const yearOptions = (extra = []) => {
  const y0 = Number(currentAcademicYear().slice(0, 4));
  const list = [1, 0, -1, -2, -3].map((d) => `${y0 + d}-${String((y0 + d + 1) % 100).padStart(2, '0')}`);
  return [...new Set([...list, ...extra.filter(Boolean)])].sort().reverse();
};
export const SEMESTERS = [1, 2, 3, 4, 5, 6, 7, 8];
export const fmtTerm = (year, sem) => [year, sem ? `Sem ${sem}` : null].filter(Boolean).join(' · ') || 'No term';

export function TermBadge({ year, sem }) {
  if (!year && !sem) return <span className="term none">No term</span>;
  return <span className="term">{year && <b>{year}</b>}{sem ? <span>Sem {sem}</span> : null}</span>;
}

/** Tiny trend line for a list of percentages. */
export function Sparkline({ values = [], width = 72, height = 22 }) {
  if (values.length < 2) return <span className="muted small">-</span>;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (width - 4) + 2, height - 2 - (Math.max(0, Math.min(100, v)) / 100) * (height - 4)]);
  const d = values[values.length - 1] - values[0];
  return (
    <svg width={width} height={height} className={`spark ${d > 0 ? 'up' : d < 0 ? 'down' : ''}`} aria-label={`Trend ${values.join(', ')}%`}>
      <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.4" />
    </svg>
  );
}

export function Delta({ v }) {
  if (v == null) return null;
  return <span className={`delta ${v > 0 ? 'up' : v < 0 ? 'down' : ''}`}>{v > 0 ? '▲' : v < 0 ? '▼' : '•'} {Math.abs(v)}%</span>;
}
