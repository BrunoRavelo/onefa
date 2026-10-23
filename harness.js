// Arnés de pruebas de interfaz: carga el index.html REAL en jsdom con sus scripts y JSON.
// Requiere:  cd tests/ui && npm install   (instala jsdom; NO subir node_modules al repositorio)
// Arnés: carga el index.html REAL del proyecto en jsdom, con sus scripts y JSON locales.
const fs = require('fs'), path = require('path'), vm = require('vm');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const RAIZ = path.join(__dirname, '..', '..');   // raíz del proyecto

class Cargador extends ResourceLoader {
  fetch(url) {
    const p = new URL(url).pathname.replace(/^\/onefa\//, '');
    const f = path.join(RAIZ, p);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return Promise.resolve(fs.readFileSync(f));
    return Promise.resolve(Buffer.from(''));             // fuentes de Google etc.: se ignoran
  }
}
function trabajadorFalso(window, opts) {                // emula new Worker('escenarios-worker.js') con vm
  return class FakeWorker {
    constructor(url) {
      if (opts.rompeWorker) throw new Error('Worker no disponible');
      this.vivo = true; this.onmessage = null; this.onerror = null;
      const ctx = { console, structuredClone, setTimeout };
      ctx.self = ctx;
      ctx.postMessage = m => setTimeout(() => { if (this.vivo && this.onmessage) this.onmessage({ data: structuredClone(m) }); }, 0);
      ctx.importScripts = (...a) => a.forEach(f => vm.runInContext(fs.readFileSync(path.join(RAIZ, f), 'utf8'), ctx, { filename: f }));
      vm.createContext(ctx); this.ctx = ctx;
      vm.runInContext(fs.readFileSync(path.join(RAIZ, String(url)), 'utf8'), ctx, { filename: String(url) });
      opts.creados.push(this);
    }
    postMessage(m) { setTimeout(() => { if (this.vivo) this.ctx.onmessage({ data: structuredClone(m) }); }, 0); }
    terminate() { this.vivo = false; opts.terminados++; }
  };
}
async function abrirPagina(o) {
  o = Object.assign({ query: '', worker: 'falso', jornadas: null }, o || {});
  const errores = [], vc = new VirtualConsole();
  vc.on('jsdomError', e => errores.push('jsdomError: ' + (e.detail || e.message)));
  vc.on('error', e => errores.push('console.error: ' + e));
  const estado = { creados: [], terminados: 0 };
  const dom = new JSDOM(fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8'), {
    url: 'http://localhost/onefa/index.html' + o.query, runScripts: 'dangerously', resources: new Cargador(), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.fetch = async (u) => {
        const f = path.join(RAIZ, String(u).replace(/^\.\//, '').split('?')[0]);
        let d = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (o.jornadas != null && /onefa_data_2026/.test(f)) d.jornadas_jugadas = o.jornadas;
        return { ok: true, json: async () => d };
      };
      w.structuredClone = structuredClone;
      if (o.worker === 'falso' || o.worker === 'roto') w.Worker = trabajadorFalso(w, Object.assign(estado, { rompeWorker: o.worker === 'roto' }));
    }
  });
  await new Promise(r => dom.window.addEventListener('load', r));
  await esperar(() => dom.window.document.querySelector('#calendarioAccordion .j-item, #calendarioAccordion > *'), 5000, 'calendario de la página');
  return { dom, w: dom.window, d: dom.window.document, errores, estado };
}
async function esperar(cond, ms, que) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const v = cond(); if (v) return v; } catch (e) { /* aún no */ } await new Promise(r => setTimeout(r, 25)); }
  throw new Error('Tiempo agotado esperando: ' + que);
}
module.exports = { abrirPagina, esperar };
