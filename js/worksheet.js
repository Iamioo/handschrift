// Arbeitsblätter laden: Fotos, Screenshots oder PDF werden zu JPEG-Seiten.
// Jede Seite: { jpeg: Uint8Array, pw, ph, img } (img zum Zeichnen auf dem Bildschirm).
// Die Seiten liegen in IndexedDB, damit sie ein Neuladen der Seite überstehen.

const MAX_W = 1600;      // Breite in Pixeln: scharf genug für A4, klein genug für den Export
const QUALITY = 0.86;

function canvasToJpeg(c) {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Bild konnte nicht umgewandelt werden.'))), 'image/jpeg', QUALITY));
}

async function fromCanvas(c) {
  const blob = await canvasToJpeg(c);
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), pw: c.width, ph: c.height, img: c, blob };
}

async function imageToPage(file) {
  let src;
  try {
    src = await createImageBitmap(file);
  } catch {
    src = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error(`„${file.name}“ lässt sich nicht als Bild öffnen.`));
      im.src = URL.createObjectURL(file);
    });
  }
  const sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight;
  const s = Math.min(1, MAX_W / sw);
  const c = document.createElement('canvas');
  c.width = Math.round(sw * s); c.height = Math.round(sh * s);
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(src, 0, 0, c.width, c.height);
  return fromCanvas(c);
}

let pdfjs = null;
async function loadPdfJs() {
  if (!pdfjs) {
    // Versionsnummer anhängen, damit Safari keine alte pdf.js aus dem Cache nimmt.
    const v = '?v=' + (window.HS_VERSION || '1');
    const url = (f) => new URL('./vendor/pdfjs/' + f + v, import.meta.url).href;
    await import(url('hs-polyfills.mjs'));
    pdfjs = await import(url('pdf-s16.mjs'));
    pdfjs.GlobalWorkerOptions.workerSrc = url('pdf-s16.worker-hs.mjs');
  }
  return pdfjs;
}

async function pdfToPages(file, onProgress) {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    onProgress?.(`PDF-Seite ${i} von ${doc.numPages} …`);
    const page = await doc.getPage(i);
    const vp0 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: MAX_W / vp0.width });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    out.push(await fromCanvas(c));
  }
  return out;
}

const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

export async function loadWorksheetFiles(files, onProgress) {
  const pages = [];
  for (const f of files) {
    onProgress?.(`Lade „${f.name}“ …`);
    if (isPdf(f)) {
      try {
        pages.push(...(await pdfToPages(f, onProgress)));
      } catch (err) {
        console.error(err);
        throw new Error(`Die PDF „${f.name}“ ließ sich nicht öffnen (${err?.name || 'Fehler'}: ${err?.message || err}). Mach notfalls Screenshots der Seiten und lade die stattdessen.`);
      }
    } else pages.push(await imageToPage(f));
  }
  return pages;
}

/* ---------- Speichern ---------- */

const DB = 'handschrift', STORE = 'blobs', KEY = 'arbeitsblatt';

function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function saveWorksheet(pages) {
  try {
    const d = await db();
    await new Promise((res, rej) => {
      const t = d.transaction(STORE, 'readwrite');
      t.objectStore(STORE).put(pages.map((p) => ({ blob: p.blob || new Blob([p.jpeg], { type: 'image/jpeg' }), pw: p.pw, ph: p.ph })), KEY);
      t.oncomplete = res; t.onerror = () => rej(t.error);
    });
  } catch (e) { console.warn('Arbeitsblatt nicht gespeichert', e); }
}

export async function restoreWorksheet() {
  try {
    const d = await db();
    const rows = await new Promise((res, rej) => {
      const r = d.transaction(STORE).objectStore(STORE).get(KEY);
      r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
    });
    const out = [];
    for (const row of rows) {
      const jpeg = new Uint8Array(await row.blob.arrayBuffer());
      let img;
      try { img = await createImageBitmap(row.blob); } catch {
        img = await new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = URL.createObjectURL(row.blob); });
      }
      out.push({ jpeg, pw: row.pw, ph: row.ph, img, blob: row.blob });
    }
    return out;
  } catch (e) {
    console.warn('Arbeitsblatt nicht geladen', e);
    return [];
  }
}

// Vorschaubild einer Seite für die Liste im Reiter.
export function thumbURL(page) {
  return URL.createObjectURL(page.blob || new Blob([page.jpeg], { type: 'image/jpeg' }));
}

// Ein kleines gedrucktes Arbeitsblatt für „Beispiel laden“. Passt zu KI_BLATT_EXAMPLE in kiblatt.js.
export async function makeDemoSheet() {
  const W = 1240, H = 1754;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const X = (p) => (p / 100) * W, Y = (p) => (p / 100) * H;
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#111'; g.strokeStyle = '#111'; g.lineWidth = 2;
  const text = (t, x, y, size = 30, bold = false) => { g.font = `${bold ? 'bold ' : ''}${size}px Helvetica, Arial, sans-serif`; g.fillText(t, X(x), Y(y)); };
  const line = (x1, y1, x2, y2) => { g.beginPath(); g.moveTo(X(x1), Y(y1)); g.lineTo(X(x2), Y(y2)); g.stroke(); };
  const box = (cx, cy, s = 1.6) => { g.strokeRect(X(cx) - X(s) / 2, Y(cy) - X(s) / 2, X(s), X(s)); };

  text('Arbeitsblatt: Bruchrechnung', 8, 4.5, 44, true);
  text('Name:', 8, 9.2); line(17, 9.4, 50, 9.4);
  text('Klasse:', 58, 9.2); line(69, 9.4, 92, 9.4);
  line(8, 13, 92, 13);
  text('1. Berechne:   1/2 + 1/4 =', 8, 23.5, 32, true);
  line(10, 27.8, 34, 27.8);
  text('2. Welcher Bruch ist größer als 1/2? Kreuze an.', 8, 35, 32, true);
  box(10.4, 40.1); text('3/5', 13, 40.9);
  box(30.4, 40.1); text('2/5', 33, 40.9);
  text('3. Kreise den Hauptnenner von 1/4 und 1/6 ein.', 8, 45, 32, true);
  text('6', 30, 49.2, 34); text('12', 54, 49.2, 34); text('24', 76, 49.2, 34);
  text('4. Verbinde, was gleich groß ist.', 8, 55.5, 32, true);
  text('0,5', 22, 60.6, 34); text('0,25', 22, 66.6, 34);
  text('1/4', 64, 60.6, 34); text('1/2', 64, 66.6, 34);
  text('5. Erkläre, wie man 2/3 + 1/4 rechnet.', 8, 73.5, 32, true);
  for (const y of [78, 81.4, 84.8]) line(8, y, 92, y);
  text('6. Zeichne einen Streifen', 8, 89, 32, true);
  text('und teile ihn in Viertel.', 8, 91.6, 32, true);
  g.lineWidth = 1.5; g.setLineDash([8, 6]); g.strokeRect(X(58), Y(85), X(34), Y(12)); g.setLineDash([]);
  return fromCanvas(c);
}
