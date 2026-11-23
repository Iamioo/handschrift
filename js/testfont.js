// Eingebaute Testschrift: einfache Einstrich-Buchstaben, aus Linien und Bögen konstruiert.
// Jede Variante bekommt eigene kleine Verzerrungen, damit sie wie von Hand geschrieben wirkt.
// Koordinaten in em: Grundlinie y = 0, Mittellinie -0.42, Großbuchstaben -0.72, Unterlänge 0.3.
import { normalizeGlyph } from './glyphs.js';
import { mulberry32 } from './render.js';
import { newFont } from './store.js';

const RAD = Math.PI / 180;

// Bogen einer Ellipse; Winkel in Grad, 0 = rechts, 90 = unten.
function arc(cx, cy, rx, ry, a0, a1) {
  const n = Math.max(6, Math.ceil(Math.abs(a1 - a0) / 12));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (a0 + (a1 - a0) * (i / n)) * RAD;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}

// Polylinie aus Koordinatenpaaren.
function line(...c) {
  const pts = [];
  for (let i = 0; i < c.length; i += 2) pts.push([c[i], c[i + 1]]);
  return pts;
}

const dot = (x, y) => [[x, y], [x + 0.012, y + 0.006]];
const join = (...parts) => parts.flat();

const O = (cx, cy, rx, ry) => arc(cx, cy, rx, ry, -90, 270);

const LOWER = {
  a: [arc(0.13, -0.21, 0.13, 0.21, -20, -340), line(0.26, -0.42, 0.26, -0.03, 0.3, 0)],
  b: [line(0, -0.75, 0, 0), arc(0.13, -0.21, 0.13, 0.21, 200, -160)],
  c: [arc(0.13, -0.21, 0.13, 0.21, -40, -320)],
  d: [arc(0.13, -0.21, 0.13, 0.21, -20, -340), line(0.26, -0.75, 0.26, -0.03, 0.3, 0)],
  e: [join(line(0.01, -0.2, 0.26, -0.2), arc(0.135, -0.2, 0.125, 0.2, 0, -320))],
  f: [join(arc(0.17, -0.6, 0.1, 0.14, -20, -180), line(0.07, -0.6, 0.07, 0)), line(0, -0.4, 0.17, -0.4)],
  g: [arc(0.13, -0.21, 0.13, 0.21, -20, -340), join(line(0.26, -0.42, 0.26, 0.18), arc(0.13, 0.18, 0.13, 0.12, 0, 160))],
  h: [line(0, -0.75, 0, 0), join(arc(0.12, -0.28, 0.12, 0.14, 180, 360), line(0.24, -0.28, 0.24, 0))],
  i: [line(0, -0.42, 0, -0.03, 0.04, 0), dot(0, -0.6)],
  j: [join(line(0.1, -0.42, 0.1, 0.18), arc(0.02, 0.18, 0.08, 0.12, 0, 150)), dot(0.1, -0.6)],
  k: [line(0, -0.75, 0, 0), line(0.22, -0.42, 0.01, -0.18, 0.25, 0)],
  l: [line(0, -0.75, 0, -0.05, 0.06, 0)],
  m: [line(0, -0.42, 0, 0), join(arc(0.1, -0.3, 0.1, 0.12, 180, 360), line(0.2, -0.3, 0.2, 0)), join(arc(0.3, -0.3, 0.1, 0.12, 180, 360), line(0.4, -0.3, 0.4, 0))],
  n: [line(0, -0.42, 0, 0), join(arc(0.12, -0.28, 0.12, 0.14, 180, 360), line(0.24, -0.28, 0.24, 0))],
  o: [O(0.13, -0.21, 0.13, 0.21)],
  p: [line(0, -0.42, 0, 0.3), arc(0.13, -0.21, 0.13, 0.21, 200, -160)],
  q: [arc(0.13, -0.21, 0.13, 0.21, -20, -340), line(0.26, -0.42, 0.26, 0.3, 0.31, 0.24)],
  r: [line(0, -0.42, 0, 0), arc(0.13, -0.27, 0.13, 0.13, 180, 300)],
  s: [join(arc(0.12, -0.31, 0.11, 0.1, -30, -270), arc(0.12, -0.105, 0.12, 0.105, -90, 150))],
  t: [line(0.07, -0.62, 0.07, -0.05, 0.14, 0), line(0, -0.42, 0.18, -0.42)],
  u: [join(line(0, -0.42, 0, -0.13), arc(0.12, -0.13, 0.12, 0.13, 180, 0), line(0.24, -0.13, 0.24, -0.42)), line(0.24, -0.42, 0.24, 0)],
  v: [line(0, -0.42, 0.12, 0, 0.24, -0.42)],
  w: [line(0, -0.42, 0.08, 0, 0.16, -0.3, 0.24, 0, 0.32, -0.42)],
  x: [line(0, -0.42, 0.24, 0), line(0.24, -0.42, 0, 0)],
  y: [line(0, -0.42, 0.12, -0.05), line(0.24, -0.42, 0.05, 0.3)],
  z: [line(0, -0.42, 0.24, -0.42, 0, 0, 0.25, 0)],
  'ß': [join(line(0, 0.2, 0, -0.55), arc(0.12, -0.55, 0.12, 0.17, 180, 360), line(0.24, -0.55, 0.08, -0.4), arc(0.1, -0.2, 0.14, 0.2, -90, 150))],
};

const UPPER = {
  A: [line(0, 0, 0.2, -0.72, 0.4, 0), line(0.08, -0.28, 0.32, -0.28)],
  B: [line(0, 0, 0, -0.72), join(line(0, -0.72, 0.16, -0.72), arc(0.16, -0.55, 0.14, 0.17, -90, 90), line(0.16, -0.38, 0, -0.38)), join(line(0, -0.38, 0.18, -0.38), arc(0.18, -0.19, 0.16, 0.19, -90, 90), line(0.18, 0, 0, 0))],
  C: [arc(0.25, -0.36, 0.25, 0.36, -40, -320)],
  D: [line(0, 0, 0, -0.72), join(line(0, -0.72, 0.12, -0.72), arc(0.12, -0.36, 0.26, 0.36, -90, 90), line(0.12, 0, 0, 0))],
  E: [line(0.3, -0.72, 0, -0.72, 0, 0, 0.3, 0), line(0, -0.37, 0.24, -0.37)],
  F: [line(0.3, -0.72, 0, -0.72, 0, 0), line(0, -0.37, 0.24, -0.37)],
  G: [join(arc(0.25, -0.36, 0.25, 0.36, -40, -360), line(0.5, -0.36, 0.28, -0.36))],
  H: [line(0, -0.72, 0, 0), line(0.36, -0.72, 0.36, 0), line(0, -0.37, 0.36, -0.37)],
  I: [line(0, -0.72, 0, 0)],
  J: [join(line(0.24, -0.72, 0.24, -0.15), arc(0.12, -0.15, 0.12, 0.15, 0, 180))],
  K: [line(0, -0.72, 0, 0), line(0.32, -0.72, 0, -0.3), line(0.09, -0.39, 0.34, 0)],
  L: [line(0, -0.72, 0, 0, 0.3, 0)],
  M: [line(0, 0, 0.04, -0.72, 0.22, -0.2, 0.4, -0.72, 0.44, 0)],
  N: [line(0, 0, 0, -0.72, 0.34, 0, 0.34, -0.72)],
  O: [O(0.25, -0.36, 0.25, 0.36)],
  P: [line(0, 0, 0, -0.72), join(line(0, -0.72, 0.16, -0.72), arc(0.16, -0.54, 0.16, 0.18, -90, 90), line(0.16, -0.36, 0, -0.36))],
  Q: [O(0.25, -0.36, 0.25, 0.36), line(0.3, -0.14, 0.52, 0.06)],
  R: [line(0, 0, 0, -0.72), join(line(0, -0.72, 0.16, -0.72), arc(0.16, -0.54, 0.16, 0.18, -90, 90), line(0.16, -0.36, 0, -0.36)), line(0.12, -0.36, 0.34, 0)],
  S: [join(arc(0.17, -0.54, 0.16, 0.18, -30, -270), arc(0.17, -0.18, 0.18, 0.18, -90, 150))],
  T: [line(0, -0.72, 0.4, -0.72), line(0.2, -0.72, 0.2, 0)],
  U: [join(line(0, -0.72, 0, -0.2), arc(0.17, -0.2, 0.17, 0.2, 180, 0), line(0.34, -0.2, 0.34, -0.72))],
  V: [line(0, -0.72, 0.19, 0, 0.38, -0.72)],
  W: [line(0, -0.72, 0.12, 0, 0.25, -0.5, 0.38, 0, 0.5, -0.72)],
  X: [line(0, -0.72, 0.36, 0), line(0.36, -0.72, 0, 0)],
  Y: [line(0, -0.72, 0.19, -0.36, 0.38, -0.72), line(0.19, -0.36, 0.19, 0)],
  Z: [line(0, -0.72, 0.36, -0.72, 0, 0, 0.38, 0)],
};

const EXTRA = {
  0: [O(0.15, -0.35, 0.15, 0.35)],
  1: [line(0.03, -0.55, 0.16, -0.7, 0.16, 0)],
  2: [join(arc(0.15, -0.52, 0.14, 0.17, -160, 25), line(0.27, -0.45, 0, 0, 0.3, 0))],
  3: [join(arc(0.14, -0.53, 0.13, 0.17, -150, 90), arc(0.14, -0.18, 0.15, 0.18, -90, 150))],
  4: [line(0.22, 0, 0.22, -0.7, 0, -0.22, 0.32, -0.22)],
  5: [join(line(0.28, -0.7, 0.04, -0.7, 0.02, -0.4), arc(0.15, -0.22, 0.15, 0.22, -125, 150))],
  6: [join(line(0.25, -0.7, 0.08, -0.45), arc(0.15, -0.2, 0.15, 0.2, 200, -160))],
  7: [line(0, -0.7, 0.3, -0.7, 0.1, 0)],
  8: [arc(0.15, -0.53, 0.12, 0.17, 90, 450), arc(0.15, -0.18, 0.15, 0.18, -90, 270)],
  9: [arc(0.15, -0.5, 0.15, 0.2, 0, 360), line(0.3, -0.5, 0.25, 0)],
  '.': [dot(0, 0)],
  ',': [line(0.03, -0.02, -0.01, 0.12)],
  ':': [dot(0, -0.3), dot(0, 0)],
  ';': [dot(0.03, -0.3), line(0.03, -0.02, -0.01, 0.12)],
  '!': [line(0, -0.72, 0, -0.2), dot(0, 0)],
  '?': [join(arc(0.13, -0.55, 0.13, 0.17, -160, 90), line(0.13, -0.38, 0.13, -0.2)), dot(0.13, 0)],
  '-': [line(0, -0.25, 0.2, -0.25)],
  "'": [line(0, -0.72, 0, -0.55)],
  '"': [line(0, -0.72, 0, -0.55), line(0.08, -0.72, 0.08, -0.55)],
  '(': [arc(0.2, -0.25, 0.2, 0.55, -120, -240)],
  ')': [arc(0, -0.25, 0.2, 0.55, -60, 60)],
  '&': [line(0.34, 0, 0.06, -0.5, 0.1, -0.68, 0.2, -0.68, 0.22, -0.55, 0.02, -0.2, 0.08, -0.02, 0.2, 0, 0.34, -0.25)],
  '/': [line(0, 0.05, 0.28, -0.75)],
  '%': [O(0.06, -0.58, 0.06, 0.1), line(0, 0, 0.32, -0.72), O(0.27, -0.12, 0.06, 0.1)],
  '+': [line(0, -0.25, 0.26, -0.25), line(0.13, -0.38, 0.13, -0.12)],
};

const UMLAUTS = { 'ä': ['a', -0.58], 'ö': ['o', -0.58], 'ü': ['u', -0.58], 'Ä': ['A', -0.88], 'Ö': ['O', -0.88], 'Ü': ['U', -0.88] };
for (const [u, [base, y]] of Object.entries(UMLAUTS)) {
  const src = (LOWER[base] || UPPER[base]);
  let maxX = 0;
  for (const s of src) for (const [x] of s) maxX = Math.max(maxX, x);
  const cx = maxX / 2;
  (u === u.toLowerCase() ? LOWER : UPPER)[u] = [...src, dot(cx - 0.07, y), dot(cx + 0.07, y)];
}

const SHAPES = { ...LOWER, ...UPPER, ...EXTRA };

// Feinere Punkte, damit die Verzerrungen weich wirken.
function densify(pts, step = 0.02) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 1; k <= n; k++) out.push([ax + (bx - ax) * (k / n), ay + (by - ay) * (k / n)]);
  }
  return out;
}

function variant(shape, rnd) {
  const slant = 0.14 + (rnd() - 0.5) * 0.08;   // leichte Rechtsneigung
  const sx = 1 + (rnd() - 0.5) * 0.1;
  const sy = 1 + (rnd() - 0.5) * 0.08;
  const strokes = shape.map((s) => {
    const pts = densify(s);
    const fx = 2 + rnd() * 3, fy = 2 + rnd() * 3, px = rnd() * 6, py = rnd() * 6;
    const amp = 0.006 + rnd() * 0.006;
    return pts.map(([x, y], i) => {
      const t = pts.length > 1 ? i / (pts.length - 1) : 0.5;
      const wx = Math.sin(t * fx + px) * amp;
      const wy = Math.sin(t * fy + py) * amp;
      const yy = y * sy + wy;
      const p = 0.35 + 0.45 * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.05));
      return [x * sx - yy * slant + wx, yy, Math.round(p * 100) / 100];
    });
  });
  return normalizeGlyph(strokes);
}

export function makeTestFont(variants = 3, seed = 7) {
  const rnd = mulberry32(seed);
  const f = newFont('Testschrift');
  f.passes = variants;
  for (const [ch, shape] of Object.entries(SHAPES)) {
    f.glyphs[ch] = Array.from({ length: variants }, () => variant(shape, rnd));
  }
  return f;
}
