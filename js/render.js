// Setzt einen Text mit einer Handschrift auf A4-Seiten (Einheit: PDF-Punkte, y nach unten).
import { PEN_EM, strokePath } from './glyphs.js';

// Seitenformate in PDF-Punkten. "goodnotes" entspricht dem Standardpapier von GoodNotes.
export const PAGE_FORMATS = {
  goodnotes: { w: 834.24, h: 1078.82, label: 'GoodNotes-Standard' },
  a4: { w: 595.28, h: 841.89, label: 'A4' },
  letter: { w: 612, h: 792, label: 'US Letter' },
};
export const PAGE = { w: PAGE_FORMATS.goodnotes.w, h: PAGE_FORMATS.goodnotes.h };
export function setPageFormat(key) {
  const f = PAGE_FORMATS[key] || PAGE_FORMATS.goodnotes;
  PAGE.w = f.w; PAGE.h = f.h;
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const UMLAUT_BASE = { 'ä': 'a', 'ö': 'o', 'ü': 'u', 'Ä': 'A', 'Ö': 'O', 'Ü': 'U' };
const SUBST = { '„': '"', '“': '"', '”': '"', '»': '"', '«': '"', '‚': "'", '‘': "'", '’': "'", '–': '-', '—': '-', 'ẞ': 'SS' };

// Ersetzt Zeichen, die in der Schrift fehlen, durch naheliegende Alternativen.
function prepareText(text, font) {
  const has = (c) => font.glyphs[c]?.length;
  let out = '';
  for (const ch of text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ')) {
    if (has(ch) || ch === ' ' || ch === '\n') out += ch;
    else if (ch === 'ß') out += 'ss';
    else if (SUBST[ch]) out += SUBST[ch];
    else out += ch;
  }
  return out;
}

function lookup(font, ch) {
  const g = font.glyphs;
  if (g[ch]?.length) return { variants: g[ch] };
  const base = UMLAUT_BASE[ch];
  if (base && g[base]?.length) return { variants: g[base], dots: true, upper: ch !== ch.toLowerCase() };
  const alt = ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase();
  if (alt !== ch && alt.length === 1 && g[alt]?.length) return { variants: g[alt] };
  return null;
}

// Zwei Punkte über einem Grundbuchstaben, falls die Schrift kein eigenes Ä/Ö/Ü hat.
function umlautDots(v, upper, rnd) {
  const cx = (v.w - 0.12) / 2;
  const y = upper ? -0.9 : -0.6;
  const d = (dx) => {
    const x = cx + dx + (rnd() - 0.5) * 0.02;
    return [[x, y, 0.6], [x + 0.02, y + 0.015, 0.6]];
  };
  return [d(-0.08), d(0.08)];
}

export const DEFAULT_OPTS = {
  pageFormat: 'goodnotes',
  size: 22, lineHeight: 1.45, letterSpacing: 0, wordSpacing: 0.38, variation: 0.6,
  penScale: 1, color: '#1b2a4a', paper: 'lined', lineColor: 'blue', lineWidth: 0.5, gridSize: 5, margin: 56, seed: 1,
};

export function layout(text, font, o) {
  const rnd = mulberry32(o.seed);
  const v = o.variation;
  const size = o.size;
  const lh = size * o.lineHeight;
  const left = o.margin, right = PAGE.w - o.margin, top = o.margin, bottom = PAGE.h - o.margin;
  // Schriften aus einer beschriebenen Vorlage bringen ihre eigene Strichdicke mit (font.penEm).
  const penW = (font.penEm || PEN_EM) * o.penScale * size;
  const pages = [];
  const missing = new Set();
  const lastVar = {};
  let page, y, x = left, slope = 0, gid = 0;

  const newSlope = () => { slope = (rnd() - 0.5) * 2 * 0.01 * v; };
  const newPage = () => { page = { strokes: [] }; pages.push(page); y = top + size; };
  const newLine = () => {
    x = left; y += lh; newSlope();
    if (y > bottom) newPage();
  };
  newPage(); newSlope();

  const makeGlyph = (ch) => {
    const L = lookup(font, ch);
    if (!L) { missing.add(ch); return { strokes: [], adv: 0.45 * size, sc: 1, rot: 0, dy: 0 }; }
    const vars = L.variants;
    let idx = 0;
    if (vars.length > 1) {
      idx = Math.floor(rnd() * vars.length);
      if (idx === lastVar[ch]) idx = (idx + 1 + Math.floor(rnd() * (vars.length - 1))) % vars.length;
    }
    lastVar[ch] = idx;
    const vr = vars[idx];
    const sc = 1 + (rnd() - 0.5) * 2 * 0.06 * v;
    const rot = (rnd() - 0.5) * 2 * 0.045 * v;
    const dy = (rnd() - 0.5) * 2 * 0.03 * v;
    const extra = (rnd() - 0.5) * 2 * 0.03 * v;
    const strokes = L.dots ? vr.strokes.concat(umlautDots(vr, L.upper, rnd)) : vr.strokes;
    return { strokes, sc, rot, dy, adv: (vr.w * sc + o.letterSpacing + extra) * size };
  };

  const place = (gl, g) => {
    const cos = Math.cos(gl.rot), sin = Math.sin(gl.rot);
    for (const s of gl.strokes) {
      const pts = s.map(([px, py, p]) => {
        const ex = (px * cos - py * sin) * gl.sc;
        const ey = (px * sin + py * cos) * gl.sc;
        const X = x + ex * size;
        const Y = y + (gl.dy + ey) * size + (X - left) * slope;
        return [Math.round(X * 100) / 100, Math.round(Y * 100) / 100, p];
      });
      page.strokes.push({ pts, w: penW, c: o.color, g });
    }
  };

  const spaceW = () => o.wordSpacing * size * (1 + (rnd() - 0.5) * 0.3 * v);
  const paras = prepareText(text, font).split('\n');
  paras.forEach((para, pi) => {
    if (pi > 0) newLine();
    for (const word of para.split(' ')) {
      if (!word) { x += spaceW(); continue; }
      const glyphs = [...word].map(makeGlyph);
      const w = glyphs.reduce((s, g) => s + g.adv, 0);
      if (x > left && x + w > right) newLine();
      const g = 'w' + gid++;
      for (const gl of glyphs) {
        if (x > left && x + gl.adv > right) newLine(); // nur bei Wörtern, die länger als eine Zeile sind
        place(gl, g);
        x += gl.adv;
      }
      x += spaceW();
    }
  });

  return { pages, missing: [...missing] };
}

const MM = 72 / 25.4;

// Linien für liniertes oder kariertes Papier, als [x1, y1, x2, y2] in Punkten.
export function paperLines(paper, o) {
  const lines = [];
  if (paper === 'lined') {
    const lh = o.size * o.lineHeight;
    for (let y = o.margin + o.size; y <= PAGE.h - o.margin + 0.1; y += lh) lines.push([0, y, PAGE.w, y]);
  } else if (paper === 'grid') {
    const step = (o.gridSize || 5) * MM;
    for (let y = step; y < PAGE.h; y += step) lines.push([0, y, PAGE.w, y]);
    for (let x = step; x < PAGE.w; x += step) lines.push([x, 0, x, PAGE.h]);
  }
  return lines;
}

// Linienfarben fürs Papier. "blue" entspricht den Standardlinien von Notability.
// Farben aus echten Notability- und GoodNotes-Exporten abgelesen.
export const LINE_COLORS = {
  blue: { hex: '#a3b7d3', label: 'Blau (Notability)' },
  gray: { hex: '#d0d2d3', label: 'Grau (GoodNotes)' },
  black: { hex: '#000000', label: 'Schwarz' },
};
export const PAPER = { color: LINE_COLORS.blue.hex, width: 0.5 };
export function setPaperStyle(key, width) {
  PAPER.color = (LINE_COLORS[key] || LINE_COLORS.blue).hex;
  PAPER.width = width > 0 ? width : 0.5;
}

export function drawPage(ctx, page, lines, scale) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PAGE.w * scale, PAGE.h * scale);
  ctx.strokeStyle = PAPER.color;
  ctx.lineWidth = Math.max(PAPER.width * scale, 0.5);
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of lines) { ctx.moveTo(x1 * scale, y1 * scale); ctx.lineTo(x2 * scale, y2 * scale); }
  ctx.stroke();
  for (const s of page.strokes) strokePath(ctx, s.pts, s.w * scale, s.c, ([x, y]) => [x * scale, y * scale]);
}
