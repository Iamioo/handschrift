// Leser für ZIP-Archive, binäre Apple-Plists, Protobuf und die GoodNotes-Punktdaten.

const dec = new TextDecoder();

/* ---------- ZIP ---------- */

async function inflateRaw(data) {
  if (typeof DecompressionStream === 'undefined') throw new Error('Dieser Browser kann keine komprimierten ZIP-Dateien entpacken. Bitte Safari ab iPadOS 16.4 oder einen aktuellen Browser nutzen.');
  const ds = new DecompressionStream('deflate-raw');
  const buf = await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(buf);
}

// Liefert Map: Name -> async () => Uint8Array
export function readZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Das ist keine gültige ZIP-Datei.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = new Map();
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP-Verzeichnis beschädigt.');
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    files.set(name, async () => {
      const ln = dv.getUint16(local + 26, true), le = dv.getUint16(local + 28, true);
      const start = local + 30 + ln + le;
      const raw = bytes.subarray(start, start + csize);
      if (method === 0) return raw;
      if (method === 8) return inflateRaw(raw);
      throw new Error('Unbekannte ZIP-Kompression ' + method);
    });
  }
  return files;
}

/* ---------- Binäre Plist ---------- */

export class PUID { constructor(n) { this.n = n; } }

export function readBplist(b) {
  if (dec.decode(b.subarray(0, 8)) !== 'bplist00') throw new Error('Keine binäre Plist.');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const t = b.length - 32;
  const offSize = b[t + 6], refSize = b[t + 7];
  const num = Number(dv.getBigUint64(t + 8)), top = Number(dv.getBigUint64(t + 16)), tableOff = Number(dv.getBigUint64(t + 24));
  const uint = (pos, size) => { let v = 0; for (let i = 0; i < size; i++) v = v * 256 + b[pos + i]; return v; };
  const offsets = Array.from({ length: num }, (_, i) => uint(tableOff + i * offSize, offSize));
  const cache = new Map();
  const obj = (i) => {
    if (cache.has(i)) return cache.get(i);
    let pos = offsets[i];
    const m = b[pos], type = m >> 4, info = m & 15;
    const len = () => {
      if (info !== 15) { pos += 1; return info; }
      const sz = 1 << (b[pos + 1] & 15);
      const v = uint(pos + 2, sz); pos += 2 + sz; return v;
    };
    let v;
    if (type === 0) v = info === 8 ? false : info === 9 ? true : null;
    else if (type === 1) { const sz = 1 << info; v = sz === 8 ? Number(dv.getBigInt64(pos + 1)) : uint(pos + 1, sz); }
    else if (type === 2) v = info === 2 ? dv.getFloat32(pos + 1) : dv.getFloat64(pos + 1);
    else if (type === 3) v = new Date((dv.getFloat64(pos + 1) + 978307200) * 1000);
    else if (type === 4) { const l = len(); v = b.slice(pos, pos + l); }
    else if (type === 5) { const l = len(); v = String.fromCharCode(...b.subarray(pos, pos + l)); }
    else if (type === 6) { const l = len(); v = ''; for (let k = 0; k < l; k++) v += String.fromCharCode(dv.getUint16(pos + k * 2)); }
    else if (type === 8) v = new PUID(uint(pos + 1, info + 1));
    else if (type === 0xa) { const l = len(); v = []; cache.set(i, v); for (let k = 0; k < l; k++) v.push(obj(uint(pos + k * refSize, refSize))); }
    else if (type === 0xd) {
      const l = len(); v = {}; cache.set(i, v);
      for (let k = 0; k < l; k++) v[obj(uint(pos + k * refSize, refSize))] = obj(uint(pos + (l + k) * refSize, refSize));
    } else throw new Error('Plist-Typ ' + type);
    cache.set(i, v);
    return v;
  };
  return obj(top);
}

// NSKeyedArchiver auflösen: liefert eine Funktion, die UIDs in Objekte übersetzt.
export function keyedArchive(plist) {
  const objs = plist.$objects;
  const R = (v) => (v instanceof PUID ? objs[v.n] : v);
  const rootKey = Object.keys(plist.$top)[0];
  return { R, root: R(plist.$top[rootKey]) };
}

/* ---------- Protobuf ---------- */

function varint(b, i) {
  let r = 0n, s = 0n;
  for (;;) {
    const c = b[i++];
    r |= BigInt(c & 0x7f) << s; s += 7n;
    if (c < 0x80) return [r, i];
  }
}

// Liefert Array von [feld, wert]; Längenfelder als Uint8Array, varints als Number (bzw. BigInt bei > 2^53).
export function readPb(b) {
  const out = [];
  let i = 0;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  while (i < b.length) {
    let key; [key, i] = varint(b, i);
    const f = Number(key >> 3n), wt = Number(key & 7n);
    if (wt === 0) { let v; [v, i] = varint(b, i); out.push([f, v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v]); }
    else if (wt === 1) { out.push([f, dv.getFloat64(i, true)]); i += 8; }
    else if (wt === 5) { out.push([f, dv.getFloat32(i, true)]); i += 4; }
    else if (wt === 2) { let l; [l, i] = varint(b, i); l = Number(l); out.push([f, b.subarray(i, i + l)]); i += l; }
    else throw new Error('Protobuf-Typ ' + wt);
  }
  return out;
}

export const pbGet = (fields, no) => fields.find(([f]) => f === no)?.[1];
export const pbStr = (v) => (v instanceof Uint8Array ? dec.decode(v) : v);

export function readDelimited(b) {
  const out = [];
  let i = 0;
  while (i < b.length) {
    let l; [l, i] = varint(b, i); l = Number(l);
    out.push(b.subarray(i, i + l)); i += l;
  }
  return out;
}

/* ---------- Apple-LZ4 und tpl (GoodNotes-Punktdaten) ---------- */

function lz4Block(src, size) {
  const dst = new Uint8Array(size);
  let i = 0, o = 0;
  while (i < src.length) {
    const tok = src[i++];
    let lit = tok >> 4;
    if (lit === 15) { let c; do { c = src[i++]; lit += c; } while (c === 255); }
    dst.set(src.subarray(i, i + lit), o); i += lit; o += lit;
    if (i >= src.length || o >= size) break;
    const off = src[i] | (src[i + 1] << 8); i += 2;
    let ml = tok & 15;
    if (ml === 15) { let c; do { c = src[i++]; ml += c; } while (c === 255); }
    ml += 4;
    for (let k = 0; k < ml; k++, o++) dst[o] = dst[o - off];
  }
  return dst.subarray(0, o);
}

export function appleLz4Decode(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const parts = [];
  let i = 0;
  while (i < b.length) {
    const magic = dec.decode(b.subarray(i, i + 4));
    if (magic === 'bv4$') break;
    if (magic === 'bv41') {
      const dsz = dv.getUint32(i + 4, true), csz = dv.getUint32(i + 8, true);
      parts.push(lz4Block(b.subarray(i + 12, i + 12 + csz), dsz)); i += 12 + csz;
    } else if (magic === 'bv4-') {
      const dsz = dv.getUint32(i + 4, true);
      parts.push(b.subarray(i + 8, i + 8 + dsz)); i += 8 + dsz;
    } else throw new Error('Unbekannter LZ4-Block');
  }
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// tpl "vuA(v)A(S(uu))A(S(uuuu))vA(f)" -> { width, points: [[x,y], ...] } (Kurven abgetastet)
export function readStrokeTpl(raw) {
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  let j = raw.indexOf(0, 8) + 1;
  j += 2;
  const width = dv.getFloat32(j, true); j += 4;
  const nt = dv.getUint32(j, true); j += 4;
  const types = []; for (let k = 0; k < nt; k++) { types.push(dv.getUint16(j, true)); j += 2; }
  const ns = dv.getUint32(j, true); j += 4;
  const starts = []; for (let k = 0; k < ns; k++) { starts.push([dv.getFloat32(j, true), dv.getFloat32(j + 4, true)]); j += 8; }
  const nq = dv.getUint32(j, true); j += 4;
  const quads = []; for (let k = 0; k < nq; k++) { quads.push([0, 4, 8, 12].map((d) => dv.getFloat32(j + d, true))); j += 16; }
  const points = [];
  let si = 0, qi = 0, cur = null;
  for (const t of types) {
    if (t === 0) { cur = starts[si++]; if (cur) points.push(cur); }
    else {
      const q = quads[qi++];
      if (!q || !cur) continue;
      for (let s = 1; s <= 4; s++) {
        const u = s / 4, a = (1 - u) * (1 - u), bb = 2 * (1 - u) * u, c = u * u;
        points.push([a * cur[0] + bb * q[0] + c * q[2], a * cur[1] + bb * q[1] + c * q[3]]);
      }
      cur = [q[2], q[3]];
    }
  }
  return { width, points };
}
