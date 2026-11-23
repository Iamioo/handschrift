// Export als GoodNotes-6-Notizbuch (.goodnotes). Aufbau siehe docs/dateiformate.md.
import { makeZip, concat, uuid } from './zip.js';
import { PAGE } from '../render.js';

const SCHEMA = 24;
const enc = new TextEncoder();

/* ---------- Protobuf-Schreiber ---------- */

function varint(n) {
  let v = BigInt(n);
  const out = [];
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) b |= 0x80;
    out.push(b);
  } while (v > 0n);
  return out;
}

// Felder: [nummer, typ, wert]; typ: 'v' varint, 's' Text, 'b' Bytes, 'm' Nachricht (Felder-Array), 'f' float32, 'd' float64
function msg(fields) {
  const parts = [];
  for (const [no, type, val] of fields) {
    if (val === undefined || val === null) continue;
    if (type === 'v') {
      parts.push(Uint8Array.from([...varint(no << 3), ...varint(val)]));
    } else if (type === 'f') {
      const dv = new DataView(new ArrayBuffer(4)); dv.setFloat32(0, val, true);
      parts.push(Uint8Array.from(varint((no << 3) | 5)), new Uint8Array(dv.buffer));
    } else if (type === 'd') {
      const dv = new DataView(new ArrayBuffer(8)); dv.setFloat64(0, val, true);
      parts.push(Uint8Array.from(varint((no << 3) | 1)), new Uint8Array(dv.buffer));
    } else {
      const body = type === 's' ? enc.encode(val) : type === 'm' ? msg(val) : val;
      parts.push(Uint8Array.from([...varint((no << 3) | 2), ...varint(body.length)]), body);
    }
  }
  return concat(parts);
}

const delimited = (m) => concat([Uint8Array.from(varint(m.length)), m]);
const rand32 = () => crypto.getRandomValues(new Uint32Array(1))[0];
const version = (n = 1) => [[1, 'v', n], [2, 'v', rand32()]];

/* ---------- Punktdaten: tpl-Datensatz, in Apple-LZ4 verpackt ---------- */

class Bin {
  constructor() { this.a = []; }
  u8(...b) { this.a.push(...b); }
  u16(v) { this.a.push(v & 0xff, (v >> 8) & 0xff); }
  u32(v) { this.a.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff); }
  f32(v) { const b = new Uint8Array(new Float32Array([v]).buffer); this.a.push(...b); }
  bytes() { return Uint8Array.from(this.a); }
}

const TPL_FORMAT = 'vuA(v)A(S(uu))A(S(uuuu))vA(f)';

// Polylinie -> Startpunkt + quadratische Kurvenstücke (Kontrollpunkt = Messpunkt, Ende = Mitte zum nächsten).
function strokeTpl(s) {
  let pts = s.pts;
  if (pts.length === 1) pts = [pts[0], [pts[0][0] + 0.3, pts[0][1] + 0.3]];
  const quads = [];
  for (let i = 1; i < pts.length; i++) {
    const c = pts[i - 1];
    const e = i === pts.length - 1 ? pts[i] : [(pts[i - 1][0] + pts[i][0]) / 2, (pts[i - 1][1] + pts[i][1]) / 2];
    // erstes Stück: gerade vom Start aus
    quads.push(i === 1 ? [(pts[0][0] + e[0]) / 2, (pts[0][1] + e[1]) / 2, e[0], e[1]] : [c[0], c[1], e[0], e[1]]);
  }
  const body = new Bin();
  body.u16(2);
  body.f32(s.w);                         // Strichbreite (als u32-Bits)
  body.u32(quads.length + 1);            // A(v): Elementtypen
  body.u16(0);
  for (let i = 0; i < quads.length; i++) body.u16(1);
  body.u32(1);                           // A(S(uu)): Startpunkt
  body.f32(pts[0][0]); body.f32(pts[0][1]);
  body.u32(quads.length);                // A(S(uuuu)): Kurvenstücke
  for (const q of quads) q.forEach((v) => body.f32(v));
  body.u16(1);
  body.u32(0);                           // A(f): leer
  const data = body.bytes();
  const fmt = enc.encode(TPL_FORMAT + '\0');
  const total = 8 + fmt.length + data.length;
  const head = new Bin();
  head.u8(0x74, 0x70, 0x6c, 0x00);       // "tpl\0"
  head.u32(total);
  return concat([head.bytes(), fmt, data]);
}

// LZ4-Block nur aus Literalen (gültig, aber unkomprimiert), in Apple-Rahmen "bv41" … "bv4$".
function appleLz4(raw) {
  const n = raw.length;
  const lenBytes = [];
  if (n >= 15) {
    let r = n - 15;
    while (r >= 255) { lenBytes.push(255); r -= 255; }
    lenBytes.push(r);
  }
  const block = concat([Uint8Array.of(Math.min(n, 15) << 4, ...lenBytes), raw]);
  const h = new Bin();
  h.u8(0x62, 0x76, 0x34, 0x31);          // "bv41"
  h.u32(n);
  h.u32(block.length);
  return concat([h.bytes(), block, Uint8Array.of(0x62, 0x76, 0x34, 0x24)]); // "bv4$"
}

function color(hex) {
  const m = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m.substr(i, 2), 16) / 255);
  return [[1, 'f', r], [2, 'f', g], [3, 'f', b], [4, 'f', 1]];
}

// Seiten-ID und Strichdatei-ID unterscheiden sich in GoodNotes um 1 in der letzten Stelle.
function pageIds() {
  const base = uuid();
  const last = parseInt(base.slice(-1), 16) & 0xe;
  return { page: base.slice(0, -1) + last.toString(16).toUpperCase(), notes: base.slice(0, -1) + (last + 1).toString(16).toUpperCase() };
}

function orderKey(i) {
  return 'N' + i.toString(36).toUpperCase().padStart(4, '0');
}

/* ---------- Notizbuch ---------- */

export function buildGoodnotes(pages, { title, paperPdf, paperName, lineSpacing, margin, thumbnailJpg }) {
  const device = (BigInt(rand32()) << 31n) | BigInt(rand32());
  let seq = Date.now();
  let noteSeq = 1500000;
  const now = () => Date.now() + (seq % 1000) / 1000;
  const docId = uuid();
  const attId = uuid();
  const templateId = uuid();
  const ids = pages.map(pageIds);

  // notes/<id>: pro Strich ein Kopf und ein Inhalt
  const noteFiles = pages.map((page) => {
    const recs = [];
    page.strokes.forEach((s, z) => {
      const sid = uuid();
      const ver = version(2);
      recs.push(delimited(msg([
        [1, 's', sid], [2, 'm', ver], [8, 'v', device], [9, 'v', noteSeq++], [14, 'v', 5381], [16, 'v', SCHEMA],
      ])));
      recs.push(delimited(msg([[7, 'm', [
        [1, 's', sid],
        [2, 'b', appleLz4(strokeTpl(s))],
        [4, 'm', color(s.c)],
        [6, 's', ''],
        [7, 'm', [[1, 'm', [[1, 'v', z + 1], [2, 'v', rand32()]]]]],
        [9, 's', ''],
        [15, 'm', ver],
        [20, 's', ''],
        [21, 'v', SCHEMA],
      ]]])));
    });
    return concat(recs);
  });

  // index.events.pb: Ereignisprotokoll
  const ev = [];
  const event = (id, field, fields) => ev.push(delimited(msg([[1, 's', id], [field, 'm', fields]])));
  event(docId, 30, [
    [1, 's', docId],
    [2, 'm', [[1, 's', title], [2, 'm', version()]]],
    [6, 'm', [[1, 's', (title[0] || 'H').toUpperCase()], [2, 'm', version()]]],
    [9, 's', 'auto'],
    [10, 'd', now()], [11, 's', uuid()], [13, 'v', device], [14, 'v', seq++],
    [17, 's', ''], [18, 's', ''],
    [19, 'm', [[2, 'm', version()]]],
    [20, 'v', SCHEMA],
  ]);
  event(attId, 6, [
    [1, 's', attId], [2, 's', attId], [5, 'v', paperPdf.length], [6, 's', docId],
    [10, 'd', now()], [11, 's', uuid()], [12, 'm', [[1, 'v', 1], [2, 'v', 1]]],
    [14, 'v', device], [15, 'v', seq++], [16, 'v', SCHEMA],
  ]);
  event(templateId, 2, [
    [1, 's', docId], [2, 's', templateId], [4, 's', attId], [5, 'v', 1], [6, 'v', 1],
    [7, 'd', lineSpacing],
    [8, 'm', [[1, 'f', PAGE.w], [2, 'f', PAGE.h]]],
    [9, 's', `${paperName} - White`],
    [10, 'd', now()], [11, 's', uuid()],
    [12, 'm', [[1, 'd', lineSpacing], [2, 'm', version()]]],
    [13, 'm', [[1, 'v', 1], [2, 'm', version()]]],
    [15, 'v', device], [16, 'v', seq++],
    [17, 'm', [[1, 'v', 1], [2, 'm', version()]]],
    [18, 'm', [
      // Schreibbereich als Ursprung + Größe (im Original: 44 + 746,24 = 834,24 − 44)
      [1, 'm', [[1, 'm', [[1, 'f', margin], [2, 'f', margin]]], [2, 'm', [[1, 'f', PAGE.w - 2 * margin], [2, 'f', PAGE.h - 2 * margin]]]]],
      [2, 'f', lineSpacing], [3, 'f', 1], [5, 'v', 1],
    ]],
    [19, 'm', [[2, 'm', version()]]],
    [21, 'v', SCHEMA],
  ]);
  ids.forEach(({ page, notes }, i) => {
    event(page, 54, [
      [1, 's', docId], [2, 's', page],
      [3, 'm', [[1, 's', templateId], [2, 'm', version()]]],
      [4, 'm', [[1, 's', orderKey(i + 1)], [2, 'm', version()]]],
      [10, 'd', now()], [11, 's', uuid()], [13, 'v', device], [14, 'v', seq++], [15, 'v', SCHEMA],
      [17, 'm', [[1, 'm', [[2, 'm', [[1, 'm', color('#dddddd')], [2, 'm', color('#ffffff')]]]]], [2, 'm', version()]]],
    ]);
    event(notes, 104, [
      [1, 's', docId], [2, 's', notes],
      [10, 'd', now()], [11, 's', uuid()], [13, 's', 'auto'], [14, 'v', 1], [15, 's', uuid()],
      [17, 'v', device], [18, 'v', seq++], [19, 'v', SCHEMA],
    ]);
  });
  if (ids.length) {
    event(docId, 10, [
      [1, 's', docId], [2, 's', ids[0].page], [3, 's', `PagingViewServiceUpdater:${uuid()}`],
      [10, 'd', now()], [11, 's', uuid()], [13, 'v', device], [14, 'v', seq++], [15, 'v', SCHEMA],
    ]);
  }

  const files = [
    { name: 'document.info.pb', data: new Uint8Array(0) },
    { name: 'index.search.pb', data: delimited(msg([[1, 's', attId], [2, 's', `search/${attId}`], [3, 'v', 1]])) },
    { name: 'index.notes.pb', data: concat(ids.map(({ notes }) => delimited(msg([[1, 's', notes], [2, 's', `notes/${notes}`]])))) },
    { name: `search/${attId}`, data: delimited(msg([[2, 'v', 1], [3, 's', '']])) },
    ...ids.map(({ notes }, i) => ({ name: `notes/${notes}`, data: noteFiles[i] })),
    { name: 'index.events.pb', data: concat(ev) },
    { name: 'thumbnail.jpg', data: thumbnailJpg },
    { name: 'index.attachments.pb', data: delimited(msg([[1, 's', attId], [2, 's', `attachments/${attId}`]])) },
    { name: `attachments/${attId}`, data: paperPdf },
    { name: 'schema.pb', data: msg([[1, 'v', SCHEMA]]) },
  ];
  return makeZip(files);
}

// Für Tests: einzelne Bausteine
export const _internal = { msg, strokeTpl, appleLz4, varint };
