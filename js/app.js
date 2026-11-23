import { loadFonts, saveFonts, loadSettings, saveSettings, newFont, fontToFile, fontFromFile, safeFileName } from './store.js';
import { LETTERS, EXTRA, PEN_EM, Pad, normalizeGlyph, denormalizeGlyph, drawGlyphThumb, drawSample } from './glyphs.js';
import { layout, paperLines, drawPage, PAGE, DEFAULT_OPTS } from './render.js';
import { buildPdf } from './pdf.js';
import { buildGoodnotes } from './formats/goodnotes.js';
import { buildNotabilityFile } from './formats/notability.js';
import { canvasBlob } from './formats/zip.js';
import { Editor } from './editor.js';

const $ = (id) => document.getElementById(id);

const DEFAULT_TEXT = 'Victor jagt zwölf Boxkämpfer quer über den großen Sylter Deich.\n\nDas hier ist meine eigene Handschrift, erzeugt aus dem Alphabet, das ich mit dem Apple Pencil geschrieben habe.';

let fonts = loadFonts();
const settings = loadSettings({
  ...DEFAULT_OPTS,
  activeId: null,
  extra: false,
  auto: false,
  text: DEFAULT_TEXT,
  view: 'capture',
});

if (!fonts.length) {
  const f = newFont('Meine Schrift');
  fonts.push(f);
  settings.activeId = f.id;
  saveFonts(fonts);
}
if (!fonts.find((f) => f.id === settings.activeId)) settings.activeId = fonts[0]?.id || null;

const activeFont = () => fonts.find((f) => f.id === settings.activeId) || null;
const persist = () => { saveFonts(fonts); saveSettings(settings); };

/* ---------- Ansichten ---------- */

function show(view) {
  settings.view = view;
  saveSettings(settings);
  document.querySelectorAll('.view').forEach((s) => s.classList.toggle('active', s.id === 'view-' + view));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  if (view === 'fonts') renderFontList();
  if (view === 'capture') startCapture();
  if (view === 'text') openText();
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => show(t.dataset.view)));

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// Auf dem iPad öffnet sich das Teilen-Menü (z.B. "In GoodNotes öffnen"), sonst ein normaler Download.
async function deliver(blob, name) {
  const isTablet = navigator.maxTouchPoints > 1 && /Mac|iPad|iPhone/.test(navigator.userAgent);
  if (isTablet && navigator.canShare) {
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
  }
  download(blob, name);
}

/* ---------- Schriften ---------- */

function fontStats(f) {
  const letters = LETTERS.filter((c) => f.glyphs[c]?.length).length;
  const variants = Object.values(f.glyphs).reduce((s, v) => s + v.length, 0);
  return `${f.passes} Durchgänge · ${letters}/${LETTERS.length} Buchstaben · ${variants} Varianten`;
}

function renderFontList() {
  const ul = $('font-list');
  ul.innerHTML = '';
  for (const f of fonts) {
    const li = document.createElement('li');
    li.className = 'font-item' + (f.id === settings.activeId ? ' active' : '');
    li.innerHTML = `
      <canvas></canvas>
      <div class="meta"><div class="name"></div><div class="muted small"></div></div>
      <div class="row">
        <button data-a="use">${f.id === settings.activeId ? 'Aktiv' : 'Verwenden'}</button>
        <button data-a="write">Weiter schreiben</button>
        <button data-a="rename">Umbenennen</button>
        <button data-a="download">Herunterladen</button>
        <button data-a="delete" class="danger">Löschen</button>
      </div>`;
    li.querySelector('.name').textContent = f.name;
    li.querySelector('.muted').textContent = fontStats(f);
    ul.appendChild(li);
    requestAnimationFrame(() => drawSample(li.querySelector('canvas'), f, 'Hallo Welt'));
    li.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => fontAction(f, b.dataset.a)));
  }
}

function fontAction(f, a) {
  if (a === 'use') { settings.activeId = f.id; persist(); renderFontList(); }
  if (a === 'write') { settings.activeId = f.id; persist(); show('capture'); }
  if (a === 'rename') {
    const name = prompt('Neuer Name', f.name);
    if (name) { f.name = name.trim(); persist(); renderFontList(); }
  }
  if (a === 'download') download(fontToFile(f), `${safeFileName(f.name)}.handschrift.json`);
  if (a === 'delete') {
    if (!confirm(`„${f.name}“ wirklich löschen? Lade sie vorher herunter, wenn du sie behalten willst.`)) return;
    fonts = fonts.filter((x) => x !== f);
    if (settings.activeId === f.id) settings.activeId = fonts[0]?.id || null;
    persist(); renderFontList();
  }
}

$('btn-new-font').addEventListener('click', () => {
  const name = prompt('Name der neuen Schrift', `Schrift ${fonts.length + 1}`);
  if (!name) return;
  const f = newFont(name.trim());
  fonts.push(f);
  settings.activeId = f.id;
  persist();
  show('capture');
});

$('inp-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const f = fontFromFile(await file.text());
    fonts.push(f);
    settings.activeId = f.id;
    persist(); renderFontList();
  } catch (err) {
    alert(err.message || 'Die Datei konnte nicht gelesen werden.');
  }
});

/* ---------- Alphabet schreiben ---------- */

const cap = { mode: 'pass', single: null };
let autoTimer = 0;
const pad = new Pad($('pad'), {
  onChange: () => clearTimeout(autoTimer),
  onLift: () => {
    if (!settings.auto) return;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => next(), 1300);
  },
});

const charset = () => (settings.extra ? LETTERS.concat(EXTRA) : LETTERS);

function startCapture() {
  const f = activeFont();
  if (!f) { show('fonts'); return; }
  $('cap-auto').checked = settings.auto;
  $('cap-extra').checked = settings.extra;
  if (!f.pass) f.pass = { idx: 0, added: {} };
  cap.mode = 'pass';
  showChar();
  renderGrid();
}

function currentChar() {
  const f = activeFont();
  return cap.mode === 'single' ? cap.single : charset()[Math.min(f.pass.idx, charset().length - 1)];
}

function showChar() {
  const f = activeFont();
  const set = charset();
  const ch = currentChar();
  $('cap-target').textContent = ch;
  if (cap.mode === 'single') {
    $('cap-title').textContent = `Neue Variante für „${ch}“`;
    $('cap-sub').textContent = `Schrift: ${f.name}`;
    pad.set([]);
  } else {
    $('cap-title').textContent = `Durchgang ${f.passes + 1}`;
    $('cap-sub').textContent = `Schrift: ${f.name} · Zeichen ${f.pass.idx + 1} von ${set.length}`;
    const vi = f.pass.added[ch];
    pad.set(vi != null && f.glyphs[ch]?.[vi] ? denormalizeGlyph(f.glyphs[ch][vi]) : []);
  }
  $('cap-progress').style.width = cap.mode === 'single' ? '100%' : `${(f.pass.idx / set.length) * 100}%`;
  $('cap-back').disabled = cap.mode === 'pass' && f.pass.idx === 0;
}

function removeVariant(f, ch, i) {
  f.glyphs[ch].splice(i, 1);
  if (!f.glyphs[ch].length) delete f.glyphs[ch];
  const added = f.pass?.added;
  if (added && added[ch] != null) {
    if (added[ch] === i) delete added[ch];
    else if (added[ch] > i) added[ch]--;
  }
}

function commit() {
  const f = activeFont();
  const ch = currentChar();
  const g = pad.isEmpty() ? null : normalizeGlyph(pad.strokes);
  if (cap.mode === 'single') {
    if (g) (f.glyphs[ch] ||= []).push(g);
  } else {
    const vi = f.pass.added[ch];
    if (vi != null && f.glyphs[ch]?.[vi]) {
      if (g) f.glyphs[ch][vi] = g; else removeVariant(f, ch, vi);
    } else if (g) {
      (f.glyphs[ch] ||= []).push(g);
      f.pass.added[ch] = f.glyphs[ch].length - 1;
    }
  }
  persist();
}

function next() {
  clearTimeout(autoTimer);
  const f = activeFont();
  if (!f) return;
  commit();
  if (cap.mode === 'single') {
    cap.mode = 'pass';
    showChar(); renderGrid();
    return;
  }
  f.pass.idx++;
  if (f.pass.idx >= charset().length) {
    f.passes++;
    f.pass = null;
    persist();
    renderGrid();
    if (confirm(`Durchgang ${f.passes} ist fertig. Willst du das Alphabet noch einmal schreiben? Jeder Durchgang bringt eine weitere Variante pro Buchstabe.`)) {
      f.pass = { idx: 0, added: {} };
      persist();
      showChar();
    } else {
      show('text');
    }
    return;
  }
  persist();
  showChar(); renderGrid();
}

function back() {
  clearTimeout(autoTimer);
  const f = activeFont();
  commit();
  if (cap.mode === 'single') { cap.mode = 'pass'; showChar(); return; }
  f.pass.idx = Math.max(0, f.pass.idx - 1);
  persist();
  showChar(); renderGrid();
}

$('cap-next').addEventListener('click', next);
$('cap-back').addEventListener('click', back);
$('cap-undo').addEventListener('click', () => pad.undo());
$('cap-clear').addEventListener('click', () => pad.clear());
$('cap-auto').addEventListener('change', (e) => { settings.auto = e.target.checked; saveSettings(settings); });
$('cap-extra').addEventListener('change', (e) => {
  settings.extra = e.target.checked;
  saveSettings(settings);
  const f = activeFont();
  if (f?.pass) f.pass.idx = Math.min(f.pass.idx, charset().length - 1);
  showChar(); renderGrid();
});
document.addEventListener('keydown', (e) => {
  if (settings.view !== 'capture' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
  if (e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); next(); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
  if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); pad.undo(); }
});

function renderGrid() {
  const f = activeFont();
  const grid = $('glyph-grid');
  grid.innerHTML = '';
  for (const ch of charset()) {
    const vars = f.glyphs[ch] || [];
    const b = document.createElement('button');
    b.className = 'glyph-cell' + (vars.length ? '' : ' empty');
    b.innerHTML = '<canvas></canvas><span class="lbl"></span><span class="cnt"></span>';
    b.querySelector('.lbl').textContent = ch;
    b.querySelector('.cnt').textContent = vars.length ? '×' + vars.length : '';
    grid.appendChild(b);
    if (vars.length) requestAnimationFrame(() => drawGlyphThumb(b.querySelector('canvas'), vars[0]));
    b.addEventListener('click', () => openGlyphDialog(ch));
  }
}

let dialogChar = null;
function openGlyphDialog(ch) {
  dialogChar = ch;
  $('gd-char').textContent = `„${ch}“`;
  renderDialog();
  $('glyph-dialog').showModal();
}

function renderDialog() {
  const f = activeFont();
  const list = $('gd-list');
  list.innerHTML = '';
  const vars = f.glyphs[dialogChar] || [];
  if (!vars.length) list.innerHTML = '<p class="muted">Noch keine Variante.</p>';
  vars.forEach((v, i) => {
    const d = document.createElement('div');
    d.className = 'variant';
    d.innerHTML = `<canvas></canvas><button type="button" class="danger">Löschen</button>`;
    list.appendChild(d);
    requestAnimationFrame(() => drawGlyphThumb(d.querySelector('canvas'), v));
    d.querySelector('button').addEventListener('click', () => {
      removeVariant(f, dialogChar, i);
      persist(); renderDialog(); renderGrid(); showChar();
    });
  });
}

$('gd-add').addEventListener('click', () => {
  $('glyph-dialog').close();
  commit();
  cap.mode = 'single';
  cap.single = dialogChar;
  showChar();
  $('pad').scrollIntoView({ behavior: 'smooth', block: 'center' });
});

/* ---------- Text & Export ---------- */

let dirty = false;      // true, sobald jemand im Ergebnis radiert oder schreibt
let current = null;     // { pages, lines }
const editor = new Editor($('pages'), {
  getPen: () => ({ w: PEN_EM * settings.penScale * settings.size, c: settings.color }),
  onEdit: () => { dirty = true; },
});

const controls = [
  ['t-size', 'size', (v) => `${v} pt`],
  ['t-lh', 'lineHeight', (v) => Number(v).toFixed(2)],
  ['t-ls', 'letterSpacing', (v) => Number(v).toFixed(2)],
  ['t-ws', 'wordSpacing', (v) => Number(v).toFixed(2)],
  ['t-var', 'variation', (v) => `${Math.round(v * 100)} %`],
  ['t-pen', 'penScale', (v) => `${Math.round(v * 100)} %`],
];
const labelIds = { size: 'v-size', lineHeight: 'v-lh', letterSpacing: 'v-ls', wordSpacing: 'v-ws', variation: 'v-var', penScale: 'v-pen' };

for (const [id, key, fmt] of controls) {
  const el = $(id);
  el.value = settings[key];
  $(labelIds[key]).textContent = fmt(settings[key]);
  el.addEventListener('input', () => {
    settings[key] = Number(el.value);
    $(labelIds[key]).textContent = fmt(settings[key]);
    changed();
  });
}
$('t-text').value = settings.text;
$('t-text').addEventListener('input', () => { settings.text = $('t-text').value; changed(); });
$('t-color').value = settings.color;
$('t-color').addEventListener('input', () => { settings.color = $('t-color').value; changed(); });
$('t-paper').value = settings.paper;
$('t-paper').addEventListener('change', () => { settings.paper = $('t-paper').value; changed(); });
$('t-font').addEventListener('change', () => { settings.activeId = $('t-font').value; changed(); });
$('t-shuffle').addEventListener('click', () => { settings.seed = Math.floor(Math.random() * 1e9); generate(true); });
$('t-generate').addEventListener('click', () => generate(true));

let changeTimer = 0;
function changed() {
  saveSettings(settings);
  if (dirty) {
    $('t-generate').textContent = 'Neu erzeugen';
    return;
  }
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => generate(false), 250);
}

function openText() {
  const sel = $('t-font');
  sel.innerHTML = '';
  for (const f of fonts) {
    const o = document.createElement('option');
    o.value = f.id;
    o.textContent = f.name;
    sel.appendChild(o);
  }
  sel.value = settings.activeId;
  if (!current || !dirty) generate(false);
  else editor.resizeAll();
}

function generate(byUser) {
  const f = activeFont();
  if (dirty && byUser && !confirm('Deine Änderungen auf den Seiten gehen beim Neu-Erzeugen verloren. Fortfahren?')) return;
  dirty = false;
  $('t-generate').textContent = 'Erzeugen';
  const warn = $('t-warn');
  if (!f || !Object.keys(f.glyphs).length) {
    current = { pages: [], lines: [] };
    editor.setDoc([], []);
    warn.hidden = false;
    warn.textContent = 'Diese Schrift hat noch keine Buchstaben. Schreib zuerst das Alphabet.';
    return;
  }
  const { pages, missing } = layout(settings.text, f, settings);
  const lines = paperLines(settings.paper, settings);
  current = { pages, lines };
  editor.setDoc(pages, lines);
  warn.hidden = !missing.length;
  warn.textContent = missing.length ? `Fehlende Zeichen (bleiben leer): ${missing.join(' ')}` : '';
}

document.querySelectorAll('.tool').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.tool').forEach((x) => x.classList.toggle('active', x === b));
  editor.setTool(b.dataset.tool);
}));
document.querySelector('.tool[data-tool="pen"]').classList.add('active');
$('ed-undo').addEventListener('click', () => editor.undo());
$('ed-delete').addEventListener('click', () => editor.deleteSelection());

function exportTitle() {
  return (settings.text.split('\n').find((l) => l.trim()) || 'Handschrift').trim().slice(0, 40);
}

// Erste Seite als Vorschaubild für GoodNotes und Notability.
async function thumbnail(type) {
  const c = document.createElement('canvas');
  const scale = 640 / PAGE.w;
  c.width = Math.round(PAGE.w * scale);
  c.height = Math.round(PAGE.h * scale);
  drawPage(c.getContext('2d'), current.pages[0], current.lines, scale);
  const blob = await canvasBlob(c, type, 0.85);
  return new Uint8Array(await blob.arrayBuffer());
}

async function exportAs(kind) {
  if (!current?.pages.length) { alert('Es gibt noch nichts zu exportieren.'); return; }
  const title = exportTitle();
  const base = safeFileName(title);
  try {
    if (kind === 'goodnotes') {
      const paperPdf = buildPdf([{ strokes: [] }], current.lines, { title: 'Papier' });
      const bytes = buildGoodnotes(current.pages, {
        title,
        paperPdf,
        paperName: `Handschrift_${settings.paper}`,
        lineSpacing: settings.size * settings.lineHeight,
        margin: settings.margin,
        thumbnailJpg: await thumbnail('image/jpeg'),
      });
      await deliver(new Blob([bytes], { type: 'application/octet-stream' }), `${base}.goodnotes`);
    } else if (kind === 'notability') {
      const bytes = await buildNotabilityFile(current.pages, { name: title, thumbnailPng: await thumbnail('image/png') });
      await deliver(new Blob([bytes], { type: 'application/octet-stream' }), `${base}.note`);
    } else {
      const bytes = buildPdf(current.pages, current.lines, { editable: kind === 'ink', title });
      await deliver(new Blob([bytes], { type: 'application/pdf' }), `${base}${kind === 'ink' ? '-striche' : ''}.pdf`);
    }
  } catch (err) {
    console.error(err);
    alert('Export fehlgeschlagen: ' + (err.message || err));
  }
}
$('ex-goodnotes').addEventListener('click', () => exportAs('goodnotes'));
$('ex-notability').addEventListener('click', () => exportAs('notability'));
$('ex-pdf-ink').addEventListener('click', () => exportAs('ink'));
$('ex-pdf').addEventListener('click', () => exportAs('flat'));

/* ---------- Start ---------- */

show(['fonts', 'capture', 'text'].includes(settings.view) ? settings.view : 'capture');
