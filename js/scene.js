// Setzt eine Seitenbeschreibung (KI-Datei, siehe docs/ki-format.md) in Handschrift.
// Alles wird zu Stiftstrichen: Text, Unterstreichungen, Markierungen, Tabellen und Zeichnungen.
// Dadurch funktionieren Editor und alle Exporte ohne Änderung.
//
// Layout: Jedes Element liefert "Blöcke" { n, s, u }. n ist die Zahl der belegten Zeilen,
// s die Striche, u die Striche unter dem Text (Textmarker). x ist absolut auf der Seite,
// y relativ zur ersten Grundlinie des Blocks. So landet jeder Text auf einer Papierlinie.
import { PAGE, mulberry32, makeGlyphMaker, glyphPoints, prepareText, lookup } from './render.js';
import { PEN_EM, GLYPH_GAP } from './glyphs.js';

export const INK = {
  rot: '#c62828', blau: '#1f4fbf', gruen: '#2e7d32', grün: '#2e7d32', orange: '#e65100', gelb: '#c79100',
  lila: '#6a1b9a', violett: '#6a1b9a', pink: '#c2185b', rosa: '#c2185b', braun: '#6d4c41', grau: '#6b7280',
  tuerkis: '#00838f', türkis: '#00838f', hellblau: '#0288d1', dunkelblau: '#1a237e', dunkelrot: '#8e0000',
};
const DEFAULT_INK = new Set(['schwarz', 'weiss', 'weiß', 'standard', 'normal', 'kreide', '']);

export const MARKER = {
  gelb: '#fff27a', gruen: '#c6f3a0', grün: '#c6f3a0', rosa: '#ffc4df', pink: '#ffc4df', blau: '#c2e2ff',
  hellblau: '#c2e2ff', orange: '#ffd6a0', lila: '#e2d2ff', violett: '#e2d2ff', grau: '#e3e5e8', rot: '#ffc9c4',
  tuerkis: '#bff0ec', türkis: '#bff0ec',
};

const isHex = (s) => /^#[0-9a-f]{6}$/i.test(s);

/* ---------- Datei lesen ---------- */

// Nimmt die Antwort der KI so, wie sie kommt: mit oder ohne Codeblock und Begleitsatz.
export function parseSceneText(raw) {
  let t = String(raw || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('In der Datei steht kein JSON-Objekt.');
  t = t.slice(a, b + 1);
  let doc;
  try {
    doc = JSON.parse(t);
  } catch (e) {
    // Häufige KI-Fehler: Komma vor schließender Klammer, typografische Anführungszeichen.
    const fixed = t.replace(/,\s*([}\]])/g, '$1').replace(/[“”„]/g, '"');
    try { doc = JSON.parse(fixed); } catch { throw new Error('Das JSON ist fehlerhaft: ' + e.message); }
  }
  return normalizeScene(doc);
}

export function normalizeScene(doc) {
  if (Array.isArray(doc)) doc = { seiten: doc };
  if (!doc || typeof doc !== 'object') throw new Error('Unbekanntes Format.');
  let seiten = doc.seiten || doc.pages;
  if (!seiten && doc.elemente) seiten = [{ elemente: doc.elemente }];
  if (!Array.isArray(seiten) || !seiten.length) throw new Error('Die Datei enthält keine Seiten ("seiten" fehlt).');
  seiten = seiten.map((s) => (Array.isArray(s) ? { elemente: s } : { ...s, elemente: s.elemente || s.elements || [] }));
  return { ...doc, seiten };
}

export function sceneInfo(doc) {
  const count = (els) => els.reduce((n, e) => n + 1 + (e.art === 'spalten' ? (e.spalten || []).reduce((m, c) => m + count(Array.isArray(c) ? c : c.elemente || []), 0) : 0), 0);
  return { pages: doc.seiten.length, elements: doc.seiten.reduce((n, s) => n + count(s.elemente), 0) };
}

/* ---------- Handgezeichnete Linien ---------- */

const r2 = (v) => Math.round(v * 100) / 100;

// Zieht eine Linie durch die Punkte, mit leichtem Zittern wie von Hand.
function wobbly(ctx, pts, { amp = null, p = 0.5, jitter = 1 } = {}) {
  const rnd = ctx.rnd;
  const v = ctx.o.variation;
  const vs = pts.map(([x, y]) => [x + (rnd() - 0.5) * jitter * v, y + (rnd() - 0.5) * jitter * v]);
  let total = 0;
  for (let i = 1; i < vs.length; i++) total += Math.hypot(vs[i][0] - vs[i - 1][0], vs[i][1] - vs[i - 1][1]);
  const A = amp ?? Math.min(1.5, 0.2 + total * 0.0035) * (0.4 + v);
  const ph = rnd() * 6.28, ph2 = rnd() * 6.28, fr = 0.012 + rnd() * 0.018;
  const out = [];
  let acc = 0;
  for (let i = 1; i < vs.length; i++) {
    const [ax, ay] = vs[i - 1], [bx, by] = vs[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 0.01) continue;
    const nx = -(by - ay) / len, ny = (bx - ax) / len;
    const steps = Math.max(1, Math.ceil(len / 6));
    for (let k = out.length ? 1 : 0; k <= steps; k++) {
      const t = k / steps, d = acc + t * len;
      const env = Math.min(1, d / 8, (total - d) / 8 + 0.2);
      const off = A * env * (Math.sin(d * fr + ph) * 0.75 + Math.sin(d * fr * 2.9 + ph2) * 0.25);
      out.push([r2(ax + (bx - ax) * t + nx * off), r2(ay + (by - ay) * t + ny * off), r2(p + 0.07 * Math.sin(d * 0.04 + ph2))]);
    }
    acc += len;
  }
  if (!out.length && vs.length) out.push([r2(vs[0][0]), r2(vs[0][1]), p]);
  if (out.length > 2) { out[0][2] = r2(p * 0.75); out[out.length - 1][2] = r2(p * 0.8); }
  return out;
}

function ellipsePts(ctx, cx, cy, rx, ry) {
  const rnd = ctx.rnd;
  const a0 = rnd() * Math.PI * 2, over = 0.25 + rnd() * 0.3, ph = rnd() * 6.28;
  const n = Math.max(20, Math.ceil((rx + ry) / 3));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const t = a0 + (Math.PI * 2 + over) * f;
    const m = 1 + 0.035 * Math.sin(2 * t + ph) + 0.05 * f * ctx.o.variation;
    out.push([r2(cx + Math.cos(t) * rx * m), r2(cy + Math.sin(t) * ry * m), r2(0.5 + 0.06 * Math.sin(t * 3))]);
  }
  return out;
}

function rectPts(ctx, x1, y1, x2, y2) {
  const o = Math.min(4, (x2 - x1) * 0.04) * (0.3 + ctx.o.variation);
  return wobbly(ctx, [[x1 - o, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1 - o]]);
}

function arcPts(cx, cy, rx, ry, a1, a2) {
  const out = [];
  const n = Math.max(8, Math.ceil(Math.abs(a2 - a1) * Math.max(rx, ry) / 5));
  for (let i = 0; i <= n; i++) {
    const t = a1 + ((a2 - a1) * i) / n;
    out.push([cx + Math.cos(t) * rx, cy - Math.sin(t) * ry]);
  }
  return out;
}

// Catmull-Rom durch alle Punkte.
function smooth(pts) {
  if (pts.length < 3) return pts;
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    for (let k = 0; k < 8; k++) {
      const t = k / 8, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function arrowHead(ctx, tip, from, scale = 1) {
  const ang = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const L = Math.max(5, ctx.size * 0.42) * scale;
  const s = 0.42 + (ctx.rnd() - 0.5) * 0.1;
  const a = [tip[0] - Math.cos(ang - s) * L, tip[1] - Math.sin(ang - s) * L];
  const b = [tip[0] - Math.cos(ang + s) * L, tip[1] - Math.sin(ang + s) * L];
  return wobbly(ctx, [a, tip, b], { amp: 0.2, jitter: 0.4 });
}

// Teilt einen Strich in Striche für eine gestrichelte Linie.
function dashes(pts, on, off) {
  const out = [];
  let cur = [], d = 0, drawing = true;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const lim = drawing ? on : off;
    if (d >= lim) {
      if (drawing) { cur.push(pts[i]); if (cur.length > 1) out.push(cur); }
      cur = drawing ? [] : [pts[i]];
      drawing = !drawing; d = 0;
    } else if (drawing) cur.push(pts[i]);
  }
  if (drawing && cur.length > 1) out.push(cur);
  return out;
}

// Flächen füllen wie mit dem Textmarker: waagerechte breite Striche. widthAt(y) liefert [x1, x2] oder null.
function hatch(ctx, y1, y2, widthAt, color, g) {
  const hw = Math.min(ctx.size * 0.8, Math.max(4, (y2 - y1) * 0.9));
  const out = [];
  const rows = Math.max(1, Math.round((y2 - y1 - hw * 0.4) / (hw * 0.8)));
  const step = (y2 - y1 - hw * 0.9) / Math.max(1, rows - 1 || 1);
  for (let i = 0; i < rows; i++) {
    const y = rows === 1 ? (y1 + y2) / 2 : y1 + hw * 0.45 + step * i;
    // Die Strichenden sind rund und so breit wie der Strich: darum oben und unten prüfen und einrücken.
    const a = widthAt(Math.max(y1, y - hw * 0.4)), b = widthAt(Math.min(y2, y + hw * 0.4));
    if (!a || !b) continue;
    const x1 = Math.max(a[0], b[0]) + hw * 0.45, x2 = Math.min(a[1], b[1]) - hw * 0.45;
    if (x2 - x1 < 1) continue;
    out.push({ pts: wobbly(ctx, [[x1, y], [x2, y]], { amp: 0.3, jitter: 0.5 }), w: hw, c: color, g });
  }
  return out;
}

/* ---------- Textauszeichnung ---------- */

const ink = (ctx, name) => {
  if (!name) return null;
  const k = String(name).toLowerCase().trim();
  if (isHex(k)) return k;
  if (DEFAULT_INK.has(k)) return ctx.o.color;
  return INK[k] || null;
};
const marker = (name) => {
  if (!name) return null;
  const k = String(name).toLowerCase().trim();
  if (isHex(k)) return k;
  return MARKER[k] || null;
};

// Zerlegt Text mit Auszeichnung in Zeichen mit Merkmalen.
// __unterstrichen__  ==markiert==  ~~durchgestrichen~~  [[eingerahmt]]  {{eingekreist}}
// <rot>farbig</rot>  <markiert:gruen>andere Markerfarbe</markiert>
function parseInline(ctx, raw, color, hc) {
  const str = prepareText(String(raw ?? ''), ctx.font);
  const out = [];
  const m = { u: 0, h: 0, s: 0, k: 0, o: 0 };
  const cs = [color], hs = [hc];
  for (let i = 0; i < str.length;) {
    const two = str.substr(i, 2);
    if (two === '__') { m.u = m.u ? 0 : 1; i += 2; continue; }
    if (two === '==') { m.h = m.h ? 0 : 1; i += 2; continue; }
    if (two === '~~') { m.s = m.s ? 0 : 1; i += 2; continue; }
    if (two === '[[') { m.k = ++ctx.span; i += 2; continue; }
    if (two === ']]' && m.k) { m.k = 0; i += 2; continue; }
    if (two === '{{') { m.o = ++ctx.span; i += 2; continue; }
    if (two === '}}' && m.o) { m.o = 0; i += 2; continue; }
    if (str[i] === '<') {
      const t = /^<(\/?)([a-zA-ZäöüÄÖÜß]+)(?::\s*([#\w äöüß-]+))?>/.exec(str.slice(i));
      if (t) {
        const [all, close, name0, arg] = t;
        const name = name0.toLowerCase();
        let ok = true;
        if (name === 'markiert' || name === 'marker') {
          if (close) { if (hs.length > 1) hs.pop(); m.h = 0; } else { hs.push(marker(arg) || hc); m.h = 1; }
        } else if (name === 'farbe') {
          if (close) { if (cs.length > 1) cs.pop(); } else cs.push(ink(ctx, arg) || color);
        } else if (ink(ctx, name)) {
          if (close) { if (cs.length > 1) cs.pop(); } else cs.push(ink(ctx, name));
        } else ok = false;
        if (ok) { i += all.length; continue; }
      }
    }
    const ch = String.fromCodePoint(str.codePointAt(i));
    i += ch.length;
    if (ch === '\r') continue;
    out.push({ ch: ch === '\t' ? ' ' : ch, m: { ...m }, c: cs[cs.length - 1], hc: hs[hs.length - 1] });
  }
  return out;
}

const plain = (ctx, raw) => parseInline(ctx, raw, '#000', '#fff').map((r) => r.ch).join('');

// Ungefähre Breite eines Textes in Punkten, ohne Zufall (für Tabellenspalten).
function measure(ctx, text, size) {
  let w = 0;
  for (const ch of text) {
    if (ch === ' ') { w += ctx.o.wordSpacing * size; continue; }
    const L = lookup(ctx.font, ch);
    w += ((L ? L.variants[0].w : 0.45) + ctx.o.letterSpacing) * size;
  }
  return w;
}

/* ---------- Zeilen setzen ---------- */

function typesetLines(ctx, runs, width, size) {
  const v = ctx.o.variation;
  const lines = [];
  let line = { items: [], w: 0 };
  const hasInk = () => line.items.some((it) => !it.space);
  const push = () => {
    while (line.items.length && line.items[line.items.length - 1].space) line.w -= line.items.pop().adv;
    lines.push(line);
    line = { items: [], w: 0 };
  };
  let word = null;
  const flushWord = () => {
    if (!word) return;
    const ww = word.reduce((s, it) => s + it.adv, 0);
    if (hasInk() && line.w + ww > width) push();
    for (const it of word) {
      if (hasInk() && line.w + it.adv > width) push();
      line.items.push(it); line.w += it.adv;
    }
    word = null;
  };
  for (const r of runs) {
    if (r.ch === '\n') { flushWord(); push(); continue; }
    if (r.ch === ' ') {
      flushWord();
      const adv = ctx.o.wordSpacing * size * (1 + (ctx.rnd() - 0.5) * 0.3 * v);
      line.items.push({ space: true, r, adv }); line.w += adv;
      continue;
    }
    const gl = ctx.glyph(r.ch);
    (word ||= []).push({ gl, r, adv: gl.adv * size });
  }
  flushWord();
  push();
  // Leerzeichen am Zeilenanfang (nach Umbruch) entfernen, außer bei bewusstem Einzug in der ersten Zeile.
  lines.forEach((l, i) => {
    if (i === 0) return;
    while (l.items.length && l.items[0].space) l.w -= l.items.shift().adv;
  });
  return lines;
}

// Schreibt eine gesetzte Zeile. y ist die Grundlinie (relativ zum Block).
function emitLine(ctx, line, x0, width, align, size, y, opts = {}) {
  const v = ctx.o.variation;
  const s = [], u = [];
  let x = x0;
  if (align === 'mitte' || align === 'center') x = x0 + Math.max(0, (width - line.w) / 2);
  else if (align === 'rechts' || align === 'right') x = x0 + Math.max(0, width - line.w);
  const startX = x;
  const slope = (ctx.rnd() - 0.5) * 2 * 0.008 * v * Math.min(1, 300 / Math.max(width, 1));
  const penW = ctx.penW * (size / ctx.size) ** 0.6 * (opts.weight || 1);
  let g = ctx.gid();
  for (const it of line.items) {
    it.x = x;
    if (it.space) { g = ctx.gid(); x += it.adv; continue; }
    for (const pts of glyphPoints(it.gl, x, y, size, slope, startX)) s.push({ pts, w: penW, c: it.r.c, g });
    x += it.adv;
  }
  const yAt = (xx, dy) => y + dy + (xx - startX) * slope;
  const gap = GLYPH_GAP * size * 0.8;
  const items = line.items;

  // Läufe gleicher Auszeichnung finden (Leerzeichen am Rand gehören nicht dazu).
  const runsOf = (key, same) => {
    const out = [];
    let cur = null;
    for (const it of items) {
      const val = it.r.m[key];
      if (val && cur && same(cur.first, it)) cur.items.push(it);
      else if (val) { cur = { first: it, items: [it] }; out.push(cur); }
      else cur = null;
    }
    return out.map((r) => {
      const a = r.items.findIndex((it) => !it.space);
      let b = r.items.length - 1;
      while (b >= 0 && r.items[b].space) b--;
      if (a < 0) return null;
      const first = r.items[a], last = r.items[b];
      return { xa: first.x, xb: last.x + last.adv - gap, c: first.r.c, hc: first.r.hc };
    }).filter(Boolean);
  };
  const dw = ctx.penW * 0.9;
  for (const r of runsOf('h', (a, b) => a.r.hc === b.r.hc)) {
    const hw = size * 0.78;
    u.push({ pts: wobbly(ctx, [[r.xa - 1, yAt(r.xa, -0.3 * size)], [r.xb + 1, yAt(r.xb, -0.3 * size)]], { amp: 0.4, jitter: 0.6 }), w: hw, c: r.hc, g: ctx.gid() });
  }
  for (const r of runsOf('u', () => true)) {
    s.push({ pts: wobbly(ctx, [[r.xa - 1, yAt(r.xa, 0.14 * size)], [r.xb + 2, yAt(r.xb, 0.14 * size)]]), w: dw, c: r.c, g: ctx.gid() });
  }
  for (const r of runsOf('s', () => true)) {
    s.push({ pts: wobbly(ctx, [[r.xa - 2, yAt(r.xa, -0.24 * size)], [r.xb + 2, yAt(r.xb, -0.27 * size)]]), w: dw, c: r.c, g: ctx.gid() });
  }
  for (const r of runsOf('k', (a, b) => a.r.m.k === b.r.m.k)) {
    const p = size * 0.18;
    s.push({ pts: rectPts(ctx, r.xa - p, yAt(r.xa, -0.92 * size), r.xb + p, yAt(r.xa, 0.3 * size)), w: dw, c: r.c, g: ctx.gid() });
  }
  for (const r of runsOf('o', (a, b) => a.r.m.o === b.r.m.o)) {
    const cx = (r.xa + r.xb) / 2;
    s.push({ pts: ellipsePts(ctx, cx, yAt(cx, -0.3 * size), (r.xb - r.xa) / 2 + size * 0.3, size * 0.62), w: dw, c: r.c, g: ctx.gid() });
  }
  if (opts.underline) {
    const ink0 = items.filter((it) => !it.space);
    if (ink0.length) {
      const xa = ink0[0].x, xb = ink0[ink0.length - 1].x + ink0[ink0.length - 1].adv - gap;
      const c = opts.underlineColor || ink0[0].r.c;
      s.push({ pts: wobbly(ctx, [[xa - 2, yAt(xa, 0.16 * size)], [xb + 3, yAt(xb, 0.16 * size)]]), w: dw * 1.1, c, g: ctx.gid() });
      if (opts.underline === 2) s.push({ pts: wobbly(ctx, [[xa, yAt(xa, 0.16 * size + 3.2)], [xb + 1, yAt(xb, 0.16 * size + 3.2)]]), w: dw * 1.1, c, g: ctx.gid() });
    }
  }
  return { s, u, w: line.w, x: startX };
}

/* ---------- Blöcke ---------- */

const shift = (list, dx, dy) => list.map((st) => ({ ...st, pts: st.pts.map(([x, y, p]) => [r2(x + dx), r2(y + dy), p]) }));

function combine(ctx, units) {
  const out = { n: 0, s: [], u: [] };
  for (const un of units) {
    const dy = out.n * ctx.lh;
    out.s.push(...shift(un.s, 0, dy));
    out.u.push(...shift(un.u, 0, dy));
    out.n += un.n;
  }
  out.n = Math.max(out.n, 1);
  return out;
}

const bandTop = (ctx) => -0.72 * ctx.lh;
const bandBottom = (ctx, n) => (n - 1) * ctx.lh + 0.28 * ctx.lh;

function textUnits(ctx, text, x0, x1, opts = {}) {
  const scale = Number(opts.scale) > 0 ? Number(opts.scale) : 1;
  const size = ctx.size * scale;
  const L = Math.max(1, Math.ceil(scale - 0.08));
  const color = ink(ctx, opts.color) || ctx.o.color;
  const hc = marker(opts.marker) || MARKER.gelb;
  const runs = parseInline(ctx, text, color, hc);
  const lines = typesetLines(ctx, runs, x1 - x0, size);
  return lines.map((line) => {
    const e = emitLine(ctx, line, x0, x1 - x0, opts.align, size, (L - 1) * ctx.lh, opts);
    return { n: L, s: e.s, u: e.u };
  });
}

function boxAround(ctx, unit, x0, x1, opts) {
  const top = bandTop(ctx) + 2, bot = bandBottom(ctx, unit.n) - 1;
  const c = ink(ctx, opts.rahmenfarbe) || ink(ctx, opts.farbe) || ctx.o.color;
  if (opts.rahmen) unit.s.push({ pts: rectPts(ctx, x0, top, x1, bot), w: ctx.penW * 0.9, c, g: ctx.gid() });
  const fill = marker(opts.hintergrund);
  if (fill) unit.u.unshift(...hatch(ctx, top, bot, () => [x0, x1], fill, ctx.gid()));
  return unit;
}

const textOpts = (el) => ({
  scale: el.groesse, align: el.ausrichtung, color: el.farbe, marker: el.markierfarbe,
});

function buildText(ctx, el, x0, x1, extra = {}) {
  const framed = el.rahmen || el.hintergrund;
  const pad = framed ? ctx.size * 0.45 : 0;
  const ind = (Number(el.einzug) || 0) * ctx.size * 1.5;
  const units = textUnits(ctx, el.text, x0 + ind + pad, x1 - pad, { ...textOpts(el), ...extra });
  if (!framed) return units;
  return [boxAround(ctx, combine(ctx, units), x0 + ind, x1, el)];
}

function buildHeading(ctx, el, x0, x1) {
  const ul = el.unterstrichen === 'doppelt' ? 2 : el.unterstrichen === false ? 0 : el.unterstrichen ? 1 : 0;
  const units = buildText(ctx, { groesse: 1.35, ...el }, x0, x1, { underline: ul, underlineColor: ink(ctx, el.linienfarbe) });
  if (units.length) units[units.length - 1].keep = true;
  return units;
}

function buildList(ctx, el, x0, x1, depth = 0) {
  const items = el.punkte || el.eintraege || el.items || [];
  const units = [];
  items.forEach((it, i) => {
    const o = typeof it === 'string' ? { text: it } : it || {};
    const ind = x0 + depth * ctx.size * 1.3;
    let mark = el.nummeriert ? `${(Number(el.start) || 1) + i}.` : (o.zeichen || el.zeichen || (depth ? '•' : '-'));
    if (el.nummeriert === 'a') mark = `${String.fromCharCode(97 + i)})`;
    const color = ink(ctx, o.farbe || el.farbe) || ctx.o.color;
    const mRuns = parseInline(ctx, mark, ink(ctx, el.zeichenfarbe) || color, MARKER.gelb);
    const mLine = typesetLines(ctx, mRuns, 1e6, ctx.size)[0];
    const mw = Math.max(mLine.w + ctx.size * 0.35, ctx.size * 0.9);
    const tu = textUnits(ctx, o.text, ind + mw, x1, { color: o.farbe || el.farbe, marker: el.markierfarbe });
    const me = emitLine(ctx, mLine, ind, mw, 'links', ctx.size, 0);
    if (tu.length) { tu[0].s.push(...me.s); }
    units.push(...tu);
    const sub = o.unterpunkte || o.punkte;
    if (Array.isArray(sub) && sub.length) units.push(...buildList(ctx, { ...el, punkte: sub, nummeriert: o.nummeriert ?? (el.nummeriert ? 'a' : false), start: 1 }, x0, x1, depth + 1));
  });
  return units;
}

function buildRule(ctx, el, x0, x1) {
  const y = -0.22 * ctx.lh;
  const c = ink(ctx, el.farbe) || ctx.o.color;
  const st = { pts: wobbly(ctx, [[x0, y], [x1, y]]), w: ctx.penW * 0.9, c, g: ctx.gid() };
  return [{ n: 1, s: el.gestrichelt ? dashes(st.pts, ctx.size * 0.5, ctx.size * 0.3).map((p) => ({ ...st, pts: p })) : [st], u: [] }];
}

/* ---------- Tabellen ---------- */

function buildTable(ctx, el, x0, x1) {
  const rows = (el.zeilen || el.rows || []).map((r) => (Array.isArray(r) ? r : [r]));
  if (!rows.length) return [];
  const nc = Math.max(...rows.map((r) => r.length));
  const cell = (r, c) => {
    const v = rows[r][c];
    return v && typeof v === 'object' ? v : { text: v == null ? '' : String(v) };
  };
  const pad = ctx.size * 0.35;
  const avail = x1 - x0;
  let widths;
  if (Array.isArray(el.breiten) && el.breiten.length === nc) {
    const sum = el.breiten.reduce((a, b) => a + (Number(b) || 1), 0);
    widths = el.breiten.map((b) => (avail * (Number(b) || 1)) / sum);
  } else {
    widths = [];
    for (let c = 0; c < nc; c++) {
      let w = ctx.size * 1.6;
      for (let r = 0; r < rows.length; r++) {
        const t = plain(ctx, cell(r, c).text);
        for (const part of t.split('\n')) w = Math.max(w, measure(ctx, part, ctx.size) + 2 * pad + ctx.size * 0.3);
      }
      widths.push(w);
    }
    const sum = widths.reduce((a, b) => a + b, 0);
    const target = el.breite === 'voll' ? avail : Math.min(avail, sum);
    if (sum > target || el.breite === 'voll') {
      // Zu breit: lange Spalten stärker kürzen als kurze.
      const min = ctx.size * 2.2;
      const k = target / sum;
      widths = widths.map((w) => Math.max(Math.min(w, min), w * k));
      const s2 = widths.reduce((a, b) => a + b, 0);
      widths = widths.map((w) => (w * target) / s2);
    }
  }
  const tw = widths.reduce((a, b) => a + b, 0);
  const tx = el.ausrichtung === 'mitte' ? x0 + (avail - tw) / 2 : x0;
  const xs = [tx];
  widths.forEach((w) => xs.push(xs[xs.length - 1] + w));

  const head = el.kopfzeile === true || (el.kopfzeile === undefined && (el.kopf === true || /^t-?konto$/i.test(String(el.rahmen))));
  const rowUnits = rows.map((row, r) => {
    const cols = [];
    let n = 1;
    for (let c = 0; c < nc; c++) {
      const o = cell(r, c);
      const tu = textUnits(ctx, o.text, xs[c] + pad, xs[c + 1] - pad, {
        align: o.ausrichtung || el.ausrichtung_zellen || (head && r === 0 ? 'mitte' : 'links'),
        color: o.farbe || (head && r === 0 ? el.kopffarbe : null) || el.farbe,
        marker: el.markierfarbe,
      });
      const u = combine(ctx, tu);
      const fill = marker(o.hintergrund || (head && r === 0 ? el.kopfhintergrund : null));
      cols.push({ u, fill, c });
      n = Math.max(n, u.n);
    }
    const out = { n, s: [], u: [] };
    for (const { u, fill, c } of cols) {
      out.s.push(...u.s); out.u.push(...u.u);
      if (fill) out.u.unshift(...hatch(ctx, bandTop(ctx) + 1, bandBottom(ctx, n) - 1, () => [xs[c] + 1, xs[c + 1] - 1], fill, ctx.gid()));
    }
    return out;
  });

  const frame0 = String(el.rahmen || 'voll').toLowerCase().replace(/[^a-z]/g, '');
  const tkonto = frame0 === 'tkonto' || frame0 === 'kreuz';
  const frame = tkonto ? 'innen' : ['voll', 'innen', 'keiner'].includes(frame0) ? frame0 : 'voll';
  const rowLines = el.zeilenlinien !== undefined ? !!el.zeilenlinien : !tkonto;
  const lc = ink(ctx, el.linienfarbe) || ctx.o.color;
  const lw = ctx.penW * 0.85;
  const chunks = [];
  let cur = [], curN = 0;
  rowUnits.forEach((ru, i) => {
    if (cur.length && curN + ru.n > ctx.linesPerPage) { chunks.push({ rows: cur, start: i - cur.length }); cur = []; curN = 0; }
    cur.push(ru); curN += ru.n;
  });
  if (cur.length) chunks.push({ rows: cur, start: rows.length - cur.length });

  return chunks.map(({ rows: rs, start }) => {
    const un = combine(ctx, rs);
    const top = bandTop(ctx), bot = bandBottom(ctx, un.n);
    const ys = [top];
    let acc = 0;
    for (const r of rs) { acc += r.n; ys.push(top + acc * ctx.lh); }
    ys[ys.length - 1] = bot;
    const line = (pts) => un.s.push({ pts: wobbly(ctx, pts), w: lw, c: lc, g: ctx.gid() });
    const ov = frame === 'innen' ? ctx.size * 0.3 : 0;
    for (let i = 0; i < ys.length; i++) {
      const outer = i === 0 || i === ys.length - 1;
      const isHead = head && start + i === 1;
      if (outer && frame !== 'voll') continue;
      if (!outer && (frame === 'keiner' || !rowLines) && !isHead) continue;
      line([[xs[0] - ov, ys[i]], [xs[nc] + ov, ys[i]]]);
      if (isHead && frame !== 'innen') line([[xs[0], ys[i] + 2.6], [xs[nc], ys[i] + 2.6]]);
    }
    if (frame !== 'keiner') {
      for (let c = 0; c <= nc; c++) {
        const outer = c === 0 || c === nc;
        if (outer && frame !== 'voll') continue;
        line([[xs[c], top - (frame === 'innen' && start === 0 ? ov : 0)], [xs[c], bot + ov]]);
      }
    }
    return un;
  });
}

/* ---------- Zeichnungen ---------- */

function buildDrawing(ctx, el, x0, x1) {
  const avail = x1 - x0;
  const bw = avail * Math.min(100, Math.max(5, Number(el.breite) || 100)) / 100;
  const k = bw / 100;
  const hoehe = Math.max(2, Number(el.hoehe) || 50);
  const H = hoehe * k;
  const n = Math.max(1, Math.ceil((H + 0.12 * ctx.lh) / ctx.lh));
  const ox = el.ausrichtung === 'mitte' ? x0 + (avail - bw) / 2 : el.ausrichtung === 'rechts' ? x1 - bw : x0;
  const oy = bandTop(ctx) + (n * ctx.lh - H) / 2;
  const P = ([x, y]) => [ox + (Number(x) || 0) * k, oy + (Number(y) || 0) * k];
  const out = { n, s: [], u: [], keep: false };
  const baseColor = ink(ctx, el.farbe) || ctx.o.color;

  for (const f of el.formen || el.shapes || []) {
    if (!f || typeof f !== 'object') continue;
    const type = String(f.form || f.typ || f.art || '').toLowerCase();
    const c = ink(ctx, f.farbe) || baseColor;
    const w = ctx.penW * 0.9 * (Number(f.dicke) || 1);
    const g = ctx.gid();
    const add = (pts) => {
      if (f.gestrichelt) for (const d of dashes(pts, ctx.size * 0.45, ctx.size * 0.3)) out.s.push({ pts: d, w, c, g });
      else out.s.push({ pts, w, c, g });
    };
    const fill = marker(f.fuellung);
    const label = (cx, cy) => {
      if (f.text == null || f.text === '') return;
      drawLabel(ctx, out, { ...f, x: undefined, y: undefined }, cx, cy, c, k);
    };
    const arrows = (pts, def) => {
      const mode = f.pfeil === true ? 'ende' : f.pfeil === false ? 'keiner' : (f.pfeil || def);
      const sc = Number(f.pfeilgroesse) || 1;
      if (pts.length < 2) return;
      if (mode === 'ende' || mode === 'beide') out.s.push({ pts: arrowHead(ctx, pts[pts.length - 1], pts[Math.max(0, pts.length - 3)], sc), w, c, g });
      if (mode === 'anfang' || mode === 'beide') out.s.push({ pts: arrowHead(ctx, pts[0], pts[Math.min(pts.length - 1, 2)], sc), w, c, g });
    };

    if (['linie', 'pfeil', 'polylinie', 'polygon', 'vieleck', 'dreieck', 'kurve'].includes(type)) {
      let src = f.punkte || (f.von && f.nach ? [f.von, f.nach] : null);
      if (!Array.isArray(src) || src.length < 2) continue;
      src = src.map(P);
      const closed = f.geschlossen || ['polygon', 'vieleck', 'dreieck'].includes(type);
      if (closed) src.push(src[0]);
      const path = type === 'kurve' || f.glatt ? smooth(src) : src;
      if (fill && closed) {
        const ys = src.map((p) => p[1]);
        out.u.push(...hatch(ctx, Math.min(...ys), Math.max(...ys), (y) => polySpan(src, y), fill, g));
      }
      const pts = type === 'kurve' || f.glatt ? wobbly(ctx, path, { amp: 0.4 }) : wobbly(ctx, path);
      add(pts);
      if (!closed) arrows(path, type === 'pfeil' ? 'ende' : 'keiner');
      if (f.text) {
        const mid = pointAlong(path, 0.5);
        label(mid[0], mid[1] - ctx.size * 0.6);
      }
    } else if (type === 'rechteck' || type === 'kasten' || type === 'quadrat') {
      const [ax, ay] = P([f.x, f.y]);
      const bw2 = (Number(f.b ?? f.breite ?? f.w) || 10) * k, bh = (Number(f.h ?? f.hoehe) || 10) * k;
      if (fill) out.u.push(...hatch(ctx, ay, ay + bh, () => [ax, ax + bw2], fill, g));
      if (f.rand !== false) add(rectPts(ctx, ax, ay, ax + bw2, ay + bh));
      label(ax + bw2 / 2, ay + bh / 2);
    } else if (type === 'kreis' || type === 'ellipse' || type === 'oval') {
      const [cx, cy] = P([f.x, f.y]);
      const rx = (Number(f.rx ?? f.r) || 5) * k, ry = (Number(f.ry ?? f.r) || 5) * k;
      if (fill) {
        // Textmarker in Ringen von außen nach innen.
        const hw = Math.min(ctx.size * 0.8, Math.min(rx, ry));
        for (let d = hw * 0.55; d < Math.min(rx, ry) + hw * 0.3; d += hw * 0.75) {
          const ax = Math.max(0.5, rx - d), ay = Math.max(0.5, ry - d);
          out.u.push({ pts: ellipsePts(ctx, cx, cy, ax, ay).map(([x, y]) => [x, y, 0.5]), w: hw, c: fill, g });
          if (ax <= 0.5 || ay <= 0.5) break;
        }
      }
      if (f.rand !== false) add(ellipsePts(ctx, cx, cy, rx, ry));
      label(cx, cy);
    } else if (type === 'bogen') {
      const [cx, cy] = P([f.x, f.y]);
      const r = (Number(f.r) || 5) * k;
      const a1 = ((Number(f.start ?? f.von) || 0) * Math.PI) / 180;
      const a2 = ((Number(f.ende ?? f.bis ?? 90) || 0) * Math.PI) / 180;
      const path = arcPts(cx, cy, r, r, a1, a2);
      add(wobbly(ctx, path, { amp: 0.3 }));
      arrows(path, 'keiner');
    } else if (type === 'punkt') {
      const [cx, cy] = P([f.x, f.y]);
      const rr = Math.max(1.2, ctx.penW * 1.2 * (Number(f.dicke) || 1));
      out.s.push({ pts: ellipsePts(ctx, cx, cy, rr * 0.5, rr * 0.5), w: rr, c, g });
      if (f.text) drawLabel(ctx, out, { ...f, ausrichtung: f.ausrichtung || 'links' }, cx + ctx.size * 0.4, cy - ctx.size * 0.5, c, k);
    } else if (type === 'text' || type === 'beschriftung') {
      const [cx, cy] = P([f.x, f.y]);
      drawLabel(ctx, out, f, cx, cy, c, k);
    }
  }
  return [out];
}

function pointAlong(path, f) {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  let want = total * f;
  for (let i = 1; i < path.length; i++) {
    const d = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    if (d >= want && d > 0) {
      const t = want / d;
      return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t];
    }
    want -= d;
  }
  return path[path.length - 1];
}

function polySpan(poly, y) {
  const xs = [];
  for (let i = 1; i < poly.length; i++) {
    const [ax, ay] = poly[i - 1], [bx, by] = poly[i];
    if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
  }
  if (xs.length < 2) return null;
  return [Math.min(...xs), Math.max(...xs)];
}

// Beschriftung in einer Zeichnung. (cx, cy) ist die Mitte des Textes, bei ausrichtung "links" der linke Rand.
function drawLabel(ctx, out, f, cx, cy, color, k) {
  const scale = Number(f.groesse) > 0 ? Number(f.groesse) : 1;
  const size = ctx.size * scale;
  const runs = parseInline(ctx, f.text, color, marker(f.markierfarbe) || MARKER.gelb);
  const maxW = f.breite ? Number(f.breite) * k : 1e6;
  const lines = typesetLines(ctx, runs, maxW, size);
  const lead = size * 1.3;
  const align = f.ausrichtung || 'mitte';
  const y0 = cy - ((lines.length - 1) * lead) / 2 + size * 0.3;
  lines.forEach((line, i) => {
    const x = align === 'links' ? cx : align === 'rechts' ? cx - line.w : cx - line.w / 2;
    const e = emitLine(ctx, line, x, line.w, 'links', size, y0 + i * lead);
    out.s.push(...e.s); out.u.push(...e.u);
  });
}

/* ---------- Spalten ---------- */

function buildColumns(ctx, el, x0, x1) {
  const cols = (el.spalten || el.columns || []).map((c) => (Array.isArray(c) ? { elemente: c } : c || {}));
  if (!cols.length) return [];
  const gap = ctx.size * (Number(el.abstand) || 1.2);
  const ws = cols.map((c) => Number(c.breite) || 1);
  const sum = ws.reduce((a, b) => a + b, 0);
  const avail = x1 - x0 - gap * (cols.length - 1);
  let x = x0;
  const out = { n: 1, s: [], u: [] };
  const seps = [];
  cols.forEach((c, i) => {
    const w = (avail * ws[i]) / sum;
    const un = combine(ctx, buildElements(ctx, c.elemente || [], x, x + w));
    out.s.push(...un.s); out.u.push(...un.u);
    out.n = Math.max(out.n, un.n);
    x += w + gap;
    if (i < cols.length - 1) seps.push(x - gap / 2);
  });
  if (el.trennlinie) {
    const c = ink(ctx, el.linienfarbe) || ctx.o.color;
    for (const sx of seps) out.s.push({ pts: wobbly(ctx, [[sx, bandTop(ctx)], [sx, bandBottom(ctx, out.n)]]), w: ctx.penW * 0.85, c, g: ctx.gid() });
  }
  return [out];
}

/* ---------- Elemente ---------- */

function buildElements(ctx, els, x0, x1) {
  const units = [];
  for (const el0 of els || []) {
    const el = typeof el0 === 'string' ? { art: 'text', text: el0 } : el0;
    if (!el || typeof el !== 'object') continue;
    const art = String(el.art || el.typ || el.type || 'text').toLowerCase();
    if (art === 'ueberschrift' || art === 'überschrift' || art === 'titel') units.push(...buildHeading(ctx, el, x0, x1));
    else if (art === 'text' || art === 'absatz') units.push(...buildText(ctx, el, x0, x1));
    else if (art === 'liste' || art === 'aufzaehlung' || art === 'aufzählung') {
      const framed = el.rahmen || el.hintergrund;
      const pad = framed ? ctx.size * 0.45 : 0;
      const lu = buildList(ctx, el, x0 + pad, x1 - pad);
      units.push(...(framed ? [boxAround(ctx, combine(ctx, lu), x0, x1, el)] : lu));
    } else if (art === 'tabelle') units.push(...buildTable(ctx, el, x0, x1));
    else if (art === 'zeichnung' || art === 'skizze' || art === 'grafik') units.push(...buildDrawing(ctx, el, x0, x1));
    else if (art === 'spalten') units.push(...buildColumns(ctx, el, x0, x1));
    else if (art === 'trennlinie' || art === 'linie') units.push(...buildRule(ctx, el, x0, x1));
    else if (art === 'abstand' || art === 'leerzeile') units.push({ n: Math.max(1, Math.round(Number(el.zeilen) || 1)), s: [], u: [] });
    else if (el.text != null) units.push(...buildText(ctx, el, x0, x1));
  }
  return units;
}

// Zerlegt einen Block, der höher als eine Seite ist, in einzelne Zeilen.
function splitTall(ctx, un) {
  const parts = Array.from({ length: un.n }, () => ({ n: 1, s: [], u: [] }));
  const top = bandTop(ctx);
  const idx = (st) => {
    const y = Math.min(...st.pts.map((p) => p[1]));
    return Math.max(0, Math.min(un.n - 1, Math.floor((y - top) / ctx.lh)));
  };
  for (const st of un.s) { const i = idx(st); parts[i].s.push(...shift([st], 0, -i * ctx.lh)); }
  for (const st of un.u) { const i = idx(st); parts[i].u.push(...shift([st], 0, -i * ctx.lh)); }
  return parts;
}

export function layoutScene(doc, font, o) {
  const size = o.size;
  const lh = size * o.lineHeight;
  const left = o.margin, right = PAGE.w - o.margin;
  const first = o.margin + size, bottom = PAGE.h - o.margin;
  const missing = new Set();
  const rnd = mulberry32(o.seed);
  let gid = 0;
  const ctx = {
    font, o, rnd, size, lh, missing,
    penW: (font.penEm || PEN_EM) * o.penScale * size,
    glyph: makeGlyphMaker(font, o, rnd, missing),
    gid: () => 'k' + gid++,
    span: 0,
    linesPerPage: Math.max(1, Math.floor((bottom - first) / lh) + 1),
  };

  const pages = [];
  let page, y;
  const newPage = () => { page = { strokes: [], under: [] }; pages.push(page); y = first; };

  for (const seite of doc.seiten) {
    newPage();
    let units = buildElements(ctx, seite.elemente, left, right);
    units = units.flatMap((un) => (un.n > ctx.linesPerPage ? splitTall(ctx, un) : [un]));
    units.forEach((un, i) => {
      const next = un.keep && units[i + 1] ? units[i + 1].n : 0;
      const need = Math.min(un.n + next, ctx.linesPerPage);
      if (y > first && y + (need - 1) * lh > bottom + 0.5) newPage();
      page.strokes.push(...shift(un.s, 0, y));
      page.under.push(...shift(un.u, 0, y));
      y += un.n * lh;
    });
  }
  for (const p of pages) { p.strokes = p.under.concat(p.strokes); delete p.under; }
  return { pages, missing: [...missing] };
}
