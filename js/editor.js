// Seitenansicht mit Stift, Radierer und Auswahl zum Verschieben.
import { PAGE, drawPage } from './render.js';

export class Editor {
  constructor(container, { getPen, onEdit }) {
    this.container = container;
    this.getPen = getPen;           // () => ({ w, c })
    this.onEdit = onEdit || (() => {});
    this.pages = [];
    this.lines = [];
    this.tool = 'pen';
    this.views = [];
    this.history = [];
    this.sel = null;                // { page, strokes:Set, box:[x1,y1,x2,y2] }
    this.penSeen = false;
    new ResizeObserver(() => this.resizeAll()).observe(container);
  }

  setDoc(pages, lines) {
    this.pages = pages;
    this.lines = lines;
    this.sel = null;
    this.history = [];
    this.build();
  }

  setTool(t) {
    this.tool = t;
    this.sel = null;
    this.container.classList.toggle('hand', t === 'hand');
    this.views.forEach((v) => this.draw(v.i));
  }

  build() {
    this.container.innerHTML = '';
    this.views = this.pages.map((page, i) => {
      const c = document.createElement('canvas');
      c.className = 'page';
      c.style.aspectRatio = `${PAGE.w} / ${PAGE.h}`;
      this.container.appendChild(c);
      const v = { i, c, ctx: c.getContext('2d'), scale: 1 };
      c.addEventListener('pointerdown', (e) => this.down(e, v));
      c.addEventListener('pointermove', (e) => this.move(e, v));
      c.addEventListener('pointerup', (e) => this.up(e, v));
      c.addEventListener('pointercancel', (e) => this.up(e, v));
      return v;
    });
    if (!this.pages.length) {
      this.container.innerHTML = '<div class="empty-note">Noch keine Seite. Schreib zuerst das Alphabet und gib dann links einen Text ein.</div>';
    }
    this.resizeAll();
  }

  resizeAll() {
    const dpr = window.devicePixelRatio || 1;
    for (const v of this.views) {
      const r = v.c.getBoundingClientRect();
      if (!r.width) continue;
      v.c.width = Math.round(r.width * dpr);
      v.c.height = Math.round(r.width * dpr * PAGE.h / PAGE.w);
      v.scale = (r.width * dpr) / PAGE.w;
      this.draw(v.i);
    }
  }

  draw(i) {
    const v = this.views[i];
    if (!v || !v.scale) return;
    drawPage(v.ctx, this.pages[i], this.lines, v.scale);
    if (this.sel && this.sel.page === i) {
      const [x1, y1, x2, y2] = this.sel.box;
      const s = v.scale;
      v.ctx.save();
      v.ctx.strokeStyle = '#1f5fbf';
      v.ctx.setLineDash([6, 4]);
      v.ctx.lineWidth = 1.5;
      v.ctx.strokeRect(x1 * s, y1 * s, (x2 - x1) * s, (y2 - y1) * s);
      v.ctx.restore();
    }
    if (this.rect && this.rect.page === i) {
      const s = v.scale;
      const { x0, y0, x1, y1 } = this.rect;
      v.ctx.save();
      v.ctx.fillStyle = 'rgba(31,95,191,0.08)';
      v.ctx.strokeStyle = '#1f5fbf';
      v.ctx.lineWidth = 1;
      v.ctx.fillRect(Math.min(x0, x1) * s, Math.min(y0, y1) * s, Math.abs(x1 - x0) * s, Math.abs(y1 - y0) * s);
      v.ctx.strokeRect(Math.min(x0, x1) * s, Math.min(y0, y1) * s, Math.abs(x1 - x0) * s, Math.abs(y1 - y0) * s);
      v.ctx.restore();
    }
  }

  schedule(i) {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(i); });
  }

  pt(e, v) {
    const r = v.c.getBoundingClientRect();
    let p = e.pressure;
    if (e.pointerType !== 'pen' || !p) p = 0.5;
    return [((e.clientX - r.left) / r.width) * PAGE.w, ((e.clientY - r.top) / r.width) * PAGE.w, p];
  }

  snapshot() {
    this.history.push(JSON.stringify(this.pages.map((p) => p.strokes)));
    if (this.history.length > 40) this.history.shift();
  }

  undo() {
    const last = this.history.pop();
    if (!last) return;
    JSON.parse(last).forEach((strokes, i) => { if (this.pages[i]) this.pages[i].strokes = strokes; });
    this.sel = null;
    this.views.forEach((v) => this.draw(v.i));
    this.onEdit();
  }

  deleteSelection() {
    if (!this.sel) return;
    this.snapshot();
    const page = this.pages[this.sel.page];
    page.strokes = page.strokes.filter((s) => !this.sel.strokes.has(s));
    const i = this.sel.page;
    this.sel = null;
    this.draw(i);
    this.onEdit();
  }

  down(e, v) {
    if (this.tool === 'hand') return;
    if (e.pointerType === 'pen') this.penSeen = true;
    if (this.penSeen && e.pointerType === 'touch') return;
    e.preventDefault();
    try { v.c.setPointerCapture(e.pointerId); } catch { /* Pointer schon weg */ }
    const p = this.pt(e, v);
    const page = this.pages[v.i];
    this.active = { v, last: p };

    if (this.tool === 'pen') {
      this.snapshot();
      const pen = this.getPen();
      const s = { pts: [p], w: pen.w, c: pen.c, g: 'u' + Date.now().toString(36) };
      page.strokes.push(s);
      this.active.stroke = s;
      this.sel = null;
      this.schedule(v.i);
    } else if (this.tool === 'eraser') {
      this.snapshot();
      this.active.erased = false;
      this.erase(v, p);
    } else if (this.tool === 'select') {
      const b = this.sel && this.sel.page === v.i && this.sel.box;
      if (b && p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3]) {
        this.snapshot();
        this.active.moving = true;
      } else {
        this.sel = null;
        this.rect = { page: v.i, x0: p[0], y0: p[1], x1: p[0], y1: p[1] };
        this.schedule(v.i);
      }
    }
  }

  move(e, v) {
    if (!this.active || this.active.v !== v) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    const pts = (evs.length ? evs : [e]).map((ev) => this.pt(ev, v));
    const p = pts[pts.length - 1];
    if (this.tool === 'pen') {
      this.active.stroke.pts.push(...pts.map(([x, y, pr]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100, pr]));
      this.schedule(v.i);
    } else if (this.tool === 'eraser') {
      for (const q of pts) this.erase(v, q);
    } else if (this.tool === 'select') {
      if (this.active.moving) {
        const dx = p[0] - this.active.last[0], dy = p[1] - this.active.last[1];
        for (const s of this.sel.strokes) for (const q of s.pts) { q[0] += dx; q[1] += dy; }
        const b = this.sel.box;
        this.sel.box = [b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy];
        this.schedule(v.i);
      } else if (this.rect) {
        this.rect.x1 = p[0]; this.rect.y1 = p[1];
        this.schedule(v.i);
      }
    }
    this.active.last = p;
  }

  up(e, v) {
    if (!this.active) return;
    if (this.tool === 'pen') {
      this.onEdit();
    } else if (this.tool === 'eraser') {
      if (!this.active.erased) this.history.pop();
      else this.onEdit();
    } else if (this.tool === 'select') {
      if (this.active.moving) {
        this.onEdit();
      } else if (this.rect) {
        this.finishRect(v);
      }
    }
    this.active = null;
    this.draw(v.i);
  }

  erase(v, [x, y]) {
    const R = 7;
    const page = this.pages[v.i];
    const before = page.strokes.length;
    page.strokes = page.strokes.filter((s) => !s.pts.some(([px, py]) => Math.abs(px - x) < R && Math.abs(py - y) < R && Math.hypot(px - x, py - y) < R));
    if (page.strokes.length !== before) {
      this.active.erased = true;
      this.schedule(v.i);
    }
  }

  finishRect(v) {
    const { x0, y0, x1, y1 } = this.rect;
    this.rect = null;
    const rx1 = Math.min(x0, x1), rx2 = Math.max(x0, x1), ry1 = Math.min(y0, y1), ry2 = Math.max(y0, y1);
    if (rx2 - rx1 < 2 && ry2 - ry1 < 2) return;
    const picked = new Set();
    let b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const s of this.pages[v.i].strokes) {
      let sx1 = Infinity, sy1 = Infinity, sx2 = -Infinity, sy2 = -Infinity;
      for (const [x, y] of s.pts) { sx1 = Math.min(sx1, x); sx2 = Math.max(sx2, x); sy1 = Math.min(sy1, y); sy2 = Math.max(sy2, y); }
      const cx = (sx1 + sx2) / 2, cy = (sy1 + sy2) / 2;
      if (cx >= rx1 && cx <= rx2 && cy >= ry1 && cy <= ry2) {
        picked.add(s);
        b = [Math.min(b[0], sx1), Math.min(b[1], sy1), Math.max(b[2], sx2), Math.max(b[3], sy2)];
      }
    }
    if (picked.size) {
      const pad = 4;
      this.sel = { page: v.i, strokes: picked, box: [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad] };
    }
  }
}
