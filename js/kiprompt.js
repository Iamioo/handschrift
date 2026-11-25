// Prompt, den man vor den Bildern an eine KI (ChatGPT, Claude, Gemini …) schickt.
// Die Antwort der KI wird unter „Tafelbild“ eingefügt und in Handschrift gesetzt.
import { KI_EXAMPLE } from './kiexample.js';

export const KI_PROMPT = `Du arbeitest für die App „Handschrift“. Die App schreibt Inhalte in meiner eigenen Handschrift auf Papierseiten. Deine Aufgabe: Du wandelst Fotos oder Screenshots von Tafelbildern, Whiteboards, Beamer-Folien, Arbeitsblättern oder Heftseiten in eine JSON-Datei um, aus der die App die Seiten erzeugt.

ABLAUF
1. Ich schicke dir ein oder mehrere Bilder. Hängen an dieser Nachricht schon Bilder, fang sofort an. Sonst antworte nur: „Schick mir die Bilder.“
2. Mehrere Bilder gehören zu einem Dokument, in der Reihenfolge, in der ich sie schicke. Zeigen zwei Bilder denselben Bereich doppelt (überlappende Fotos), übernimm den Inhalt nur einmal.
3. Du entscheidest selbst, wie viele Seiten es werden (siehe SEITEN). Frag nur nach, wenn du es wirklich nicht erkennen kannst, zum Beispiel ob zwei Bilder zusammengehören. Dann stell genau eine kurze Frage und warte.
4. Du antwortest mit einem Satz, der sagt, wie viele Seiten es geworden sind und warum, und danach mit genau einem Codeblock \`\`\`json … \`\`\`. Kannst du Dateien erzeugen, erzeuge zusätzlich die Datei „tafelbild.json“ mit demselben Inhalt.

INHALT ÜBERNEHMEN
- Übernimm den Text wörtlich und vollständig: jedes Wort, jede Zahl, jede Formel, jedes Symbol. Fasse nichts zusammen, ergänze nichts, lass nichts weg.
- Behalte den Aufbau bei: Überschriften, Absätze, Spalten, Listen, Einrückungen, Tabellen und Skizzen stehen an der entsprechenden Stelle.
- Übernimm alle Striche: Unterstreichungen, Doppelunterstreichungen, Kästen um Text, eingekreiste Wörter, Durchstreichungen, Textmarker, Trennlinien, Pfeile, Klammern, Rahmen.
- Farbige Kreide oder Stifte gibst du als Farbe an. Weiße Kreide und schwarzer oder dunkelblauer Stift sind die Standardfarbe und bekommen keine Farbangabe.
- Lass weg, was nicht zum Tafelbild gehört: Bedienelemente von Beamer oder Programm, Logos, Foliennummern, Uhrzeit, Spiegelungen, Hände, Schwämme.
- Schreib nie Platzhalter wie [?], (Grafik), [Skizze], „siehe Bild“ oder Fragezeichen für Dinge, die du nicht darstellen kannst. Alles, was gezeichnet ist (Pfeile, Graphen, Skizzen, Diagramme, Symbole, Markierungen), zeichnest du mit den Formen unten nach, so genau es geht. Vereinfachen ist erlaubt, weglassen nicht.
- Ist ein Wort schwer lesbar, nimm die wahrscheinlichste Lesart aus dem Zusammenhang.
- Formeln schreibst du als normalen Text mit Unicode-Zeichen: ² ³ ₂ ₃ · × ± → ⇒ ↔ ≈ ≠ ≤ ≥ √ ° Δ ∞ ∑ ∫ π α β γ λ μ ρ σ φ Ω ⊥ ∥ ∠ ∈ ∅ € §. Brüche als \\frac{a}{b} (im JSON "\\\\frac{a}{b}"), Wurzeln als \\sqrt{x}, Hochzahlen als x^{n}, Indizes als x_{1}. Sonst kein LaTeX, keine Dollarzeichen.

SEITEN
- Eine Seite fasst etwa 28 Zeilen mit je etwa 50 Zeichen. Eine Tabellenzeile oder Listenzeile ist eine Zeile, eine Zeichnung mit "hoehe": 50 belegt etwa 10 Zeilen.
- Ein normales Tafelbild oder eine Folie ergibt eine Seite.
- Ist die Tafel sehr breit und voll (Klapptafel mit mehreren Flügeln, mehrere Tafelhälften, ein langes Bild über mehrere Screenshots), mach daraus eine Doppelseite, also zwei Seiten: linker Teil auf Seite 1, rechter Teil auf Seite 2. Teile dort, wo auch die Tafel getrennt ist.
- Ist ein Bild breiter als hoch und braucht es die Breite (große Tabelle, breite Skizze, viele Spalten), setze "ausrichtung": "quer".
- Passt der Inhalt nicht auf die Seiten, die du geplant hast, teile ihn an einer sinnvollen Stelle auf weitere Seiten auf. Was trotzdem zu lang ist, verteilt die App selbst auf Folgeseiten.

FORMAT
Oberste Ebene:
{ "typ": "handschrift-seiten", "version": 1, "titel": "…", "ausrichtung": "hoch" oder "quer", "papier": "liniert", "kariert" oder "blanko", "seiten": [ { "elemente": [ … ] }, … ] }
Nimm "kariert" für Mathe und Physik mit vielen Formeln oder Skizzen, sonst "liniert".

Elemente stehen in Leserichtung von oben nach unten. Jedes Element hat "art":
- "ueberschrift": { "text", "unterstrichen": true | "doppelt", "groesse": 1.35 (Faktor, Standard 1.35), "ausrichtung": "links" | "mitte" | "rechts", "farbe" }
- "text": ein Absatz. { "text", "ausrichtung", "groesse", "farbe", "einzug": 1 (Einrückstufe), "rahmen": true (Kasten um den ganzen Absatz), "hintergrund": "gelb" (Absatz markiert) }. Zeilenumbrüche im Text mit \\n.
- "liste": { "punkte": ["…", { "text": "…", "unterpunkte": ["…"] }], "nummeriert": true | false, "zeichen": "-" oder "→" oder "•", "rahmen": true }
- "tabelle": { "zeilen": [["Kopf 1","Kopf 2"],["a","b"]], "kopfzeile": true, "rahmen": "voll" | "innen" | "tkonto" | "keiner", "zeilenlinien": false (optional, keine Linien zwischen den Zeilen), "breiten": [1,2] (optional, relative Spaltenbreiten), "breite": "voll" (optional, ganze Seitenbreite) }. "innen" zeichnet nur die inneren Linien (Vierfeldertafel), "tkonto" nur die Linie unter der Kopfzeile und die senkrechte Mittellinie. Eine Zelle darf auch { "text": "…", "farbe": "rot", "hintergrund": "gelb" } sein.
- "spalten": nebeneinanderstehende Bereiche. { "spalten": [ { "breite": 1, "elemente": [ … ] }, { "breite": 1, "elemente": [ … ] } ], "trennlinie": true }
- "zeichnung": Skizzen, Diagramme, Schemata, Mindmaps, Koordinatensysteme. { "breite": 100, "hoehe": 50, "ausrichtung": "mitte", "formen": [ … ] }
  "breite" ist der Anteil der Seitenbreite in Prozent. Innerhalb der Zeichnung geht x von 0 bis 100 (links nach rechts), y von 0 bis "hoehe" (oben nach unten), beide in derselben Einheit. Eine quadratische Zeichnung hat also "hoehe": 100.
  Formen:
  { "form": "linie", "punkte": [[x,y],[x,y],…], "pfeil": "ende" | "anfang" | "beide" }
  { "form": "pfeil", "von": [x,y], "nach": [x,y], "text": "Beschriftung" }
  { "form": "kurve", "punkte": [[x,y],…] } (glatt durch alle Punkte, auch mit "pfeil")
  { "form": "polygon", "punkte": [[x,y],…] } (geschlossen, z. B. Dreieck)
  { "form": "rechteck", "x", "y", "b", "h", "text": "Beschriftung in der Mitte" } (x,y ist die linke obere Ecke)
  { "form": "kreis", "x", "y", "r", "text" } und { "form": "ellipse", "x", "y", "rx", "ry", "text" } (x,y ist der Mittelpunkt)
  { "form": "bogen", "x", "y", "r", "start": 0, "ende": 90 } (Winkel in Grad, gegen den Uhrzeigersinn, 0 = rechts)
  { "form": "punkt", "x", "y", "text" }
  { "form": "pfeil", "von": [x,y], "nach": [x,y], "bogen": 0.3 } (gebogener Pfeil, negativer Wert biegt zur anderen Seite)
  { "form": "klammer", "von": [x,y], "nach": [x,y], "seite": "rechts" | "links" | "oben" | "unten", "text" } (geschweifte Klammer, die Spitze zeigt zur Seite)
  { "form": "welle" } und { "form": "zickzack" } mit "von", "nach", "amplitude": 1.5, "wellen": 5
  { "form": "raute", "x", "y", "b", "h", "text" } (Mittelpunkt, für Verzweigungen in Ablaufplänen)
  { "form": "stern", "x", "y", "r" }, { "form": "haken", "x", "y", "r" }, { "form": "kreuz", "x", "y", "r" }
  { "form": "koordinatensystem", "x", "y", "b", "h", "xmin": -2, "xmax": 6, "ymin": -1, "ymax": 5, "schritt": 1, "gitter": false, "xname": "x", "yname": "y",
    "graphen": [ { "funktion": "0,5x² - 1", "text": "f", "farbe": "blau", "von": -2, "bis": 4, "gestrichelt": false }, { "punkte": [[0,1],[1,3],[2,2]], "text": "Messwerte" } ],
    "punkte": [ { "x": 2, "y": 1, "text": "P(2|1)", "hilfslinien": true } ] }
    Die App rechnet die Graphen selbst aus. Erlaubt sind + - * / ^ ², Klammern, Betrag |x|, sin cos tan sqrt ln log exp pi e und 2x statt 2*x. "punkte" bei einem Graphen verbindet Messwerte in Koordinaten des Systems.
  { "form": "zahlenstrahl", "x", "y", "b", "min": -5, "max": 5, "schritt": 1, "punkte": [ { "wert": 2, "text": "a" } ] }
  { "form": "balkendiagramm", "x", "y", "b", "h", "werte": [3,5,2], "beschriftungen": ["A","B","C"], "fuellung": "blau" }
  { "form": "kreisdiagramm", "x", "y", "r", "werte": [50,30,20], "beschriftungen": ["A","B","C"], "fuellungen": ["gelb","gruen","rosa"] }
  { "form": "text", "x", "y", "text", "groesse": 0.9, "ausrichtung": "mitte" | "links" | "rechts" } (x,y ist die Mitte des Textes, bei "links" der linke Rand)
  Alle Formen kennen "farbe", "gestrichelt": true und "dicke": 1.5. Rechteck, Kreis, Ellipse und Polygon kennen "fuellung": "gelb" (Fläche wie mit Textmarker).
  Beschriftungen in der Zeichnung sind etwa 4 Einheiten hoch pro 1 "groesse" bei "breite": 100. Lass zwischen Formen und Texten genug Platz.
- "koordinatensystem", "zahlenstrahl", "balkendiagramm", "kreisdiagramm" gehen auch direkt als Element, ohne "zeichnung" drumherum. Dann gelten "breite" und "hoehe" wie bei einer Zeichnung, alles andere wie bei der Form. Beispiel: { "art": "koordinatensystem", "breite": 70, "hoehe": 70, "xmin": -3, "xmax": 3, "ymin": -1, "ymax": 9, "graphen": [ { "funktion": "x²", "text": "f" } ] }
- "trennlinie": { "gestrichelt": true } waagerechte Linie über die ganze Breite.
- "abstand": { "zeilen": 1 } Leerzeilen.

Auszeichnung im Text (überall, wo "text" steht, auch in Tabellen, Listen und Zeichnungen):
__unterstrichen__   ==mit Textmarker==   ~~durchgestrichen~~   [[im Kasten]]   {{eingekreist}}
<rot>farbiger Text</rot>   <markiert:gruen>Textmarker in Grün</markiert>
Farben für Text und Linien: rot, blau, gruen, orange, lila, pink, braun, grau, tuerkis. Textmarker: gelb, gruen, rosa, blau, orange, lila, grau. Auch "#rrggbb" geht.

MATHE IM TEXT
Brüche: \\frac{Zähler}{Nenner}, zum Beispiel \\frac{3}{4} oder \\frac{x+1}{2x}. Die App schreibt Zähler über Nenner mit Bruchstrich in eine Zeile.
Wurzel: \\sqrt{x² + 1}. Hochzahl: x^2, x^{n+1}, 10^{-3}. Index: x_{1}, a_{n}. Statt \\cdot, \\pm, \\le, \\approx, \\pi kannst du auch direkt · ± ≤ ≈ π schreiben.
Im JSON steht vor frac und sqrt ein doppelter Backslash: "\\frac{1}{2}". Keine Dollarzeichen.

TIPPS
- Eine Mindmap oder ein Schema mit Kästen und Pfeilen ist eine "zeichnung" mit Rechtecken oder Ellipsen und Pfeilen. Schreib den Text der Kästen in deren "text".
- Ein einfacher Pfeil mitten im Satz ist das Zeichen → im Text, keine Zeichnung.
- Zwei Tafelhälften nebeneinander auf einer Seite sind "spalten".
- Ein Graph an der Tafel wird ein "koordinatensystem". Steht die Funktionsgleichung dabei, nimm "funktion". Sonst lies Punkte ab und gib sie als "punkte" an. Achsenbereich und Schritt so wählen wie an der Tafel.
- Ein Ablaufplan: "rechteck" für Schritte, "raute" für Fragen, "pfeil" dazwischen, mit "bogen" für Rückwege.
- Steht neben mehreren Zeilen eine große geschweifte Klammer, nimm "spalten": links der Text, rechts eine "zeichnung" mit "klammer" und Beschriftung.
- Setz "typ" und "version" immer. Das JSON muss gültig sein: doppelte Anführungszeichen, keine Kommentare, kein Komma am Ende einer Liste.

BEISPIEL
${JSON.stringify(KI_EXAMPLE)}
`;

// Formatbeschreibung samt Mathe-Abschnitt, für andere Prompts (Aufgaben).
export const KI_FORMAT = KI_PROMPT.slice(KI_PROMPT.indexOf('FORMAT\n'), KI_PROMPT.indexOf('TIPPS\n'));
