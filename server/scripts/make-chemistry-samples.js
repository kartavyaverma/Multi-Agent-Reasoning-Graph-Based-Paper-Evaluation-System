// Generates the Chemistry sample set in test/chemistry/: a typed question paper, a typed model answer with
// reference diagrams, and four handwritten-style student scripts (10 questions x 5 marks, a diagram in every answer).
// Uses node-canvas's PDF backend with Windows fonts (Arial, Ink Free, Segoe Print).
// Run from server/:  node scripts/make-chemistry-samples.js   (FONT_DIR overrides C:/Windows/Fonts)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import canvasPkg from 'canvas';

const { createCanvas, registerFont } = canvasPkg;
const FONT_DIR = process.env.FONT_DIR || 'C:/Windows/Fonts';
registerFont(path.join(FONT_DIR, 'arial.ttf'), { family: 'Arial' });
registerFont(path.join(FONT_DIR, 'arialbd.ttf'), { family: 'Arial', weight: 'bold' });
registerFont(path.join(FONT_DIR, 'Inkfree.ttf'), { family: 'Ink Free' });
registerFont(path.join(FONT_DIR, 'segoepr.ttf'), { family: 'Segoe Print' });

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'test', 'chemistry');
fs.mkdirSync(OUT, { recursive: true });
const W = 595, H = 842;

/* ───────────── drawing style: typed (clean) or hand (jittered ink) ───────────── */
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function makeStyle(kind, opts = {}) {
  const r = rng(opts.seed || 7);
  const hand = kind === 'hand';
  return {
    hand,
    ink: opts.ink || (hand ? '#1f2f8f' : '#111111'),
    font: (size, bold) => (hand ? `${size}px "${opts.font || 'Ink Free'}"` : `${bold ? 'bold ' : ''}${size}px Arial`),
    j: (a = 1.2) => (hand ? (r() - 0.5) * 2 * a : 0),
  };
}

/* low-level primitives that look hand-drawn in "hand" style */
function line(ctx, st, x1, y1, x2, y2, { dash, width = 1.3 } = {}) {
  ctx.save();
  ctx.strokeStyle = st.ink; ctx.lineWidth = width; ctx.setLineDash(dash || []);
  ctx.beginPath();
  const n = st.hand ? 4 : 1;
  ctx.moveTo(x1 + st.j(), y1 + st.j());
  for (let i = 1; i <= n; i++) ctx.lineTo(x1 + ((x2 - x1) * i) / n + st.j(0.8), y1 + ((y2 - y1) * i) / n + st.j(0.8));
  ctx.stroke(); ctx.restore();
}
function poly(ctx, st, pts, { close, dash, width = 1.3, fill } = {}) {
  ctx.save(); ctx.strokeStyle = st.ink; ctx.lineWidth = width; ctx.setLineDash(dash || []);
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x + st.j(0.7), y + st.j(0.7)) : ctx.moveTo(x + st.j(0.7), y + st.j(0.7))));
  if (close) ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  ctx.stroke(); ctx.restore();
}
function circle(ctx, st, cx, cy, r, { fill, width = 1.3, dash } = {}) {
  const pts = [];
  for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 24) pts.push([cx + Math.cos(a) * (r + st.j(0.6)), cy + Math.sin(a) * (r + st.j(0.6))]);
  poly(ctx, st, pts, { close: true, fill, width, dash });
}
function dot(ctx, st, x, y, r = 2.2) { ctx.save(); ctx.fillStyle = st.ink; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
function arrow(ctx, st, x1, y1, x2, y2, opts = {}) {
  line(ctx, st, x1, y1, x2, y2, opts);
  const a = Math.atan2(y2 - y1, x2 - x1), s = 6;
  poly(ctx, st, [[x2 - s * Math.cos(a - 0.45), y2 - s * Math.sin(a - 0.45)], [x2, y2], [x2 - s * Math.cos(a + 0.45), y2 - s * Math.sin(a + 0.45)]]);
}
function label(ctx, st, s, x, y, size = 10, align = 'left') {
  ctx.save(); ctx.fillStyle = st.ink; ctx.font = st.font(size); ctx.textAlign = align; ctx.fillText(s, x + st.j(0.5), y + st.j(0.5)); ctx.restore();
}
function curve(ctx, st, fn, x0, x1, opts = {}) { // fn: t in [0,1] -> [x,y]
  const pts = []; for (let i = 0; i <= 40; i++) pts.push(fn(i / 40)); poly(ctx, st, pts, opts); void x0; void x1;
}
function axes(ctx, st, x, y, w, h, xl, yl) {
  arrow(ctx, st, x, y + h, x + w, y + h); arrow(ctx, st, x, y + h, x, y);
  label(ctx, st, xl, x + w - 4, y + h + 14, 9.5, 'right'); label(ctx, st, yl, x + 4, y - 4, 9.5);
}

/* ───────────── the ten diagrams (x, y = top-left of a ~ 300 x 150 box) ───────────── */
const FIG = {
  bohr(ctx, st, x, y, o = {}) {
    const cfg = o.config || [2, 8, 1], cx = x + 110, cy = y + 75;
    circle(ctx, st, cx, cy, 16);
    label(ctx, st, o.nucleus ?? '11p', cx, cy - 1, 8.5, 'center'); label(ctx, st, o.nucleus2 ?? '12n', cx, cy + 9, 8.5, 'center');
    cfg.forEach((n, i) => {
      const r = 30 + i * 20; circle(ctx, st, cx, cy, r);
      for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2 - Math.PI / 2; dot(ctx, st, cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
      if (o.shellLabels !== false) label(ctx, st, 'KLMN'[i], cx + r + 3, cy - 3, 9);
    });
    if (o.title !== false) label(ctx, st, o.symbol || 'Sodium (Na)', cx + 95, cy + 4, 11);
  },
  water(ctx, st, x, y, o = {}) {
    const ox = x + 90, oy = y + 55;
    label(ctx, st, 'O', ox, oy + 5, 15, 'center');
    const hs = o.linear ? [[ox - 55, oy], [ox + 55, oy]] : [[ox - 40, oy + 40], [ox + 40, oy + 40]];
    hs.forEach(([hx, hy]) => { line(ctx, st, ox + (hx - ox) * 0.18, oy + (hy - oy) * 0.18, hx - (hx - ox) * 0.15, hy - (hy - oy) * 0.15); label(ctx, st, 'H', hx, hy + 5, 14, 'center'); });
    if (o.lonePairs !== false) { [[-9, -16], [9, -16]].forEach(([dx, dy]) => { dot(ctx, st, ox + dx - 3, oy + dy); dot(ctx, st, ox + dx + 3, oy + dy); }); }
    if (o.angle) { label(ctx, st, o.angle, ox, oy + 48, 10, 'center'); }
    if (o.caption) label(ctx, st, o.caption, x + 170, y + 60, 10);
  },
  ieGraph(ctx, st, x, y, o = {}) {
    const gx = x + 30, gy = y + 10, gw = 230, gh = 120;
    axes(ctx, st, gx, gy, gw, gh, 'Atomic number', 'IE (kJ/mol)');
    let v = [520, 900, 800, 1086, 1402, 1314, 1681, 2081];
    if (o.trend === 'down') v = [...v].reverse();
    if (o.dips === false) v = [520, 760, 1000, 1240, 1480, 1720, 1960, 2081];
    const el = ['Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne'];
    const pts = v.map((e, i) => [gx + 20 + i * 28, gy + gh - 8 - ((e - 400) / 1800) * (gh - 16)]);
    poly(ctx, st, pts); pts.forEach(([px, py], i) => { dot(ctx, st, px, py, 2.4); if (o.labels !== false) label(ctx, st, el[i], px, py - 6, 8.5, 'center'); });
  },
  daniell(ctx, st, x, y, o = {}) {
    const b1 = x + 20, b2 = x + 170, by = y + 48;
    [b1, b2].forEach((bx) => poly(ctx, st, [[bx, by], [bx, by + 72], [bx + 90, by + 72], [bx + 90, by]]));
    line(ctx, st, b1 + 2, by + 25, b1 + 88, by + 25, { dash: [3, 3], width: 0.8 }); line(ctx, st, b2 + 2, by + 25, b2 + 88, by + 25, { dash: [3, 3], width: 0.8 });
    poly(ctx, st, [[b1 + 40, by - 25], [b1 + 40, by + 55], [b1 + 50, by + 55], [b1 + 50, by - 25]], { close: true });
    poly(ctx, st, [[b2 + 40, by - 25], [b2 + 40, by + 55], [b2 + 50, by + 55], [b2 + 50, by - 25]], { close: true });
    line(ctx, st, b1 + 45, by - 25, b1 + 45, y + 12); line(ctx, st, b2 + 45, by - 25, b2 + 45, y + 12);
    line(ctx, st, b1 + 45, y + 12, x + 125, y + 12); line(ctx, st, x + 145, y + 12, b2 + 45, y + 12);
    circle(ctx, st, x + 135, y + 12, 10); label(ctx, st, 'V', x + 135, y + 16, 10, 'center');
    if (o.saltBridge !== false) { poly(ctx, st, [[b1 + 70, by + 40], [b1 + 70, by - 10], [b2 + 20, by - 10], [b2 + 20, by + 40]], { width: 1.1 }); poly(ctx, st, [[b1 + 80, by + 40], [b1 + 80, by], [b2 + 10, by], [b2 + 10, by + 40]], { width: 1.1 }); label(ctx, st, 'salt bridge', x + 135, by - 15, 8.5, 'center'); }
    if (o.labels !== false) {
      const L = o.swap ? ['Zn (cathode +)', 'Cu (anode -)'] : ['Zn (anode -)', 'Cu (cathode +)'];
      label(ctx, st, L[0], b1 + 5, by + 86, 9); label(ctx, st, L[1], b2 + 5, by + 86, 9);
      label(ctx, st, 'ZnSO4', b1 + 22, by + 66, 8.5, 'center'); label(ctx, st, 'CuSO4', b2 + 70, by + 66, 8.5, 'center');
    }
    if (o.flow !== false) { const rev = o.flow === 'reverse'; arrow(ctx, st, rev ? x + 220 : x + 75, y + 4, rev ? x + 160 : x + 115, y + 4); label(ctx, st, 'e-', x + (rev ? 190 : 95), y, 8.5, 'center'); }
  },
  energyProfile(ctx, st, x, y, o = {}) {
    const gx = x + 30, gy = y + 8, gw = 250, gh = 125;
    axes(ctx, st, gx, gy, gw, gh, 'Reaction progress', 'Energy');
    const rY = gy + 70, pY = o.endo ? gy + 45 : gy + 100;
    line(ctx, st, gx + 10, rY, gx + 60, rY); line(ctx, st, gx + 190, pY, gx + 240, pY);
    const hump = (peak, dash) => curve(ctx, st, (t) => { const xx = gx + 60 + t * 130; const base = rY + (pY - rY) * t; return [xx, base - Math.sin(Math.PI * t) * (base - peak + 8) * (1 - 0.15 * t)]; }, 0, 1, { dash });
    hump(gy + 12);
    if (o.catalyst !== false) hump(o.catalystHigher ? gy - 4 : gy + 42, [4, 3]);
    if (o.labels !== false) {
      label(ctx, st, 'Reactants', gx + 12, rY - 4, 8.5); label(ctx, st, 'Products', gx + 192, pY - 4, 8.5);
      arrow(ctx, st, gx + 85, rY, gx + 85, gy + 30); label(ctx, st, 'Ea', gx + 89, gy + 50, 9);
      if (o.catalyst !== false) { arrow(ctx, st, gx + 105, rY, gx + 105, gy + 52, { dash: [2, 2] }); label(ctx, st, 'Ea (cat)', gx + 109, gy + 64, 8.5); }
      if (o.dH !== false) { arrow(ctx, st, gx + 225, rY, gx + 225, pY); line(ctx, st, gx + 60, rY, gx + 230, rY, { dash: [2, 3], width: 0.8 }); label(ctx, st, o.endo ? 'dH (+)' : 'ΔH (-ve)', gx + 230, (rY + pY) / 2 + 3, 8.5); }
      if (o.catalyst !== false) label(ctx, st, '--- with catalyst', gx + 150, gy + 8, 8.5);
    }
  },
  distillation(ctx, st, x, y, o = {}) {
    const fx = x + 50, fy = y + 95;
    circle(ctx, st, fx, fy, 28);
    poly(ctx, st, [[fx - 7, fy - 27], [fx - 7, fy - 55], [fx + 7, fy - 55], [fx + 7, fy - 27]]);
    line(ctx, st, fx, fy - 75, fx, fy - 40, { width: 1.8 }); // thermometer
    poly(ctx, st, [[fx + 7, fy - 48], [x + 220, fy - 10]]); poly(ctx, st, [[fx + 7, fy - 42], [x + 220, fy - 4]]);
    poly(ctx, st, [[x + 95, fy - 48], [x + 200, fy - 24], [x + 197, fy - 12], [x + 92, fy - 36]], { close: true }); // condenser jacket
    poly(ctx, st, [[x + 215, fy + 15], [x + 215, fy + 45], [x + 255, fy + 45], [x + 255, fy + 15]]); // receiver
    line(ctx, st, fx - 20, fy + 45, fx + 20, fy + 45); poly(ctx, st, [[fx - 8, fy + 58], [fx, fy + 42], [fx + 8, fy + 58]]); // burner flame
    const inB = o.waterInBottom !== false;
    arrow(ctx, st, inB ? x + 205 : x + 85, inB ? fy + 2 : fy - 62, inB ? x + 195 : x + 95, inB ? fy - 14 : fy - 46);
    arrow(ctx, st, inB ? x + 100 : x + 195, inB ? fy - 50 : fy - 14, inB ? x + 92 : x + 208, inB ? fy - 64 : fy + 2);
    if (o.labels !== false) {
      label(ctx, st, 'thermometer', fx - 8, fy - 72, 8.5, 'right'); label(ctx, st, 'flask', fx - 45, fy + 30, 8.5); label(ctx, st, 'heat', fx + 12, fy + 58, 8.5);
      label(ctx, st, 'condenser', x + 140, fy - 46, 8.5); label(ctx, st, 'distillate', x + 220, fy + 58, 8.5);
      label(ctx, st, 'water in', inB ? x + 208 : x + 60, inB ? fy + 8 : fy - 66, 8.5); label(ctx, st, 'water out', inB ? x + 60 : x + 210, inB ? fy - 66 : fy + 8, 8.5);
    }
  },
  titration(ctx, st, x, y, o = {}) {
    const gx = x + 30, gy = y + 8, gw = 240, gh = 125;
    axes(ctx, st, gx, gy, gw, gh, 'Vol. NaOH (mL)', 'pH');
    const vEq = o.eqVol ?? 25, phEq = o.eqPH ?? 7;
    const X = (v) => gx + (v / 50) * (gw - 10), Y = (p) => gy + gh - (p / 14) * (gh - 6);
    if (o.shape === 'line') curve(ctx, st, (t) => [X(t * 50), Y(1 + t * 12)]);
    else curve(ctx, st, (t) => { const v = t * 50; const p = 1 + 12 / (1 + Math.exp(-(v - vEq) * 0.9)); return [X(v), Y(p)]; });
    if (o.mark !== false) { line(ctx, st, X(vEq), Y(phEq), X(vEq), gy + gh, { dash: [3, 3], width: 0.9 }); line(ctx, st, gx, Y(phEq), X(vEq), Y(phEq), { dash: [3, 3], width: 0.9 }); dot(ctx, st, X(vEq), Y(phEq), 2.8); label(ctx, st, `equivalence (pH ${phEq})`, X(vEq) + 6, Y(phEq) + 4, 8.5); label(ctx, st, String(vEq), X(vEq), gy + gh + 12, 8.5, 'center'); }
  },
  benzene(ctx, st, x, y, o = {}) {
    const hex = (cx, cy, r, dbl, ring) => {
      const p = Array.from({ length: 6 }, (_, i) => [cx + r * Math.cos(Math.PI / 6 + (i * Math.PI) / 3), cy + r * Math.sin(Math.PI / 6 + (i * Math.PI) / 3)]);
      poly(ctx, st, p, { close: true });
      if (dbl !== undefined) for (let i = dbl; i < 6; i += 2) { const a = p[i], b = p[(i + 1) % 6]; const k = 0.78; line(ctx, st, cx + (a[0] - cx) * k, cy + (a[1] - cy) * k, cx + (b[0] - cx) * k, cy + (b[1] - cy) * k); }
      if (ring) circle(ctx, st, cx, cy, r * 0.55);
    };
    if (o.single) { hex(x + 70, y + 70, 38); label(ctx, st, 'C6H12', x + 130, y + 75, 10); return; }
    hex(x + 50, y + 65, 34, 0); hex(x + 150, y + 65, 34, 1);
    line(ctx, st, x + 92, y + 65, x + 108, y + 65); poly(ctx, st, [[x + 96, y + 61], [x + 92, y + 65], [x + 96, y + 69]]); poly(ctx, st, [[x + 104, y + 61], [x + 108, y + 65], [x + 104, y + 69]]);
    if (o.hybrid !== false) { hex(x + 250, y + 65, 34, undefined, true); label(ctx, st, 'hybrid', x + 250, y + 120, 9, 'center'); }
    label(ctx, st, 'Kekule structures', x + 100, y + 120, 9, 'center');
  },
  boyle(ctx, st, x, y, o = {}) {
    const gx = x + 30, gy = y + 8, gw = 230, gh = 120;
    axes(ctx, st, gx, gy, gw, gh, 'V', 'P');
    if (o.shape === 'line') curve(ctx, st, (t) => [gx + 15 + t * 190, gy + gh - 10 - t * 100]);
    else curve(ctx, st, (t) => { const v = 0.6 + t * 4.4; return [gx + 10 + (v / 5) * (gw - 20), gy + gh - Math.min(gh - 6, (55 / v))]; });
    if (o.caption !== false) label(ctx, st, o.caption || 'T constant', gx + 140, gy + 30, 9);
  },
  electrolysis(ctx, st, x, y, o = {}) {
    const bx = x + 50, by = y + 55;
    poly(ctx, st, [[bx, by], [bx + 10, by + 80], [bx + 150, by + 80], [bx + 160, by]]);
    line(ctx, st, bx + 4, by + 22, bx + 156, by + 22, { dash: [3, 3], width: 0.8 });
    [[bx + 40], [bx + 120]].forEach(([ex]) => poly(ctx, st, [[ex - 5, by - 20], [ex - 5, by + 65], [ex + 5, by + 65], [ex + 5, by - 20]], { close: true }));
    line(ctx, st, bx + 40, by - 20, bx + 40, y + 10); line(ctx, st, bx + 120, by - 20, bx + 120, y + 10);
    line(ctx, st, bx + 40, y + 10, bx + 72, y + 10); line(ctx, st, bx + 88, y + 10, bx + 120, y + 10);
    line(ctx, st, bx + 72, y + 2, bx + 72, y + 18, { width: 1.8 }); line(ctx, st, bx + 80, y + 5, bx + 80, y + 15, { width: 1.8 }); line(ctx, st, bx + 88, y + 2, bx + 88, y + 18, { width: 1.8 });
    [[bx + 128, by + 40], [bx + 132, by + 28], [bx + 127, by + 15]].forEach(([cx, cy]) => circle(ctx, st, cx, cy, 3, { width: 0.9 }));
    if (o.labels !== false) {
      label(ctx, st, 'molten NaCl', bx + 80, by + 60, 9, 'center');
      label(ctx, st, 'cathode (-)', bx - 35, by - 5, 9); label(ctx, st, 'Na', bx + 30, by + 75, 8.5);
      label(ctx, st, 'anode (+)', bx + 135, by - 5, 9); label(ctx, st, 'Cl2 gas', bx + 140, by + 18, 8.5);
      label(ctx, st, 'battery', bx + 80, y + 32, 8.5, 'center');
    }
  },
};

/* ───────────── page writers ───────────── */
function ruled(ctx) {
  ctx.save(); ctx.strokeStyle = '#c9d6ee'; ctx.lineWidth = 0.7;
  for (let yy = 100; yy < H - 30; yy += 24) { ctx.beginPath(); ctx.moveTo(30, yy); ctx.lineTo(W - 30, yy); ctx.stroke(); }
  ctx.strokeStyle = '#f2a7a7'; ctx.beginPath(); ctx.moveTo(70, 30); ctx.lineTo(70, H - 30); ctx.stroke(); ctx.restore();
}

class Writer {
  constructor(file, st, { lined = false, size = 11.5, lh = 18, left = 60, right = W - 50 } = {}) {
    Object.assign(this, { file, st, lined, size, lh, left, right });
    this.canvas = createCanvas(W, H, 'pdf'); this.ctx = this.canvas.getContext('2d');
    this.y = 60; if (lined) ruled(this.ctx);
  }
  page() { this.ctx.addPage(W, H); if (this.lined) ruled(this.ctx); this.y = 60; }
  need(h) { if (this.y + h > H - 40) this.page(); }
  text(s, { size = this.size, bold = false, indent = 0, color, gap = 0, align } = {}) {
    const { ctx, st } = this; ctx.font = st.font(size, bold); ctx.fillStyle = color || st.ink;
    const maxW = this.right - this.left - indent;
    for (const para of String(s).split('\n')) {
      const words = para.split(' '); let ln = '';
      const flush = () => { this.need(this.lh); const x = this.left + indent + st.j(1.5); if (align === 'center') { ctx.textAlign = 'center'; ctx.fillText(ln, W / 2, this.y); ctx.textAlign = 'left'; } else ctx.fillText(ln, x, this.y + st.j(0.8)); this.y += this.lh; ln = ''; };
      for (const w of words) { const t = ln ? `${ln} ${w}` : w; if (ctx.measureText(t).width > maxW && ln) { flush(); ln = w; } else ln = t; }
      if (ln || !para) flush();
    }
    this.y += gap;
  }
  fig(name, opts = {}, h = 150) { this.need(h + 20); FIG[name](this.ctx, this.st, this.left + 10, this.y - 4, opts); this.y += h + 14; }
  rule() { const { ctx } = this; ctx.save(); ctx.strokeStyle = '#999'; ctx.beginPath(); ctx.moveTo(this.left, this.y - 8); ctx.lineTo(this.right, this.y - 8); ctx.stroke(); ctx.restore(); this.y += 8; }
  save() { fs.writeFileSync(path.join(OUT, this.file), this.canvas.toBuffer()); console.log('wrote', this.file); }
}

/* ───────────── content ───────────── */
const QUESTIONS = [
  ['Atomic structure', 'Draw the Bohr model of a sodium atom (Z = 11, A = 23) showing the number of protons and neutrons and the arrangement of electrons in shells. Write its electronic configuration and valency.'],
  ['Shape of the water molecule', 'Draw the electron-dot (Lewis) structure of H2O and a diagram of its shape. State the H-O-H bond angle and explain why it is less than the tetrahedral angle of 109.5°.'],
  ['Ionisation energy', 'Sketch a graph of first ionisation energy against atomic number for the period 2 elements (Li to Ne). Explain the general trend and the drops at boron and oxygen.'],
  ['Daniell cell', 'Draw a labelled diagram of the Daniell cell. Write the anode and cathode half-reactions and calculate the standard cell EMF. (E° Zn2+/Zn = -0.76 V, E° Cu2+/Cu = +0.34 V)'],
  ['Catalysis', 'Draw an energy profile diagram for an exothermic reaction with and without a catalyst. Label the activation energies and ΔH, and explain how a catalyst increases the rate of reaction.'],
  ['Simple distillation', 'Draw a labelled diagram of the apparatus for simple distillation. Explain the purpose of the condenser and why the cooling water enters at the bottom.'],
  ['Acid-base titration', '25.0 mL of 0.10 M HCl is titrated with 0.10 M NaOH. Sketch the titration curve (pH against volume of NaOH added) and mark the equivalence point. Calculate the volume of NaOH at the equivalence point and name a suitable indicator.'],
  ['Benzene', 'Draw the two Kekulé structures and the resonance hybrid of benzene. Explain why benzene prefers substitution reactions to addition reactions.'],
  ["Boyle's law", "State Boyle's law and sketch a graph of pressure (P) against volume (V) for a fixed mass of gas at constant temperature. A gas occupies 3.0 L at 2.0 atm. Find its volume at 6.0 atm at the same temperature."],
  ['Electrolysis', 'Draw a labelled diagram for the electrolysis of molten sodium chloride. Write the reactions at the cathode and the anode and name the products formed.'],
];

const MODEL = [
  { text: 'Nucleus contains 11 protons and 12 neutrons (A - Z = 23 - 11). Electrons: K shell 2, L shell 8, M shell 1.\nElectronic configuration: 2, 8, 1 (1s2 2s2 2p6 3s1). Valency = 1: sodium loses its single outer electron to form Na+.', fig: ['bohr', {}], scheme: 'Nucleus 11p, 12n [1]; shells drawn K2 L8 M1 [2]; configuration 2,8,1 [1]; valency 1 with reason [1].' },
  { text: 'Oxygen forms two O-H bond pairs and keeps two lone pairs. The four electron pairs are arranged tetrahedrally, but the molecule is bent (V-shaped).\nBond angle = 104.5°. Lone pair-lone pair repulsion is greater than bond pair-bond pair repulsion, so the lone pairs push the O-H bonds closer together, reducing the angle below 109.5°.', fig: ['water', { angle: '104.5°', caption: 'bent (V-shaped)' }], scheme: 'Lewis structure with 2 bond pairs and 2 lone pairs on O [2]; bent shape drawn [1]; angle 104.5° [1]; lone-pair repulsion explanation [1].' },
  { text: 'Graph rises from Li to Ne with two small drops, at B and at O.\nGeneral trend: across the period the nuclear charge increases while electrons are added to the same shell, so atomic radius decreases and the outer electron is held more strongly; ionisation energy increases.\nDrop at B: the electron removed is a 2p electron, which is higher in energy and shielded by the 2s electrons.\nDrop at O: the electron removed is from a doubly occupied 2p orbital; repulsion between the paired electrons makes it easier to remove.', fig: ['ieGraph', {}], scheme: 'Graph increasing with dips at B and O [2]; trend explained by nuclear charge / radius [1]; B explained (2p, shielding) [1]; O explained (paired-electron repulsion) [1].' },
  { text: 'Zinc rod in ZnSO4 solution, copper rod in CuSO4 solution, joined by a salt bridge (KCl/KNO3); external wire with voltmeter. Electrons flow from Zn to Cu in the external circuit.\nAnode (oxidation): Zn -> Zn2+ + 2e-\nCathode (reduction): Cu2+ + 2e- -> Cu\nE°cell = E°cathode - E°anode = 0.34 - (-0.76) = +1.10 V', fig: ['daniell', {}], scheme: 'Labelled diagram with both half-cells, salt bridge and voltmeter, electron flow Zn to Cu [2]; anode reaction [1]; cathode reaction [1]; EMF 1.10 V [1].' },
  { text: 'For an exothermic reaction the products lie below the reactants (ΔH negative). The catalysed pathway (dashed) has a lower peak, so Ea (cat) < Ea, while ΔH is unchanged.\nA catalyst provides an alternative reaction pathway with lower activation energy, so a larger fraction of colliding molecules have energy equal to or greater than Ea, and the rate increases. The catalyst is not used up.', fig: ['energyProfile', {}], scheme: 'Exothermic profile, products lower [1]; catalysed path with lower peak [1]; Ea, Ea(cat) and ΔH labelled [1.5]; explanation: alternative path, lower Ea, more effective collisions [1.5].' },
  { text: 'Apparatus: round-bottom flask heated from below, thermometer bulb at the side arm, Liebig condenser sloping down to a receiving flask.\nThe condenser cools the hot vapour so that it condenses back to liquid (the distillate).\nCooling water enters at the bottom and leaves at the top so the condenser jacket stays completely full of water and the coldest water meets the vapour just before it leaves (counter-current), giving efficient cooling.', fig: ['distillation', {}], scheme: 'Correct apparatus drawn (flask, heat, thermometer at side arm, condenser, receiver) [2]; labels [1]; purpose of condenser [1]; water in at bottom with reason [1].' },
  { text: 'The curve starts at about pH 1, rises slowly, then rises very steeply from about pH 3 to pH 11 near the equivalence point, then levels off near pH 13.\nEquivalence point: pH 7 (strong acid + strong base).\nmoles HCl = 0.10 × 0.0250 = 0.00250 mol, so V(NaOH) = 0.00250 / 0.10 = 0.0250 L = 25.0 mL.\nIndicator: phenolphthalein (methyl orange is also acceptable).', fig: ['titration', {}], scheme: 'S-shaped curve with steep rise [2]; equivalence point at pH 7 marked [1]; 25.0 mL calculated [1]; suitable indicator [1].' },
  { text: 'Two Kekulé structures with alternating double bonds, linked by a double-headed resonance arrow; the real molecule is the resonance hybrid (hexagon with a circle) in which all six C-C bonds are equal (139 pm).\nThe six π electrons are delocalised over the ring, which gives benzene extra stability (resonance / delocalisation energy). Addition would destroy this delocalised (aromatic) system, whereas substitution keeps it, so benzene prefers substitution.', fig: ['benzene', {}], scheme: 'Two Kekulé structures with resonance arrow [2]; resonance hybrid with circle [1]; delocalised π electrons give extra stability [1]; addition destroys aromaticity, substitution retains it [1].' },
  { text: "Boyle's law: at constant temperature, the pressure of a fixed mass of gas is inversely proportional to its volume (PV = constant).\nThe P-V graph is a hyperbola (curve), since P ∝ 1/V.\nP1V1 = P2V2: 2.0 × 3.0 = 6.0 × V2, so V2 = 1.0 L.", fig: ['boyle', {}], scheme: 'Correct statement [1]; hyperbolic P-V curve with labelled axes [2]; P1V1 = P2V2 used [1]; V2 = 1.0 L [1].' },
  { text: 'Molten NaCl in a crucible with two inert (graphite) electrodes connected to a battery. Na+ ions move to the cathode (-) and Cl- ions move to the anode (+).\nCathode (reduction): Na+ + e- -> Na\nAnode (oxidation): 2Cl- -> Cl2 + 2e-\nProducts: sodium metal at the cathode, chlorine gas at the anode.', fig: ['electrolysis', {}], scheme: 'Labelled diagram with molten NaCl, electrodes, battery, cathode (-) and anode (+) [2]; cathode reaction [1]; anode reaction [1]; products named [1].' },
];

/* Students: answers are [text, fig, figOpts, textAfter]. Expected marks are in test/chemistry/README.md. */
const STUDENTS = [
  {
    file: 'student_01_ishaan.pdf', name: 'Ishaan Mehta', roll: '1CH24CS011', sec: 'B', font: 'Ink Free', ink: '#1f2f8f', seed: 11,
    answers: [
      ['Na atom: Z = 11, A = 23, so the nucleus has 11 protons and 23 - 11 = 12 neutrons.', 'bohr', {}, 'Electronic configuration = 2, 8, 1 (1s2 2s2 2p6 3s1). Valency = 1 as Na loses its one outer electron to form Na+.'],
      ['Lewis structure: O has 2 bond pairs with the two H atoms and 2 lone pairs.', 'water', { angle: '104.5°', caption: 'bent / V shape' }, 'Bond angle is 104.5°. The lone pair - lone pair repulsion is more than bond pair - bond pair repulsion, so the O-H bonds are pushed closer and the angle becomes less than 109.5°.'],
      ['', 'ieGraph', {}, 'IE increases from Li to Ne because nuclear charge increases and atomic size decreases, so electrons are held more tightly. B is lower than Be because the electron is removed from 2p which is higher in energy and shielded by 2s. O is lower than N because in O the 2p electron is paired and the repulsion makes it easier to remove.'],
      ['', 'daniell', {}, 'Anode: Zn -> Zn2+ + 2e- (oxidation)\nCathode: Cu2+ + 2e- -> Cu (reduction)\nE cell = E cathode - E anode = 0.34 - (-0.76) = 1.10 V'],
      ['', 'energyProfile', {}, 'Products are lower so dH is negative (exothermic). A catalyst gives an alternative path with lower activation energy, so more molecules have energy more than Ea and more collisions are successful, so rate increases. dH does not change.'],
      ['', 'distillation', {}, 'The condenser cools the vapour so it turns back into liquid which is collected as distillate. Water enters at the bottom so that the condenser is completely filled with water and cooling is efficient (counter current flow).'],
      ['', 'titration', {}, 'moles of HCl = 0.10 x 25/1000 = 0.0025 mol. V of NaOH = 0.0025/0.10 = 0.025 L = 25.0 mL. Equivalence point at pH 7. Indicator: phenolphthalein.'],
      ['', 'benzene', {}, 'In benzene the 6 pi electrons are delocalised over the ring which gives extra stability (resonance energy). Addition would destroy the delocalised aromatic ring but substitution keeps it, so benzene prefers substitution.'],
      ["Boyle's law: at constant temperature the pressure of a fixed mass of gas is inversely proportional to its volume, PV = constant.", 'boyle', {}, 'P1V1 = P2V2 => 2 x 3 = 6 x V2 => V2 = 1.0 L'],
      ['', 'electrolysis', {}, 'Cathode: Na+ + e- -> Na (sodium metal)\nAnode: 2Cl- -> Cl2 + 2e- (chlorine gas)\nSodium is formed at the cathode and chlorine gas at the anode.'],
    ],
  },
  {
    file: 'student_02_priya.pdf', name: 'Priya Nair', roll: '1CH24CS027', sec: 'B', font: 'Segoe Print', ink: '#14143c', seed: 23,
    answers: [
      ['Sodium has 11 protons and 12 neutrons in the nucleus.', 'bohr', {}, 'Configuration 2, 8, 1. Valency is 1.'],
      ['Water has two bond pairs and two lone pairs on oxygen.', 'water', { angle: '109.5°' }, 'Bond angle is 109.5° because there are four electron pairs around oxygen. Lone pairs repel more strongly so the shape is bent.'],
      ['', 'ieGraph', {}, 'Ionisation energy increases across the period because the nuclear charge increases and the size decreases. B is lower because its electron is in 2p which is further from the nucleus. O is lower because of repulsion between paired 2p electrons.'],
      ['', 'daniell', { swap: true }, 'Anode: Cu -> Cu2+ + 2e-\nCathode: Zn2+ + 2e- -> Zn\nEMF = 0.34 + 0.76 = 1.10 V'],
      ['', 'energyProfile', {}, 'The catalyst lowers the activation energy by giving another pathway so more particles can react and the rate increases. dH stays the same.'],
      ['', 'distillation', { waterInBottom: false }, 'The condenser cools the vapour into liquid. Water goes in from the top so that it flows down with gravity and cools faster.'],
      ['', 'titration', { eqVol: 50 }, 'Volume of NaOH = 0.10 x 25 / 0.05 = 50 mL. Equivalence point at pH 7. Indicator phenolphthalein.'],
      ['', 'benzene', {}, 'Benzene has delocalised electrons that make it very stable, so it does substitution and keeps the ring stable instead of addition.'],
      ["Boyle's law: P is inversely proportional to V at constant temperature.", 'boyle', {}, 'P1V1 = P2V2, so V2 = 6 x 3 / 2 = 9 L'],
      ['', 'electrolysis', {}, 'At cathode Na+ + e- -> Na\nAt anode 2Cl- -> Cl2 + 2e-\nSodium at cathode and chlorine at anode.'],
    ],
  },
  {
    file: 'student_03_arjun.pdf', name: 'Arjun Reddy', roll: '1CH24CS034', sec: 'A', font: 'Ink Free', ink: '#16163a', seed: 37,
    answers: [
      ['', 'bohr', { title: false }, 'Electronic configuration is 2, 8, 1.'],
      ['', 'water', { lonePairs: false, linear: true }, 'Water is H-O-H. The bond angle is 104.5°.'],
      ['', 'ieGraph', { labels: false }, 'Ionisation energy increases across the period because the atoms get smaller.'],
      ['', 'daniell', { saltBridge: false }, 'Zn -> Zn2+ + 2e-\nCu2+ + 2e- -> Cu'],
      ['', 'energyProfile', { catalyst: false, dH: false }, 'A catalyst makes the reaction faster.'],
      ['', 'distillation', { labels: false }, 'The condenser turns the vapour into a liquid. Water goes in at the bottom.'],
      ['', 'titration', {}, 'V = 25 mL since the concentrations are the same. Equivalence point is at pH 7.'],
      ['', 'benzene', { hybrid: false }, ''],
      ["PV = constant at constant temperature.", 'boyle', {}, '2 x 3 = 6 x V2, V2 = 1 L'],
    ],
  },
  {
    file: 'student_04_sneha.pdf', name: 'Sneha Kulkarni', roll: '1CH24CS041', sec: 'A', font: 'Segoe Print', ink: '#1f2f8f', seed: 53,
    answers: [
      ['Sodium has 11 electrons.', 'bohr', { config: [2, 9], nucleus: '11', nucleus2: '' }, 'Configuration 2, 9. Valency 9.'],
      ['', 'water', { lonePairs: false, linear: true, angle: '180°' }, 'Water is a linear molecule with angle 180° because the hydrogens repel each other.'],
      ['', 'ieGraph', { trend: 'down', dips: false }, 'Ionisation energy decreases across the period because more electrons are added so they are easier to remove.'],
      ['', 'daniell', { saltBridge: false, flow: 'reverse' }, 'Electrons flow from copper to zinc. Cu -> Cu2+. EMF = 0.34 - 0.76 = -0.42 V'],
      ['', 'energyProfile', { endo: true, catalystHigher: true }, 'A catalyst increases the activation energy so the reaction is controlled and goes faster.'],
      ['', 'distillation', { waterInBottom: false, labels: false }, 'The condenser heats the vapour so it evaporates faster. Water enters at the top.'],
      ['', 'titration', { shape: 'line', mark: false }, 'pH increases in a straight line as NaOH is added. Volume = 12.5 mL.'],
      ['', 'benzene', { single: true }, 'Benzene has only single bonds so it does addition reactions.'],
      ['', 'boyle', { shape: 'line', caption: 'P = V' }, 'Pressure is directly proportional to volume. V2 = 3 x 6 = 18 L'],
    ],
  },
];

/* ───────────── build ───────────── */
function questionPaper() {
  const w = new Writer('question_paper.pdf', makeStyle('typed'), { size: 10.5, lh: 15 });
  w.text('Internal Assessment 1 - Chemistry', { size: 16, bold: true, align: 'center' });
  w.text('Semester II  |  Time: 2 hours  |  Maximum marks: 50', { size: 10, align: 'center' });
  w.text('Answer ALL questions. Each question carries 5 marks. Draw neat, labelled diagrams in every answer.', { size: 10, align: 'center', gap: 4 });
  w.rule();
  QUESTIONS.forEach(([t, q], i) => {
    w.need(60);
    w.text(`Q${i + 1}. ${t}`, { bold: true, size: 11 }); w.y -= 15;
    w.ctx.font = 'bold 11px Arial'; w.ctx.fillStyle = '#111'; w.ctx.textAlign = 'right'; w.ctx.fillText('[5 marks]', w.right, w.y); w.ctx.textAlign = 'left'; w.y += 15;
    w.text(q, { indent: 14, gap: 8 });
  });
  w.save();
}

function modelAnswer() {
  const w = new Writer('model_answer.pdf', makeStyle('typed'), { size: 10, lh: 14 });
  w.text('Model Answer and Marking Scheme - Chemistry IA 1', { size: 15, bold: true, align: 'center' });
  w.text('Total: 50 marks (10 x 5). Mark splits are given in [brackets]. Accept equivalent correct wording and methods.', { size: 9.5, align: 'center', gap: 4 });
  w.rule();
  MODEL.forEach((m, i) => {
    w.need(200);
    w.text(`Q${i + 1}. ${QUESTIONS[i][0]}  [5 marks]`, { bold: true, size: 11, gap: 2 });
    w.fig(m.fig[0], m.fig[1], 150);
    w.text(m.text, { indent: 8 });
    w.text(`Marking: ${m.scheme}`, { indent: 8, size: 9.5, color: '#444', gap: 10 });
  });
  w.save();
}

function studentScript(s) {
  const w = new Writer(s.file, makeStyle('hand', { font: s.font, ink: s.ink, seed: s.seed }), { lined: true, size: 13, lh: 24, left: 80, right: W - 40 });
  w.y = 52;
  w.text(`Name: ${s.name}     Roll No: ${s.roll}     Sec: ${s.sec}`, { size: 13 });
  w.text('Chemistry - Internal Assessment 1', { size: 12, gap: 6 });
  s.answers.forEach(([before, fig, opts, after], i) => {
    w.need(before ? 70 : 205); // keep the heading with its diagram
    w.text(`Ans ${i + 1})`, { size: 13.5, indent: -8 });
    if (before) w.text(before, { indent: 6 });
    if (fig) w.fig(fig, opts, 155);
    if (after) w.text(after, { indent: 6, gap: 6 });
  });
  w.save();
}

questionPaper();
modelAnswer();
STUDENTS.forEach(studentScript);
