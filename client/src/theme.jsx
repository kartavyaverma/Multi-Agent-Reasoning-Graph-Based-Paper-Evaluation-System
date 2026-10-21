import React, { createContext, useContext, useEffect, useRef, useState } from 'react';

/**
 * Themes: two glass themes (translucent, blurred surfaces over a soft gradient) and two solid ones.
 * Accent colours tint focus, selection, progress and charts; buttons and chrome stay monochrome.
 * Choices are stored per browser.
 */
export const THEMES = [
  { id: 'midnight', label: 'Midnight', note: 'Dark glass', mode: 'dark', glass: true, swatch: ['#0a0a0c', '#1c1c22', '#fafafa'] },
  { id: 'graphite', label: 'Graphite', note: 'Dark solid', mode: 'dark', glass: false, swatch: ['#0e0e10', '#18181b', '#e4e4e7'] },
  { id: 'frost', label: 'Frost', note: 'Light glass', mode: 'light', glass: true, swatch: ['#e9ebf0', '#ffffff', '#0a0a0a'] },
  { id: 'paper', label: 'Paper', note: 'Light solid', mode: 'light', glass: false, swatch: ['#f6f5f2', '#ffffff', '#1c1917'] },
];

export const ACCENTS = {
  mono: { label: 'Mono', dark: '#e4e4e7', light: '#18181b' },
  indigo: { label: 'Indigo', dark: '#a5b4fc', light: '#4f46e5' },
  emerald: { label: 'Emerald', dark: '#6ee7b7', light: '#047857' },
  amber: { label: 'Amber', dark: '#fcd34d', light: '#b45309' },
  rose: { label: 'Rose', dark: '#fda4af', light: '#be123c' },
};

const STATUS = {
  dark: { ok: '#4ade80', warn: '#fbbf24', bad: '#f87171', muted: '#71717a', grid: 'rgba(255,255,255,0.08)' },
  light: { ok: '#15803d', warn: '#b45309', bad: '#dc2626', muted: '#a1a1aa', grid: 'rgba(0,0,0,0.08)' },
};

const KEY = 'papercheck_look';
const read = () => {
  try { return { theme: 'midnight', accent: 'indigo', ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { theme: 'midnight', accent: 'indigo' }; }
};

function apply({ theme, accent }) {
  const t = THEMES.find((x) => x.id === theme) || THEMES[0];
  const a = ACCENTS[accent] || ACCENTS.indigo;
  const root = document.documentElement;
  root.dataset.theme = t.id;
  root.dataset.mode = t.mode;
  root.dataset.glass = t.glass ? 'on' : 'off';
  root.style.setProperty('--accent', a[t.mode]);
  root.style.setProperty('--accent-ink', t.mode === 'dark' ? '#09090b' : '#ffffff');
  return { t, a };
}
apply(read()); // before first paint

const Ctx = createContext(null);

export function ThemeProvider({ children }) {
  const [look, setLook] = useState(read);
  useEffect(() => {
    apply(look);
    try { localStorage.setItem(KEY, JSON.stringify(look)); } catch { /* ignore */ }
  }, [look]);
  const t = THEMES.find((x) => x.id === look.theme) || THEMES[0];
  const accent = (ACCENTS[look.accent] || ACCENTS.indigo)[t.mode];
  const colors = { accent, ...STATUS[t.mode], ink: t.mode === 'dark' ? '#fafafa' : '#09090b' };
  return <Ctx.Provider value={{ ...look, mode: t.mode, colors, set: (patch) => setLook((l) => ({ ...l, ...patch })) }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);

/** Theme + accent picker in a small popover. */
export function ThemeMenu({ compact, up }) {
  const th = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc); };
  }, [open]);
  const cur = THEMES.find((x) => x.id === th.theme) || THEMES[0];
  return (
    <div className="theme-menu" ref={ref}>
      <button type="button" className={`btn ghost sm theme-btn ${compact ? 'icon-btn' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Appearance" title="Appearance">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="13.5" cy="6.5" r="1.5" /><circle cx="17.5" cy="10.5" r="1.5" /><circle cx="8.5" cy="7.5" r="1.5" /><circle cx="6.5" cy="12.5" r="1.5" />
          <path d="M12 2a10 10 0 1 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A5.6 5.6 0 0 0 22 9.8C22 5.5 17.5 2 12 2z" />
        </svg>
        {!compact && <span>{cur.label}</span>}
      </button>
      {open && (
        <div className={`theme-pop ${up ? 'up' : ''}`} role="dialog" aria-label="Appearance">
          <div className="eyebrow">Theme</div>
          <div className="theme-grid">
            {THEMES.map((t) => (
              <button key={t.id} type="button" className={`theme-card ${th.theme === t.id ? 'on' : ''}`} onClick={() => th.set({ theme: t.id })}>
                <span className="theme-swatch" style={{ background: t.swatch[0] }}>
                  <i style={{ background: t.swatch[1], borderColor: t.mode === 'dark' ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.08)' }} />
                  <b style={{ background: t.swatch[2] }} />
                  {t.glass && <em />}
                </span>
                <span className="theme-name">{t.label}</span>
                <span className="theme-note">{t.note}</span>
              </button>
            ))}
          </div>
          <div className="eyebrow" style={{ marginTop: 14 }}>Accent</div>
          <div className="accent-row">
            {Object.entries(ACCENTS).map(([id, a]) => (
              <button key={id} type="button" className={`accent-dot ${th.accent === id ? 'on' : ''}`} style={{ '--dot': a[th.mode] }} onClick={() => th.set({ accent: id })} title={a.label} aria-label={`${a.label} accent`} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
