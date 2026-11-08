/* estado-equipos.js — ✅ / ✖️ junto a los equipos 100 % clasificados o 100 % eliminados
   ============================================================================
   Se carga en las páginas principales (index.html y nacional.html) y marca, en el CALENDARIO, a cada equipo que
   ya está matemáticamente clasificado a playoffs (✅) o eliminado (✖️). "100 %" = prueba exacta (enumeración de
   todas las combinaciones de los juegos que faltan), nunca una simulación.

   Cuándo marca:
     · jornada concluida ≥ 6 y la temporada regular sigue abierta → calcula el panorama con el motor (Web Worker);
     · temporada regular terminada (ya no hay juegos pendientes) → usa la tabla final: top 8 ✅, el resto ✖️ (sin motor);
     · antes de la J6 → no marca nada.
   Solo cuentan los resultados OFICIALES del JSON (no los marcadores que la persona escribe en su simulación).

   Es opcional y silencioso: si algo falla (sin Worker, JSON ausente…) la página queda exactamente como estaba.
   El resultado se guarda en localStorage con una "firma" de los resultados oficiales, así que en visitas siguientes
   las marcas aparecen al instante y solo se recalcula cuando llegan resultados nuevos.

   Uso:  <script src="estado-equipos.js" data-conf="14g"></script>   (o data-conf="nacional"), DESPUÉS de prediccion.js.
   ============================================================================ */
(function () {
  'use strict';
  const script = document.currentScript;
  const CONF = (script && script.getAttribute('data-conf')) || (/nacional/.test(location.pathname) ? 'nacional' : '14g');
  const NAC = CONF === 'nacional';
  const JORNADA_MIN = 6;                      // igual que el módulo de escenarios
  const MARCA = { c: '✅', e: '✖️' };
  const TITULO = { c: 'Clasificado a playoffs (100 %)', e: 'Eliminado: ya no puede clasificar (100 %)' };

  let estados = null;                         // { equipo: 'c' | 'e' }
  let observador = null, pendiente = null;

  function $(s) { return document.querySelector(s); }
  function temporada() {
    const t = new URLSearchParams(location.search).get('temporada');
    return (typeof ONEFA_TEMP !== 'undefined') ? ONEFA_TEMP.resolver(t) : (parseInt(t, 10) || 0);
  }
  function esActual(t) { return (typeof ONEFA_TEMP !== 'undefined') ? ONEFA_TEMP.esActual(t) : true; }
  function hash(txt) { let h = 5381; for (let i = 0; i < txt.length; i++) h = ((h << 5) + h + txt.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

  // ------------------------------------------------------------------ marcas en el calendario
  function nombreDe(el) {
    let n = '';
    el.childNodes.forEach(function (c) { if (c.nodeType === 3) n += c.textContent; });
    return n.trim();
  }
  function aplicar() {
    const cal = document.getElementById('calendarioAccordion');
    if (!cal || !estados) return;
    cal.querySelectorAll('.t-name').forEach(function (el) {
      if (el.closest('.scrim-item')) return;                          // los scrimmages no cuentan
      const st = estados[nombreDe(el)];
      const actual = el.querySelector('.est-mark');
      if (!st) { if (actual) actual.remove(); return; }
      if (actual && actual.getAttribute('data-e') === st) return;      // ya está bien: no se toca el DOM
      if (actual) actual.remove();
      const m = document.createElement('span');
      m.className = 'est-mark'; m.setAttribute('data-e', st); m.title = TITULO[st]; m.textContent = MARCA[st];
      m.style.cssText = 'margin-left:.35em;font-size:.85em;white-space:nowrap';
      el.appendChild(m);
    });
    leyenda(cal);
  }
  function leyenda(cal) {
    let l = document.getElementById('estLeyenda');
    const hay = estados && Object.keys(estados).length > 0;
    if (!hay) { if (l) l.remove(); return; }
    if (!l) {
      l = document.createElement('div'); l.id = 'estLeyenda';
      l.style.cssText = 'font-size:.8rem;opacity:.75;margin:.25rem 0 .6rem';
      cal.parentNode.insertBefore(l, cal);
    }
    const txt = MARCA.c + ' clasificado a playoffs · ' + MARCA.e + ' eliminado (matemáticamente, con los resultados oficiales)';
    if (l.textContent !== txt) l.textContent = txt;
  }
  function programar() {
    if (pendiente) return;
    pendiente = setTimeout(function () { pendiente = null; aplicar(); }, 60);
  }
  function observar() {
    const cal = document.getElementById('calendarioAccordion');
    if (!cal || observador || typeof MutationObserver === 'undefined') return;
    observador = new MutationObserver(programar);                       // el calendario se vuelve a pintar al editar marcadores
    observador.observe(cal, { childList: true, subtree: true });
  }

  // ------------------------------------------------------------------ cálculo
  // Temporada regular terminada: la tabla final decide (sin motor)
  function desdeTablaFinal(d) {
    const PRED = window.ONEFA_PRED, out = {};
    if (NAC) {
      const r = PRED.calcularStandingsNacional(d.grupos, d.juegos);
      const dentro = {}; r.seeds.forEach(function (s) { dentro[s.equipo] = true; });
      Object.keys(r.allRows).forEach(function (g) { r.allRows[g].forEach(function (x) { out[x.equipo] = dentro[x.equipo] ? 'c' : 'e'; }); });
    } else {
      PRED.calcularStandings14G(d.equipos, d.juegos).forEach(function (x, i) { out[x.equipo] = i < 8 ? 'c' : 'e'; });
    }
    return out;
  }
  function deResultado(r) {
    const out = {};
    ((r && r.equipos) || []).forEach(function (e) { if (e.estado === 'clasificado') out[e.equipo] = 'c'; else if (e.estado === 'eliminado') out[e.equipo] = 'e'; });
    // equipos excluidos de la clasificación (juegos por default, p. ej. Liebres CD Juárez): están eliminados por definición
    if (r && r.estado === 'ok') ((window.ONEFA_PRED && window.ONEFA_PRED.EQUIPOS_EXCLUIDOS) || []).forEach(function (t) { out[t] = 'e'; });
    return out;
  }
  function cargarScript(src) {
    return new Promise(function (ok, no) { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
  }
  // Panorama con el motor: Web Worker; si no se puede, en el hilo principal
  function panorama(datos) {
    const opciones = { conferencia: NAC ? 'nacional' : '14g', jornadaMin: JORNADA_MIN };
    return new Promise(function (resolve, reject) {
      let w;
      const respaldo = function () {
        const scripts = NAC ? ['escenarios.js', 'escenarios-nacional.js'] : ['escenarios.js'];
        let p = Promise.resolve();
        scripts.forEach(function (s) { p = p.then(function () { return (s === 'escenarios.js' ? window.ONEFA_ESC : (s === 'escenarios-nacional.js' ? window.ONEFA_ESC_NAC : null)) ? null : cargarScript(s); }); });
        p.then(function () { setTimeout(function () { try { resolve((NAC ? window.ONEFA_ESC_NAC : window.ONEFA_ESC).panorama(datos, opciones, {})); } catch (e) { reject(e); } }, 50); }).catch(reject);
      };
      try { w = new Worker('escenarios-worker.js'); } catch (e) { respaldo(); return; }
      w.onmessage = function (ev) {
        const m = ev.data || {};
        if (m.id !== 'estado') return;
        if (m.tipo === 'resultado') { try { w.terminate(); } catch (e) { /* nada */ } resolve(m.resultado); }
        else if (m.tipo === 'error') { try { w.terminate(); } catch (e) { /* nada */ } reject(new Error(m.mensaje)); }
      };
      w.onerror = function () { try { w.terminate(); } catch (e) { /* nada */ } respaldo(); };
      w.postMessage({ tipo: 'panorama', id: 'estado', datos: datos, opciones: opciones });
    });
  }

  function iniciar() {
    const temp = temporada();
    observar();
    if (!window.__DATOS || !window.ONEFA_PRED) return;
    window.__DATOS.then(function (d) {
      const juegos = d.juegos || [], jj = Number(d.jornadas_jugadas) || 0, PRED = window.ONEFA_PRED;
      const jugados = juegos.filter(function (g) { return !PRED.esPendiente(g, jj); });
      const abierta = juegos.some(function (g) { return PRED.esPendiente(g, jj); });
      const firma = jj + ':' + hash(jugados.map(function (g) { return g.jornada + g.local + g.visita + g.scoreLocal + '-' + g.scoreVisita; }).join('|'));
      const llave = 'onefa_estado_v1_' + CONF + '_' + temp;
      let cache = null; try { cache = JSON.parse(localStorage.getItem(llave) || 'null'); } catch (e) { cache = null; }
      if (cache && cache.firma === firma) { estados = cache.estados; aplicar(); return; }   // nada nuevo: marcas al instante

      const guardar = function (est) {
        estados = est; aplicar();
        try { localStorage.setItem(llave, JSON.stringify({ firma: firma, estados: est })); } catch (e) { /* sin espacio: no pasa nada */ }
      };
      if (!abierta) { guardar(desdeTablaFinal(d)); return; }          // temporada regular terminada
      if (jj < JORNADA_MIN || !esActual(temp)) { guardar({}); return; }  // todavía no aplica (o temporada histórica incompleta)
      const lanzar = function () {
        PRED.cargarDatos('./').then(panorama).then(function (r) { guardar(deResultado(r)); }).catch(function () { /* silencioso */ });
      };
      if (window.requestIdleCallback) requestIdleCallback(lanzar, { timeout: 2500 }); else setTimeout(lanzar, 400);
    }).catch(function () { /* sin datos: nada que marcar */ });
  }

  window.ONEFA_ESTADO = { aplicar: aplicar, estados: function () { return estados; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
