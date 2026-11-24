// Zeichenpakete zum Anhaken: kommen zusätzlich zu den Grundzeichen in Vorlage und Alphabet-Schreiben.
// Jedes Zeichen hier ist entweder Latin-1 (die Vorlage druckt es mit Helvetica vor) oder steht in
// symbols.js (die Vorlage zeichnet es selbst vor, und ohne eigene Variante springt das Symbol ein).
// Hoch- und tiefgestellte Zeichen fehlen absichtlich: Die App baut sie aus den normalen Ziffern.

export const PACKS = [
  { id: 'mathe', label: 'Mathe', chars: '=+-×·÷:≈≠≤≥<>±√∞°%²³∠⊥∥∈∅∑∫()[]{}|⇒⇔' },
  { id: 'griechisch', label: 'Griechisch', chars: 'αβγδεηθλμπρστφωΔΣΩ' },
  { id: 'chemie', label: 'Chemie', chars: '→⇌↑↓+-=()[]°Δδ·' },
  { id: 'physik', label: 'Physik', chars: 'ΔλμρηωφτΩ°≈∝→⇒·×√∞%' },
  { id: 'pfeile', label: 'Pfeile und Zeichen', chars: '→←↑↓↔⇒⇔✓✗•*#§€&' },
];

export function packChars(ids) {
  const out = [];
  for (const p of PACKS) if (ids.includes(p.id)) out.push(...p.chars);
  return out;
}
