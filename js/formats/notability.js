// Export als Notability-Notiz (.note). Aufbau siehe docs/dateiformate.md.
import { writeBplist, Archive, Real, UID, appleTime } from './bplist.js';
import { makeZip, uuid, uuidBytes } from './zip.js';
import { PAGE } from '../render.js';
import { widthFactor } from '../glyphs.js';
import { md5hex } from './md5.js';

const NB_WIDTH = 610;                         // Breite des Notability-Blatts bei importierter PDF (aus einer echten Notiz)

const f32 = (arr) => new Uint8Array(new Float32Array(arr).buffer);
const i32 = (arr) => new Uint8Array(new Int32Array(arr).buffer);

function rgba(hex) {
  const m = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(m.substr(i, 2), 16)).concat(255);
}

// Polylinie -> kubische Bézierkurven (Catmull-Rom), Ergebnis: 3n+1 Punkte.
function toCubic(pts) {
  if (pts.length === 1) pts = [pts[0], [pts[0][0] + 0.3, pts[0][1] + 0.3, pts[0][2]]];
  const out = [pts[0]];
  const P = (i) => pts[Math.max(0, Math.min(pts.length - 1, i))];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    out.push(
      [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6],
      [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6],
      p2,
    );
  }
  return out;
}

export function buildNotability(pages, { name = 'Handschrift', pdfName } = {}) {
  // Die PDF-Seiten werden auf Blattbreite skaliert und liegen ohne Abstand untereinander.
  const k = NB_WIDTH / PAGE.w;
  const ox = 0;
  const pageH = PAGE.h * k;

  const numPts = [], points = [], widths = [], colors = [], styles = [], uuids = [];
  const fracW = [], forces = [], altitude = [], azimuth = [];
  pages.forEach((page, pi) => {
    const oy = pi * pageH;
    for (const s of page.strokes) {
      const cubic = toCubic(s.pts);
      numPts.push(cubic.length);
      for (const [x, y] of cubic) points.push(ox + x * k, oy + y * k);
      const knots = s.pts.length === 1 ? [s.pts[0], s.pts[0]] : s.pts;
      for (const p of knots) {
        fracW.push(widthFactor(p[2]));
        forces.push(1);
        altitude.push(Math.PI / 2);
        azimuth.push(1, 0);
      }
      widths.push(s.w * k);
      colors.push(...rgba(s.c));
      styles.push(3);
      uuids.push(...uuidBytes(uuid()));
    }
  });
  const numCurves = numPts.length;
  const now = appleTime();

  // ---- Session.plist (Objektgraph wie in Notability 14) ----
  const A = new Archive();
  const rootIdx = A.reserve();
  const richIdx = A.reserve();
  const empty = () => A.mutableArray();
  const attributed = (backing) => {
    const keys = [A.str('stringKey'), A.str('subRangesKey')];
    const strObj = backing
      ? A.add({ $class: A.cls('NSMutableString', ['NSMutableString', 'NSString', 'NSObject']), 'NS.bytes': new Uint8Array(0) })
      : A.str('');
    return A.mutableDict(keys, [strObj, empty()]);
  };

  // Die drei Zähler stehen im Original als eigene Zahlenobjekte (UID-Verweis), nicht direkt im Dictionary.
  // Direkt eingetragen liest Notability sie als 0 und zeigt eine leere Seite.
  const spatial = A.add({
    numpoints: A.add(points.length / 2),
    options: new Uint8Array(numCurves * 8),
    numfractionalwidths: A.add(fracW.length),
    groupsArrays: empty(),
    curvesaltitudeangles: f32(altitude),
    curvespoints: f32(points),
    curveUUIDs: new Uint8Array(uuids),
    curvescolors: new Uint8Array(colors),
    curvesfractionalwidths: f32(fracW),
    curvesnumpoints: i32(numPts),
    curvesforces: f32(forces),
    $class: A.cls('InkedSpatialHash'),
    curvesazimuthunitvector: f32(azimuth),
    curveswidth: f32(widths),
    curvesstyles: new Uint8Array(styles),
    bezierPathsDataDictionary: A.mutableDict(),
    numcurves: A.add(numCurves),
  });
  const overlay = A.add({ SpatialHash: spatial, $class: A.cls('HandwritingObject', ['HandwritingObject', 'NSObject']) });
  const backing = A.add({
    $class: A.cls('NBAttributedString', ['NBAttributedString', 'NSObject']),
    NBAttributedBackingStringCodingKey: attributed(true),
    NBAttributedLayoutStringCodingKey: attributed(true),
  });
  const reflow = A.add({
    pageWidthInDocumentCoordsKey: new Real(NB_WIDTH),
    nativeLayoutDeviceStringKey: A.str('Letter'),
    $class: A.cls('NBReflowStateLocked', ['NBReflowStateLocked', 'NBReflowState', 'NSObject']),
  });
  // Die Papier-PDF hängt als PDFFile an der Notiz; jede Seite verweist darauf.
  const pdfFile = A.add({
    $class: A.cls('PDFFile', ['PDFFile', 'NSObject']),
    pdfFileName: A.str(pdfName),
    contentBoxVersion: 1,
    highlights: A.array(),
    type: 0,
    version: 2,
  });
  const pdfFiles = A.array([pdfFile]);
  const mediaObjects = A.array();
  const layoutKeys = (names) => names.map((k2) => A.str(k2));
  const pageLayoutRich = A.mutableArray(pages.map((_, i) => A.mutableDict(
    layoutKeys(['kPageLayoutPageIsBookmarkedKey', 'kPageLayoutDocumentPageNumberKey', 'kPageLayoutPDFFileNameKey', 'kPageLayoutPDFPageNumberKey', 'kPageLayoutPDFIsOriginalPageKey', 'kPageLayoutPDFFileKey']),
    [A.add(false), A.add(i + 1), A.str(pdfName), A.add(i + 1), A.add(true), pdfFile],
  )));
  const pageLayoutModel = A.mutableArray(pages.map((_, i) => A.add({
    'NS.keys': layoutKeys(['kPageLayoutDocumentPageNumberKey', 'kPageLayoutPageIsBookmarkedKey', 'kPageLayoutPDFPageNumberKey', 'kPageLayoutPDFIsOriginalPageKey', 'kPageLayoutPDFFileNameKey']),
    'NS.objects': [A.add(i + 1), A.add(false), A.add(i + 1), A.add(true), A.str(pdfName)],
    $class: A.cls('NSDictionary', ['NSDictionary', 'NSObject']),
  })));
  A.set(richIdx, {
    formatVersion: 5,
    formattedStringTextAlignmentKey: 0,
    attributedString: attributed(false),
    NBAttributedBackingString: backing,
    'Handwriting Overlay': overlay,
    $class: A.cls('FormattedString', ['FormattedString', 'NSObject']),
    reflowState: reflow,
    didBecomeReflowable: true,
    pdfFiles,
    mediaObjects,
    recordingTimestampString: attributed(true),
    pageLayoutArray: pageLayoutRich,
  });
  const nameUid = A.str(name);
  const paper = A.add({
    paperIdentifier: A.str('Legacy:13'),
    $class: A.cls('GLModel.PaperAttributes', ['GLModel.PaperAttributes', 'NSObject']),
    drawRotatedForOrientation: true,
    paperOrientation: A.str('portrait'),
    paperSize: A.str('letter'),
    paperSizingBehavior: A.str('staticWidth'),
    alignsTextToLines: false,
    lineStyle2: A.str('No Lines'),
  });
  const layoutModel = A.add({
    documentPaperAttributes: paper,
    $class: A.cls('Notability.NoteDocumentPaperLayoutModel', ['NoteDocumentPaperLayoutModel', 'NSObject']),
    pageLayoutArray: pageLayoutModel,
  });
  const emptyData = new Uint8Array(0);
  A.set(rootIdx, {
    subject: A.str('unsortedNotesKey'),
    NBNoteTakingSessionBundleVersionNumberKey: A.str('14.11.17'),
    NBNoteTakingSessionHandwritingLanguageKey: A.str('de_DE'),
    contentPlaybackEventManager: A.add({
      NBCPTimeManagerSOAEventUUIDsKey: emptyData,
      NBCPTimeManagerSOATimestampsKey: emptyData,
      NBCPTimeManagerSOANumEventsKey: 0,
      NBCPTimeManagerSOARecordingIDsKey: emptyData,
      NBCPTimeManagerSOADurationsKey: emptyData,
      $class: A.cls('NBCPEventManager', ['NBCPEventManager', 'NSObject']),
    }),
    NBPaperMinorVersionNumber: 0,
    NBNoteTakingSessionLastUsedFontKey: new UID(0),   // $null
    NBNoteTakingSessionMinorVersionNumberKey: 0,
    packagePath: nameUid,
    tags: A.str(''),
    NBNoteTakingSessionIsHighlighterBehindTextKey: true,
    sessionFormatVersion: 9,
    NBNoteTakingSessionDocumentPaperLayoutModelKey: layoutModel,
    $class: A.cls('NoteTakingSession', ['NoteTakingSession', 'NSObject']),
    NBNoteTakingSessionAllowHighlighterConversionKey: false,
    NBPaperMajorVersionNumber: 3,
    richText: new UID(richIdx),
    isReadOnly: false,
    creationDate: A.date(now),
    name: nameUid,
  });
  const session = writeBplist(A.toPlist('GLKeyedArchiver', '$0', new UID(rootIdx)));

  // ---- metadata.plist ----
  const M = new Archive();
  const mRoot = M.reserve();
  const created = M.date(now);
  const changed = M.date(now);
  const perType = M.mutableDict([2, 8, 16, 1, 4].map((n) => M.add(n)), [created, created, created, created, created]);
  const mName = M.str(name);
  M.set(mRoot, {
    notePackagePath: mName,
    noteLastChangeDatePerTypeKey: perType,
    $class: M.cls('SessionInfo', ['SessionInfo', 'NSObject']),
    noteCreationDateKey: created,
    associatedProductsKey: M.array(),
    uuidKey: M.str(uuid()),
    noteSubject: M.str('unsortedNotesKey'),
    noteHasRecordingKey: false,
    noteName: mName,
    noteTags: M.str(''),
    noteModifiedDateKey: changed,
  });
  const metadata = writeBplist(M.toPlist('NSKeyedArchiver', 'root', new UID(mRoot)));

  const library = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>application version</key>
	<string>6284</string>
	<key>library-format-version</key>
	<string>1.0</string>
	<key>recordings</key>
	<dict/>
</dict>
</plist>
`;

  return { session, metadata, library, numCurves };
}

// Notability sucht Session.plist im Ordner, der so heißt wie die Notiz (packagePath).
// Nur ASCII, damit Dateiname, Ordner und packagePath sicher übereinstimmen.
export function notePackageName(name) {
  const t = (name || '')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[^A-Za-z0-9 _-]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 40).trim();
  return t || 'Handschrift';
}

// Suchindizes zur PDF, wie Notability sie neben der Notiz ablegt.
function pdfIndexFiles(pdfBytes, pdfName, nPages) {
  const md5 = md5hex(pdfBytes);
  const box = [[0, 0], [PAGE.w, PAGE.h]];
  const meta = writeBplist({
    version: 26,
    pages: Array.from({ length: nPages }, (_, i) => ({
      rotation: 0, pageNumber: i + 1, artBox: box, mediaBox: box, cropBox: box, bleedBox: box, trimBox: box,
      version: 2, linksStorage: { numLinks: 0, urlStrings: [], intData: [] },
    })),
    md5,
  });
  const image = writeBplist({ pageImageString: { [pdfName]: {} }, pageImageRects: { [pdfName]: {} } });
  const d = `NBPDFIndex/${pdfName}/`;
  const inner = makeZip([
    { name: d },
    { name: d + 'PDFImageIndex.plist', data: image },
    { name: d + 'PDFLayoutIndex.nbpdflayout', data: new Uint8Array([3, 0, 0, 0, 0, 0, 0, 0, 0, 0]) },
    { name: d + 'PDFTextIndex.txt', data: new Uint8Array(0) },
    { name: d + 'PDFMetadataIndex.plist', data: meta },
    { name: 'NBPDFIndex/' },
  ], { madeBy: 0x0315, dirAttr: (0o40755 << 16) >>> 0 });
  const noteMeta = writeBplist({
    pageNumbers: { [pdfName]: [1, nPages] },
    pdfFilesMD5: md5hex(new TextEncoder().encode(md5)),
    version: 26,
  });
  return { inner, noteMeta };
}

export async function buildNotabilityFile(pages, { name, thumbnailPng, pdfBytes }) {
  name = notePackageName(name);
  const pdfName = uuid().toUpperCase() + '.pdf';
  const { session, metadata, library } = buildNotability(pages, { name, pdfName });
  const { inner, noteMeta } = pdfIndexFiles(pdfBytes, pdfName, pages.length);
  // Leerer Handschrift-Suchindex wie in echten Notability-Dateien
  const index = writeBplist({ version: 7, minCompatibleVersion: 7, pages: {} });
  const dir = name + '/';
  return makeZip([
    { name: dir + 'Assets/' },
    { name: dir + 'Session.plist', data: session },
    { name: dir + 'NBPDFIndex/' },
    { name: dir + 'NBPDFIndex/PDFIndex.zip', data: inner },
    { name: dir + 'NBPDFIndex/NoteDocumentPDFMetadataIndex.plist', data: noteMeta },
    { name: dir + 'thumb12x.png', data: thumbnailPng },
    { name: dir + 'Recordings/' },
    { name: dir + 'Recordings/library.plist', data: library },
    { name: dir + 'metadata.plist', data: metadata },
    { name: dir + 'Images/' },
    { name: dir + 'PDFs/' },
    { name: dir + 'PDFs/' + pdfName, data: pdfBytes },
    { name: dir + 'HandwritingIndex/' },
    { name: dir + 'HandwritingIndex/index.plist', data: index },
    { name: dir },
  ], { madeBy: 0x0315, dirAttr: (0o40755 << 16) >>> 0 });
}
