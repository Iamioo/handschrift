// Speichert Schriften und Einstellungen im Browser (localStorage).
// Format einer Schrift:
// { id, name, created, passes, pass: {idx, added:{ch: variantIndex}} | null,
//   glyphs: { "a": [ { strokes: [[[x,y,p], ...], ...], w }, ... ] } }
// Koordinaten in em: x ab linker Kante, y relativ zur Grundlinie (nach unten positiv).

const FONTS_KEY = 'hs.fonts.v1';
const SETTINGS_KEY = 'hs.settings.v1';
export const FILE_FORMAT = 'handschrift-font';

export function loadFonts() {
  try { return JSON.parse(localStorage.getItem(FONTS_KEY)) || []; } catch { return []; }
}

export function saveFonts(fonts) {
  try {
    localStorage.setItem(FONTS_KEY, JSON.stringify(fonts));
    return true;
  } catch (e) {
    alert('Der Browser-Speicher ist voll. Lade eine Schrift als Datei herunter und lösche sie danach hier.');
    return false;
  }
}

export function loadSettings(defaults) {
  try { return { ...defaults, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}) }; } catch { return { ...defaults }; }
}

export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* egal */ }
}

export function newFont(name) {
  return { id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, created: new Date().toISOString(), passes: 0, pass: null, glyphs: {} };
}

export function fontToFile(font) {
  const data = { format: FILE_FORMAT, version: 1, font: { ...font, pass: null } };
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

export function fontFromFile(text) {
  const data = JSON.parse(text);
  if (data.format !== FILE_FORMAT || !data.font || typeof data.font.glyphs !== 'object') {
    throw new Error('Das ist keine Handschrift-Datei.');
  }
  const f = data.font;
  return { ...newFont(f.name || 'Importiert'), passes: f.passes || 0, glyphs: f.glyphs };
}

export function safeFileName(name) {
  return (name || 'schrift').replace(/[^\p{L}\p{N}_ -]+/gu, '').trim().replace(/\s+/g, '-') || 'schrift';
}
