// Kleiner PDF-Schreiber ohne Abhängigkeiten.
// editable = false: Striche landen im Seiteninhalt (flach).
// editable = true:  jedes Wort wird eine Ink-Anmerkung (/Subtype /Ink) mit eigenem Erscheinungsbild.
// page.ops: zusätzlicher Seiteninhalt (PDF-Operatoren, y nach oben), z.B. für die Vorlage.
import { PAGE, PAPER } from './render.js';
import { widthFactor } from './glyphs.js';

export const n = (v) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};

export function rgb(hex) {
  const m = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(m.substr(i, 2), 16) / 255);
}

function strokeOps(s, H) {
  const [r, g, b] = rgb(s.c);
  let out = `${n(r)} ${n(g)} ${n(b)} RG 1 J 1 j\n`;
  const p = s.pts;
  if (p.length === 1) {
    return out + `${n(s.w * widthFactor(p[0][2]))} w ${n(p[0][0])} ${n(H - p[0][1])} m ${n(p[0][0] + 0.05)} ${n(H - p[0][1])} l S\n`;
  }
  let curW = -1, path = '';
  for (let i = 1; i < p.length; i++) {
    const w = Math.round(s.w * widthFactor((p[i - 1][2] + p[i][2]) / 2) * 10) / 10;
    if (w !== curW) {
      if (path) out += path + ' S\n';
      out += `${n(w)} w `;
      path = `${n(p[i - 1][0])} ${n(H - p[i - 1][1])} m`;
      curW = w;
    }
    path += ` ${n(p[i][0])} ${n(H - p[i][1])} l`;
  }
  return out + path + ' S\n';
}

function paperOps(lines, H) {
  if (!lines.length) return '';
  const [r, g, b] = rgb(PAPER.color);
  let out = `q ${n(r)} ${n(g)} ${n(b)} RG ${n(PAPER.width)} w\n`;
  for (const [x1, y1, x2, y2] of lines) out += `${n(x1)} ${n(H - y1)} m ${n(x2)} ${n(H - y2)} l S\n`;
  return out + 'Q\n';
}

const ascii = (s) => s.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/[()\\]/g, '');

// Text für die Standardschrift Helvetica (WinAnsi): Klammern und Backslash maskieren, nur Latin-1.
export function pdfText(s) {
  return [...s].map((c) => {
    const code = c.charCodeAt(0);
    if (c === '(' || c === ')' || c === '\\') return '\\' + c;
    if (code < 32 || code > 255) return '';
    return c;
  }).join('');
}

function pdfDate(d = new Date()) {
  const p = (v) => String(v).padStart(2, '0');
  return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// scale: Seitenmaß in der PDF = Blattmaß * scale (Inhalt wird mitskaliert). GoodNotes rechnet PDF-Punkte
// mit 11/6 in Blattmaße um; seine eigenen Papier-PDFs sind darum 455,04 pt breit für ein 834,24 breites Blatt.
export function buildPdf(pages, lines, { editable = false, title = 'Handschrift', size = PAGE, comment = '', scale = 1 } = {}) {
  const W = size.w, H = size.h;
  const sc = String(Math.round(scale * 1e6) / 1e6);
  const objs = [null, null]; // 1: Katalog, 2: Seitenbaum
  const add = (s) => { objs.push(s); return objs.length; };
  const stream = (dict, data) => `<< ${dict} /Length ${data.length} >>\nstream\n${data}\nendstream`;
  const pageIds = [];
  const now = pdfDate();
  const paper = paperOps(lines, H);
  const fontId = pages.some((p) => p.ops) ? add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>') : 0;
  const fontRes = fontId ? `/Font << /F1 ${fontId} 0 R >>` : '';
  // JPEG-Hintergründe (Arbeitsblätter) als Bild-XObject, jedes Bild nur einmal.
  const imgIds = new Map();
  const imageId = (bg) => {
    if (!imgIds.has(bg.jpeg)) {
      const bin = bytesToBinary(bg.jpeg);
      imgIds.set(bg.jpeg, add(`<< /Type /XObject /Subtype /Image /Width ${bg.pw} /Height ${bg.ph} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bin.length} >>\nstream\n${bin}\nendstream`));
    }
    return imgIds.get(bg.jpeg);
  };

  pages.forEach((page, pi) => {
    const pageId = add(null);
    pageIds.push(pageId);
    let bgOps = '', xobj = '';
    if (page.bg?.jpeg) {
      const [x, y, w, h] = page.bg.rect;
      xobj = `/XObject << /Im0 ${imageId(page.bg)} 0 R >>`;
      bgOps = `q ${n(w)} 0 0 ${n(h)} ${n(x)} ${n(H - y - h)} cm /Im0 Do Q\n`;
    }
    const resources = `<< ${fontRes} ${xobj} >>`;
    let content = bgOps + paper + (page.ops || '');
    const wrap = (c) => (scale === 1 ? c : `q ${sc} 0 0 ${sc} 0 0 cm
${c}Q
`);
    const annots = [];
    if (!editable) {
      for (const s of page.strokes) content += strokeOps(s, H);
    } else {
      const groups = new Map();
      for (const s of page.strokes) {
        const key = s.g || 'x';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(s);
      }
      let ai = 0;
      for (const strokes of groups.values()) {
        let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity, maxW = 0;
        for (const s of strokes) {
          maxW = Math.max(maxW, s.w * 1.5);
          for (const [x, y] of s.pts) {
            x1 = Math.min(x1, x); x2 = Math.max(x2, x);
            y1 = Math.min(y1, H - y); y2 = Math.max(y2, H - y);
          }
        }
        const pad = maxW + 1;
        const rect = [x1 - pad, y1 - pad, x2 + pad, y2 + pad].map(n).join(' ');
        const ops = strokes.map((s) => strokeOps(s, H)).join('');
        const apId = add(stream(`/Type /XObject /Subtype /Form /FormType 1 /BBox [${rect}] /Resources << >>`, ops));
        const ink = strokes.map((s) => '[' + s.pts.map(([x, y]) => `${n(x)} ${n(H - y)}`).join(' ') + ']').join(' ');
        const [r, g, b] = rgb(strokes[0].c);
        const avgW = strokes.reduce((a, s) => a + s.w, 0) / strokes.length;
        annots.push(add(
          `<< /Type /Annot /Subtype /Ink /Rect [${rect}] /InkList [${ink}] /BS << /Type /Border /W ${n(avgW)} /S /S >> ` +
          `/C [${n(r)} ${n(g)} ${n(b)}] /CA 1 /F 4 /NM (hs-${pi}-${ai++}) /M (${now}) /T (Handschrift) ` +
          `/P ${pageId} 0 R /AP << /N ${apId} 0 R >> >>`
        ));
      }
    }
    const contentId = add(stream('', wrap(content)));
    objs[pageId - 1] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(W * scale)} ${n(H * scale)}] /Contents ${contentId} 0 R /Resources ${resources}` +
      (annots.length ? ` /Annots [${annots.map((a) => a + ' 0 R').join(' ')}]` : '') + ' >>';
  });

  objs[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[1] = `<< /Type /Pages /Kids [${pageIds.map((i) => i + ' 0 R').join(' ')}] /Count ${pageIds.length} >>`;
  const infoId = add(`<< /Title (${ascii(title)}) /Producer (Handschrift Web-App) /CreationDate (${now}) >>`);

  let out = '%PDF-1.7\n%\xe2\xe3\xcf\xd3\n' + (comment ? comment.split('\n').map((l) => '%' + l).join('\n') + '\n' : '');
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += String(off).padStart(10, '0') + ' 00000 n \n';
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}

function bytesToBinary(u8) {
  let out = '';
  for (let i = 0; i < u8.length; i += 0x8000) out += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return out;
}
