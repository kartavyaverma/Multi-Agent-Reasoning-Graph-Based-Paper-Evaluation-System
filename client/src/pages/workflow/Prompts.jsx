import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import { Switch } from '../../components/ui.jsx';
import { NodeIcon } from './util.jsx';

/* Built-in suggestions; the teacher's own snippets live in their prompt library. */
const SUGGESTIONS = [
  { title: 'Spelling', text: 'Be lenient with spelling and grammar; judge the content.' },
  { title: 'Language', text: 'Students may answer in Hindi or English; grade both the same way.' },
  { title: 'Method marks', text: 'Give partial credit for a correct method even if the final answer is wrong.' },
  { title: 'Board conventions', text: 'Follow CBSE / university marking scheme conventions.' },
  { title: 'Units', text: 'Penalise missing or wrong units in numerical answers.' },
  { title: 'Strictness', text: 'Be strict: award marks only for points that are clearly and correctly stated.' },
];

const uid = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Server prompt entry -> editor value. A legacy single "extra" note becomes the first added prompt. */
export function toDraft(p) {
  const blocks = (p.blocks || []).map((b) => ({ id: b.id || uid(), title: b.title || '', text: b.text || '', enabled: b.enabled !== false }));
  if (p.extra?.trim()) blocks.unshift({ id: 'extra', title: 'Extra instructions', text: p.extra.trim(), enabled: true });
  return { text: p.text || '', extra: '', blocks };
}

/* ───────── prompt library (shared across tests and steps) ───────── */
let libCache = null;
const libSubs = new Set();
const publish = (items) => { libCache = items; libSubs.forEach((f) => f(items)); };
export function useLibrary() {
  const [items, setItems] = useState(libCache || []);
  useEffect(() => {
    libSubs.add(setItems);
    if (!libCache) api.get('/prompt-library').then((d) => publish(d.items)).catch(() => {});
    return () => libSubs.delete(setItems);
  }, []);
  const save = async (next) => publish((await api.put('/prompt-library', { items: next })).items);
  return {
    items,
    add: (it) => save([...(libCache || []), { id: `l${Date.now().toString(36)}`, title: it.title, text: it.text }]),
    remove: (id) => save((libCache || []).filter((x) => x.id !== id)),
  };
}

function InsertMenu({ onPick, lib }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  const pick = (x) => { onPick(x); setOpen(false); };
  return (
    <div className="insert-menu" ref={ref}>
      <button type="button" className="btn sm" onClick={() => setOpen(!open)} aria-expanded={open}>Insert from library ▾</button>
      {open && (
        <div className="insert-pop">
          <div className="eyebrow">Your library</div>
          {!lib.items.length && <div className="muted small" style={{ padding: '4px 2px 8px' }}>Empty. Use ☆ on an added prompt to save it here.</div>}
          {lib.items.map((x) => (
            <div key={x.id} className="insert-item">
              <button type="button" onClick={() => pick(x)}><b>{x.title || 'Untitled'}</b><span>{x.text}</span></button>
              <button type="button" className="x" onClick={() => lib.remove(x.id)} title="Remove from library" aria-label="Remove from library">×</button>
            </div>
          ))}
          <div className="eyebrow" style={{ marginTop: 8 }}>Suggestions</div>
          {SUGGESTIONS.map((x) => (
            <div key={x.title} className="insert-item"><button type="button" onClick={() => pick(x)}><b>{x.title}</b><span>{x.text}</span></button></div>
          ))}
        </div>
      )}
    </div>
  );
}

function Block({ b, i, n, onChange, onMove, onRemove, onSave }) {
  return (
    <div className={`pblock ${b.enabled ? '' : 'off'}`}>
      <div className="pblock-head">
        <Switch checked={b.enabled} label="Use this prompt" onChange={(v) => onChange({ ...b, enabled: v })} />
        <span className="pblock-n">{String(i + 1).padStart(2, '0')}</span>
        <input className="pblock-title" placeholder="Title (optional)" value={b.title} onChange={(e) => onChange({ ...b, title: e.target.value })} aria-label="Prompt title" />
        <button type="button" className="btn ghost sm icon-btn" onClick={() => onMove(-1)} disabled={i === 0} title="Move up" aria-label="Move up">↑</button>
        <button type="button" className="btn ghost sm icon-btn" onClick={() => onMove(1)} disabled={i === n - 1} title="Move down" aria-label="Move down">↓</button>
        <button type="button" className="btn ghost sm icon-btn" onClick={onSave} disabled={!b.text.trim()} title="Save to my library" aria-label="Save to library">☆</button>
        <button type="button" className="btn ghost sm icon-btn danger" onClick={onRemove} title="Delete" aria-label="Delete prompt">×</button>
      </div>
      <textarea rows={3} placeholder="Write an instruction for this step, e.g. “Accept answers that use SI or CGS units.”" value={b.text} onChange={(e) => onChange({ ...b, text: e.target.value })} aria-label="Prompt text" />
    </div>
  );
}

/** What the model receives, mirroring buildPrompt() on the server. */
const assemble = (p, v) => {
  const added = v.blocks.filter((b) => b.enabled && b.text.trim()).map((b) => (b.title.trim() ? `${b.title.trim()}:\n${b.text.trim()}` : b.text.trim()));
  return [v.text.trim() || p.default, added.length && `ADDITIONAL INSTRUCTIONS FROM THE TEACHER (follow them; where they conflict with the guidance above they take priority, but never change the required JSON output format):\n${added.join('\n\n')}`, '[ The questions, the student\'s answers and the required JSON output format are appended here automatically ]'].filter(Boolean).join('\n\n');
};

/** Editor for one AI prompt. value = { text, extra, blocks }. */
export function PromptCard({ p, type, value, onChange, defaultOpen = false, done, notify }) {
  const [open, setOpen] = useState(defaultOpen);
  const [view, setView] = useState(value.blocks.length ? 'added' : 'base');
  const lib = useLibrary();
  const edited = !!value.text.trim() && value.text.trim() !== p.default.trim();
  const active = value.blocks.filter((b) => b.enabled && b.text.trim()).length;
  const setBlocks = (blocks) => onChange({ ...value, blocks });
  const add = (x = {}) => { setBlocks([...value.blocks, { id: uid(), title: x.title || '', text: x.text || '', enabled: true }]); setView('added'); };
  const move = (i, d) => { const bs = [...value.blocks]; [bs[i], bs[i + d]] = [bs[i + d], bs[i]]; setBlocks(bs); };
  return (
    <div className={`prompt-card ${open ? 'open' : ''}`}>
      <button type="button" className="prompt-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <NodeIcon type={type} size={14} />
        <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <b className="ell" style={{ display: 'block' }}>{p.label}</b>
          <span className="muted small mono">{p.node}{done ? ' · already ran' : ''}</span>
        </div>
        {edited && <span className="badge b-brand">edited</span>}
        {active > 0 && <span className="badge b-info">+{active} added</span>}
        <span className="chev" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="prompt-body">
          <div className="seg sm prompt-seg" role="tablist">
            <button type="button" className={view === 'base' ? 'on' : ''} onClick={() => setView('base')}>Base prompt{edited ? ' •' : ''}</button>
            <button type="button" className={view === 'added' ? 'on' : ''} onClick={() => setView('added')}>Added prompts{value.blocks.length ? ` (${value.blocks.length})` : ''}</button>
            <button type="button" className={view === 'preview' ? 'on' : ''} onClick={() => setView('preview')}>Preview</button>
          </div>

          {view === 'base' && (
            <>
              <div className="flex" style={{ marginBottom: 6 }}>
                <span className="muted small" style={{ flex: 1 }}>{edited ? 'Your edited prompt for this step.' : 'The default prompt. Edit it directly to change how this step works.'}</span>
                {edited && <button type="button" className="linkbtn small" onClick={() => onChange({ ...value, text: '' })}>Reset to default</button>}
              </div>
              <textarea className="mono prompt-text" rows={14} value={value.text || p.default} onChange={(e) => onChange({ ...value, text: e.target.value })} spellCheck={false} aria-label={`${p.label} prompt`} />
              <div className="hint">The data and the required output format are added after this text automatically, so editing it cannot break grading.</div>
            </>
          )}

          {view === 'added' && (
            <>
              <div className="muted small" style={{ marginBottom: 10 }}>Your own prompts, sent after the base prompt in this order. Switch one off to keep it without using it.</div>
              {!value.blocks.length && <div className="pblock-empty">No added prompts yet.</div>}
              {value.blocks.map((b, i) => (
                <Block key={b.id} b={b} i={i} n={value.blocks.length}
                  onChange={(nb) => setBlocks(value.blocks.map((x) => (x.id === b.id ? nb : x)))}
                  onMove={(d) => move(i, d)} onRemove={() => setBlocks(value.blocks.filter((x) => x.id !== b.id))}
                  onSave={async () => { await lib.add(b); notify?.('Saved to your prompt library'); }} />
              ))}
              <div className="flex" style={{ marginTop: 8 }}>
                <button type="button" className="btn sm primary" onClick={() => add()}>+ Add prompt</button>
                <InsertMenu lib={lib} onPick={add} />
              </div>
            </>
          )}

          {view === 'preview' && (
            <>
              <div className="muted small" style={{ marginBottom: 6 }}>Exactly what this step sends to the model (before the data).</div>
              <pre className="box mono prompt-preview">{assemble(p, value)}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Every step in order: AI steps get prompt editors, the rest are listed as running without the AI. */
export function PromptList({ nodes, prompts, draft, onChange, notify }) {
  return (
    <div>
      <div className="note small">Every AI step sends the model a prompt. Edit the <b>base prompt</b>, or <b>add your own prompts</b> on top of it. Saved per test; "Save as my default" uses them for new tests too.</div>
      {nodes.map((n) => {
        const ps = prompts.filter((p) => p.node === n.name);
        if (!ps.length) return <div key={n.name} className="prompt-none"><NodeIcon type={n.type} size={12} /><span>{n.label}</span><span className="muted small">no AI prompt</span></div>;
        return ps.map((p) => <PromptCard key={p.id} p={p} type={n.type} value={draft[p.id]} done={n.status === 'completed'} notify={notify} onChange={(v) => onChange({ ...draft, [p.id]: v })} />);
      })}
    </div>
  );
}

/** Prompt editors for one step, used in the step inspector. Loads and saves on its own. */
export function NodePrompts({ testId, node, onChanged, notify }) {
  const [list, setList] = useState(null);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const take = (s) => {
    const mine = s.prompts.filter((p) => p.node === node.name);
    setList(mine);
    setDraft(Object.fromEntries(mine.map((p) => [p.id, toDraft(p)])));
  };
  useEffect(() => { api.get(`/tests/${testId}/workflow/settings`).then(take).catch((e) => setErr(e.message)); }, [testId, node.name]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <div className="err">{err}</div>;
  if (!list) return null;
  if (!list.length) return <div className="empty">This step runs without the AI, so it has no prompt.</div>;
  const initial = Object.fromEntries(list.map((p) => [p.id, toDraft(p)]));
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const save = async () => {
    setBusy(true); setErr('');
    try {
      take(await api.put(`/tests/${testId}/workflow/settings`, { prompts: draft }));
      notify(node.status === 'completed' ? 'Prompt saved. Re-run this step to apply it.' : 'Prompt saved');
      onChanged();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div>
      {list.map((p) => <PromptCard key={p.id} p={p} type={node.type} value={draft[p.id]} defaultOpen={list.length === 1} notify={notify} onChange={(v) => setDraft({ ...draft, [p.id]: v })} />)}
      <div className="flex prompt-save">
        <span className="muted small" style={{ flex: 1 }}>{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
        {dirty && <button className="btn sm ghost" onClick={() => setDraft(initial)}>Undo</button>}
        <button className="btn sm primary" onClick={save} disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save prompt'}</button>
      </div>
    </div>
  );
}
