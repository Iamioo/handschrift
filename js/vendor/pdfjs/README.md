pdf.js 6.2 (Mozilla, Apache-2.0, siehe LICENSE), aus `pdfjs-dist/legacy/build`.

Die Dateien sind mit esbuild für Safari 16 umgeschrieben (`--target=safari16 --format=esm --minify`).
Die Originale enthalten `static {}`-Blöcke in Klassen, die Safari erst ab iOS 16.4 versteht.
Auf iOS 16.0 bis 16.3 brach das Laden einer PDF sonst mit „Unexpected token '{'“ ab.
Dateien: `pdf-s16.mjs` (App), `pdf-s16.worker.mjs` (Hintergrundprozess). `pdf-s16.worker-hs.mjs`
lädt vorher `hs-polyfills.mjs`, das `Promise.try` (Safari 18.2) und `Response.bytes()` (Safari 18)
nachrüstet. pdf.js benutzt beides, bringt es aber nicht selbst mit.
Beim Aktualisieren von pdf.js diese Schritte wiederholen und den Dateinamen ändern, damit Safari
keine alte Fassung aus dem Cache nimmt.
