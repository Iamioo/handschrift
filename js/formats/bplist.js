// Schreiber für binäre Apple-Plists (bplist00).
// JS-Werte: String, Boolean, null ("$null" gibt es nur als String), Array, Objekt (Dictionary),
// Uint8Array (Data) sowie die Hüllen UID, Real und Int.

export class UID { constructor(n) { this.n = n; } }
export class Real { constructor(v) { this.v = v; } }
export class Int { constructor(v) { this.v = v; } }

// Gleiche Einzelwerte (Text, Zahl, Wahrheitswert, Daten) werden nur einmal gespeichert,
// genau wie bei Apples und Pythons Schreiber. Notability verwirft die Striche sonst beim Laden.
function scalarKey(v) {
  if (v === true) return 'T';
  if (v === false) return 'F';
  if (v === null || v === undefined) return 'N';
  if (typeof v === 'string') return 's' + v;
  if (v instanceof Int) return 'i' + v.v;
  if (v instanceof Real) return 'r' + v.v;
  if (typeof v === 'number') return (Number.isInteger(v) ? 'i' : 'r') + v;
  if (v instanceof Uint8Array) {
    let s = 'd';
    for (let i = 0; i < v.length; i += 8192) s += String.fromCharCode(...v.subarray(i, i + 8192));
    return s;
  }
  return null; // UID und Container werden nie zusammengefasst
}

export function writeBplist(root) {
  const objects = [];   // [{ kind, value, refs }]
  const seen = new Map();
  const flatten = (v) => {
    const key = scalarKey(v);
    if (key !== null && seen.has(key)) return seen.get(key);
    const idx = objects.length;
    if (key !== null) seen.set(key, idx);
    objects.push(null);
    if (Array.isArray(v)) {
      const refs = v.map(flatten);
      objects[idx] = { kind: 'array', refs };
    } else if (v && typeof v === 'object' && !(v instanceof UID) && !(v instanceof Real) && !(v instanceof Int) && !(v instanceof Uint8Array)) {
      const keys = Object.keys(v);
      const krefs = keys.map(flatten);
      const vrefs = keys.map((k) => flatten(v[k]));
      objects[idx] = { kind: 'dict', krefs, vrefs };
    } else {
      objects[idx] = { kind: 'scalar', value: v };
    }
    return idx;
  };
  flatten(root);

  const refSize = objects.length < 256 ? 1 : objects.length < 65536 ? 2 : 4;
  const chunks = [];
  let pos = 8;
  const offsets = [];
  const push = (arr) => { chunks.push(arr); pos += arr.length; };
  const be = (n, size) => {
    const a = new Uint8Array(size);
    for (let i = size - 1; i >= 0; i--) { a[i] = n & 0xff; n = Math.floor(n / 256); }
    return a;
  };
  const header = (type, len) => {
    if (len < 15) return Uint8Array.of((type << 4) | len);
    return Uint8Array.of((type << 4) | 0xf, ...intBytes(len));
  };
  const intBytes = (n) => {
    if (n < 0) {
      const dv = new DataView(new ArrayBuffer(9));
      dv.setUint8(0, 0x13);
      dv.setBigInt64(1, BigInt(n));
      return new Uint8Array(dv.buffer);
    }
    if (n < 0x100) return [0x10, n];
    if (n < 0x10000) return [0x11, ...be(n, 2)];
    if (n < 0x100000000) return [0x12, ...be(n, 4)];
    return [0x13, ...be(n, 8)];
  };

  for (const o of objects) {
    offsets.push(pos);
    if (o.kind === 'array') {
      push(header(0xa, o.refs.length));
      for (const r of o.refs) push(be(r, refSize));
    } else if (o.kind === 'dict') {
      push(header(0xd, o.krefs.length));
      for (const r of o.krefs) push(be(r, refSize));
      for (const r of o.vrefs) push(be(r, refSize));
    } else {
      const v = o.value;
      if (v === null || v === undefined) push(Uint8Array.of(0x00));
      else if (v === false) push(Uint8Array.of(0x08));
      else if (v === true) push(Uint8Array.of(0x09));
      else if (v instanceof UID) {
        const size = v.n < 0x100 ? 1 : v.n < 0x10000 ? 2 : 4;
        push(Uint8Array.of(0x80 | (size - 1), ...be(v.n, size)));
      } else if (v instanceof Real || (typeof v === 'number' && !Number.isInteger(v))) {
        const dv = new DataView(new ArrayBuffer(9));
        dv.setUint8(0, 0x23);
        dv.setFloat64(1, v instanceof Real ? v.v : v);
        push(new Uint8Array(dv.buffer));
      } else if (v instanceof Int || typeof v === 'number') {
        push(Uint8Array.from(intBytes(v instanceof Int ? v.v : v)));
      } else if (v instanceof Uint8Array) {
        push(header(0x4, v.length));
        push(v);
      } else if (typeof v === 'string') {
        if (/^[\x00-\x7f]*$/.test(v)) {
          push(header(0x5, v.length));
          push(Uint8Array.from(v, (c) => c.charCodeAt(0)));
        } else {
          push(header(0x6, v.length));
          const a = new Uint8Array(v.length * 2);
          for (let i = 0; i < v.length; i++) { a[i * 2] = v.charCodeAt(i) >> 8; a[i * 2 + 1] = v.charCodeAt(i) & 0xff; }
          push(a);
        }
      } else {
        throw new Error('bplist: unbekannter Typ');
      }
    }
  }

  const offsetTableStart = pos;
  const offSize = pos < 0x100 ? 1 : pos < 0x10000 ? 2 : 4;
  for (const off of offsets) push(be(off, offSize));
  const trailer = new Uint8Array(32);
  trailer[6] = offSize;
  trailer[7] = refSize;
  trailer.set(be(objects.length, 8), 8);
  trailer.set(be(0, 8), 16);
  trailer.set(be(offsetTableStart, 8), 24);
  push(trailer);

  const out = new Uint8Array(pos);
  out.set([0x62, 0x70, 0x6c, 0x69, 0x73, 0x74, 0x30, 0x30], 0);
  let o = 8;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// Hilfen für NSKeyedArchiver-Objektlisten.
export class Archive {
  constructor() { this.objects = ['$null']; this.classes = new Map(); }
  add(obj) { this.objects.push(obj); return new UID(this.objects.length - 1); }
  reserve() { this.objects.push(null); return this.objects.length - 1; }
  set(i, obj) { this.objects[i] = obj; return new UID(i); }
  cls(name, chain) {
    const key = name + '|' + (chain || []).join(',');
    if (!this.classes.has(key)) {
      this.classes.set(key, this.add(chain ? { $classname: name, $classes: chain } : { $classname: name }));
    }
    return this.classes.get(key);
  }
  date(seconds) { return this.add({ 'NS.time': new Real(seconds), $class: this.cls('NSDate', ['NSDate', 'NSObject']) }); }
  mutableArray(items = []) { return this.add({ 'NS.objects': items, $class: this.cls('NSMutableArray', ['NSMutableArray', 'NSArray', 'NSObject']) }); }
  array(items = []) { return this.add({ 'NS.objects': items, $class: this.cls('NSArray', ['NSArray', 'NSObject']) }); }
  mutableDict(keys = [], values = []) {
    return this.add({ 'NS.keys': keys, 'NS.objects': values, $class: this.cls('NSMutableDictionary', ['NSMutableDictionary', 'NSDictionary', 'NSObject']) });
  }
  str(s) { return this.add(s); }
  toPlist(archiver, topKey, root) {
    return { $version: 100000, $archiver: archiver, $top: { [topKey]: root }, $objects: this.objects };
  }
}

// Sekunden seit 2001-01-01 (Apple-Referenzdatum).
export const appleTime = (d = new Date()) => d.getTime() / 1000 - 978307200;
