// Beispiel für das KI-Format. Wird in der App über „Beispiel laden“ angezeigt und steht auch im Prompt.
export const KI_EXAMPLE = {
  typ: 'handschrift-seiten',
  version: 1,
  titel: 'Photosynthese',
  ausrichtung: 'hoch',
  papier: 'liniert',
  seiten: [
    {
      elemente: [
        { art: 'ueberschrift', text: 'Photosynthese', unterstrichen: 'doppelt', ausrichtung: 'mitte' },
        { art: 'text', text: 'Pflanzen bauen mit Hilfe von ==Lichtenergie== aus <blau>Wasser</blau> und <blau>Kohlenstoffdioxid</blau> __Traubenzucker__ auf.' },
        { art: 'text', text: '[[6 CO₂ + 6 H₂O → C₆H₁₂O₆ + 6 O₂]]', ausrichtung: 'mitte' },
        { art: 'abstand', zeilen: 1 },
        {
          art: 'spalten', trennlinie: true,
          spalten: [
            { elemente: [
              { art: 'ueberschrift', text: 'Ausgangsstoffe', groesse: 1, unterstrichen: true },
              { art: 'liste', punkte: ['Wasser (aus dem Boden)', 'CO₂ (aus der Luft)', { text: 'Licht', unterpunkte: ['Sonne', 'Lampe'] }] },
            ] },
            { elemente: [
              { art: 'ueberschrift', text: 'Produkte', groesse: 1, unterstrichen: true },
              { art: 'liste', nummeriert: true, punkte: ['Traubenzucker', 'Sauerstoff ~~Stickstoff~~'] },
            ] },
          ],
        },
        { art: 'abstand', zeilen: 1 },
        {
          art: 'zeichnung', breite: 80, hoehe: 34, ausrichtung: 'mitte',
          formen: [
            { form: 'kreis', x: 14, y: 17, r: 11, fuellung: 'gelb', text: 'Sonne' },
            { form: 'pfeil', von: [27, 17], nach: [48, 17], farbe: 'rot', text: 'Licht' },
            { form: 'rechteck', x: 50, y: 6, b: 34, h: 22, text: 'Blatt' },
            { form: 'kurve', punkte: [[84, 12], [92, 6], [99, 10]], pfeil: 'ende' },
            { form: 'text', x: 92, y: 2, text: 'O₂', groesse: 0.8 },
          ],
        },
        {
          art: 'tabelle', kopfzeile: true,
          zeilen: [
            ['Stoff', 'Herkunft', 'Rolle'],
            ['Wasser', 'Boden', 'Ausgangsstoff'],
            ['Sauerstoff', 'entsteht im Blatt', '{{Abfallprodukt}}'],
          ],
        },
      ],
    },
  ],
};
