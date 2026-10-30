/* escenarios-ui.js — Interfaz del módulo "Escenarios de playoffs"
   ============================================================================
   UNA sola copia de la interfaz, compartida por todas las páginas (14 Grandes y
   Conferencia Nacional). Se activa sola en cualquier elemento con
   data-esc-conf="14g" | "nacional":   <button data-esc-conf="nacional">Escenarios de playoffs</button>
   Crea su propio overlay (no hay HTML del módulo dentro de las páginas).

   Es de SOLO LECTURA: nunca escribe en localStorage ni toca los pronósticos.
   El cálculo corre en un Web Worker (escenarios-worker.js), que elige el motor
   según la conferencia (escenarios.js / escenarios-nacional.js). Si el navegador
   no puede crear el Worker (p. ej. abriendo con file://), se usa un respaldo en
   el hilo principal (la pantalla puede tardar en responder).
   Depende de prediccion.js (window.ONEFA_PRED). Estilos: clases .esc-* de onefa.css.
   ============================================================================ */
(function () {
  'use strict';

  // El módulo se habilita desde la J6 concluida (decisión del usuario). La jornada máxima depende de
  // la conferencia: 14 Grandes = 9 (fija); Nacional = última jornada regular − 1 (se deriva de los datos).
  const ESC_JORNADA_MIN = 6;
  const CONFS = {
    '14g': {
      clave: '14g', prefijo: 'd14', nombre: '14 Grandes', pagina: 'index.html',
      obj: 'el Top 8', totalJuegos: 9,
      nota: 'Elige un equipo de 14 Grandes y calculamos qué tiene que pasar para que clasifique a playoffs (Top 8). ' +
            'Usa el modelo de predicción de marcadores; puede tardar unos segundos.',
      jornadaMax: function () { return 9; }, motor: 'ONEFA_ESC', scripts: ['escenarios.js']
    },
    'nacional': {
      clave: 'nacional', prefijo: 'dnac', nombre: 'Conferencia Nacional', pagina: 'nacional.html',
      obj: 'los 8 de playoffs', totalJuegos: null,
      nota: 'Elige un equipo de la Conferencia Nacional y calculamos qué tiene que pasar para que clasifique a playoffs ' +
            '(los 2 primeros de cada grupo y los 2 mejores terceros lugares). Usa el modelo de predicción de marcadores; puede tardar unos segundos.',
      jornadaMax: function (d) { let u = 0; d.juegos.forEach(function (g) { if (g.jornada > u) u = g.jornada; }); return u - 1; },
      motor: 'ONEFA_ESC_NAC', scripts: ['escenarios.js', 'escenarios-nacional.js']
    }
  };
  let CONF = CONFS['14g'];

  const FASES = {
    preparando:  { txt: 'Preparando…',                          a: 0.00, b: 0.02 },
    enumeracion: { txt: 'Calculando cotas exactas…',            a: 0.02, b: 0.32 },
    montecarlo:  { txt: 'Simulando temporadas…',                a: 0.32, b: 0.47 },
    victorias:   { txt: 'Calculando según tus victorias…',      a: 0.47, b: 0.55 },
    busqueda:    { txt: 'Buscando los escenarios más probables…', a: 0.55, b: 0.85 },
    escenarios:  { txt: 'Armando los escenarios…',              a: 0.85, b: 0.99 },
    listo:       { txt: 'Listo',                                a: 1.00, b: 1.00 }
  };
  const SITUACION = {
    clasificado:    { txt: 'Clasificado matemáticamente', cls: 'clasificado',
                      ayuda: 'Pase lo que pase en los juegos que quedan, terminas en {OBJ}, sin depender de desempates.' },
    eliminado:      { txt: 'Eliminado matemáticamente', cls: 'eliminado',
                      ayuda: 'Ni ganando todos tus juegos y todos los desempates alcanzarías {OBJ}.' },
    solo_desempate: { txt: 'Solo por desempate', cls: 'burbuja',
                      ayuda: 'Ninguna combinación de victorias te asegura {OBJ}: solo clasificarías si ganas el desempate (resultado directo o menos puntos en contra).' },
    favorito:       { txt: 'Favorito', cls: 'favorito',
                      ayuda: 'Según el modelo, clasificas en la gran mayoría de los escenarios.' },
    burbuja:        { txt: 'En la burbuja', cls: 'burbuja',
                      ayuda: 'Tu clasificación sigue abierta: depende de tus resultados y de los de otros equipos.' },
    casi_eliminado: { txt: 'Casi eliminado', cls: 'eliminado',
                      ayuda: 'Es muy difícil: necesitarías varios resultados contrarios a lo esperado.' }
  };
  const VIA = { ganadores: 'Se decide solo por victorias', resultado_directo: 'Se decide por resultado directo', desempate_pc: 'Se decide por desempate de puntos en contra (PC)',
                desempate_comodin: 'Se decide por puntos en contra (PC) contra otro tercer lugar' };
  const EXIGENCIA = { facil: 'marcadores fáciles de lograr', exigente: 'marcadores exigentes', muy_exigente: 'marcadores muy exigentes' };

  let overlay = null, datos = null, jj = null, equipoActual = null;
  let worker = null, workerPan = null, corrida = 0, bodyOverflowPrevio = '';

  // ---------------------------------------------------------------- utilidades
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pct(x) {                       // probabilidad 0..1 → texto
    const p = x * 100;
    if (!(p > 0)) return '0 %';
    if (p < 0.1) return '<0.1 %';
    if (p > 99.9) return '>99.9 %';
    return p.toFixed(1) + ' %';
  }
  function pctFino(x) {                   // para escenarios (pueden ser muy chicos)
    const p = x * 100;
    if (!(p > 0)) return '0 %';
    if (p < 0.01) return '<0.01 %';
    if (p < 1) return p.toFixed(2) + ' %';
    return p.toFixed(1) + ' %';
  }
  function $(id) { return document.getElementById(id); }
  // JSON de la temporada más reciente de la conferencia (sin años escritos a mano): d14_2026, dnac_2026…
  function jsonActual(d, prefijo) {
    let mejor = null, anio = -1;
    Object.keys(d).forEach(function (k) {
      const m = new RegExp('^' + prefijo + '_(\\d{4})$').exec(k);
      if (m && +m[1] > anio && d[k]) { anio = +m[1]; mejor = d[k]; }
    });
    return mejor;
  }
  function ayudaSituacion(s) { return s.ayuda.replace('{OBJ}', CONF.obj); }

  // ---------------------------------------------------------------- overlay
  function construirOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'escOverlay'; overlay.className = 'esc-overlay';
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', 'Escenarios de playoffs');
    overlay.innerHTML =
      '<nav class="topbar"><div class="topbar-inner">' +
        '<a class="brand" id="escBrand" href="index.html"><span class="brand-main">ONEFA</span><span class="brand-sub">Pronósticos</span></a>' +
        '<div class="nav-right"><button class="btn-esc-back" id="escBack" type="button">← Regresar</button></div>' +
      '</div></nav>' +
      '<header class="hero"><div class="hero-inner">' +
        '<div class="hero-eye" id="escEye">Liga Mayor ONEFA — Escenarios</div>' +
        '<h1 class="hero-title">ESCENARIOS DE<br><em>PLAYOFFS</em></h1>' +
        '<div class="hero-bar"></div>' +
        '<p class="hero-meta" id="escMeta">Solo de consulta — no guarda ni modifica tus pronósticos.</p>' +
      '</div></header>' +
      '<div class="esc-body">' +
        '<div class="esc-note" id="escNota"></div>' +
        '<div class="esc-controles">' +
          '<label for="escEquipo">Equipo</label>' +
          '<select id="escEquipo" class="esc-select" disabled><option value="">Cargando…</option></select>' +
          '<button id="escAnalizar" class="esc-btn" type="button" disabled>Analizar</button>' +
        '</div>' +
        '<div id="escProgreso" class="esc-progreso" role="status" aria-live="polite" hidden>' +
          '<div class="esc-progreso-txt"><span class="esc-spin" aria-hidden="true"></span><b>Simulando opciones…</b> <span id="escFase"></span></div>' +
          '<div class="esc-barra"><div id="escBarraFill"></div></div>' +
          '<div class="esc-progreso-pie"><span id="escProgresoNota">Puede tardar hasta un minuto en teléfonos lentos.</span>' +
            '<button id="escCancelar" class="esc-btn esc-btn-sec" type="button">Cancelar</button></div>' +
        '</div>' +
        '<div id="escResultado"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    $('escBack').addEventListener('click', cerrar);
    $('escAnalizar').addEventListener('click', analizar);
    $('escCancelar').addEventListener('click', function () { cancelarCorrida(true); });
    $('escEquipo').addEventListener('change', function () { $('escResultado').innerHTML = ''; });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && overlay.classList.contains('open')) cerrar(); });
    return overlay;
  }

  function abrir(conf) {
    const nueva = CONFS[conf] || CONF;
    if (nueva !== CONF) { CONF = nueva; equipoActual = null; }
    construirOverlay();
    $('escNota').textContent = CONF.nota;
    $('escBrand').setAttribute('href', CONF.pagina);
    $('escEye').textContent = 'Liga Mayor ONEFA — Escenarios · ' + CONF.nombre;
    $('escResultado').innerHTML = '';
    overlay.classList.add('open');
    bodyOverflowPrevio = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    overlay.scrollTop = 0;
    if (datos) { prepararControles(); return Promise.resolve(); }
    return window.ONEFA_PRED.cargarDatos('./').then(function (d) { datos = d; prepararControles(); })
      .catch(function () { $('escResultado').innerHTML = '<div class="esc-aviso esc-aviso-error">No se pudieron cargar los datos. Revisa tu conexión e inténtalo de nuevo.</div>'; });
  }

  function cerrar() {
    cancelarCorrida(false);
    cerrarWorkerPan();
    if (overlay) overlay.classList.remove('open');
    document.body.style.overflow = bodyOverflowPrevio;
  }

  // ---------------------------------------------------------------- controles
  function prepararControles() {
    const PRED = window.ONEFA_PRED, d = jsonActual(datos, CONF.prefijo);
    jj = d.jornadas_jugadas;
    const jmax = CONF.jornadaMax(d);
    const sel = $('escEquipo'), btn = $('escAnalizar'), res = $('escResultado');
    $('escMeta').textContent = 'Jornada ' + jj + ' concluida · Solo de consulta — no guarda ni modifica tus pronósticos.';
    let aviso = '';
    if (jj < ESC_JORNADA_MIN) aviso = 'Disponible a partir de la Jornada ' + ESC_JORNADA_MIN + ' concluida (hoy: Jornada ' + jj + ').';
    else if (jj > jmax) aviso = 'La temporada regular ya concluyó; no quedan escenarios por calcular.';
    if (aviso) {
      sel.innerHTML = '<option value="">—</option>'; sel.disabled = true; btn.disabled = true;
      res.innerHTML = '<div class="esc-aviso">' + esc(aviso) + '</div>';
      return;
    }
    // Equipos ordenados como la tabla actual (solo juegos ya jugados)
    const jugados = d.juegos.filter(function (g) { return !PRED.esPendiente(g, jj); });
    if (CONF.clave === 'nacional') {
      const t = PRED.calcularStandingsNacional(d.grupos, jugados), excl = PRED.EQUIPOS_EXCLUIDOS || [];
      sel.innerHTML = '<option value="">Elige un equipo…</option>' + Object.keys(d.grupos).map(function (gn) {
        return '<optgroup label="Grupo ' + esc(gn) + '">' + t.allRows[gn].filter(function (r) { return excl.indexOf(r.equipo) < 0; }).map(function (r, i) {
          return '<option value="' + esc(r.equipo) + '">' + esc(r.equipo) + ' (' + r.pg + '-' + r.pp + ')</option>';
        }).join('') + '</optgroup>';
      }).join('');
    } else {
      const filas = PRED.calcularStandings14G(d.equipos, jugados);
      sel.innerHTML = '<option value="">Elige un equipo…</option>' + filas.map(function (r) {
        return '<option value="' + esc(r.equipo) + '">' + r.seed + '. ' + esc(r.equipo) + ' (' + r.pg + '-' + r.pp + ')</option>';
      }).join('');
    }
    sel.disabled = false; btn.disabled = false;
    if (equipoActual) sel.value = equipoActual;
    if (CONF.clave === 'nacional') cargarPanorama();
  }

  // Panorama (solo Nacional): estado exacto de todos los equipos para marcar ✓ clasificado / ✕ eliminado
  // en el selector antes de analizar. Es opcional: si algo falla, el selector queda como está.
  function cerrarWorkerPan() { if (workerPan) { try { workerPan.terminate(); } catch (e) { /* nada */ } workerPan = null; } }
  function marcarPanorama(r) {
    if (!r || r.estado !== 'ok') return;
    const sel = $('escEquipo'); if (!sel) return;
    const m = {}; r.equipos.forEach(function (e) { m[e.equipo] = e.estado; });
    Array.prototype.forEach.call(sel.options, function (o) {
      if (!o.value) return;
      if (!o.hasAttribute('data-base')) o.setAttribute('data-base', o.textContent);
      const st = m[o.value];
      o.textContent = o.getAttribute('data-base') + (st === 'clasificado' ? '  ✓ clasificado' : (st === 'eliminado' ? '  ✕ eliminado' : ''));
    });
  }
  function cargarPanorama() {
    cerrarWorkerPan();
    const opc = { conferencia: 'nacional', jornadaMin: ESC_JORNADA_MIN };
    const enHilo = function () {
      cargarMotor().then(function (motor) { setTimeout(function () { try { marcarPanorama(motor.panorama(datos, opc, {})); } catch (e) { /* opcional */ } }, 30); }).catch(function () {});
    };
    let w;
    try { w = new Worker('escenarios-worker.js'); } catch (e) { enHilo(); return; }
    workerPan = w;
    w.onmessage = function (ev) {
      const m = ev.data || {};
      if (m.id !== 'panorama') return;
      if (m.tipo === 'resultado') { cerrarWorkerPan(); marcarPanorama(m.resultado); }
      else if (m.tipo === 'error') { cerrarWorkerPan(); }
    };
    w.onerror = function () { cerrarWorkerPan(); enHilo(); };
    w.postMessage({ tipo: 'panorama', id: 'panorama', datos: datos, opciones: opc });
  }

  // ---------------------------------------------------------------- ejecución
  function mostrarProgreso(modoCompat) {
    $('escProgreso').hidden = false;
    $('escBarraFill').style.width = '0%';
    $('escFase').textContent = FASES.preparando.txt;
    $('escCancelar').hidden = !!modoCompat;
    $('escProgresoNota').textContent = modoCompat
      ? 'Modo compatible: la pantalla puede dejar de responder unos segundos mientras calcula.'
      : 'Puede tardar hasta un minuto en teléfonos lentos.';
    $('escAnalizar').disabled = true; $('escEquipo').disabled = true;
  }
  function ocultarProgreso() {
    $('escProgreso').hidden = true;
    $('escAnalizar').disabled = false; $('escEquipo').disabled = false;
  }
  function alProgreso(id) {
    return function (fase, p) {
      if (id !== corrida) return;
      const f = FASES[fase]; if (!f) return;
      const v = f.a + (f.b - f.a) * (typeof p === 'number' ? Math.min(1, Math.max(0, p)) : 0);
      $('escBarraFill').style.width = (v * 100).toFixed(0) + '%';
      $('escFase').textContent = f.txt;
    };
  }

  function cerrarWorker() { if (worker) { try { worker.terminate(); } catch (e) { /* nada */ } worker = null; } }

  function cancelarCorrida(avisar) {
    corrida++;                                   // invalida cualquier respuesta pendiente
    cerrarWorker();
    if (overlay && !$('escProgreso').hidden) {
      ocultarProgreso();
      if (avisar) $('escResultado').innerHTML = '<div class="esc-aviso">Análisis cancelado.</div>';
    }
  }

  function correrEnWorker(opciones, id) {
    return new Promise(function (resolve, reject) {
      let w;
      try { w = new Worker('escenarios-worker.js'); } catch (e) { reject({ fallback: true, error: e }); return; }
      worker = w;
      const prog = alProgreso(id);
      w.onmessage = function (ev) {
        const m = ev.data || {};
        if (m.id !== id) return;
        if (m.tipo === 'progreso') prog(m.fase, m.pct);
        else if (m.tipo === 'resultado') { cerrarWorker(); resolve(m.resultado); }
        else if (m.tipo === 'error') { cerrarWorker(); reject(new Error(m.mensaje)); }
      };
      w.onerror = function (ev) { cerrarWorker(); reject({ fallback: true, error: ev }); };
      w.postMessage({ tipo: 'analizar', id: id, datos: datos, opciones: opciones });
    });
  }

  function cargarScript(src) {
    return new Promise(function (resolve, reject) {
      const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
    });
  }
  // Carga (si hace falta) los scripts del motor de la conferencia y devuelve el motor
  function cargarMotor() {
    let p = Promise.resolve();
    CONF.scripts.forEach(function (src) {
      p = p.then(function () {
        const ya = (src === 'escenarios.js') ? window.ONEFA_ESC : (src === 'escenarios-nacional.js' ? window.ONEFA_ESC_NAC : null);
        return ya ? null : cargarScript(src);
      });
    });
    return p.then(function () { return window[CONF.motor]; });
  }
  function correrEnHiloPrincipal(opciones, id) {
    mostrarProgreso(true);
    return cargarMotor().then(function (motor) {
      return new Promise(function (resolve, reject) {
        setTimeout(function () {                 // deja pintar el mensaje antes de bloquear el hilo
          try { resolve(motor.analizar(datos, opciones, { progreso: alProgreso(id), cancelado: function () { return id !== corrida; } })); }
          catch (e) { reject(e); }
        }, 60);
      });
    });
  }

  function analizar() {
    const equipo = $('escEquipo').value;
    const res = $('escResultado');
    if (!equipo) { res.innerHTML = '<div class="esc-aviso">Elige un equipo para analizar.</div>'; return; }
    equipoActual = equipo;
    cancelarCorrida(false);
    const id = ++corrida;
    res.innerHTML = '';
    mostrarProgreso(false);
    const opciones = { equipo: equipo, conferencia: CONF.clave, jornadaMin: ESC_JORNADA_MIN };
    if (CONF.clave === '14g') opciones.jornadaMax = CONF.jornadaMax();     // Nacional: el motor la deriva de los datos
    correrEnWorker(opciones, id)
      .catch(function (err) {
        if (err && err.fallback && id === corrida) return correrEnHiloPrincipal(opciones, id);
        throw err;
      })
      .then(function (r) {
        if (id !== corrida) return;
        ocultarProgreso(); render(r, equipo);
      })
      .catch(function (err) {
        if (id !== corrida) return;
        ocultarProgreso();
        res.innerHTML = '<div class="esc-aviso esc-aviso-error">No se pudo completar el análisis (' + esc((err && err.message) || 'error desconocido') + ').</div>';
      });
  }

  // ---------------------------------------------------------------- resultados
  function render(r, equipo) {
    const cont = $('escResultado');
    if (!r || r.estado === 'fuera_de_rango') { cont.innerHTML = '<div class="esc-aviso">' + esc((r && r.mensaje) || 'Fuera de rango.') + '</div>'; return; }
    // Equipo ya decidido (clasificado / eliminado con prueba exacta): solo el resumen con su explicación
    cont.innerHTML = r.explicacion
      ? htmlResumen(r, equipo) + htmlAviso(r)
      : htmlResumen(r, equipo) + htmlVictorias(r) + htmlClave(r, equipo) + htmlEscenarios(r, equipo) + htmlAviso(r);
    activarTabs(cont);
  }

  function posicionModal(r, dist) {
    let mejor = 0, pm = 0;
    if (!dist) return { pos: 0, p: 0 };
    dist.forEach(function (p, i) { if (p > pm) { pm = p; mejor = i + 1; } });
    return { pos: mejor, p: pm };
  }

  function htmlResumen(r, equipo) {
    const s = SITUACION[r.situacion] || SITUACION.burbuja, m = r.meta, pr = r.probabilidad, c = pr.cotasExactas;
    const ic = (pr.ic95[1] - pr.ic95[0]) / 2, nac = CONF.clave === 'nacional';
    const pm = nac ? posicionModal(r, r.distribucionGrupo) : posicionModal(r, r.distribucionPosicion);
    let h = '<section class="esc-card esc-resumen"><div class="esc-resumen-top">' +
      '<div><div class="esc-eq">' + esc(equipo) + '</div><span class="esc-badge esc-b-' + s.cls + '">' + esc(s.txt) + '</span></div>' +
      '<div class="esc-prob"><span class="esc-prob-num">' + pct(pr.p) + '</span>' +
        '<span class="esc-prob-lbl">probabilidad de clasificar</span>' +
        '<span class="esc-prob-ic" title="Margen de error de la simulación (95 %)">±' + (ic * 100).toFixed(1) + ' pts</span></div>' +
      '</div><p class="esc-explica">' + esc(ayudaSituacion(s)) + '</p>' +
      (r.explicacion ? r.explicacion.map(function (t) { return '<p class="esc-explica"><b>' + esc(t) + '</b></p>'; }).join('') : '') + '<ul class="esc-datos">';
    h += '<li>Quedan <b>' + m.nPendientes + '</b> juegos por jugar en la liga' + (m.aplazados ? ' (incluye <b>' + m.aplazados + '</b> aplazado' + (m.aplazados > 1 ? 's' : '') + ')' : '') + '.</li>';
    if (nac && r.distribucionGrupo) {
      h += '<li>Grupo <b>' + esc(m.grupo) + '</b>. Lugar final más probable en tu grupo: <b>' + pm.pos + '.º</b> (' + pct(pm.p) + ').  Victorias esperadas: <b>' + r.victoriasEsperadas.toFixed(1) + '</b> de ' + m.juegosPorEquipo + '.</li>';
      const v = r.viaClasificacion;
      h += '<li>Clasificas como <b>top 2 de tu grupo</b> en ' + pct(v.top2) + ' de las simulaciones y como <b>mejor tercer lugar (comodín)</b> en ' + pct(v.comodin) + '.</li>';
    } else if (!nac && r.distribucionPosicion) {
      h += '<li>Posición final más probable: <b>' + pm.pos + '.º</b> (' + pct(pm.p) + ').  Victorias esperadas: <b>' + r.victoriasEsperadas.toFixed(1) + '</b> de ' + CONF.totalJuegos + '.</li>';
    }
    if (c) h += '<li title="Calculado con TODAS las combinaciones de ganadores posibles. El rango existe porque algunos lugares se deciden por desempate (marcadores).">' +
      'Según todas las combinaciones de ganadores: entre <b>' + pct(c.min) + '</b> (clasificas sin depender de desempates) y <b>' + pct(c.max) + '</b> (si ganas todos los desempates).</li>';
    return h + '</ul></section>';
  }

  function htmlVictorias(r) {
    const f = r.porVictoriasPropias || [];
    if (!f.length) return '<h2 class="esc-h">Según tus victorias propias</h2><div class="esc-card"><p class="esc-explica">Ya no te quedan juegos por jugar: tu clasificación depende solo de otros equipos.</p></div>';
    const m = f[0].de;
    let h = '<h2 class="esc-h">Según tus victorias propias (te quedan ' + m + ' juego' + (m > 1 ? 's' : '') + ')</h2><div class="s-wrap"><table class="s-tbl"><thead><tr>' +
      '<th>Ganas…</th><th class="ta-r">Probabilidad de que ocurra</th><th class="ta-r">Probabilidad de clasificar</th></tr></thead><tbody>';
    f.slice().reverse().forEach(function (x) {
      h += '<tr><td class="s-eq">' + x.victorias + ' de ' + x.de + '</td><td class="ta-r">' + pct(x.probabilidadDeEsaCantidad) + '</td>' +
           '<td class="ta-r esc-verde">' + pct(x.p) + '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }

  function textoClave(j, equipo) {
    const gana = j.resultadoQueAyuda === 'local' ? j.local : j.visita;
    const ap = j.aplazado ? ' <span class="esc-tag esc-tag-apl">APLAZADO</span>' : '';
    const rel = j.relacion === 'carrera_comodin' ? ' <span class="esc-tag esc-tag-lib">carrera por el comodín</span>' : (j.relacion === 'mi_grupo' && !j.propio ? ' <span class="esc-tag esc-tag-lib">tu grupo</span>' : '');
    return '<li><span class="esc-j">J' + j.jornada + '</span> ' + esc(j.local) + ' vs ' + esc(j.visita) + ap + rel +
      ' — te conviene que gane <b>' + esc(gana) + '</b> <span class="esc-imp">(' + Math.round(Math.abs(j.impacto) * 100) + ' pts de probabilidad)</span></li>';
  }
  function htmlClave(r, equipo) {
    const propios = (r.juegosClave || []).filter(function (j) { return j.propio; }).slice(0, 3);
    const otros = (r.juegosClaveOtros || []).slice(0, 5);
    if (!propios.length && !otros.length) return '';
    let h = '<h2 class="esc-h">Juegos clave</h2><div class="esc-card esc-claves">';
    if (propios.length) h += '<h3>Tus juegos</h3><ul class="esc-lista">' + propios.map(function (j) { return textoClave(j, equipo); }).join('') + '</ul>';
    if (otros.length) h += '<h3>Ayuda de otros equipos</h3><ul class="esc-lista">' + otros.map(function (j) { return textoClave(j, equipo); }).join('') + '</ul>';
    return h + '</div>';
  }

  function htmlEscenarios(r, equipo) {
    const esc_ = r.escenarios || [];
    if (r.busqueda && r.busqueda.omitida) {
      return '<h2 class="esc-h">Escenarios</h2><div class="esc-aviso">Prácticamente clasificado (probabilidad ≥ 99.5 %): no hay escenarios de riesgo relevantes que mostrar.</div>';
    }
    if (!esc_.length) {
      if (r.situacion === 'clasificado' || r.situacion === 'eliminado') return '';
      return '<h2 class="esc-h">Escenarios</h2><div class="esc-aviso">No se encontraron escenarios dentro del tiempo de búsqueda.</div>';
    }
    const riesgo = r.modo === 'riesgo';
    let h = '<h2 class="esc-h">' + (riesgo ? 'Qué podría hacerte fallar' : 'Escenarios más probables para clasificar') + '</h2>';
    if (r.modoAutomatico) h += '<div class="esc-aviso">Con los resultados esperados por el modelo ya clasificas; esto es lo que más probablemente te sacaría del Top 8.</div>';
    h += '<div class="esc-tabs" role="tablist">' + esc_.map(function (e, i) {
      return '<button type="button" role="tab" class="esc-tab' + (i === 0 ? ' on' : '') + '" data-i="' + i + '">Escenario ' + e.id + ' · ' + pctFino(e.probabilidad) + '</button>';
    }).join('') + '</div>';
    h += esc_.map(function (e, i) { return htmlPanel(e, equipo, riesgo, i === 0); }).join('');
    return h;
  }

  function htmlPanel(e, equipo, riesgo, visible) {
    let h = '<div class="esc-panel' + (visible ? ' on' : '') + '" data-i="' + (e.id - 1) + '">';
    h += '<div class="esc-card"><div class="esc-chips">';
    h += '<span class="esc-chip">' + (e.sorpresas ? e.sorpresas + ' sorpresa' + (e.sorpresas > 1 ? 's' : '') + ' (gana el no favorito)' : 'Resultados esperados por el modelo') + '</span>';
    h += '<span class="esc-chip">' + esc(VIA[e.via] || e.via) + '</span>';
    if (e.exigencia) h += '<span class="esc-chip esc-chip-' + esc(e.exigencia) + '">' + esc(EXIGENCIA[e.exigencia] || e.exigencia) + '</span>';
    h += '</div>';
    h += '<p class="esc-explica">' + (riesgo ? 'Este escenario ocurre' : 'Este escenario ocurre') + ' con probabilidad <b>' + pctFino(e.probabilidad) + '</b>: ' +
      'los resultados necesarios coinciden con probabilidad ' + pctFino(e.probabilidadDeLaCondicion) + ' y, dadas esas condiciones, ' +
      (riesgo ? 'no clasificas' : 'clasificas') + ' en <b>' + pct(e.probabilidadCondicion) + '</b> de los casos. Los escenarios se traslapan: no son excluyentes.</p>';
    // resultados necesarios
    h += '<h3>' + (riesgo ? 'Resultados que te dejarían fuera' : 'Resultados necesarios') + '</h3>';
    if (!e.necesarios.length) h += '<p class="esc-explica">Ningún resultado en particular es indispensable.</p>';
    else h += '<ul class="esc-lista">' + e.necesarios.map(function (n) {
      return '<li><span class="esc-j">J' + n.jornada + '</span> ' + esc(n.local) + ' vs ' + esc(n.visita) + ': gana <b>' + esc(n.ganador) + '</b>' +
        (n.relacion === 'carrera_comodin' ? ' <span class="esc-tag esc-tag-lib">carrera por el comodín</span>' : '') + (n.sorpresa ? ' <span class="esc-tag esc-tag-sor">SORPRESA</span>' : '') + (n.aplazado ? ' <span class="esc-tag esc-tag-apl">APLAZADO</span>' : '') + '</li>';
    }).join('') + '</ul>';
    // desempate
    if (e.desempate && e.via === 'desempate_comodin' && e.desempate.pcRivales) {
      const riv = e.desempate.pcRivales.filter(function (x) { return !x.mismoGrupo; });
      h += '<div class="esc-desempate"><b>Desempate por el comodín:</b> ' + esc(equipo) + ' y ' + riv.map(function (x) { return esc(x.equipo); }).join(', ') +
        ' terminan con las mismas victorias en el tercer lugar de sus grupos y el último lugar de comodín se decide por menos puntos en contra (PC). ' +
        'Con estos marcadores: ' + esc(equipo) + ' <b>' + e.desempate.pcEquipo + '</b> PC; ' +
        riv.map(function (x) { return esc(x.equipo) + ' ' + x.pc; }).join(', ') + '.</div>';
    } else if (e.desempate && e.via === 'desempate_pc' && e.desempate.pcRivales) {
      const riv = CONF.clave === 'nacional' ? e.desempate.pcRivales.filter(function (x) { return x.mismoGrupo; }) : e.desempate.pcRivales;
      const eq = CONF.clave === 'nacional' ? [equipo].concat(riv.map(function (x) { return x.equipo; })) : e.desempate.grupo;
      h += '<div class="esc-desempate"><b>Desempate:</b> ' + esc(eq.join(', ')) + ' empatan en victorias y se acomodan por menos puntos en contra (PC). ' +
        'Con estos marcadores: ' + esc(equipo) + ' <b>' + e.desempate.pcEquipo + '</b> PC; ' +
        riv.map(function (x) { return esc(x.equipo) + ' ' + x.pc; }).join(', ') + '.</div>';
    }
    // completaciones exactas
    if (e.completaciones) {
      const c = e.completaciones;
      h += '<p class="esc-explica esc-peq">Si solo se cumplen esos resultados y todo lo demás puede pasar de cualquier forma: ' +
        (riesgo ? pct(c.pFuera) + ' quedas fuera seguro, ' + pct(c.pFilo) + ' depende del desempate, ' + pct(c.pSeguro) + ' clasificas de todos modos.'
                : pct(c.pSeguro) + ' clasificas seguro, ' + pct(c.pFilo) + ' depende del desempate, ' + pct(c.pFuera) + ' no clasificas.') + '</p>';
    }
    h += '</div>';
    // pantalla de marcadores
    h += '<h3 class="esc-h2">Marcadores del escenario</h3>' + htmlMarcadores(e, equipo);
    // tabla final
    h += '<details class="esc-det"><summary>Tabla final proyectada en este escenario</summary>' + htmlTablaFinal(e, equipo) + '</details>';
    return h + '</div>';
  }

  function htmlMarcadores(e, equipo) {
    const porJ = {};
    e.marcadores.forEach(function (m) { (porJ[m.jornada] = porJ[m.jornada] || []).push(m); });
    return Object.keys(porJ).sort(function (a, b) { return a - b; }).map(function (j) {
      let h = '<div class="esc-jl">Jornada ' + j + '</div><div class="s-wrap"><table class="s-tbl esc-tbl"><thead><tr>' +
        '<th>Local</th><th class="ta-c">Marcador</th><th>Visita</th><th class="hide-sm"></th></tr></thead><tbody>';
      porJ[j].forEach(function (m) {
        const propio = m.local === equipo || m.visita === equipo, lg = m.scoreLocal > m.scoreVisita;
        const tags = (m.rol === 'necesario' ? '<span class="esc-tag esc-tag-nec">NECESARIO</span>' : '<span class="esc-tag esc-tag-lib">libre</span>') +
          (m.sorpresa ? '<span class="esc-tag esc-tag-sor">SORPRESA</span>' : '') +
          (m.aplazado ? '<span class="esc-tag esc-tag-apl">APLAZADO</span>' : '') +
          (m.ajustado ? '<span class="esc-tag esc-tag-aj">marcador ajustado</span>' : '');
        h += '<tr class="' + (m.rol === 'necesario' ? 'esc-row-nec' : 'esc-row-libre') + (propio ? ' esc-row-eq' : '') + '">' +
          '<td class="s-eq' + (lg ? ' esc-win' : '') + '">' + esc(m.local) + '</td>' +
          '<td class="esc-score">' + m.scoreLocal + ' – ' + m.scoreVisita + '</td>' +
          '<td class="s-eq' + (!lg ? ' esc-win' : '') + '">' + esc(m.visita) + '</td>' +
          '<td class="esc-tags hide-sm">' + tags + '</td></tr>';
      });
      return h + '</tbody></table></div>';
    }).join('');
  }

  function htmlTablaFinalNac(e, equipo) {
    const t = e.tablaFinal;
    let h = '';
    Object.keys(t.grupos).forEach(function (gn) {
      h += '<div class="esc-jl">Grupo ' + esc(gn) + '</div><div class="s-wrap"><table class="s-tbl"><thead><tr><th style="width:36px">#</th><th>Equipo</th><th class="ta-r">PG</th><th class="ta-r">PC</th><th class="hide-sm"></th></tr></thead><tbody>';
      t.grupos[gn].forEach(function (r) {
        h += '<tr class="' + (r.estado !== 'fuera' ? 'r-playoff' : '') + (r.pos === 2 ? ' r-cutoff' : '') + (r.equipo === equipo ? ' esc-row-eq' : '') + '">' +
          '<td><span class="pos-n' + (r.pos === 1 ? ' top' : '') + '">' + r.pos + '</span></td><td class="s-eq">' + esc(r.equipo) + '</td>' +
          '<td class="ta-r s-num">' + r.pg + '</td><td class="ta-r s-num">' + r.pc + '</td>' +
          '<td class="esc-tags hide-sm">' + (r.estado === 'comodin' ? '<span class="esc-tag esc-tag-aj">COMODÍN</span>' : '') + '</td></tr>';
      });
      h += '</tbody></table></div>';
    });
    h += '<div class="esc-jl">Los 8 clasificados (sembrado por PG)</div><div class="s-wrap"><table class="s-tbl"><thead><tr><th style="width:36px">#</th><th>Equipo</th><th class="ta-r">PG</th><th class="ta-r">PC</th></tr></thead><tbody>';
    t.seeds.forEach(function (r) {
      h += '<tr class="r-playoff' + (r.equipo === equipo ? ' esc-row-eq' : '') + '"><td><span class="pos-n' + (r.pos === 1 ? ' top' : '') + '">' + r.pos + '</span></td><td class="s-eq">' + esc(r.equipo) + '</td>' +
        '<td class="ta-r s-num">' + r.pg + '</td><td class="ta-r s-num">' + r.pc + '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }

  function htmlTablaFinal(e, equipo) {
    if (!Array.isArray(e.tablaFinal)) return htmlTablaFinalNac(e, equipo);
    let h = '<div class="s-wrap"><table class="s-tbl"><thead><tr><th style="width:36px">#</th><th>Equipo</th><th class="ta-r">PG</th><th class="ta-r">PC</th></tr></thead><tbody>';
    e.tablaFinal.forEach(function (t) {
      h += '<tr class="' + (t.pos <= 8 ? 'r-playoff' : '') + (t.pos === 8 ? ' r-cutoff' : '') + (t.equipo === equipo ? ' esc-row-eq' : '') + '">' +
        '<td><span class="pos-n' + (t.pos === 1 ? ' top' : '') + '">' + t.pos + '</span></td><td class="s-eq">' + esc(t.equipo) + '</td>' +
        '<td class="ta-r s-num">' + t.pg + '</td><td class="ta-r s-num">' + t.pc + '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }

  function htmlAviso(r) {
    const p = r.meta.parametros || {};
    return '<div class="esc-limites"><b>Cómo leer esto.</b> Las probabilidades salen del modelo Massey (ratings fijos durante cada escenario, juegos independientes y cada resultado ' +
      'limitado a ' + Math.round((p.pMin || 0.03) * 100) + ' %–' + Math.round((p.pMax || 0.97) * 100) + ' %). Los marcadores son <b>sugerencias plausibles</b> que cumplen el desempate, no pronósticos. ' +
      'No se listan todos los escenarios posibles (son millones): se muestran los más probables y sus condiciones mínimas.' +
      (r.meta.ms ? ' Cálculo: ' + (r.meta.ms / 1000).toFixed(1) + ' s.' : '') + '</div>';
  }

  function activarTabs(cont) {
    const tabs = cont.querySelectorAll('.esc-tab'), paneles = cont.querySelectorAll('.esc-panel');
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        const i = t.getAttribute('data-i');
        tabs.forEach(function (x) { x.classList.toggle('on', x === t); });
        paneles.forEach(function (p) { p.classList.toggle('on', p.getAttribute('data-i') === i); });
      });
    });
  }

  // ---------------------------------------------------------------- arranque
  function iniciar() {
    const temp = new URLSearchParams(window.location.search).get('temporada');
    document.querySelectorAll('[data-esc-conf]').forEach(function (btn) {
      if (temp === '2025') { btn.style.display = 'none'; return; }   // solo temporada en curso
      btn.addEventListener('click', function () {
        const conf = btn.getAttribute('data-esc-conf');
        if (!CONFS[conf]) return;
        abrir(conf);
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();

  window.ONEFA_ESC_UI = { abrir: abrir, cerrar: cerrar, analizar: analizar, render: render, _cancelar: cancelarCorrida };
})();
