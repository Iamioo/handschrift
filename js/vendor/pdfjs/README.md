pdf.js 6.2 (Mozilla, Apache-2.0, siehe LICENSE), aus `pdfjs-dist/legacy/build`.

Die Dateien sind mit esbuild für Safari 16 umgeschrieben (`--target=safari16 --format=esm --minify`).
Die Originale enthalten `static {}`-Blöcke in Klassen, die Safari erst ab iOS 16.4 versteht.
Auf iOS 16.0 bis 16.3 brach das Laden einer PDF sonst mit „Unexpected token '{'“ ab.
Beim Aktualisieren von pdf.js diesen Schritt wiederholen.
