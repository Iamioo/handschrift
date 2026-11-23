// Zeichensatz, Schreibfeld für den Apple Pencil und Normalisierung der Buchstaben.

export const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜabcdefghijklmnopqrstuvwxyzäöüß'];
export const EXTRA = [...'0123456789.,:;!?-\'"()&/%+'];

// Geometrie des Schreibfelds in em. Die Grundlinie liegt bei y = 0.
export const EM = { top: -1.05, bottom: 0.55, width: 2.4, cap: -0.72, xh: -0.42, desc: 0.3 };
export const PEN_EM = 0.055;      // Strichbreite relativ zur Schriftgröße
export const GLYPH_GAP = 0.12;    // Abstand nach jedem Buchstaben
export const LEFT_PAD = 0.35;     // wo ein gespeicherter Buchstabe beim Bearbeiten erscheint

export const widthFactor = (p) => 0.55 + 0.9 * (p ?? 0.5);

const r3 = (v) => Math.round(v * 1000) / 1000;
const r2 = (v) => Math.round(v * 100) / 100;

function simplify(pts, minDist) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], b = pts[i];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) >= minDist) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// Wandelt die Striche aus dem Schreibfeld in eine gespeicherte Variante um.
export function normalizeGlyph(strokes) {
  let minX = Infinity, maxX = -Infinity;
  for (const s of strokes) for (const [x] of s) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
  if (!isFinite(minX)) return null;
  const out = strokes.map((s) => simplify(s, 0.004).map(([x, y, p]) => [r3(x - minX), r3(y), r2(p)]));
  return { strokes: out, w: r3(maxX - minX + GLYPH_GAP) };
}

export function denormalizeGlyph(v) {
  return v.strokes.map((s) => s.map(([x, y, p]) => [x + LEFT_PAD, y, p]));
}

// Zeichnet einen Strich mit druckabhängiger Breite. Segmente gleicher Breite teilen sich einen Pfad.
export function strokePath(ctx, pts, baseWidth, color, map) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (pts.length === 1) {
    const [x, y] = map(pts[0]);
    ctx.beginPath();
    ctx.arc(x, y, (baseWidth * widthFactor(pts[0][2])) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  let curW = -1;
  let open = false;
  for (let i = 1; i < pts.length; i++) {
    const w = Math.round(baseWidth * widthFactor((pts[i - 1][2] + pts[i][2]) / 2) * 4) / 4;
    const [ax, ay] = map(pts[i - 1]);
    const [bx, by] = map(pts[i]);
    if (w !== curW) {
      if (open) ctx.stroke();
      ctx.lineWidth = Math.max(w, 0.5);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      curW = w;
      open = true;
    }
    ctx.lineTo(bx, by);
  }
  if (open) ctx.stroke();
}

// Kleine Vorschau einer Variante in ein Canvas.
export function drawGlyphThumb(canvas, variant, color = '#1b1f27') {
  const dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  const W = Math.max(r.width, 40), H = Math.max(r.height, 40);
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!variant) return;
  const emH = EM.bottom - EM.top;
  const scale = Math.min(H / emH, W / Math.max(variant.w, 0.6)) * 0.9;
  const ox = (W - variant.w * scale) / 2;
  const oy = H / 2 - ((EM.top + EM.bottom) / 2) * scale;
  ctx.strokeStyle = '#e2e6ee';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(W, oy); ctx.stroke();
  for (const s of variant.strokes) {
    strokePath(ctx, s, PEN_EM * scale, color, ([x, y]) => [ox + x * scale, oy + y * scale]);
  }
}

// Eine Reihe Buchstaben (z.B. "Hallo") als Vorschau einer Schrift.
export function drawSample(canvas, font, text) {
  const dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  const W = r.width || 220, H = r.height || 48;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const scale = H / 1.5;
  let x = 8;
  const base = H * 0.72;
  for (const ch of text) {
    const v = font.glyphs[ch]?.[0];
    if (!v) { x += 0.4 * scale; continue; }
    for (const s of v.strokes) strokePath(ctx, s, PEN_EM * scale, '#1b1f27', ([px, py]) => [x + px * scale, base + py * scale]);
    x += v.w * scale;
    if (x > W) break;
  }
}

// Schreibfeld: nimmt Striche mit Stift, Finger oder Maus auf.
export class Pad {
  constructor(canvas, { onChange, onLift } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.strokes = [];
    this.current = null;
    this.penSeen = false;
    this.onChange = onChange || (() => {});
    this.onLift = onLift || (() => {});
    this.hint = '';
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e));
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = r.width * dpr;
    this.canvas.height = r.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = r.width; this.h = r.height;
    this.scale = r.height / (EM.bottom - EM.top);
    this.redraw();
  }

  toPx([x, y]) { return [x * this.scale, (y - EM.top) * this.scale]; }

  point(e) {
    const r = this.canvas.getBoundingClientRect();
    let p = e.pressure;
    if (e.pointerType !== 'pen' || !p) p = 0.5;
    return [(e.clientX - r.left) / this.scale, (e.clientY - r.top) / this.scale + EM.top, p];
  }

  ignore(e) {
    if (e.pointerType === 'pen') this.penSeen = true;
    // Handballen-Erkennung: sobald der Pencil benutzt wurde, zählen Finger nicht mehr.
    return this.penSeen && e.pointerType === 'touch';
  }

  down(e) {
    if (this.ignore(e)) return;
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* Pointer schon weg */ }
    this.current = [this.point(e)];
    this.strokes.push(this.current);
    this.redraw();
  }

  move(e) {
    if (!this.current || this.ignore(e)) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) this.current.push(this.point(ev));
    this.redraw();
  }

  up(e) {
    if (!this.current) return;
    this.current = null;
    this.onChange();
    this.onLift();
  }

  clear() { this.strokes = []; this.redraw(); this.onChange(); }
  undo() { this.strokes.pop(); this.redraw(); this.onChange(); }
  set(strokes) { this.strokes = strokes.map((s) => s.map((p) => [...p])); this.redraw(); }
  isEmpty() { return this.strokes.length === 0; }

  redraw() {
    const { ctx, w, h } = this;
    if (!w) return;
    ctx.clearRect(0, 0, w, h);
    const line = (y, color, dash, width = 1) => {
      const py = (y - EM.top) * this.scale;
      ctx.save();
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke();
      ctx.restore();
    };
    line(EM.cap, '#c9d3e3', [6, 6]);
    line(EM.xh, '#9fb2d1', [10, 6]);
    line(0, '#5b6f92', [], 2);
    line(EM.desc, '#c9d3e3', [2, 6]);
    if (this.hint) {
      ctx.save();
      ctx.fillStyle = 'rgba(31,95,191,0.07)';
      ctx.font = `${0.9 * this.scale}px Georgia, serif`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(this.hint, LEFT_PAD * this.scale, (0 - EM.top) * this.scale);
      ctx.restore();
    }
    for (const s of this.strokes) strokePath(ctx, s, PEN_EM * this.scale, '#1b1f27', (p) => this.toPx(p));
  }
}
