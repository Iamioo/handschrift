# Dateiformate von GoodNotes und Notability

Analysiert an zwei Beispieldateien (je eine Notiz mit dem Wort „Hallo“), November 2026.
Beide Formate sind nicht offiziell dokumentiert. Alles hier ist aus den Dateien abgelesen.

## Notability (`.note`, Version 14.11)

Eine `.note`-Datei ist ein ZIP-Archiv:

| Pfad | Inhalt |
|------|--------|
| `Notability/Session.plist` | Das eigentliche Dokument, binäre Plist im NSKeyedArchiver-Format |
| `Notability/metadata.plist` | Name, Erstell- und Änderungsdatum, UUID |
| `Notability/thumb12x.png` | Vorschaubild |
| `Notability/HandwritingIndex/index.plist` | Texterkennung („hallo“) für die Suche |
| `Notability/Recordings/library.plist` | Audioaufnahmen (leer) |
| `Assets/`, `Images/`, `PDFs/` | leer |

In `Session.plist` liegen die Striche unter
`$0 → richText → "Handwriting Overlay" → SpatialHash` (Klasse `InkedSpatialHash`), als Arrays für alle Striche zusammen:

| Schlüssel | Typ | Bedeutung |
|-----------|-----|-----------|
| `numcurves` | int | Anzahl Striche |
| `curvesnumpoints` | int32[] | Punkte pro Strich, immer 3·n + 1 (kubische Bézierkurven: Start, dann je zwei Kontrollpunkte und ein Endpunkt) |
| `curvespoints` | float32[] | alle Punkte als x, y hintereinander |
| `curveswidth` | float32[] | Strichbreite pro Strich (Beispiel 1,107) |
| `curvescolors` | 4 Byte pro Strich | RGBA (`000000ff` = schwarz) |
| `curvesstyles` | 1 Byte pro Strich | 3 = Stift |
| `curvesfractionalwidths` | float32[] | Breitenfaktor pro Kurvenknoten (Anzahl Segmente + 1 je Strich) |
| `curvesforces` | float32[] | Druck pro Knoten |
| `curvesaltitudeangles` | float32[] | Neigung des Stifts pro Knoten |
| `curvesazimuthunitvector` | 2 × float32 pro Knoten | Richtung des Stifts |
| `curveUUIDs` | 16 Byte pro Strich | ID |
| `numpoints`, `numfractionalwidths` | int | Summen der obigen Arrays |

Notability speichert keine Seiten. Das Dokument ist ein durchgehendes Blatt mit fester Breite
(`paperSizingBehavior = lockedWidth:567.0:iPad`, Papier `letter`, also etwa 734 Einheiten Höhe pro Seite).
Die Seitenanzahl ergibt sich aus dem untersten Strich.

## GoodNotes 6 (`.goodnotes`)

Auch ein ZIP-Archiv. Fast alle Dateien sind Folgen von Protobuf-Nachrichten, jede mit vorangestellter Länge (varint).

| Pfad | Inhalt |
|------|--------|
| `schema.pb` | Formatversion (24) |
| `index.notes.pb` | Liste der Seiten: Seiten-UUID und Pfad `notes/<UUID>` |
| `index.events.pb` | Dokument und Seitenreihenfolge, Papiervorlage, Seitengröße |
| `index.attachments.pb`, `attachments/<UUID>` | Papiervorlage (eingebettetes PDF) |
| `index.search.pb`, `search/<UUID>` | Handschrifterkennung für die Suche |
| `notes/<Seiten-UUID>` | Striche einer Seite (leere Datei = leere Seite) |
| `thumbnail.jpg` | Vorschaubild |

Seitengröße der Vorlage „standard“: 834,24 × 1078,82 Punkte.

Jeder Strich in `notes/<UUID>` besteht aus zwei Nachrichten:

1. Kopf: Feld 1 Strich-UUID, Feld 2 Versionszähler, Feld 8 Geräte-ID, Feld 9 laufende Nummer.
2. Inhalt in Feld 7: Feld 1 Strich-UUID, Feld 2 Punktdaten, Feld 4 Farbe als vier float32 (RGBA).

Die Punktdaten sind mit Apple-LZ4 komprimiert (Blöcke `bv41` … `bv4$`).
Entpackt ergibt sich ein Datensatz im „tpl“-Format mit der Typbeschreibung
`vuA(v)A(S(uu))A(S(uuuu))vA(f)`:

| Teil | Bedeutung |
|------|-----------|
| `v` | 2 |
| `u` | Strichbreite als float32 (Beispiel 1,299) |
| `A(v)` | Elementtypen: 0 = Startpunkt, 1 = Kurvenstück |
| `A(S(uu))` | Startpunkte (x, y als float32) |
| `A(S(uuuu))` | quadratische Kurvenstücke: Kontrollpunkt x, y und Endpunkt x, y |
| `v`, `A(f)` | 1 und eine leere Liste (Bedeutung offen) |

## Umsetzung

`js/formats/notability.js` und `js/formats/goodnotes.js` schreiben beide Formate.

Notability: Die Striche werden per Catmull-Rom in kubische Bézierkurven umgerechnet. Der Stiftdruck landet in `curvesfractionalwidths`.

GoodNotes: Jede Seite bekommt ein Ereignis 54 (Seite mit Sortierschlüssel) und ein Ereignis 104 (Strichdatei). Die IDs von Seite und Strichdatei unterscheiden sich wie im Original um 1 in der letzten Stelle. Als Papiervorlage hängt ein selbst erzeugtes PDF mit den Linien der App an. Die Vorlage trägt bewusst keine eigenen Linienwerte (Zeilenabstand, Schreibbereich), damit GoodNotes nur das PDF als Hintergrund zeigt und keine eigenen Linien darüberlegt. Die Punktdaten stehen in einem LZ4-Block, der nur aus Literalen besteht. Das ist gültiges LZ4, nur eben unkomprimiert.

Geprüft: Beide Dateien lassen sich mit Python (`zipfile`, `plistlib`, eigener Protobuf- und tpl-Leser) fehlerfrei zurücklesen. Aufbau und Größe der Einträge stimmen mit den Beispieldateien überein.

Rückmeldung vom iPad: Der GoodNotes-Import funktioniert.

Notability (getestet mit Version 16.14) zeigte unsere Notizen zuerst leer an. Drei Ursachen, alle behoben:

1. Der Ordner in der Datei muss so heißen wie `packagePath`. Die App nutzt dafür nur ASCII.
2. `numcurves`, `numpoints` und `numfractionalwidths` müssen als UID-Verweis auf ein Zahlenobjekt stehen, nicht direkt im Dictionary.
3. Der Plist-Schreiber muss gleiche Einzelwerte (Texte, Zahlen, Wahrheitswerte, Daten) zusammenfassen, wie Apple und Python es tun. Mit doppelt abgelegten Werten lädt Notability die Notiz, verwirft aber alle Striche. Gefunden mit vier Testdateien: Dieselbe Notiz, von Pythons `plistlib` neu geschrieben, zeigte die Striche. Die App erzeugt jetzt Byte für Byte dieselben Plists wie `plistlib`.

## Vorlage zum Nachschreiben

Die Vorlage-PDF trägt ihr Kästchen-Layout als Kommentarzeile `%HANDSCHRIFT-VORLAGE:<base64-JSON>` am Dateianfang.
GoodNotes und Notability speichern importierte PDFs unverändert (GoodNotes unter `attachments/`, Notability unter `PDFs/`), so findet die App das Layout beim Rückimport wieder.

GoodNotes: Ereignis 2 (Papiervorlage) verweist mit Feld 4 auf den Anhang und mit Feld 5 vermutlich auf die PDF-Seite. Ereignis 54 (Seite) verweist mit Feld 3 auf die Vorlage. Die Striche werden mit Vorlagenbreite / Seitenbreite in PDF-Punkte umgerechnet und über die Mitte ihres Rahmens einem Kästchen zugeordnet. Gelöschte Striche (Kopf-Feld 3 = 1 oder Inhalt-Feld 14 = 1) werden übersprungen.

Notability: Angenommen wird, dass die PDF-Seiten auf Blattbreite skaliert ohne Abstand untereinander liegen.

## Notability mit PDF-Hintergrund

Aufbau nach einer echten Notiz mit importierter PDF (Notability 16.14):

- Die PDF liegt unter `PDFs/<UUID>.pdf`. In `Session.plist` steht sie als `PDFFile` (`pdfFileName`, `contentBoxVersion` 1, `highlights` leer, `type` 0, `version` 2) in `richText.pdfFiles`. `mediaObjects` ist ein eigenes, leeres Array.
- `richText.pageLayoutArray` und `NoteDocumentPaperLayoutModel.pageLayoutArray` führen pro Seite ein Wörterbuch mit Seitennummer, PDF-Seitennummer, `kPageLayoutPDFIsOriginalPageKey` und Dateiname. Die Variante in `richText` enthält zusätzlich das `PDFFile`-Objekt.
- Das Papier heißt `staticWidth`, hat `lineStyle2` = `No Lines` und `alignsTextToLines` = false. Das Blatt ist 610 Einheiten breit (`pageWidthInDocumentCoordsKey`), `nativeLayoutDeviceStringKey` ist `Letter`.
- `NBPDFIndex/NoteDocumentPDFMetadataIndex.plist` enthält `pdfFilesMD5` (MD5 des Hex-Textes der PDF-MD5) und die Seitenbereiche. `NBPDFIndex/PDFIndex.zip` enthält pro PDF `PDFMetadataIndex.plist` (Seitenrahmen, MD5 der PDF), `PDFImageIndex.plist`, `PDFLayoutIndex.nbpdflayout` und `PDFTextIndex.txt`.
- Der Export baut genau diese Struktur nach. Für mehrere Seiten ist der Seitenbereich `[1, n]` geraten, die Probedatei hatte nur eine Seite.

Noch offen:

1. Import auf dem iPad testen (radieren, verschieben, Seitenanzahl).
2. In GoodNotes fehlen bewusst die Felder 3 und 7 des Dokument-Ereignisses (vermutlich Cover und Ordner) sowie die Suchindizes der Seiten. Falls der Import scheitert, sind das die ersten Kandidaten.
3. GoodNotes 5 braucht eine eigene Beispieldatei.
