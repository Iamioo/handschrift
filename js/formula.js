// Liest Funktionsterme wie "f(x) = 0,5x² - 2x + 1" oder "sin(x)" und macht daraus eine Funktion.
// Kein eval: eigener kleiner Parser mit + - * / ^, Klammern, impliziter Multiplikation (2x, 3(x+1))
// und den Funktionen sin cos tan sqrt abs ln log exp.

const FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, sqrt: Math.sqrt, wurzel: Math.sqrt, abs: Math.abs,
  ln: Math.log, log: Math.log10, lg: Math.log10, exp: Math.exp,
};
const CONSTS = { pi: Math.PI, π: Math.PI, e: Math.E };

function tokenize(src) {
  let s = String(src)
    .replace(/^\s*[a-zA-Z]\s*\(\s*x\s*\)\s*=/, '')
    .replace(/^\s*y\s*=/, '')
    .replace(/²/g, '^2').replace(/³/g, '^3')
    .replace(/[·×⋅∙]/g, '*').replace(/[−–]/g, '-').replace(/÷/g, '/').replace(/√/g, 'sqrt')
    .replace(/(\d),(\d)/g, '$1.$2');
  const out = [];
  const re = /\s*(\d+\.?\d*|\.\d+|[a-zA-Zπ]+|[-+*/^()|])/y;
  let m;
  while (re.lastIndex < s.length) {
    const at = re.lastIndex;
    m = re.exec(s);
    if (!m) {
      if (/^\s*$/.test(s.slice(at))) break;
      throw new Error(`Unbekanntes Zeichen in „${src}“`);
    }
    out.push(m[1]);
  }
  return out;
}

export function compileFormula(src) {
  const t = tokenize(src);
  let i = 0;
  const peek = () => t[i];
  const take = (v) => { if (t[i] !== v) throw new Error(`„${v}“ fehlt in „${src}“`); i++; };
  let absDepth = 0;
  const startsFactor = (tok) => tok !== undefined && (/^[\d.a-zA-Zπ(]/.test(tok) || (tok === '|' && absDepth === 0));

  function expr() {
    let f = term();
    while (peek() === '+' || peek() === '-') {
      const op = t[i++], a = f, b = term();
      f = op === '+' ? (x) => a(x) + b(x) : (x) => a(x) - b(x);
    }
    return f;
  }
  function term() {
    let f = unary();
    for (;;) {
      if (peek() === '*' || peek() === '/') {
        const op = t[i++], a = f, b = unary();
        f = op === '*' ? (x) => a(x) * b(x) : (x) => a(x) / b(x);
      } else if (startsFactor(peek())) {
        const a = f, b = power();
        f = (x) => a(x) * b(x);
      } else return f;
    }
  }
  function unary() {
    if (peek() === '-') { i++; const a = unary(); return (x) => -a(x); }
    if (peek() === '+') { i++; return unary(); }
    return power();
  }
  function power() {
    const base = primary();
    if (peek() === '^') { i++; const ex = unary(); return (x) => Math.pow(base(x), ex(x)); }
    return base;
  }
  function primary() {
    const tok = t[i++];
    if (tok === undefined) throw new Error(`Term „${src}“ endet zu früh`);
    if (/^[\d.]/.test(tok)) { const v = parseFloat(tok); return () => v; }
    if (tok === '(') { const f = expr(); take(')'); return f; }
    if (tok === '|') { absDepth++; const f = expr(); absDepth--; take('|'); return (x) => Math.abs(f(x)); }
    const name = tok.toLowerCase();
    if (name === 'x') return (x) => x;
    if (FUNCS[name]) {
      const fn = FUNCS[name];
      if (peek() === '(') { i++; const a = expr(); take(')'); return (x) => fn(a(x)); }
      const a = power();
      return (x) => fn(a(x));
    }
    if (name in CONSTS) { const v = CONSTS[name]; return () => v; }
    // "xx" oder "2pix" zerlegen: Buchstabenfolgen aus x, e, pi
    if (/^(x|e|pi)+$/.test(name)) {
      const parts = name.match(/x|e|pi/g).map((p) => (p === 'x' ? (x) => x : () => CONSTS[p]));
      return (x) => parts.reduce((acc, f) => acc * f(x), 1);
    }
    throw new Error(`Unbekannter Name „${tok}“ in „${src}“`);
  }

  const f = expr();
  if (i < t.length) throw new Error(`Rest „${t.slice(i).join('')}“ in „${src}“ nicht verstanden`);
  return f;
}
