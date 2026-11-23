# Handschrift

Du schreibst das deutsche Alphabet ein-, zwei- oder dreimal mit dem Apple Pencil. Die App setzt danach jeden eingetippten Text in deiner Handschrift und gibt ihn als PDF aus. Jeder Durchgang liefert pro Buchstabe eine weitere Variante. Die App wechselt zwischen diesen Varianten, damit zwei „e“ im selben Wort nicht identisch aussehen.

Das hier ist der erste Prototyp als Web-App. Später soll daraus eine native App für iPadOS 16 werden.

Live-Version: https://iamioo.github.io/handschrift/

## Was der Prototyp kann

1. Alphabet schreiben: A bis Z, Ä, Ö, Ü, a bis z, ä, ö, ü und ß. Zahlen und Satzzeichen lassen sich zuschalten. Ein Schreibfeld mit Grund-, Mittel- und Oberlinie zeigt, wo der Buchstabe hingehört. Stiftdruck fließt in die Strichbreite ein, und sobald der Pencil einmal benutzt wurde, ignoriert das Feld den Handballen.
2. Mehrere Durchgänge: Jeder Durchgang ergänzt eine Variante pro Zeichen. In der Übersicht kannst du einzelne Varianten löschen oder gezielt neue schreiben.
3. Testschrift: Unter „Schriften“ legt „Testschrift hinzufügen“ eine fertige Schrift mit drei Varianten pro Zeichen an. Damit kannst du Textsatz und Export ausprobieren, ohne vorher selbst zu schreiben.
4. Mehrere Schriften: Du kannst beliebig viele Schriften anlegen, umbenennen, als `.handschrift.json` herunterladen und wieder importieren.
4. Text setzen: Schriftgröße, Zeilen-, Buchstaben- und Wortabstand, Stärke der Variation, Stiftdicke, Farbe und Papier (blanko, liniert, kariert) sind einstellbar. „Neu würfeln“ mischt die Varianten neu.
5. Nachbearbeiten: Auf den erzeugten Seiten kannst du radieren, mit dem Stift ergänzen und Wörter mit der Auswahl verschieben.
6. Export: Die App schreibt echte GoodNotes-6-Notizbücher (`.goodnotes`) und Notability-Notizen (`.note`) mit Stiftstrichen, die du dort radieren und verschieben kannst. Dazu kommen ein PDF mit Freihand-Anmerkungen und ein flaches PDF. Auf dem iPad öffnet sich das Teilen-Menü, über das du die Datei direkt an die App schickst.

Fehlt ein Umlaut in der Schrift, setzt die App zwei Punkte über den Grundbuchstaben. Fehlt das ß, schreibt sie „ss“.

## Offene Punkte

Die Formate `.goodnotes` und `.note` sind nicht offiziell dokumentiert. Wir haben sie aus Beispieldateien nachgebaut (siehe `docs/dateiformate.md`). Der Import auf dem iPad ist noch nicht getestet. GoodNotes 5 nutzt ein anderes Format und wird noch nicht unterstützt.

Notability legt die Seiten untereinander auf ein Blatt im Format „Letter“. Die App verkleinert die A4-Seiten deshalb etwas und nutzt das linierte Papier von Notability.

Die Daten liegen im Browser-Speicher (localStorage) des Geräts. Wer den Safari-Verlauf samt Website-Daten löscht, verliert die Schriften. Lade sie deshalb als Datei herunter.

## Lokal starten

Die App braucht keinen Build-Schritt. Ein beliebiger statischer Webserver reicht:

```
python -m http.server 8765
```

Danach `http://localhost:8765` öffnen. Auf dem iPad im selben WLAN geht das über die IP-Adresse des Rechners.

## Aufbau

| Datei | Inhalt |
|-------|--------|
| `js/glyphs.js` | Zeichensatz, Schreibfeld, Normalisierung der Buchstaben |
| `js/render.js` | Textsatz mit Variantenwahl und Zufallsabweichungen |
| `js/editor.js` | Seitenansicht mit Stift, Radierer und Auswahl |
| `js/pdf.js` | PDF-Schreiber ohne Abhängigkeiten (flach oder mit Ink-Anmerkungen) |
| `js/formats/goodnotes.js` | Export als GoodNotes-6-Notizbuch |
| `js/formats/notability.js` | Export als Notability-Notiz |
| `js/formats/zip.js`, `js/formats/bplist.js` | ZIP- und Binär-Plist-Schreiber |
| `js/store.js` | Speichern, Import und Export der Schriften |
| `js/app.js` | Oberfläche und Ablauf |

Buchstaben werden als Vektorstriche in em-Einheiten gespeichert (Grundlinie bei y = 0). Dadurch bleibt die Schrift in jeder Größe scharf.

## Lizenz

MIT, siehe `LICENSE`.
