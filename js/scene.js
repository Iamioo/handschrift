// Setzt eine Seitenbeschreibung (KI-Datei, siehe docs/ki-format.md) in Handschrift.
// Alles wird zu Stiftstrichen: Text, Unterstreichungen, Markierungen, Tabellen und Zeichnungen.
// Dadurch funktionieren Editor und alle Exporte ohne Änderung.
//
// Layout: Jedes Element liefert "Blöcke" { n, s, u }. n ist die Zahl der belegten Zeilen,
// s die Striche, u die Striche unter dem Text (Textmarker). x ist absolut auf der Seite,
// y relativ zur ersten Grundlinie des Blocks. So landet jeder Text auf einer Papierlinie.
import { PAGE, mulberry32, makeGlyphMaker, glyphPoints, prepareText, lookup } from './render.js';
import { PEN_EM, GLYPH_GAP } from './glyphs.js';
import { compileFormula } from './formula.js';

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
  const rows = Math.max(1, Math.ceil((y2 - y1 - hw) / (hw * 0.75)) + 1);
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
  // Platzhalter für Unleserliches lässt die App weg, statt Fragezeichen zu schreiben.
  const str = prepareText(String(raw ?? '').replace(/\s?\[(?:\?|\.\.\.|…|unleserlich)\]/gi, ''), ctx.font);
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
  const out = { n, s: [], u: [], keep: false };
  drawShapes(ctx, el, ox, oy, k, hoehe, out);
  return [out];
}

// Zeichnet die Formen einer Zeichnung. (ox, oy) ist die linke obere Ecke in Punkten, k Punkte pro Einheit.
export function drawShapes(ctx, el, ox, oy, k, hoehe, out) {
  const P = ([x, y]) => [ox + (Number(x) || 0) * k, oy + (Number(y) || 0) * k];
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
      const bend = Number(f.bogen) || 0;
      if (bend && src.length === 2 && !['polygon', 'vieleck', 'dreieck'].includes(type)) src = bendPath(src[0], src[1], bend);
      const closed = f.geschlossen || ['polygon', 'vieleck', 'dreieck'].includes(type);
      if (closed) src.push(src[0]);
      const path = type === 'kurve' || f.glatt || bend ? smooth(src) : src;
      if (fill && closed) out.u.push(...fillPoly(ctx, src, fill, g));
      const pts = type === 'kurve' || f.glatt || bend ? wobbly(ctx, path, { amp: 0.4 }) : wobbly(ctx, path);
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
    } else if (EXTRA_SHAPES[type]) {
      EXTRA_SHAPES[type]({ ctx, f, P, k, c, w, g, out, add, fill, label, arrows, hoehe });
    } else if (type === 'text' || type === 'beschriftung') {
      const [cx, cy] = P([f.x, f.y]);
      drawLabel(ctx, out, f, cx, cy, c, k);
    }
  }
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

function bendPath(a, b, bend) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
  const m = [(a[0] + b[0]) / 2 - (dy / len) * bend * len, (a[1] + b[1]) / 2 + (dx / len) * bend * len];
  const out = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12, u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * m[0] + t * t * b[0], u * u * a[1] + 2 * u * t * m[1] + t * t * b[1]]);
  }
  return out;
}

const num = (v, d) => (v === undefined || v === null || v === '' || !isFinite(Number(String(v).replace(',', '.'))) ? d : Number(String(v).replace(',', '.')));
const fmt = (v) => String(Math.round(v * 1000) / 1000).replace('.', ',').replace('-', '−');

// Schrittweite, bei der höchstens etwa max Teilstriche entstehen.
function niceStep(range, max = 10) {
  const raw = range / max;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

function ticks(min, max, step) {
  const out = [];
  const st = step > 0 ? step : niceStep(max - min);
  for (let v = Math.ceil(min / st - 1e-9) * st; v <= max + 1e-9; v += st) out.push(Math.round(v / st) * st);
  return out;
}

// Kleiner Text an einer Stelle (Mitte), Größe als Faktor der Schriftgröße.
function smallLabel(o, text, x, y, size = 0.62, align = 'mitte', color) {
  drawLabel(o.ctx, o.out, { text, groesse: size, ausrichtung: align }, x, y, color || o.c, o.k);
}

// Weitere Formen für Zeichnungen. Jede bekommt die Form f und Hilfsfunktionen aus buildDrawing.
const EXTRA_SHAPES = {
  koordinatensystem(o) {
    const { ctx, f, P, k, c, w, g, out } = o;
    let xmin = num(f.xmin, -1), xmax = num(f.xmax, 6), ymin = num(f.ymin, -1), ymax = num(f.ymax, 5);
    if (xmax <= xmin) [xmin, xmax] = [xmax - 1, xmin + 1];
    if (ymax <= ymin) [ymin, ymax] = [ymax - 1, ymin + 1];
    const [ax, ay] = P([num(f.x, 6), num(f.y, 4)]);
    const W = num(f.b, 88) * k, H = num(f.h, o.hoehe - 8) * k;
    const X = (v) => ax + ((v - xmin) / (xmax - xmin)) * W;
    const Y = (v) => ay + ((ymax - v) / (ymax - ymin)) * H;
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const axY = Y(clamp(0, ymin, ymax)), axX = X(clamp(0, xmin, xmax));
    const thin = w * 0.6;
    const xs = ticks(xmin, xmax, num(f.xschritt ?? f.schritt, 0));
    const ys = ticks(ymin, ymax, num(f.yschritt ?? f.schritt, 0));
    if (f.gitter) {
      const gc = ink(ctx, f.gitterfarbe) || '#9aa3b2';
      for (const v of xs) out.s.push({ pts: wobbly(ctx, [[X(v), ay], [X(v), ay + H]], { amp: 0.2 }), w: thin * 0.7, c: gc, g });
      for (const v of ys) out.s.push({ pts: wobbly(ctx, [[ax, Y(v)], [ax + W, Y(v)]], { amp: 0.2 }), w: thin * 0.7, c: gc, g });
    }
    const ext = ctx.size * 0.7;
    const xa = [[ax - ext * 0.3, axY], [ax + W + ext, axY]];
    const ya = [[axX, ay + H + ext * 0.3], [axX, ay - ext]];
    out.s.push({ pts: wobbly(ctx, xa), w, c, g }, { pts: arrowHead(ctx, xa[1], xa[0], 0.8), w, c, g });
    out.s.push({ pts: wobbly(ctx, ya), w, c, g }, { pts: arrowHead(ctx, ya[1], ya[0], 0.8), w, c, g });
    const tl = ctx.size * 0.18;
    const showNums = f.zahlen !== false;
    const xEvery = Math.max(1, Math.ceil((ctx.size * 1.3) / Math.max(1, (W / Math.max(1, xs.length)))));
    const yEvery = Math.max(1, Math.ceil((ctx.size * 0.8) / Math.max(1, (H / Math.max(1, ys.length)))));
    xs.forEach((v, i) => {
      if (Math.abs(v) < 1e-9) return;
      out.s.push({ pts: wobbly(ctx, [[X(v), axY - tl], [X(v), axY + tl]], { amp: 0.1 }), w: thin, c, g });
      if (showNums && i % xEvery === 0) smallLabel(o, fmt(v), X(v), axY + ctx.size * 0.62);
    });
    ys.forEach((v, i) => {
      if (Math.abs(v) < 1e-9) return;
      out.s.push({ pts: wobbly(ctx, [[axX - tl, Y(v)], [axX + tl, Y(v)]], { amp: 0.1 }), w: thin, c, g });
      if (showNums && i % yEvery === 0) smallLabel(o, fmt(v), axX - ctx.size * 0.35, Y(v), 0.62, 'rechts');
    });
    if (showNums && xmin <= 0 && xmax >= 0 && ymin <= 0 && ymax >= 0) smallLabel(o, '0', axX - ctx.size * 0.35, axY + ctx.size * 0.55, 0.62, 'rechts');
    smallLabel(o, f.xname ?? 'x', ax + W + ext, axY + ctx.size * 0.7, 0.8);
    smallLabel(o, f.yname ?? 'y', axX + ctx.size * 0.5, ay - ext, 0.8, 'links');

    const lo = ymin - (ymax - ymin) * 0.03, hi = ymax + (ymax - ymin) * 0.03;
    for (const gr of f.graphen || f.graphs || []) {
      const gc = ink(ctx, gr.farbe) || c;
      let runs = [];
      if (Array.isArray(gr.punkte)) {
        runs = [gr.punkte.map(([vx, vy]) => [X(num(vx, 0)), Y(num(vy, 0))])];
      } else if (gr.funktion) {
        let fn;
        try { fn = compileFormula(gr.funktion); } catch (e) { console.warn(e.message); continue; }
        const a = num(gr.von, xmin), b = num(gr.bis, xmax);
        const N = 160;
        let cur = [], prev = null;
        for (let i = 0; i <= N; i++) {
          const vx = a + ((b - a) * i) / N;
          const vy = fn(vx);
          const ok = isFinite(vy) && vy >= lo && vy <= hi && !(prev !== null && Math.abs(vy - prev) > (ymax - ymin) * 0.7);
          if (ok) cur.push([X(vx), Y(vy)]);
          else if (cur.length) { runs.push(cur); cur = []; }
          prev = isFinite(vy) ? vy : null;
        }
        if (cur.length) runs.push(cur);
      }
      runs = runs.filter((r) => r.length > 1);
      for (const r of runs) {
        const pts = gr.glatt === false || Array.isArray(gr.punkte) && !gr.glatt ? r : smooth(r.length > 40 ? r.filter((_, i) => i % 2 === 0 || i === r.length - 1) : r);
        const st = wobbly(ctx, pts, { amp: 0.25, jitter: 0.3 });
        if (gr.gestrichelt) for (const d of dashes(st, ctx.size * 0.45, ctx.size * 0.3)) out.s.push({ pts: d, w: w * 1.1, c: gc, g });
        else out.s.push({ pts: st, w: w * 1.1, c: gc, g });
      }
      if (gr.text && runs.length) {
        const last = runs[runs.length - 1];
        const [lx, ly] = last[last.length - 1];
        smallLabel(o, gr.text, lx + ctx.size * 0.25, ly - ctx.size * 0.5, 0.75, 'links', gc);
      }
    }
    for (const pt of f.punkte || []) {
      const vx = num(pt.x, 0), vy = num(pt.y, 0);
      const px = X(vx), py = Y(vy);
      const pc = ink(ctx, pt.farbe) || c;
      if (pt.hilfslinien) {
        for (const seg of [[[px, py], [px, axY]], [[px, py], [axX, py]]]) {
          for (const d of dashes(wobbly(ctx, seg, { amp: 0.15 }), ctx.size * 0.3, ctx.size * 0.25)) out.s.push({ pts: d, w: thin, c: pc, g });
        }
      }
      const rr = Math.max(1.5, w * 1.6);
      out.s.push({ pts: ellipsePts(ctx, px, py, rr * 0.4, rr * 0.4), w: rr, c: pc, g });
      if (pt.text) smallLabel(o, pt.text, px + ctx.size * 0.3, py - ctx.size * 0.55, 0.7, 'links', pc);
    }
  },

  zahlenstrahl(o) {
    const { ctx, f, P, k, c, w, g, out } = o;
    const min = num(f.min, 0), max = num(f.max, 10);
    const [ax, ay] = P([num(f.x, 3), num(f.y, o.hoehe / 2)]);
    const W = num(f.b, 92) * k;
    const X = (v) => ax + ((v - min) / (max - min || 1)) * W;
    const line = [[ax - ctx.size * 0.3, ay], [ax + W + ctx.size * 0.8, ay]];
    out.s.push({ pts: wobbly(ctx, line), w, c, g }, { pts: arrowHead(ctx, line[1], line[0], 0.8), w, c, g });
    const tl = ctx.size * 0.25;
    const ts = ticks(min, max, num(f.schritt, 0));
    const every = Math.max(1, Math.ceil((ctx.size * 1.3) / Math.max(1, W / Math.max(1, ts.length))));
    ts.forEach((v, i) => {
      out.s.push({ pts: wobbly(ctx, [[X(v), ay - tl], [X(v), ay + tl]], { amp: 0.1 }), w: w * 0.7, c, g });
      if (f.zahlen !== false && i % every === 0) smallLabel(o, fmt(v), X(v), ay + ctx.size * 0.75);
    });
    for (const pt of f.punkte || []) {
      const pc = ink(ctx, pt.farbe) || ink(ctx, 'rot');
      const px = X(num(pt.wert ?? pt.x, 0));
      const rr = Math.max(1.5, w * 1.8);
      out.s.push({ pts: ellipsePts(ctx, px, ay, rr * 0.4, rr * 0.4), w: rr, c: pc, g });
      if (pt.text) smallLabel(o, pt.text, px, ay - ctx.size * 0.75, 0.7, 'mitte', pc);
    }
  },

  klammer(o) {
    const { ctx, f, P, w, c, g, out } = o;
    if (!f.von || !f.nach) return;
    const a = P(f.von), b = P(f.nach);
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    let nx = -dy / len, ny = dx / len;
    // "rechts"/"unten" (Standard): Spitze zeigt nach rechts bzw. unten, "links"/"oben" umgekehrt.
    const dom = Math.abs(nx) > Math.abs(ny) ? nx : ny;
    const wantNeg = f.seite === 'links' || f.seite === 'oben';
    if ((dom < 0) !== wantNeg) { nx = -nx; ny = -ny; }
    const d = Math.min(len * 0.12, ctx.size * 0.55);
    const at = (t, n) => [a[0] + dx * t + nx * n * d, a[1] + dy * t + ny * n * d];
    const pts = smooth([at(0, 0), at(0.04, 0.45), at(0.44, 0.55), at(0.5, 1), at(0.56, 0.55), at(0.96, 0.45), at(1, 0)]);
    out.s.push({ pts: wobbly(ctx, pts, { amp: 0.2 }), w, c, g });
    if (f.text) {
      const [tx, ty] = at(0.5, 1);
      const horiz = Math.abs(nx) > Math.abs(ny);
      smallLabel(o, f.text, tx + nx * ctx.size * 0.4, ty + ny * ctx.size * 0.7, Number(f.groesse) || 0.85, horiz ? (nx > 0 ? 'links' : 'rechts') : 'mitte');
    }
  },

  welle(o) { waveShape(o, 'welle'); },
  zickzack(o) { waveShape(o, 'zickzack'); },

  raute(o) {
    const { ctx, f, P, k, add, fill, out, g, label } = o;
    const [cx, cy] = P([f.x, f.y]);
    const hb = (num(f.b, 20) * k) / 2, hh = (num(f.h, 12) * k) / 2;
    const poly = [[cx, cy - hh], [cx + hb, cy], [cx, cy + hh], [cx - hb, cy], [cx, cy - hh]];
    if (fill) out.u.push(...fillPoly(ctx, poly, fill, g));
    add(wobbly(ctx, poly));
    label(cx, cy);
  },

  stern(o) {
    const { ctx, f, P, k, add, fill, out, g } = o;
    const [cx, cy] = P([f.x, f.y]);
    const r = num(f.r, 4) * k;
    const poly = [];
    for (let i = 0; i <= 10; i++) {
      const t = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r * 0.42 : r;
      poly.push([cx + Math.cos(t) * rr, cy + Math.sin(t) * rr]);
    }
    if (fill) out.u.push(...fillPoly(ctx, poly, fill, g));
    add(wobbly(ctx, poly, { amp: 0.2 }));
  },

  haken(o) {
    const { ctx, f, P, k, add } = o;
    const [cx, cy] = P([f.x, f.y]);
    const r = num(f.r, 3) * k;
    add(wobbly(ctx, [[cx - r, cy], [cx - r * 0.3, cy + r * 0.7], [cx + r, cy - r]], { amp: 0.2 }));
  },

  kreuz(o) {
    const { ctx, f, P, k, out, w, c, g } = o;
    const [cx, cy] = P([f.x, f.y]);
    const r = num(f.r, 3) * k;
    out.s.push({ pts: wobbly(ctx, [[cx - r, cy - r], [cx + r, cy + r]], { amp: 0.2 }), w, c, g });
    out.s.push({ pts: wobbly(ctx, [[cx + r, cy - r], [cx - r, cy + r]], { amp: 0.2 }), w, c, g });
  },

  balkendiagramm(o) {
    const { ctx, f, P, k, c, w, g, out } = o;
    const vals = (f.werte || []).map((v) => num(v, 0));
    if (!vals.length) return;
    const names = f.beschriftungen || [];
    const [ax, ay] = P([num(f.x, 8), num(f.y, 4)]);
    const W = num(f.b, 86) * k, H = num(f.h, o.hoehe - 12) * k;
    const max = num(f.max, Math.max(...vals, 0) || 1);
    const base = ay + H;
    out.s.push({ pts: wobbly(ctx, [[ax, ay - ctx.size * 0.4], [ax, base], [ax + W, base]]), w, c, g });
    const slot = W / vals.length, bw = slot * 0.6;
    const fills = Array.isArray(f.fuellungen) ? f.fuellungen : null;
    vals.forEach((v, i) => {
      const x1 = ax + slot * i + (slot - bw) / 2, x2 = x1 + bw;
      const y1 = base - (Math.max(0, v) / max) * H;
      const fc = marker(fills ? fills[i % fills.length] : f.fuellung);
      if (fc && base - y1 > 2) out.u.push(...hatch(ctx, y1, base, () => [x1, x2], fc, g));
      if (base - y1 > 0.5) out.s.push({ pts: wobbly(ctx, [[x1, base], [x1, y1], [x2, y1], [x2, base]]), w, c: ink(ctx, f.farbe) || c, g });
      if (f.zahlen !== false) smallLabel(o, fmt(v), (x1 + x2) / 2, y1 - ctx.size * 0.45, 0.62);
      if (names[i] != null) smallLabel(o, String(names[i]), (x1 + x2) / 2, base + ctx.size * 0.65, 0.62);
    });
  },

  kreisdiagramm(o) {
    const { ctx, f, P, k, c, w, g, out } = o;
    const vals = (f.werte || []).map((v) => Math.max(0, num(v, 0)));
    const sum = vals.reduce((a, b) => a + b, 0);
    if (!sum) return;
    const names = f.beschriftungen || [];
    const fills = Array.isArray(f.fuellungen) ? f.fuellungen : null;
    const [cx, cy] = P([f.x, f.y]);
    const r = num(f.r, 15) * k;
    let a0 = -Math.PI / 2;
    vals.forEach((v, i) => {
      const a1 = a0 + (v / sum) * Math.PI * 2;
      const fc = marker(fills ? fills[i % fills.length] : null);
      if (fc) {
        // Textmarker in Bögen von außen nach innen, jeweils etwas vom Rand des Stücks eingerückt.
        const hw = Math.min(ctx.size * 0.8, r * 0.3);
        for (let rr = r - hw * 0.5; rr > hw * 0.3; rr -= hw * 0.7) {
          const inset = (hw * 0.5) / rr;
          const b0 = a0 + inset, b1 = a1 - inset;
          if (b1 - b0 <= 0.02) {
            if (rr < r * 0.5) break;
            continue;
          }
          const arc = [];
          const steps = Math.max(2, Math.ceil(((b1 - b0) * rr) / 5));
          for (let j = 0; j <= steps; j++) { const t = b0 + ((b1 - b0) * j) / steps; arc.push([r2(cx + Math.cos(t) * rr), r2(cy + Math.sin(t) * rr), 0.5]); }
          out.u.push({ pts: arc, w: hw, c: fc, g });
        }
      }
      if (vals.length > 1) out.s.push({ pts: wobbly(ctx, [[cx, cy], [cx + Math.cos(a0) * r, cy + Math.sin(a0) * r]], { amp: 0.2 }), w, c, g });
      const am = (a0 + a1) / 2;
      const txt = names[i] != null ? String(names[i]) : (f.zahlen !== false ? fmt(v) : '');
      if (txt) {
        const inside = v / sum > 0.12;
        const rr = inside ? r * 0.6 : r + ctx.size * 0.9;
        smallLabel(o, txt, cx + Math.cos(am) * rr, cy + Math.sin(am) * rr, 0.62);
      }
      a0 = a1;
    });
    out.s.push({ pts: ellipsePts(ctx, cx, cy, r, r), w, c, g });
  },
};
EXTRA_SHAPES.achsen = EXTRA_SHAPES.koordinatensystem;
EXTRA_SHAPES.graph = EXTRA_SHAPES.koordinatensystem;
EXTRA_SHAPES.wellenlinie = EXTRA_SHAPES.welle;
EXTRA_SHAPES.diagramm = EXTRA_SHAPES.balkendiagramm;
EXTRA_SHAPES.hakenzeichen = EXTRA_SHAPES.haken;

function waveShape(o, kind) {
  const { ctx, f, P, k, add, arrows } = o;
  if (!f.von || !f.nach) return;
  const a = P(f.von), b = P(f.nach);
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const amp = num(f.amplitude, 1.5) * k;
  const n = Math.max(1, Math.round(num(f.wellen, len / (ctx.size * 1.2))));
  const pts = [];
  const steps = kind === 'zickzack' ? n * 2 : n * 12;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const off = kind === 'zickzack' ? (i === 0 || i === steps ? 0 : i % 2 ? amp : -amp) : Math.sin(t * n * Math.PI * 2) * amp;
    pts.push([a[0] + dx * t + nx * off, a[1] + dy * t + ny * off]);
  }
  add(wobbly(ctx, pts, { amp: 0.15, jitter: 0.3 }));
  arrows(pts, 'keiner');
}

// Kurzformen: Ein Koordinatensystem oder Zahlenstrahl direkt als Element, ohne "zeichnung" drumherum.
const SHAPE_ELEMENTS = {
  koordinatensystem: (el) => ({ breite: el.breite ?? 70, hoehe: el.hoehe ?? 70, ausrichtung: el.ausrichtung ?? 'mitte', formen: [{ ...el, form: 'koordinatensystem', x: 8, y: 6, b: 84, h: (el.hoehe ?? 70) - 12, breite: undefined, hoehe: undefined }] }),
  zahlenstrahl: (el) => ({ breite: el.breite ?? 100, hoehe: el.hoehe ?? 12, formen: [{ ...el, form: 'zahlenstrahl', x: 3, y: (el.hoehe ?? 12) / 2, b: 92, breite: undefined, hoehe: undefined }] }),
  balkendiagramm: (el) => ({ breite: el.breite ?? 80, hoehe: el.hoehe ?? 50, ausrichtung: el.ausrichtung ?? 'mitte', formen: [{ ...el, form: 'balkendiagramm', x: 8, y: 5, b: 86, h: (el.hoehe ?? 50) - 13, breite: undefined, hoehe: undefined }] }),
  kreisdiagramm: (el) => ({ breite: el.breite ?? 60, hoehe: el.hoehe ?? 60, ausrichtung: el.ausrichtung ?? 'mitte', formen: [{ ...el, form: 'kreisdiagramm', x: 50, y: (el.hoehe ?? 60) / 2, r: Math.min(30, (el.hoehe ?? 60) / 2 - 8), breite: undefined, hoehe: undefined }] }),
};

// Füllt ein Vieleck mit Textmarker-Ringen, die zum Schwerpunkt hin kleiner werden.
function fillPoly(ctx, poly, color, g) {
  const pts = poly[0][0] === poly[poly.length - 1][0] && poly[0][1] === poly[poly.length - 1][1] ? poly.slice(0, -1) : poly;
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  let inr = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    inr = Math.min(inr, Math.abs((bx - ax) * (ay - cy) - (ax - cx) * (by - ay)) / len);
  }
  if (!isFinite(inr) || inr < 1) return [];
  const hw = Math.min(ctx.size * 0.8, inr * 0.9);
  const out = [];
  for (let d = hw * 0.5; d < inr; d += hw * 0.75) {
    const sc = Math.max(0.02, 1 - d / inr);
    const ring = pts.concat([pts[0]]).map(([x, y]) => [cx + (x - cx) * sc, cy + (y - cy) * sc]);
    out.push({ pts: wobbly(ctx, ring, { amp: 0.2, jitter: 0.3 }).map(([x, y]) => [x, y, 0.5]), w: hw, c: color, g });
    if (sc <= 0.05) break;
  }
  return out;
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
    else if (SHAPE_ELEMENTS[art]) units.push(...buildDrawing(ctx, SHAPE_ELEMENTS[art](el), x0, x1));
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

export function makeCtx(font, o, size, lh) {
  const missing = new Set();
  const rnd = mulberry32(o.seed);
  let gid = 0;
  return {
    font, o, rnd, size, lh, missing,
    penW: (font.penEm || PEN_EM) * o.penScale * size,
    glyph: makeGlyphMaker(font, o, rnd, missing),
    gid: () => 'k' + gid++,
    span: 0,
    linesPerPage: 30,
  };
}

// Gleicher Zufall und gleiche Strichgruppen, aber andere Schriftgröße (Arbeitsblätter).
export function resizeCtx(ctx, size, lh) {
  return Object.assign(Object.create(ctx), { size, lh, penW: (ctx.font.penEm || PEN_EM) * ctx.o.penScale * size });
}

export function layoutScene(doc, font, o) {
  const size = o.size;
  const lh = size * o.lineHeight;
  const left = o.margin, right = PAGE.w - o.margin;
  const first = o.margin + size, bottom = PAGE.h - o.margin;
  const ctx = makeCtx(font, o, size, lh);
  ctx.linesPerPage = Math.max(1, Math.floor((bottom - first) / lh) + 1);

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
  return { pages, missing: [...ctx.missing] };
}

/* ---------- Arbeitsblätter ---------- */

// Legt ein Hintergrundbild so groß wie möglich auf die Seite (ohne Verzerren).
export function fitRect(pw, ph) {
  const s = Math.min(PAGE.w / pw, PAGE.h / ph);
  const w = pw * s, h = ph * s;
  return [(PAGE.w - w) / 2, (PAGE.h - h) / 2, w, h];
}

export function parseWorksheetText(raw) {
  const doc = parseSceneText(raw);
  for (const s of doc.seiten) s.eintraege = s.eintraege || s.elemente || s.antworten || [];
  return doc;
}

// Schreibt die Antworten der KI auf die Seiten des Arbeitsblatts.
// Positionen sind Prozent des Blatts: x von links, y von oben. bgs: geladene Seiten (Bilder).
export function layoutWorksheet(doc, font, o, bgs) {
  const pages = bgs.map((bg) => ({ strokes: [], under: [], bg: { ...bg, rect: fitRect(bg.pw, bg.ph) } }));
  const base = makeCtx(font, o, o.size, o.size * o.lineHeight);
  const blank = () => ({ strokes: [], under: [], bg: null });

  doc.seiten.forEach((seite, si) => {
    const idx = Math.max(0, Math.round(num(seite.bild ?? seite.seite, si + 1)) - 1);
    while (pages.length <= idx) pages.push(blank());
    const page = pages[idx];
    const R = page.bg?.rect || [0, 0, PAGE.w, PAGE.h];
    const X = (v) => R[0] + (num(v, 0) / 100) * R[2];
    const Y = (v) => R[1] + (num(v, 0) / 100) * R[3];
    const BW = (v) => (num(v, 0) / 100) * R[2];
    const BH = (v) => (num(v, 0) / 100) * R[3];
    const defGap = BH(num(seite.zeilenabstand ?? doc.zeilenabstand, 2.6));
    const sheetSize = Math.min(40, Math.max(6, defGap * 0.72));
    const sc = resizeCtx(base, sheetSize, defGap);
    const S = page.strokes, U = page.under;
    const pen = (e) => sc.penW * 0.9 * (num(e.dicke, 1));
    const col = (e, def) => ink(sc, e.farbe) || def || o.color;

    for (const e0 of seite.eintraege) {
      if (!e0 || typeof e0 !== 'object') continue;
      const e = e0;
      const art = String(e.art || e.typ || 'text').toLowerCase();
      const g = sc.gid();
      if (['text', 'antwort', 'luecke', 'lücke', 'zeilen', 'feld'].includes(art)) {
        const zl = Array.isArray(e.zeilen) ? e.zeilen.map((v) => num(v, NaN)).filter(isFinite) : [];
        // Abstand der Schreiblinien: angegeben, aus "zeilen" abgelesen oder Standard der Seite.
        const gap = e.zeilenabstand != null ? BH(e.zeilenabstand) : zl.length > 1 ? Math.abs(BH(zl[1] - zl[0])) : defGap;
        const size = Math.min(48, Math.max(5, gap * 0.72 * num(e.groesse, 1)));
        const c2 = resizeCtx(base, size, gap);
        const x0 = X(e.x);
        const x1 = e.b != null ? x0 + BW(e.b) : R[0] + R[2] * 0.96;
        const units = textUnits(c2, e.text, x0, Math.max(x1, x0 + size * 2), { align: e.ausrichtung, color: e.farbe, marker: e.markierfarbe });
        const lines = Array.isArray(e.zeilen) ? e.zeilen.map(Y) : null;
        let y = Y(e.y);
        units.forEach((un, i) => {
          if (lines && lines[i] != null) y = lines[i];
          else if (i > 0) y += (lines && lines.length > 1 ? lines[lines.length - 1] - lines[lines.length - 2] : gap);
          S.push(...shift(un.s, 0, y));
          U.push(...shift(un.u, 0, y));
        });
      } else if (art === 'kreuz' || art === 'ankreuzen' || art === 'x') {
        const r = e.r != null ? BW(e.r) : sheetSize * 0.32;
        const cx = X(e.x), cy = Y(e.y);
        S.push({ pts: wobbly(sc, [[cx - r, cy - r], [cx + r, cy + r]], { amp: 0.2 }), w: pen(e), c: col(e), g });
        S.push({ pts: wobbly(sc, [[cx + r, cy - r * 1.05], [cx - r * 0.95, cy + r]], { amp: 0.2 }), w: pen(e), c: col(e), g });
      } else if (art === 'haken') {
        const r = e.r != null ? BW(e.r) : sheetSize * 0.38;
        const cx = X(e.x), cy = Y(e.y);
        S.push({ pts: wobbly(sc, [[cx - r, cy], [cx - r * 0.3, cy + r * 0.7], [cx + r, cy - r]], { amp: 0.2 }), w: pen(e), c: col(e), g });
      } else if (art === 'einkreisen' || art === 'kreis' || art === 'ellipse') {
        const x = X(e.x), y = Y(e.y), w = BW(e.b ?? 5), h = BH(e.h ?? 2.5);
        const pad = sheetSize * 0.2;
        S.push({ pts: ellipsePts(sc, x + w / 2, y + h / 2, w / 2 + pad, h / 2 + pad), w: pen(e), c: col(e), g });
      } else if (art === 'kasten' || art === 'rahmen' || art === 'einrahmen') {
        const x = X(e.x), y = Y(e.y), w = BW(e.b ?? 5), h = BH(e.h ?? 2.5);
        const pad = sheetSize * 0.15;
        S.push({ pts: rectPts(sc, x - pad, y - pad, x + w + pad, y + h + pad), w: pen(e), c: col(e), g });
      } else if (art === 'unterstreichen' || art === 'unterstrichen') {
        const x = X(e.x), y = Y(e.y) + sheetSize * 0.12, w = BW(e.b ?? 10);
        S.push({ pts: wobbly(sc, [[x, y], [x + w, y]]), w: pen(e), c: col(e), g });
        if (e.doppelt) S.push({ pts: wobbly(sc, [[x, y + sheetSize * 0.18], [x + w, y + sheetSize * 0.18]]), w: pen(e), c: col(e), g });
      } else if (art === 'durchstreichen' || art === 'durchgestrichen') {
        const x = X(e.x), y = Y(e.y) - sheetSize * 0.25, w = BW(e.b ?? 10);
        S.push({ pts: wobbly(sc, [[x, y], [x + w, y - sheetSize * 0.05]]), w: pen(e), c: col(e), g });
      } else if (art === 'markieren' || art === 'markierung' || art === 'textmarker') {
        const x = X(e.x), y = Y(e.y), w = BW(e.b ?? 10), h = BH(e.h ?? 2);
        U.push(...hatch(sc, y, y + h, () => [x - 1, x + w + 1], marker(e.farbe) || MARKER.gelb, g));
      } else if (art === 'linie' || art === 'pfeil' || art === 'verbinden') {
        const pts0 = e.punkte || (e.von && e.nach ? [e.von, e.nach] : null);
        if (!Array.isArray(pts0) || pts0.length < 2) continue;
        let pts = pts0.map(([a, b]) => [X(a), Y(b)]);
        if (e.bogen && pts.length === 2) pts = smooth(bendPath(pts[0], pts[1], num(e.bogen, 0)));
        const st = wobbly(sc, pts);
        if (e.gestrichelt) for (const d of dashes(st, sheetSize * 0.45, sheetSize * 0.3)) S.push({ pts: d, w: pen(e), c: col(e), g });
        else S.push({ pts: st, w: pen(e), c: col(e), g });
        const mode = e.pfeil === true || (art === 'pfeil' && e.pfeil === undefined) ? 'ende' : e.pfeil;
        if (mode === 'ende' || mode === 'beide') S.push({ pts: arrowHead(sc, pts[pts.length - 1], pts[Math.max(0, pts.length - 3)], 0.8), w: pen(e), c: col(e), g });
        if (mode === 'anfang' || mode === 'beide') S.push({ pts: arrowHead(sc, pts[0], pts[Math.min(pts.length - 1, 2)], 0.8), w: pen(e), c: col(e), g });
      } else if (art === 'zeichnung' || art === 'skizze') {
        // Innerhalb der Zeichnung zählen x und y in Prozent der Blattbreite ab der Ecke (x, y).
        const k = R[2] / 100;
        const out = { s: [], u: [] };
        drawShapes(sc, e, X(e.x), Y(e.y), k, (BH(e.h ?? 20)) / k, out);
        S.push(...out.s); U.push(...out.u);
      }
    }
  });
  for (const p of pages) { p.strokes = p.under.concat(p.strokes); delete p.under; }
  return { pages, missing: [...base.missing] };
}
