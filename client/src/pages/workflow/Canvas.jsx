import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Bar } from '../../components/ui.jsx';
import { stateOf, dur, tryOf, NodeIcon, Ico, store, LEGEND } from './util.jsx';

export const NW = 240, NH = 104;
const GAP = { TB: { cross: 36, deep: 76 }, LR: { cross: 26, deep: 90 } };
const SNAP = 8, MIN_K = 0.25, MAX_K = 1.75;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const snap = (v) => Math.round(v / SNAP) * SNAP;

/** Layered DAG layout: level = longest path from a root; order inside a level by the parents' position. */
function autoLayout(nodes, dir) {
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
  const tb = dir === 'TB';
  const size = tb ? NW : NH, deep = tb ? NH : NW, g = GAP[dir];
  const widest = Math.max(...rows.map((r) => r.length));
  const span = widest * size + (widest - 1) * g.cross;
  const cross = {}, pos = {};
  rows.forEach((row, r) => {
    if (r > 0) {
      const bary = (name) => {
        const xs = byName[name].depends_on.filter((d) => cross[d] != null).map((d) => cross[d]);
        return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
      };
      row.sort((a, b) => bary(a) - bary(b));
    }
    const c0 = (span - (row.length * size + (row.length - 1) * g.cross)) / 2;
    row.forEach((name, i) => {
      cross[name] = c0 + i * (size + g.cross);
      const d = r * (deep + g.deep);
      pos[name] = tb ? { x: cross[name], y: d } : { x: d, y: cross[name] };
    });
  });
  return pos;
}

function edgePath(a, b, dir, so, to) {
  if (dir === 'TB') {
    const sx = a.x + NW / 2 + so, sy = a.y + NH, tx = b.x + NW / 2 + to, ty = b.y - 2;
    const d = Math.max(36, Math.abs(ty - sy) / 2);
    return `M${sx},${sy} C${sx},${sy + d} ${tx},${ty - d} ${tx},${ty}`;
  }
  const sx = a.x + NW, sy = a.y + NH / 2 + so, tx = b.x - 2, ty = b.y + NH / 2 + to;
  const d = Math.max(44, Math.abs(tx - sx) / 2);
  return `M${sx},${sy} C${sx + d},${sy} ${tx - d},${ty} ${tx},${ty}`;
}

function MiniMap({ nodes, pos, states, bounds, view, size, onJump }) {
  const MW = 188, MH = 124, P = 8;
  const bw = bounds.maxX - bounds.minX, bh = bounds.maxY - bounds.minY;
  const s = Math.min((MW - 2 * P) / bw, (MH - 2 * P) / bh);
  const ox = P + (MW - 2 * P - bw * s) / 2 - bounds.minX * s, oy = P + (MH - 2 * P - bh * s) / 2 - bounds.minY * s;
  const down = useRef(false);
  const jump = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    onJump((e.clientX - r.left - ox) / s, (e.clientY - r.top - oy) / s);
  };
  const vx = (-view.x / view.k) * s + ox, vy = (-view.y / view.k) * s + oy;
  return (
    <svg className="wf-minimap" width={MW} height={MH} role="img" aria-label="Minimap: click or drag to move the view"
      onPointerDown={(e) => { e.stopPropagation(); down.current = true; e.currentTarget.setPointerCapture(e.pointerId); jump(e); }}
      onPointerMove={(e) => down.current && jump(e)} onPointerUp={() => (down.current = false)}>
      {nodes.map((n) => <rect key={n.name} x={pos[n.name].x * s + ox} y={pos[n.name].y * s + oy} width={NW * s} height={NH * s} rx={2} className={`mm-node s-${states[n.name].k}`} />)}
      <rect x={vx} y={vy} width={(size.w / view.k) * s} height={(size.h / view.k) * s} className="mm-view" rx={3} />
    </svg>
  );
}

export default function Canvas({ data, now, selected, onSelect }) {
  const { nodes, workflow } = data;
  const vp = useRef(null);
  const [dir, setDir] = useState(() => store.get('wf-dir', 'TB'));
  const layoutKey = `wf-layout:${workflow.template_id}`;
  const [over, setOver] = useState(() => store.get(layoutKey, {}));
  const [drag, setDrag] = useState(null); // { name, x, y } while a node is being dragged
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [hover, setHover] = useState(null);
  const [query, setQuery] = useState('');
  const [mini, setMini] = useState(() => store.get('wf-minimap', true));
  const [grabbing, setGrabbing] = useState(false);
  const act = useRef(null); // current pointer gesture: { kind: 'pan' | 'node', ... }
  const touched = useRef(false); // user moved the view: stop auto-fitting on resize

  const sig = nodes.map((n) => n.name + n.depends_on.join()).join('|');
  const auto = useMemo(() => autoLayout(nodes, dir), [sig, dir]); // eslint-disable-line react-hooks/exhaustive-deps
  const custom = over[dir] || {};
  const pos = useMemo(() => {
    const p = {};
    for (const n of nodes) p[n.name] = custom[n.name] || auto[n.name];
    if (drag) p[drag.name] = { x: drag.x, y: drag.y };
    return p;
  }, [auto, custom, drag, sig]); // eslint-disable-line react-hooks/exhaustive-deps

  const bounds = useMemo(() => {
    const xs = Object.values(pos);
    return { minX: Math.min(...xs.map((p) => p.x)), minY: Math.min(...xs.map((p) => p.y)), maxX: Math.max(...xs.map((p) => p.x + NW)), maxY: Math.max(...xs.map((p) => p.y + NH)) };
  }, [pos]);

  // 'all' shows the whole graph; 'auto' (first view) fits across the flow at a readable zoom and starts at the first step
  const fit = useCallback((mode = 'all') => {
    const el = vp.current;
    if (!el) return;
    const W = el.clientWidth, H = el.clientHeight, P = 48;
    const bw = bounds.maxX - bounds.minX, bh = bounds.maxY - bounds.minY;
    const kAll = Math.min((W - 2 * P) / bw, (H - 2 * P) / bh);
    const kCross = dir === 'TB' ? (W - 2 * P) / bw : (H - 2 * P) / bh;
    const k = mode === 'auto' && kAll < 0.6 ? clamp(kCross, 0.55, 1) : clamp(kAll, MIN_K, 1.1);
    const cx = (W - bw * k) / 2 - bounds.minX * k, cy = (H - bh * k) / 2 - bounds.minY * k;
    const startX = P / 2 - bounds.minX * k, startY = P / 2 - bounds.minY * k;
    setView({ k, x: dir === 'LR' && bw * k > W ? startX : cx, y: dir === 'TB' && bh * k > H ? startY : Math.max(startY, cy) });
  }, [bounds, dir]);
  const fitRef = useRef(fit);
  fitRef.current = fit;

  useLayoutEffect(() => { touched.current = false; fitRef.current('auto'); }, [dir, sig]);
  useLayoutEffect(() => {
    const el = vp.current;
    const ro = new ResizeObserver(([e]) => {
      setSize({ w: e.contentRect.width, h: e.contentRect.height });
      if (!touched.current) fitRef.current('auto');
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const zoomAt = (px, py, factor) => setView((v) => {
    const k = clamp(v.k * factor, MIN_K, MAX_K);
    touched.current = true;
    return { k, x: px - (px - v.x) * (k / v.k), y: py - (py - v.y) * (k / v.k) };
  });
  const zoomCenter = (f) => zoomAt(size.w / 2, size.h / 2, f);
  const centerOn = useCallback((wx, wy) => setView((v) => { touched.current = true; return { ...v, x: size.w / 2 - wx * v.k, y: size.h / 2 - wy * v.k }; }), [size]);

  // wheel: scroll pans, ctrl/cmd + scroll (and trackpad pinch) zooms around the cursor
  useEffect(() => {
    const el = vp.current;
    const onWheel = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.004));
      else { touched.current = true; setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY })); }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // bring the selected node into view when it is chosen from outside the canvas
  useEffect(() => {
    const p = selected && pos[selected];
    if (!p) return;
    const sx = p.x * view.k + view.x, sy = p.y * view.k + view.y;
    if (sx < 0 || sy < 0 || sx + NW * view.k > size.w || sy + NH * view.k > size.h) centerOn(p.x + NW / 2, p.y + NH / 2);
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveOver = (next) => { setOver(next); store.set(layoutKey, Object.keys(next).length ? next : null); };
  const changeDir = (d) => { setDir(d); store.set('wf-dir', d); };
  const resetLayout = () => { const { [dir]: _, ...rest } = over; saveOver(rest); touched.current = false; requestAnimationFrame(() => fitRef.current('auto')); };
  const toggleMini = () => { setMini(!mini); store.set('wf-minimap', !mini); };

  const onPointerDown = (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    const nodeEl = e.target.closest('[data-node]');
    if (nodeEl && e.button === 0) {
      const name = nodeEl.dataset.node;
      act.current = { kind: 'node', name, tab: e.target.closest('[data-prompt]') ? 'prompt' : null, sx: e.clientX, sy: e.clientY, ox: pos[name].x, oy: pos[name].y, moved: false };
    } else {
      act.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    const a = act.current;
    if (!a) return;
    const dx = e.clientX - a.sx, dy = e.clientY - a.sy;
    if (!a.moved && Math.hypot(dx, dy) < 4) return;
    if (!a.moved) setGrabbing(true);
    a.moved = true;
    if (a.kind === 'pan') { touched.current = true; setView((v) => ({ ...v, x: a.vx + dx, y: a.vy + dy })); }
    else setDrag({ name: a.name, x: snap(a.ox + dx / view.k), y: snap(a.oy + dy / view.k) });
  };
  const onPointerUp = () => {
    const a = act.current;
    act.current = null;
    setGrabbing(false);
    if (!a) return;
    if (a.kind === 'node') {
      if (a.moved && drag) { saveOver({ ...over, [dir]: { ...custom, [drag.name]: { x: drag.x, y: drag.y } } }); setHover(null); }
      else if (!a.moved) onSelect(a.name, a.tab);
      setDrag(null);
    } else if (!a.moved && selected) onSelect(null);
  };

  // edges + fan-in / fan-out spreading so parallel lines don't sit on top of each other
  const byName = Object.fromEntries(nodes.map((n) => [n.name, n]));
  const states = Object.fromEntries(nodes.map((n) => [n.name, stateOf(n, workflow, now)]));
  const edges = nodes.flatMap((n) => n.depends_on.filter((d) => byName[d]).map((d) => ({ from: d, to: n.name })));
  const cross = (name) => (dir === 'TB' ? pos[name].x : pos[name].y);
  const ek = (e) => `${e.from}>${e.to}`;
  const off = {};
  const spread = (key, list, other) => {
    const groups = {};
    list.forEach((e) => (groups[e[key]] ||= []).push(e));
    Object.values(groups).forEach((g) => g.sort((a, b) => cross(a[other]) - cross(b[other])).forEach((e, i) => ((off[ek(e)] ||= {})[key] = (i - (g.length - 1) / 2) * 12)));
  };
  spread('from', edges, 'to');
  spread('to', edges, 'from');

  const focus = hover || selected;
  const q = query.trim().toLowerCase();
  const matches = q ? nodes.filter((n) => `${n.name} ${n.label} ${n.type}`.toLowerCase().includes(q)).map((n) => n.name) : null;
  const findNext = () => { if (matches?.length) { const p = pos[matches[0]]; centerOn(p.x + NW / 2, p.y + NH / 2); } };
  const customised = Object.keys(custom).length > 0;

  return (
    <div className="wf-board">
      <div className="wf-toolbar">
        <label className="wf-search">
          <Ico name="search" size={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && findNext()} placeholder="Find a step…" aria-label="Find a step" />
          {matches && <span className="muted small nowrap">{matches.length} found</span>}
        </label>
        <div className="seg sm" role="group" aria-label="Layout direction">
          <button className={dir === 'TB' ? 'on' : ''} onClick={() => changeDir('TB')} title="Top to bottom"><Ico name="down" /> Vertical</button>
          <button className={dir === 'LR' ? 'on' : ''} onClick={() => changeDir('LR')} title="Left to right"><Ico name="right" /> Horizontal</button>
        </div>
        <div className="spacer" />
        {customised && <button className="btn sm ghost" onClick={resetLayout} title="Put every step back in its automatic position"><Ico name="reset" /> Auto-arrange</button>}
        <button className={`btn sm ghost ${mini ? 'on' : ''}`} onClick={toggleMini} aria-pressed={mini} title="Minimap"><Ico name="map" /></button>
        <div className="wf-zoomgrp">
          <button className="btn sm ghost" onClick={() => zoomCenter(1 / 1.2)} aria-label="Zoom out">−</button>
          <button className="btn sm ghost mono" onClick={() => zoomCenter(1 / view.k)} title="Reset to 100%">{Math.round(view.k * 100)}%</button>
          <button className="btn sm ghost" onClick={() => zoomCenter(1.2)} aria-label="Zoom in">+</button>
        </div>
        <button className="btn sm ghost" onClick={() => { touched.current = false; fit(); }} title="Fit to screen"><Ico name="fit" /> Fit</button>
      </div>

      <div ref={vp} className={`wf-viewport ${grabbing ? 'grabbing' : ''}`}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${20 * view.k}px ${20 * view.k}px` }}>
        <div className={`wf-world dir-${dir}`} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
          <svg className="wf-edges" width="1" height="1">
            <defs>
              {['idle', 'done', 'live'].map((k) => (
                <marker key={k} id={`arr-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" className={`wf-arrow ${k}`} />
                </marker>
              ))}
            </defs>
            {edges.map((e) => {
              const src = states[e.from].k, dst = states[e.to].k;
              const done = ['completed', 'partial', 'skipped'].includes(src);
              const live = done && ['running', 'queued'].includes(dst);
              const k = live ? 'live' : done ? 'done' : 'idle';
              const dim = (focus && e.from !== focus && e.to !== focus) || (matches && !matches.includes(e.from) && !matches.includes(e.to));
              return <path key={ek(e)} d={edgePath(pos[e.from], pos[e.to], dir, off[ek(e)].from, off[ek(e)].to)} className={`wf-edge ${k} ${dim ? 'dim' : ''} ${focus && !dim ? 'hl' : ''}`} markerEnd={`url(#arr-${k})`} />;
            })}
          </svg>
          {nodes.map((n) => {
            const p = pos[n.name];
            const st = states[n.name];
            const dim = (focus && focus !== n.name && !byName[focus]?.depends_on.includes(n.name) && !n.depends_on.includes(focus)) || (matches && !matches.includes(n.name));
            const pr = n.progress;
            return (
              <div key={n.id} data-node={n.name} role="button" tabIndex={0} aria-label={`${n.label}: ${st.t}`}
                className={`wf-node s-${st.k} ${selected === n.name ? 'sel' : ''} ${dim ? 'dim' : ''} ${drag?.name === n.name ? 'dragging' : ''} ${matches?.includes(n.name) ? 'match' : ''}`}
                style={{ transform: `translate(${p.x}px, ${p.y}px)`, width: NW, height: NH }}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(n.name))}
                onMouseEnter={() => !act.current && setHover(n.name)} onMouseLeave={() => setHover(null)}>
                <i className="wf-port in" /><i className="wf-port out" />
                <div className="wf-node-top">
                  <NodeIcon type={n.type} />
                  <div className="wf-node-title"><b>{n.label}</b><span className="mono">{n.name}</span></div>
                  {!n.enabled && n.status !== 'completed' && <span className="wf-off">OFF</span>}
                  {n.prompt?.ai && (
                    <span data-prompt className={`wf-pchip ${n.prompt.edited || n.prompt.added ? 'on' : ''}`} title="Edit this step's AI prompt">
                      ✎{n.prompt.edited ? ' edited' : ''}{n.prompt.added ? ` +${n.prompt.added}` : ''}
                    </span>
                  )}
                </div>
                <div className="wf-node-st">
                  <i className={`wf-dot s-${st.k}`} /><span className={`wf-st s-${st.k}`}>{st.t}</span>
                  {(n.started_at || n.try_count > 0) && !n.skipped && <span className="muted"> · try {tryOf(n)}/{n.max_try_count}</span>}
                  {n.started_at && !n.skipped && <span className="muted"> · {dur((n.finished_at || now) - n.started_at)}</span>}
                </div>
                {pr?.total > 1 && n.status !== 'completed' ? (
                  <div className="wf-node-prog"><Bar value={(pr.done / pr.total) * 100} cls="" /><span className="small muted">{pr.done}/{pr.total}</span></div>
                ) : (
                  <div className="wf-node-deps">
                    {n.depends_on.slice(0, 2).map((d) => <span key={d} className={`wf-chip ${n.depends_on_current.includes(d) ? 'wait' : 'ok'}`}>{d}</span>)}
                    {n.depends_on.length > 2 && <span className="wf-chip">+{n.depends_on.length - 2}</span>}
                    {!n.depends_on.length && <span className="wf-chip src">uploads</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="wf-legend" onPointerDown={(e) => e.stopPropagation()}>
          {LEGEND.map(([k, l]) => <span key={k}><i className={`wf-dot s-${k}`} />{l}</span>)}
        </div>
        <div className="wf-hint muted small">Drag steps to rearrange · drag the background or scroll to pan · Ctrl + scroll to zoom</div>
        {mini && <MiniMap nodes={nodes} pos={pos} states={states} bounds={bounds} view={view} size={size} onJump={centerOn} />}
      </div>
    </div>
  );
}
