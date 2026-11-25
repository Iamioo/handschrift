// Nachrüstungen für ältere Safari-Versionen (iOS 16), die pdf.js 6 benutzt, aber nicht selbst mitbringt.
// Wird vor pdf.js geladen: in der App (worksheet.js) und im Hintergrundprozess (pdf-s16.worker-hs.mjs).

// Promise.try: Safari 18.2
if (typeof Promise.try !== 'function') {
  Object.defineProperty(Promise, 'try', {
    configurable: true, writable: true,
    value: function (fn, ...args) { return new this((resolve) => resolve(fn(...args))); },
  });
}

// Response.prototype.bytes und Blob.prototype.bytes: Safari 18
for (const C of [globalThis.Response, globalThis.Blob]) {
  if (C && typeof C.prototype.bytes !== 'function') {
    Object.defineProperty(C.prototype, 'bytes', {
      configurable: true, writable: true,
      value: async function () { return new Uint8Array(await this.arrayBuffer()); },
    });
  }
}
