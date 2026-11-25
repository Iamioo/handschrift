import { loadFonts, saveFonts, loadSettings, saveSettings, newFont, fontToFile, fontFromFile, safeFileName } from './store.js';
import { LETTERS, EXTRA, PEN_EM, Pad, normalizeGlyph, denormalizeGlyph, drawGlyphThumb, drawSample } from './glyphs.js';
import { layout, paperLines, drawPage, PAGE, DEFAULT_OPTS, setPageFormat, setPaperStyle, setPageSize } from './render.js';
import { buildPdf } from './pdf.js';
import { buildGoodnotes } from './formats/goodnotes.js';
import { buildNotabilityFile, notePackageName } from './formats/notability.js';
import { canvasBlob } from './formats/zip.js';
import { makeTestFont } from './testfont.js';
import { buildTemplatePdf, importFilledTemplate } from './template.js';
import { layoutScene, parseSceneText, sceneInfo, layoutWorksheet, parseWorksheetText } from './scene.js';
import { KI_BLATT_PROMPT, KI_BLATT_EXAMPLE } from './kiblatt.js';
import { loadWorksheetFiles, saveWorksheet, restoreWorksheet, thumbURL, makeDemoSheet } from './worksheet.js';
import { KI_PROMPT } from './kiprompt.js';
import { KI_EXAMPLE } from './kiexample.js';

const DEFAULT_CHARS = LETTERS.concat(EXTRA).join('');
import { Editor } from './editor.js';
import { PACKS, packChars } from './charsets.js';

const $ = (id) => document.getElementById(id);

const DEFAULT_TEXT = 'Victor jagt zwölf Boxkämpfer quer über den großen Sylter Deich.\n\nDas hier ist meine eigene Handschrift, erzeugt aus dem Alphabet, das ich mit dem Apple Pencil geschrieben habe.';

let fonts = loadFonts();
const settings = loadSettings({
  ...DEFAULT_OPTS,
  activeId: null,
  chars: DEFAULT_CHARS,
  tplCopies: 1,
  auto: false,
  text: DEFAULT_TEXT,
  view: 'capture',
  source: 'text',
  kiJson: '',
  orientation: 'hoch',
  packs: [],
  blattJson: '',
  tplMissing: false,
});

if (!fonts.length) {
  const f = newFont('Meine Schrift');
  fonts.push(f);
  settings.activeId = f.id;
  saveFonts(fonts);
}
if (!fonts.find((f) => f.id === settings.activeId)) settings.activeId = fonts[0]?.id || null;

// Zeichenliste aus den Einstellungen, ohne Leerraum und doppelte Zeichen.
const charsFrom = (s) => [...new Set([...(s || '')].filter((c) => c.trim()))];
const baseChars = () => {
  const c = charsFrom(settings.chars);
  return c.length ? c : charsFrom(DEFAULT_CHARS);
};
// Grundzeichen plus angehakte Pakete (Mathe, Griechisch, …), ohne doppelte Zeichen.
const charset = () => [...new Set(baseChars().concat(packChars(settings.packs || [])))];

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
  if (view === 'board') openBoard();
  if (view === 'sheet') openSheet();
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
  renderTemplateTarget();
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

$('btn-test-font').addEventListener('click', () => {
  const f = makeTestFont();
  fonts.push(f);
  settings.activeId = f.id;
  persist();
  show('text');
});

/* ---------- Vorlage zum Nachschreiben ---------- */

$('tpl-chars').value = baseChars().join(' ');
$('tpl-chars').addEventListener('input', () => { settings.chars = $('tpl-chars').value; saveSettings(settings); });
$('tpl-reset').addEventListener('click', () => {
  settings.chars = DEFAULT_CHARS;
  $('tpl-chars').value = baseChars().join(' ');
  saveSettings(settings);
});
$('tpl-copies').value = String(settings.tplCopies);
$('tpl-copies').addEventListener('change', () => { settings.tplCopies = Number($('tpl-copies').value); saveSettings(settings); });

function renderPacks() {
  const box = $('tpl-packs');
  box.innerHTML = '';
  for (const p of PACKS) {
    const on = settings.packs.includes(p.id);
    const l = document.createElement('label');
    l.className = 'pack' + (on ? ' on' : '');
    l.innerHTML = '<span><input type="checkbox"><b></b></span><span class="chars"></span>';
    l.querySelector('input').checked = on;
    l.querySelector('b').textContent = p.label;
    l.querySelector('.chars').textContent = [...p.chars].join(' ');
    l.querySelector('input').addEventListener('change', (e) => {
      settings.packs = e.target.checked ? [...new Set([...settings.packs, p.id])] : settings.packs.filter((x) => x !== p.id);
      saveSettings(settings);
      renderPacks();
    });
    box.appendChild(l);
  }
}
renderPacks();
$('tpl-missing').checked = settings.tplMissing;
$('tpl-missing').addEventListener('change', () => { settings.tplMissing = $('tpl-missing').checked; saveSettings(settings); });

$('tpl-download').addEventListener('click', async () => {
  let chars = charset();
  const f = fonts.find((x) => x.id === $('tpl-target').value);
  if (settings.tplMissing && f) {
    chars = chars.filter((c) => !f.glyphs[c]?.length);
    if (!chars.length) {
      $('tpl-status').textContent = `„${f.name}“ hat schon alle ausgewählten Zeichen. Hak weitere Pakete an oder schalte „Nur fehlende Zeichen“ aus.`;
      return;
    }
  }
  const { bytes, layout: L } = buildTemplatePdf(chars, settings.tplCopies);
  $('tpl-status').textContent = `Vorlage mit ${chars.length} Zeichen, ${settings.tplCopies} Durchgang/Durchgänge, ${L.pages} Seiten.`;
  const name = settings.tplMissing && f ? `Handschrift-Vorlage-${safeFileName(f.name)}-Ergänzung.pdf` : 'Handschrift-Vorlage.pdf';
  await deliver(new Blob([bytes], { type: 'application/pdf' }), name);
});

function renderTemplateTarget() {
  const sel = $('tpl-target');
  const keep = sel.value;
  sel.innerHTML = '';
  for (const f of fonts) {
    const o = document.createElement('option');
    o.value = f.id;
    o.textContent = f.name;
    sel.appendChild(o);
  }
  const o = document.createElement('option');
  o.value = '__new';
  o.textContent = 'Neue Schrift anlegen';
  sel.appendChild(o);
  sel.value = [...sel.options].some((x) => x.value === keep) ? keep : (settings.activeId || '__new');
}

$('tpl-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let f = fonts.find((x) => x.id === $('tpl-target').value);
  if (!f) {
    f = newFont(file.name.replace(/\.[^.]+$/, '') || 'Meine Schrift');
    fonts.push(f);
  }
  $('tpl-status').textContent = 'Lese Datei …';
  try {
    const { added, chars } = await importFilledTemplate(new Uint8Array(await file.arrayBuffer()), f);
    if (!added) throw new Error('Auf der Vorlage wurden keine Striche in den Kästchen gefunden.');
    settings.activeId = f.id;
    persist();
    renderFontList();
    $('tpl-status').textContent = `${added} Varianten für ${chars} Zeichen in „${f.name}“ übernommen.`;
  } catch (err) {
    console.error(err);
    if (!Object.keys(f.glyphs).length) { fonts = fonts.filter((x) => x !== f); }
    $('tpl-status').textContent = 'Import fehlgeschlagen: ' + (err.message || err);
  }
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


function startCapture() {
  const f = activeFont();
  if (!f) { show('fonts'); return; }
  $('cap-auto').checked = settings.auto;
  if (!f.pass) f.pass = { idx: 0, added: {} };
  f.pass.idx = Math.min(f.pass.idx, charset().length - 1);
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

/* ---------- Tafelbild per KI ---------- */

const PAPER_NAMES = { liniert: 'lined', kariert: 'grid', blanko: 'blank', lined: 'lined', grid: 'grid', blank: 'blank' };

$('ki-prompt').textContent = KI_PROMPT;

function openBoard() {
  if (!$('ki-json').value) $('ki-json').value = settings.kiJson || '';
}

$('ki-json').addEventListener('input', () => { $('ki-status').textContent = ''; });

$('ki-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(KI_PROMPT);
    $('ki-status').textContent = 'Prompt kopiert. Füge ihn in einen neuen KI-Chat ein und schick danach die Bilder.';
  } catch {
    $('ki-prompt').closest('details').open = true;
    const r = document.createRange();
    r.selectNodeContents($('ki-prompt'));
    getSelection().removeAllRanges(); getSelection().addRange(r);
    $('ki-status').textContent = 'Kopieren ging nicht automatisch. Der Prompt ist markiert, kopiere ihn von Hand.';
  }
});

$('ki-share').addEventListener('click', () => deliver(new Blob([KI_PROMPT], { type: 'text/plain' }), 'Handschrift-KI-Prompt.txt'));

$('ki-paste').addEventListener('click', async () => {
  try {
    $('ki-json').value = await navigator.clipboard.readText();
    $('ki-status').textContent = '';
  } catch {
    $('ki-status').textContent = 'Kein Zugriff auf die Zwischenablage. Füge den Text mit langem Tippen ins Feld ein.';
  }
});

$('ki-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) $('ki-json').value = await file.text();
});

$('ki-example').addEventListener('click', () => {
  $('ki-json').value = JSON.stringify(KI_EXAMPLE, null, 2);
  $('ki-status').textContent = 'Beispiel geladen. Tippe auf „Seiten erzeugen“.';
});

$('ki-go').addEventListener('click', () => {
  let doc;
  try {
    doc = parseSceneText($('ki-json').value);
  } catch (err) {
    $('ki-status').textContent = 'Das klappt so nicht: ' + err.message + ' Kopiere die ganze Antwort der KI oder bitte sie, nur gültiges JSON zu schicken.';
    return;
  }
  if (dirty && !confirm('Deine Änderungen auf den Seiten gehen verloren. Fortfahren?')) return;
  settings.kiJson = $('ki-json').value;
  settings.source = 'ki';
  if (doc.ausrichtung === 'quer' || doc.ausrichtung === 'hoch') settings.orientation = doc.ausrichtung;
  if (PAPER_NAMES[doc.papier]) settings.paper = PAPER_NAMES[doc.papier];
  dirty = false;
  saveSettings(settings);
  syncTextControls();
  const { pages } = sceneInfo(doc);
  $('ki-status').textContent = `${pages} ${pages === 1 ? 'Seite' : 'Seiten'} aus der KI-Datei.`;
  show('text');
});

/* ---------- Arbeitsblatt per KI ---------- */

let sheet = [];          // geladene Seiten des Arbeitsblatts (Hintergründe)
let sheetReady = false;  // erst nach dem Wiederherstellen aus IndexedDB

$('ws-prompt').textContent = KI_BLATT_PROMPT;
document.querySelectorAll('.app-version').forEach((el) => { el.textContent = window.HS_VERSION || '?'; });

function openSheet() {
  if (!$('ws-json').value) $('ws-json').value = settings.blattJson || '';
}

function renderSheetThumbs() {
  const box = $('ws-thumbs');
  box.querySelectorAll('img').forEach((im) => URL.revokeObjectURL(im.src));
  box.innerHTML = '';
  sheet.forEach((p, i) => {
    const fig = document.createElement('figure');
    const im = document.createElement('img');
    im.src = thumbURL(p);
    fig.append(im, `Seite ${i + 1}`);
    box.appendChild(fig);
  });
  $('ws-load-status').textContent = sheet.length ? `${sheet.length} ${sheet.length === 1 ? 'Seite' : 'Seiten'} geladen. Schick der KI dieselben Dateien in derselben Reihenfolge.` : 'Noch kein Arbeitsblatt geladen.';
}

async function setSheet(pages) {
  sheet = pages;
  renderSheetThumbs();
  await saveWorksheet(pages);
}

restoreWorksheet().then((pages) => {
  sheet = pages;
  sheetReady = true;
  renderSheetThumbs();
  if (settings.source === 'blatt' && settings.view === 'text') generate(false);
});

$('ws-files').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  try {
    const pages = await loadWorksheetFiles(files, (msg) => { $('ws-load-status').textContent = msg; });
    // Weitere Dateien ergänzen das Blatt, wenn eine PDF nur teilweise geladen wurde.
    const add = sheet.partial ? sheet.concat(pages) : pages;
    add.partial = !!pages.warning;
    await setSheet(add);
    if (pages.warning) $('ws-load-status').textContent = pages.warning;
  } catch (err) {
    console.error(err);
    $('ws-load-status').textContent = 'Laden fehlgeschlagen: ' + (err.message || err);
  }
});

$('ws-clear').addEventListener('click', async () => {
  await setSheet([]);
  if (settings.source === 'blatt') { settings.source = 'text'; saveSettings(settings); syncTextControls(); }
});

$('ws-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(KI_BLATT_PROMPT);
    $('ws-status').textContent = 'Prompt kopiert. Füge ihn in einen neuen KI-Chat ein und schick danach das Arbeitsblatt.';
  } catch {
    $('ws-prompt').closest('details').open = true;
    const r = document.createRange();
    r.selectNodeContents($('ws-prompt'));
    getSelection().removeAllRanges(); getSelection().addRange(r);
    $('ws-status').textContent = 'Kopieren ging nicht automatisch. Der Prompt ist markiert, kopiere ihn von Hand.';
  }
});
$('ws-share').addEventListener('click', () => deliver(new Blob([KI_BLATT_PROMPT], { type: 'text/plain' }), 'Handschrift-Arbeitsblatt-Prompt.txt'));

$('ws-paste').addEventListener('click', async () => {
  try { $('ws-json').value = await navigator.clipboard.readText(); $('ws-status').textContent = ''; } catch {
    $('ws-status').textContent = 'Kein Zugriff auf die Zwischenablage. Füge den Text mit langem Tippen ins Feld ein.';
  }
});
$('ws-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) $('ws-json').value = await file.text();
});
$('ws-example').addEventListener('click', async () => {
  await setSheet([await makeDemoSheet()]);
  $('ws-json').value = JSON.stringify(KI_BLATT_EXAMPLE, null, 2);
  $('ws-status').textContent = 'Beispielblatt und Beispielantwort geladen. Tippe auf „Blatt ausfüllen“.';
});

$('ws-go').addEventListener('click', () => {
  let doc;
  try {
    doc = parseWorksheetText($('ws-json').value);
  } catch (err) {
    $('ws-status').textContent = 'Das klappt so nicht: ' + err.message + ' Kopiere die ganze Antwort der KI oder bitte sie, nur gültiges JSON zu schicken.';
    return;
  }
  if (!sheet.length) {
    $('ws-status').textContent = 'Lade zuerst das Arbeitsblatt (Schritt 1).';
    return;
  }
  if (dirty && !confirm('Deine Änderungen auf den Seiten gehen verloren. Fortfahren?')) return;
  settings.blattJson = $('ws-json').value;
  settings.source = 'blatt';
  dirty = false;
  saveSettings(settings);
  syncTextControls();
  const n = doc.seiten.reduce((a, s) => a + s.eintraege.length, 0);
  $('ws-status').textContent = `${n} Einträge auf ${sheet.length} ${sheet.length === 1 ? 'Seite' : 'Seiten'}.`;
  show('text');
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
  ['t-linew', 'lineWidth', (v) => `${Number(v).toFixed(2)} pt`],
  ['t-grid', 'gridSize', (v) => `${Number(v).toFixed(1)} mm`],
];
const labelIds = { size: 'v-size', lineHeight: 'v-lh', letterSpacing: 'v-ls', wordSpacing: 'v-ws', variation: 'v-var', penScale: 'v-pen', lineWidth: 'v-linew', gridSize: 'v-grid' };

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
function syncTextControls() {
  const ki = settings.source === 'ki' || settings.source === 'blatt';
  const blatt = settings.source === 'blatt';
  $('t-source').value = settings.source;
  $('t-text-wrap').hidden = ki;
  $('t-ki-info').hidden = !ki;
  // Beim Arbeitsblatt bestimmt das Blatt Format und Papier.
  for (const id of ['t-format-wrap', 't-orient-wrap', 't-paper-wrap']) $(id).hidden = blatt;
  $('t-orient').value = settings.orientation;
  $('t-paper').value = settings.paper;
}
$('t-source').addEventListener('change', () => {
  settings.source = $('t-source').value;
  if (settings.source === 'ki' && !settings.kiJson) {
    settings.source = 'text';
    alert('Es gibt noch keine KI-Datei. Füge sie zuerst unter „Tafelbild“ ein.');
    show('board');
    return;
  }
  if (settings.source === 'blatt' && (!settings.blattJson || !sheet.length)) {
    settings.source = 'text';
    alert('Lade zuerst unter „Arbeitsblatt“ ein Blatt und die Antwort der KI.');
    show('sheet');
    return;
  }
  syncTextControls();
  changed();
});
$('t-orient').addEventListener('change', () => { settings.orientation = $('t-orient').value; changed(); });
$('t-text').value = settings.text;
$('t-text').addEventListener('input', () => { settings.text = $('t-text').value; changed(); });
$('t-color').value = settings.color;
$('t-color').addEventListener('input', () => { settings.color = $('t-color').value; changed(); });
$('t-format').value = settings.pageFormat;
$('t-format').addEventListener('change', () => { settings.pageFormat = $('t-format').value; changed(); });
$('t-paper').value = settings.paper;
$('t-paper').addEventListener('change', () => { settings.paper = $('t-paper').value; changed(); });
$('t-linecolor').value = settings.lineColor;
$('t-linecolor').addEventListener('change', () => { settings.lineColor = $('t-linecolor').value; changed(); });
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
  syncTextControls();
  if (!current || !dirty) generate(false);
  else editor.resizeAll();
}

function generate(byUser) {
  const f = activeFont();
  if (dirty && byUser && !confirm('Deine Änderungen auf den Seiten gehen beim Neu-Erzeugen verloren. Fortfahren?')) return;
  dirty = false;
  setPageFormat(settings.pageFormat, settings.orientation);
  setPaperStyle(settings.lineColor, settings.lineWidth);
  $('t-generate').textContent = 'Erzeugen';
  const warn = $('t-warn');
  if (!f || !Object.keys(f.glyphs).length) {
    current = { pages: [], lines: [] };
    editor.setDoc([], []);
    warn.hidden = false;
    warn.textContent = 'Diese Schrift hat noch keine Buchstaben. Schreib zuerst das Alphabet.';
    return;
  }
  let result;
  current = null;
  if (settings.source === 'blatt') {
    if (!sheetReady) return; // wird nach dem Wiederherstellen erneut aufgerufen
    if (!sheet.length) {
      editor.setDoc([], []);
      warn.hidden = false;
      warn.textContent = 'Das Arbeitsblatt fehlt. Lade es unter „Arbeitsblatt“ neu.';
      return;
    }
    try {
      const doc = parseWorksheetText(settings.blattJson);
      const r0 = Math.min(2, Math.max(0.5, sheet[0].ph / sheet[0].pw));
      setPageSize(595.28, Math.round(595.28 * r0 * 100) / 100);
      result = layoutWorksheet(doc, f, settings, sheet);
      result.title = doc.titel || 'Arbeitsblatt';
      result.noPaper = true;
      $('t-ki-info').textContent = `Arbeitsblatt „${result.title}“: ${result.pages.length} ${result.pages.length === 1 ? 'Seite' : 'Seiten'}. Ändern kannst du alles unter „Arbeitsblatt“.`;
    } catch (err) {
      console.error(err);
      editor.setDoc([], []);
      warn.hidden = false;
      warn.textContent = 'KI-Datei fehlerhaft: ' + (err.message || err);
      return;
    }
  } else if (settings.source === 'ki') {
    try {
      const doc = parseSceneText(settings.kiJson);
      result = layoutScene(doc, f, settings);
      $('t-ki-info').textContent = `„${doc.titel || 'Tafelbild'}“: ${result.pages.length} ${result.pages.length === 1 ? 'Seite' : 'Seiten'}. Ändern kannst du die Datei unter „Tafelbild“.`;
      result.title = doc.titel;
    } catch (err) {
      console.error(err);
      editor.setDoc([], []);
      warn.hidden = false;
      warn.textContent = 'KI-Datei fehlerhaft: ' + (err.message || err);
      return;
    }
  } else {
    result = layout(settings.text, f, settings);
  }
  const { pages, missing } = result;
  const lines = result.noPaper ? [] : paperLines(settings.paper, settings);
  current = { pages, lines, title: result.title };
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
  if ((settings.source === 'ki' || settings.source === 'blatt') && current?.title) return String(current.title).trim().slice(0, 40);
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

// GoodNotes zeigt PDF-Punkte 11/6-fach (132 ppi / 72). Abgelesen an der Papier-PDF aus GoodNotes (455,04 pt für 834,24).
const GOODNOTES_PDF_SCALE = 6 / 11;

async function exportAs(kind) {
  if (!current?.pages.length) { alert('Es gibt noch nichts zu exportieren.'); return; }
  const title = exportTitle();
  const base = safeFileName(title);
  try {
    if (kind === 'goodnotes') {
      // Mit Hintergrund (Arbeitsblatt) braucht jede Seite ihr eigenes Papier.
      const paperPdf = current.pages.some((p) => p.bg)
        ? current.pages.map((p) => buildPdf([{ strokes: [], bg: p.bg }], current.lines, { title: 'Papier', scale: GOODNOTES_PDF_SCALE }))
        : buildPdf([{ strokes: [] }], current.lines, { title: 'Papier', scale: GOODNOTES_PDF_SCALE });
      const bytes = buildGoodnotes(current.pages, {
        title,
        paperPdf,
        paperName: `Handschrift_${settings.paper}`,
        thumbnailJpg: await thumbnail('image/jpeg'),
      });
      await deliver(new Blob([bytes], { type: 'application/octet-stream' }), `${base}.goodnotes`);
    } else if (kind === 'notability') {
      const pdfBytes = buildPdf(current.pages.map((p) => ({ strokes: [], bg: p.bg })), current.lines, { title: 'Papier' });
      const bytes = await buildNotabilityFile(current.pages, { name: title, thumbnailPng: await thumbnail('image/png'), pdfBytes });
      await deliver(new Blob([bytes], { type: 'application/octet-stream' }), `${notePackageName(title)}.note`);
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

show(['fonts', 'capture', 'board', 'sheet', 'text'].includes(settings.view) ? settings.view : 'capture');
