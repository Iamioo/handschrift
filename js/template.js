// Vorlage zum Nachschreiben: PDF mit Kästchen, in denen jedes Zeichen hellgrau vorgedruckt ist.
// Die beschriebene Vorlage kommt als .goodnotes oder .note zurück; jedes Kästchen wird zu einer Variante.
import { buildPdf, n, pdfText } from './pdf.js';
import { PAGE_FORMATS } from './render.js';
import { normalizeGlyph } from './glyphs.js';
import { SYMBOLS } from './symbols.js';
import { readZip, readBplist, keyedArchive, readPb, pbGet, pbStr, readDelimited, appleLz4Decode, readStrokeTpl } from './formats/readers.js';

const MARK = 'HANDSCHRIFT-VORLAGE:';
const A4 = PAGE_FORMATS.a4;
const EM = 36;                 // Schriftgröße im Kästchen (pt)
const COLS = 6;
const MARGIN = 36;
const HEADER = 34;
const CELL_H = EM * 1.6;
const ROW_PITCH = CELL_H + 10;
const XH = 0.523;              // x-Höhe der vorgedruckten Helvetica
const CAP = 0.718;

export function templateLayout(chars, copies) {
  const cellW = (A4.w - 2 * MARGIN) / COLS;
  const rows = Math.floor((A4.h - 2 * MARGIN - HEADER) / ROW_PITCH);
  const perPage = rows * COLS;
  const cells = [];
  let page = 0;
  for (let pass = 0; pass < copies; pass++) {
    chars.forEach((ch, i) => {
      const k = i % perPage;
      const p = page + Math.floor(i / perPage);
      const col = k % COLS, row = Math.floor(k / COLS);
      const top = MARGIN + HEADER + row * ROW_PITCH;
      cells.push({ page: p, pass, ch, x: MARGIN + col * cellW, top, w: cellW, base: top + 1.05 * EM });
    });
    page += Math.ceil(chars.length / perPage);
  }
  return { v: 1, page: [A4.w, A4.h], em: EM, pages: page, cells };
}

export function buildTemplatePdf(chars, copies) {
  const L = templateLayout(chars, copies);
  const H = A4.h;
  const pages = Array.from({ length: L.pages }, () => ({ strokes: [], ops: '' }));
  const perPass = {};
  for (const c of L.cells) {
    const pg = pages[c.page];
    if (!pg.title) {
      perPass[c.pass] = (perPass[c.pass] || 0) + 1;
      pg.title = true;
      pg.ops += `BT /F1 11 Tf 0.45 g ${n(MARGIN)} ${n(H - MARGIN - 12)} Td (${pdfText(`Handschrift-Vorlage  -  Durchgang ${c.pass + 1}  -  Seite ${perPass[c.pass]}   (grau nachschreiben, schwarzer Stift)`)}) Tj ET\n`;
    }
    const y = (v) => n(H - v);
    const x1 = c.x + 3, x2 = c.x + c.w - 3;
    pg.ops +=
      `q 0.9 G 0.5 w ${n(x1)} ${y(c.top + CELL_H)} ${n(x2 - x1)} ${n(CELL_H)} re S Q\n` +
      `q 0.85 G 0.4 w [1 2] 0 d ${n(x1)} ${y(c.base - CAP * EM)} m ${n(x2)} ${y(c.base - CAP * EM)} l S Q\n` +
      `q 0.75 G 0.5 w [4 3] 0 d ${n(x1)} ${y(c.base - XH * EM)} m ${n(x2)} ${y(c.base - XH * EM)} l S Q\n` +
      `q 0.45 G 0.8 w ${n(x1)} ${y(c.base)} m ${n(x2)} ${y(c.base)} l S Q\n` +
      `q 0.88 G 0.4 w [1 2] 0 d ${n(x1)} ${y(c.base + 0.3 * EM)} m ${n(x2)} ${y(c.base + 0.3 * EM)} l S Q\n`;
    const t = pdfText(c.ch);
    if (t) pg.ops += `BT /F1 ${EM} Tf 0.82 g ${n(c.x + 0.25 * EM)} ${y(c.base)} Td (${t}) Tj ET\n`;
    else if (SYMBOLS[c.ch]) {
      // Zeichen außerhalb von Latin-1 (griechisch, Pfeile, Mathe) kennt Helvetica hier nicht: als graue Striche vorzeichnen.
      pg.ops += `q 0.82 G ${n(EM * 0.06)} w 1 J 1 j\n`;
      for (const st of SYMBOLS[c.ch].strokes) {
        pg.ops += st.map(([px, py], i) => `${n(c.x + 0.25 * EM + px * EM)} ${y(c.base + py * EM)} ${i ? 'l' : 'm'}`).join(' ') + ' S\n';
      }
      pg.ops += 'Q\n';
    }
  }
  const json = JSON.stringify({ v: L.v, page: L.page, em: L.em, cells: L.cells.map((c) => [c.page, c.pass, c.ch, +c.x.toFixed(2), +c.base.toFixed(2), +c.w.toFixed(2)]) });
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
  const comment = MARK + b64;
  return { bytes: buildPdf(pages, [], { title: 'Handschrift-Vorlage', size: A4, comment }), layout: L };
}

function parseMarker(pdfBytes) {
  const head = new TextDecoder('latin1').decode(pdfBytes.subarray(0, Math.min(pdfBytes.length, 400000)));
  const i = head.indexOf('%' + MARK);
  if (i < 0) return null;
  const end = head.indexOf('\n', i);
  const b64 = head.slice(i + 1 + MARK.length, end).trim();
  const json = new TextDecoder().decode(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)));
  const d = JSON.parse(json);
  return { page: d.page, em: d.em, cells: d.cells.map(([page, pass, ch, x, base, w]) => ({ page, pass, ch, x, base, w })) };
}

/* ---------- Striche den Kästchen zuordnen ---------- */

function assign(layout, strokesByPdfPage, font) {
  // strokesByPdfPage: Map(pdfPageIndex -> [{ pts:[[x,y]...], width }]) in Vorlagen-Koordinaten (pt, y nach unten)
  const groups = new Map(); // "pass|ch" -> { cell, strokes }
  let widthSum = 0, widthN = 0;
  for (const [page, strokes] of strokesByPdfPage) {
    const cells = layout.cells.filter((c) => c.page === page);
    for (const s of strokes) {
      if (!s.pts.length) continue;
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const [x, y] of s.pts) { x1 = Math.min(x1, x); x2 = Math.max(x2, x); y1 = Math.min(y1, y); y2 = Math.max(y2, y); }
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
      const cell = cells.find((c) => cx >= c.x && cx <= c.x + c.w && cy >= c.base - 1.05 * layout.em && cy <= c.base + 0.55 * layout.em);
      if (!cell) continue;
      const key = cell.pass + '|' + cell.ch;
      if (!groups.has(key)) groups.set(key, { cell, strokes: [] });
      groups.get(key).strokes.push(s.pts.map(([x, y]) => [(x - cell.x) / layout.em, (y - cell.base) / layout.em, 0.5]));
      if (s.width) { widthSum += s.width; widthN++; }
    }
  }
  let added = 0;
  const chars = new Set();
  for (const { cell, strokes } of groups.values()) {
    const g = normalizeGlyph(strokes);
    if (!g) continue;
    (font.glyphs[cell.ch] ||= []).push(g);
    chars.add(cell.ch);
    added++;
  }
  if (widthN) font.penEm = Math.round((widthSum / widthN / layout.em) * 10000) / 10000;
  const passes = new Set([...groups.values()].map((g) => g.cell.pass));
  font.passes = (font.passes || 0) + passes.size;
  return { added, chars: chars.size };
}

/* ---------- GoodNotes ---------- */

function uuidPlusOne(u) {
  const hex = u.replace(/-/g, '');
  let v = BigInt('0x' + hex) + 1n;
  const h = v.toString(16).toUpperCase().padStart(32, '0');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function importGoodnotes(files, font) {
  const get = (name) => files.get(name)?.();
  // Unsere Vorlage unter den Anhängen finden
  let layout = null, attId = null;
  for (const [name, load] of files) {
    if (!name.startsWith('attachments/')) continue;
    const L = parseMarker(await load());
    if (L) { layout = L; attId = name.slice('attachments/'.length); break; }
  }
  if (!layout) throw new Error('In dieser GoodNotes-Datei steckt keine Handschrift-Vorlage. Importiere die Vorlage-PDF in GoodNotes, schreib darauf und exportiere dann das Notizbuch.');

  const templates = new Map(), pages = new Map();
  for (const rec of readDelimited((await get('index.events.pb')) || new Uint8Array(0))) {
    let top;
    try { top = readPb(rec); } catch { continue; }
    for (const [f, v] of top) {
      if (!(v instanceof Uint8Array) || f === 1) continue;
      let m;
      try { m = readPb(v); } catch { continue; }
      if (f === 2) {
        const size = pbGet(m, 8);
        const t = { id: pbStr(pbGet(m, 2)), att: pbStr(pbGet(m, 4)), pageNo: pbGet(m, 5) };
        if (size instanceof Uint8Array) { const s = readPb(size); t.w = pbGet(s, 1); t.h = pbGet(s, 2); }
        if (t.id) templates.set(t.id, { ...(templates.get(t.id) || {}), ...Object.fromEntries(Object.entries(t).filter(([, x]) => x !== undefined)) });
      } else if (f === 54) {
        const id = pbStr(pbGet(m, 2));
        if (!id) continue;
        const prev = pages.get(id) || { id };
        const tpl = pbGet(m, 3), ord = pbGet(m, 4);
        if (tpl instanceof Uint8Array) prev.template = pbStr(pbGet(readPb(tpl), 1));
        if (ord instanceof Uint8Array) prev.order = pbStr(pbGet(readPb(ord), 1));
        pages.set(id, prev);
      }
    }
  }

  // Seiten in Notizbuch-Reihenfolge; Strichdateien laut Seitenverzeichnis
  const pageList = [...pages.values()].sort((a, b) => String(a.order || '').localeCompare(String(b.order || '')));
  const notesIds = readDelimited((await get('index.notes.pb')) || new Uint8Array(0))
    .map((r) => { try { return pbStr(pbGet(readPb(r), 1)); } catch { return null; } }).filter(Boolean);
  // Seitengröße der Vorlage notfalls aus der PDF selbst (MediaBox)
  const attPdf = new TextDecoder('latin1').decode(await get('attachments/' + attId));
  const mb = attPdf.match(/\/MediaBox\s*\[\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)/);
  const pdfW = mb ? parseFloat(mb[1]) : layout.page[0];

  const stats = { pages: pageList.length, notesFiles: notesIds.length, pagesWithStrokes: 0, strokes: 0, scale: [] };
  const byPage = new Map();
  const ours = pageList.filter((p) => templates.get(p.template)?.att === attId);
  const usePages = ours.length ? ours : pageList;
  for (let i = 0; i < Math.max(usePages.length, ours.length ? 0 : notesIds.length); i++) {
    const p = usePages[i];
    const t = p ? templates.get(p.template) || {} : {};
    let notesId = p && notesIds.includes(uuidPlusOne(p.id)) ? uuidPlusOne(p.id) : null;
    if (!notesId && p && notesIds.includes(p.id)) notesId = p.id;
    if (!notesId) notesId = notesIds[pageList.indexOf(p) >= 0 ? pageList.indexOf(p) : i];
    const notes = notesId ? await get('notes/' + notesId) : null;
    if (!notes || !notes.length) continue;
    const k = layout.page[0] / (t.w || pdfW);
    stats.scale.push(Math.round(k * 1000) / 1000);
    const strokes = new Map(); // Strich-ID -> letzter Stand (null = gelöscht/leer)
    for (const rec of readDelimited(notes)) {
      let m;
      try {
        const body = pbGet(readPb(rec), 7);
        if (!(body instanceof Uint8Array)) continue;
        m = readPb(body);
      } catch { continue; }
      const id = pbStr(pbGet(m, 1)) || 's' + strokes.size;
      const blob = pbGet(m, 2);
      if (!(blob instanceof Uint8Array) || !blob.length) { strokes.set(id, null); continue; }
      let st;
      try { st = readStrokeTpl(appleLz4Decode(blob)); } catch { continue; }
      strokes.set(id, st.points.length ? { pts: st.points.map(([x, y]) => [x * k, y * k]), width: st.width * k } : null);
    }
    const live = [...strokes.values()].filter(Boolean);
    if (live.length) stats.pagesWithStrokes++;
    stats.strokes += live.length;
    const pdfPage = t.pageNo ? t.pageNo - 1 : i;
    byPage.set(pdfPage, (byPage.get(pdfPage) || []).concat(live));
  }
  const res = assign(layout, byPage, font);
  res.stats = stats;
  if (!res.added) throw new Error(diagnose(stats, byPage, layout));
  return res;
}

// Erklärt, warum keine Kästchen getroffen wurden (für Rückmeldungen).
function diagnose(stats, byPage, layout) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const list of byPage.values()) for (const s of list) for (const [x, y] of s.pts) {
    x1 = Math.min(x1, x); x2 = Math.max(x2, x); y1 = Math.min(y1, y); y2 = Math.max(y2, y);
  }
  const area = isFinite(x1) ? `Striche liegen bei x ${Math.round(x1)}–${Math.round(x2)}, y ${Math.round(y1)}–${Math.round(y2)}` : 'keine Striche gelesen';
  return `Keine Striche in den Kästchen gefunden. Details: ${stats.pages} Seiten, ${stats.notesFiles} Strichdateien, ` +
    `${stats.strokes} Striche auf ${stats.pagesWithStrokes} Seiten, ${area}, Vorlage ${Math.round(layout.page[0])}×${Math.round(layout.page[1])}, ` +
    `Maßstab ${stats.scale.join('/') || '?'}.`;
}

/* ---------- Notability (noch nicht mit echter Datei getestet) ---------- */

async function importNotability(files, font) {
  let layout = null, sessionName = null;
  for (const [name, load] of files) {
    if (/\/PDFs\//.test(name) && !layout) layout = parseMarker(await load());
    if (name.endsWith('/Session.plist')) sessionName = name;
  }
  if (!layout) throw new Error('In dieser Notability-Notiz steckt keine Handschrift-Vorlage. Importiere die Vorlage-PDF in Notability, schreib darauf und exportiere dann die Notiz.');
  const { R, root } = keyedArchive(readBplist(await files.get(sessionName)()));
  const rich = R(root.richText);
  const sh = R(R(rich['Handwriting Overlay']).SpatialHash);
  const f32 = (d) => new Float32Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
  const i32 = (d) => new Int32Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
  const counts = i32(R(sh.curvesnumpoints));
  const pts = f32(R(sh.curvespoints));
  const widths = f32(R(sh.curveswidth));
  const docW = R(R(rich.reflowState)?.pageWidthInDocumentCoordsKey) || 567;
  const k = layout.page[0] / docW;
  const pageH = layout.page[1];
  const byPage = new Map();
  let o = 0;
  counts.forEach((c, i) => {
    const P = [];
    for (let j = 0; j < c; j++) P.push([pts[(o + j) * 2], pts[(o + j) * 2 + 1]]);
    o += c;
    const poly = [P[0]];
    for (let s = 0; s + 3 < P.length; s += 3) {
      const [p0, p1, p2, p3] = [P[s], P[s + 1], P[s + 2], P[s + 3]];
      for (let u = 0.25; u <= 1.001; u += 0.25) {
        const a = (1 - u) ** 3, b = 3 * (1 - u) ** 2 * u, cc = 3 * (1 - u) * u * u, d = u ** 3;
        poly.push([a * p0[0] + b * p1[0] + cc * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + cc * p2[1] + d * p3[1]]);
      }
    }
    const scaled = poly.filter(Boolean).map(([x, y]) => [x * k, y * k]);
    const midY = scaled.reduce((s, p) => s + p[1], 0) / scaled.length;
    const page = Math.floor(midY / pageH);
    const list = byPage.get(page) || [];
    list.push({ pts: scaled.map(([x, y]) => [x, y - page * pageH]), width: widths[i] * k });
    byPage.set(page, list);
  });
  return assign(layout, byPage, font);
}

export async function importFilledTemplate(bytes, font) {
  if (bytes[0] === 0x25 && bytes[1] === 0x50) {
    throw new Error('PDF-Dateien kann die App noch nicht auslesen. Exportiere die Notiz bitte als GoodNotes-Datei (.goodnotes) oder Notability-Notiz (.note).');
  }
  const files = readZip(bytes);
  if (files.has('index.events.pb')) return importGoodnotes(files, font);
  if ([...files.keys()].some((nme) => nme.endsWith('/Session.plist'))) return importNotability(files, font);
  throw new Error('Unbekanntes Dateiformat. Erwartet wird eine .goodnotes- oder .note-Datei.');
}
