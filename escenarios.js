/* ============================================================================
   escenarios.js — Escenarios de clasificación a playoffs (14 Grandes)
   ============================================================================
   Responde: "¿qué tiene que pasar para que el equipo X clasifique a playoffs?"
   Ver plan.md para el diseño completo. Resumen de la lógica:

   Capa 1 (ganadores): para cada juego pendiente hay una probabilidad de victoria
     p = Φ(margen/σ) acotada a [3 %, 97 %] (prediccion.js → probabilidadVictoria).
   Capa 2 (marcadores): cuando el lugar depende del desempate (resultado directo →
     menor PC), se buscan marcadores plausibles que lo cumplan.

   Etapas: enumeración exacta (cotas SEGURO/EN EL FILO/FUERA) · Monte Carlo
   (probabilidad, distribución de posición, victorias propias, juegos clave) ·
   situación del equipo · búsqueda best-first de escenarios por "costo de sorpresa" ·
   condición mínima y probabilidad de cada familia · marcadores de desempate.

   Es un módulo PURO (sin DOM): funciona en Node, en el navegador y en un Web Worker.
   Depende de prediccion.js (ONEFA_PRED). Toda posición final se calcula con
   ONEFA_PRED.calcularStandings14G — aquí NO se reimplementa la regla de desempate.
   ============================================================================ */
(function (global) {
  'use strict';

  const PRED = (typeof module !== 'undefined' && module.exports)
    ? require('./prediccion.js')
    : global.ONEFA_PRED;

  // ==========================================================================
  // PARÁMETROS (todos sobrescribibles vía opciones)
  // ==========================================================================
  const DEF = {
    conferencia: '14g',
    sims: 20000,            // simulaciones Monte Carlo principales
    simsFamilia: 4000,      // simulaciones para la probabilidad de cada familia de escenarios
    simsVictorias: 3000,    // simulaciones por cada fila de la tabla "victorias propias"
    K: 5,                   // escenarios a devolver
    maxExp: 200000,         // tope de expansiones de la búsqueda best-first
    maxMsBusqueda: 20000,   // tope de tiempo de la búsqueda (decisión D10: hasta ~1 min en total)
    presupuestoTotalMs: 45000,
    sigma: null,            // null = la de la conferencia (PRED.SIGMA_MARGEN)
    sigmaTotal: 14,         // dispersión de los puntos totales de un juego (por calibrar)
    sigmaPuntos: 13.6,      // SD medida de puntos de un equipo por juego (plausibilidad de marcadores)
    maxPuntos: 73,          // máximo de puntos de un equipo observado en los datos
    pMin: null, pMax: null, // null = PRED.P_MIN / PRED.P_MAX (3 %–97 %, decisión D9)
    semilla: 20261014,
    umbralFavorito: 0.85,
    umbralCasiEliminado: 0.02,
    umbralPracticamenteSeguro: 0.995,   // favorito con P ≥ esto: no se buscan escenarios de riesgo
    maxMsCasiEliminado: 5000,           // presupuesto de búsqueda para equipos casi eliminados
    jornadaMin: 6, jornadaMax: 9,   // el módulo se habilita con J6..J9 concluidas
    enumeracionMaxN: 26,    // enumeración exacta solo si los juegos libres son ≤ este número
    verificarCompletacionesMaxF: 22
  };
  const OBJETIVO_PLAYOFFS = { tipo: 'playoffs', min: 1, max: 8 };
  const SEGURO = 0, FILO = 1, FUERA = 2;

  // ==========================================================================
  // Utilidades: RNG con semilla, normal, probit
  // ==========================================================================
  function crearRng(semilla) {
    let x = (semilla >>> 0) || 123456789;
    return function () {
      x ^= x << 13; x >>>= 0;
      x ^= x >>> 17;
      x ^= x << 5;  x >>>= 0;
      return x / 4294967296;
    };
  }
  function probit(p) { // inversa de la CDF normal (Acklam)
    if (p <= 0) return -8; if (p >= 1) return 8;
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    const pl = 0.02425;
    let q, r;
    if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
    if (p > 1 - pl) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
    q = p - 0.5; r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5]) * q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  }
  function ctxPorDefecto(ctx) {
    return Object.assign({ progreso: function () {}, cancelado: function () { return false; } }, ctx || {});
  }

  // ==========================================================================
  // Etapa 0 y 1 — Preparación del problema y probabilidades por juego
  // ==========================================================================
  function prepararProblema(datos, opciones) {
    const o = Object.assign({}, DEF, opciones || {});
    if (o.conferencia !== '14g') throw new Error('Conferencia no soportada todavía (Nacional = Fase 5)');
    const d = datos.d14_2026, jj = d.jornadas_jugadas;
    const modelo = PRED.construirModelosPorConferencia(datos).modelo14;
    const equipos = d.equipos.slice(), idx = {};
    equipos.forEach(function (t, i) { idx[t] = i; });
    const nEq = equipos.length;

    // Pendiente = jornada posterior a jj O sin marcador (incluye juegos aplazados)
    const jugados = [], pend = [];
    d.juegos.forEach(function (g) { (PRED.esPendiente(g, jj) ? pend : jugados).push(g); });

    const base = new Int8Array(nEq), pcBase = new Float64Array(nEq);
    jugados.forEach(function (g) {
      const sl = g.scoreLocal, sv = g.scoreVisita;
      if (sl + sv > 0 && sl !== sv) {
        pcBase[idx[g.local]] += sv; pcBase[idx[g.visita]] += sl;
        if (sl > sv) base[idx[g.local]]++; else base[idx[g.visita]]++;
      }
    });

    const popc = { conferencia: o.conferencia, sigma: o.sigma || undefined };
    if (o.pMin != null) popc.pMin = o.pMin;
    if (o.pMax != null) popc.pMax = o.pMax;
    const G = pend.map(function (g, id) {
      const pv = PRED.probabilidadVictoria(g.local, g.visita, modelo, popc);
      const pr = PRED.predecirPartido(g.local, g.visita, modelo);
      let a = pr.scoreLocal, b = pr.scoreVisita;
      if (a === b) a++;                                   // sin empates
      const pHome = pv.p, pf = Math.max(pHome, 1 - pHome);
      return {
        id: id, g: g, jornada: g.jornada, local: g.local, visita: g.visita,
        iL: idx[g.local], iV: idx[g.visita], aplazado: g.jornada <= jj,
        mu: pv.mu, pHome: pHome, favHome: pHome >= 0.5, pf: pf, forzado: pv.forzado,
        costo: pv.forzado ? Infinity : Math.log(pf / (1 - pf)),
        predHome: a > b, a: a, b: b
      };
    });
    return { o: o, conferencia: o.conferencia, jj: jj, modelo: modelo, equipos: equipos, idx: idx, nEq: nEq,
             jugados: jugados, G: G, n: G.length, base: base, pcBase: pcBase };
  }

  function ganadoresFavoritos(P) { return P.G.map(function (x) { return x.favHome; }); }

  function victorias(P, hw) {
    const W = Int8Array.from(P.base);
    for (let i = 0; i < P.n; i++) { const x = P.G[i]; if (hw[i]) W[x.iL]++; else W[x.iV]++; }
    return W;
  }

  // Marcadores "esperados" (los de predecirPartido) ajustados al ganador del vector
  function marcadoresBase(P, hw) {
    const sl = new Int16Array(P.n), sv = new Int16Array(P.n);
    for (let i = 0; i < P.n; i++) {
      const x = P.G[i];
      let l, v;
      if (!!hw[i] === x.predHome) { l = x.a; v = x.b; } else { l = x.b; v = x.a; }
      if (hw[i] && l <= v) { const t = l; l = v; v = t; }
      if (!hw[i] && v <= l) { const t = l; l = v; v = t; }
      sl[i] = l; sv[i] = v;
    }
    return { sl: sl, sv: sv };
  }

  function juegosCompletos(P, sl, sv) {
    return P.jugados.concat(P.G.map(function (x, i) {
      return { jornada: x.jornada, local: x.local, visita: x.visita, scoreLocal: sl[i], scoreVisita: sv[i] };
    }));
  }
  function tablaFinal(P, sl, sv) { return PRED.calcularStandings14G(P.equipos, juegosCompletos(P, sl, sv)); }
  function posicionDe(rows, equipo) { for (let i = 0; i < rows.length; i++) if (rows[i].equipo === equipo) return rows[i].seed; return -1; }

  // ==========================================================================
  // Clasificación rápida con solo victorias (plan §4.4): posición ∈ [A+1, A+B+1]
  // ==========================================================================
  function clasificarVictorias(P, W, T, obj) {
    let A = 0, B = 0;
    const wT = W[T];
    for (let t = 0; t < P.nEq; t++) {
      if (t === T) continue;
      const w = W[t];
      if (w > wT) A++; else if (w === wT) B++;
    }
    const lo = A + 1, hi = A + B + 1;
    if (lo >= obj.min && hi <= obj.max) return SEGURO;
    if (hi < obj.min || lo > obj.max) return FUERA;
    return FILO;
  }

  // ==========================================================================
  // Enumeración exacta con código Gray (solo ganadores). Con `fijos` (Map id→bool)
  // calcula la distribución CONDICIONADA a esos resultados.
  // ==========================================================================
  function enumerarExacto(P, T, obj, fijos, ctxIn) {
    const ctx = ctxPorDefecto(ctxIn);
    const n = P.n, W = Int8Array.from(P.base), hw = new Uint8Array(n);
    const libres = [], ratio = [];
    let prod = 1;
    for (let i = 0; i < n; i++) {
      const x = P.G[i];
      if (fijos && fijos.has(i)) hw[i] = fijos.get(i) ? 1 : 0;
      else if (x.forzado) hw[i] = x.pHome >= 0.5 ? 1 : 0;
      else { hw[i] = 0; libres.push(i); ratio.push(x.pHome / (1 - x.pHome)); prod *= (1 - x.pHome); }
      if (hw[i]) W[x.iL]++; else W[x.iV]++;
    }
    const m = libres.length;
    if (m > P.o.enumeracionMaxN) return null;
    const iLs = libres.map(function (i) { return P.G[i].iL; }), iVs = libres.map(function (i) { return P.G[i].iV; });
    const nEq = P.nEq, total = Math.pow(2, m), paso = 1 << 21;
    const cnt = [0, 0, 0], pr = [0, 0, 0];
    const lo0 = obj.min, hi0 = obj.max;
    const hl = new Uint8Array(m);
    for (let k = 0; k < total; k++) {
      if (k > 0) {
        const b = 31 - Math.clz32(k & -k);
        if (hl[b]) { hl[b] = 0; W[iLs[b]]--; W[iVs[b]]++; prod /= ratio[b]; }
        else       { hl[b] = 1; W[iLs[b]]++; W[iVs[b]]--; prod *= ratio[b]; }
        if ((k & (paso - 1)) === 0) {
          ctx.progreso('enumeracion', k / total);
          if (ctx.cancelado()) return null;
        }
      }
      const wT = W[T];
      let A = 0, B = 0;
      for (let t = 0; t < nEq; t++) { if (t === T) continue; const w = W[t]; if (w > wT) A++; else if (w === wT) B++; }
      const lo = A + 1, hi = A + B + 1;
      const c = (lo >= lo0 && hi <= hi0) ? SEGURO : ((hi < lo0 || lo > hi0) ? FUERA : FILO);
      cnt[c]++; pr[c] += prod;
    }
    return { libres: m, total: total,
             seguro: { n: cnt[SEGURO], p: pr[SEGURO] }, filo: { n: cnt[FILO], p: pr[FILO] }, fuera: { n: cnt[FUERA], p: pr[FUERA] } };
  }

  // ==========================================================================
  // Monte Carlo: sorteo de ganadores con p acotada y marcadores plausibles;
  // la posición sale de la tabla completa (misma regla de desempate de la app).
  // ==========================================================================
  function crearSimulador(P, T, obj, rng) {
    const o = P.o, n = P.n, MAXP = o.maxPuntos, sigT = o.sigmaTotal;
    const sigma = o.sigma || PRED.SIGMA_MARGEN[P.conferencia];
    const sim = P.jugados.concat(P.G.map(function (x) { return { jornada: x.jornada, local: x.local, visita: x.visita, scoreLocal: 0, scoreVisita: 0 }; }));
    const off = P.jugados.length;
    const hw = new Uint8Array(n);
    const nombreT = P.equipos[T];
    let spare = null;
    function normal() {
      if (spare !== null) { const s = spare; spare = null; return s; }
      let u = 0, v = 0; while (u === 0) u = rng(); v = rng();
      const r = Math.sqrt(-2 * Math.log(u));
      spare = r * Math.sin(2 * Math.PI * v);
      return r * Math.cos(2 * Math.PI * v);
    }
    // margen del ganador ~ Normal(μ, σ) condicionado a que sea > 0 (cola truncada por inversa de la CDF)
    function margenGanador(mu, localGana) {
      const m = localGana ? mu : -mu;
      if (!isFinite(m)) return 1 + Math.floor(rng() * 4);
      const lowU = PRED.Phi(-m / sigma);
      if (1 - lowU < 1e-12) return 1 + Math.floor(rng() * 3);
      const u = lowU + rng() * (1 - lowU);
      const x = m + sigma * probit(u);
      return (isFinite(x) && x >= 1) ? x : 1;
    }
    function muestrear(forzados) {
      for (let i = 0; i < n; i++) {
        const x = P.G[i];
        let gl;
        if (forzados && forzados.has(i)) gl = forzados.get(i);
        else if (x.forzado) gl = x.pHome >= 0.5;
        else gl = rng() < x.pHome;
        hw[i] = gl ? 1 : 0;
        let sw, sp;
        if (x.forzado) { sw = 1; sp = 0; }
        else {
          const m = margenGanador(x.mu, gl);
          let tot = (x.a + x.b) + sigT * normal();
          if (tot < 20) tot = 20; if (tot > 90) tot = 90;
          sw = Math.round((tot + m) / 2); sp = Math.round((tot - m) / 2);
          if (sp < 0) { sp = 0; sw = Math.max(1, Math.round(m)); }
          if (sw <= sp) sw = sp + 1;
          if (sw > MAXP) { sw = MAXP; if (sp >= sw) sp = sw - 1; }
        }
        const g = sim[off + i];
        if (gl) { g.scoreLocal = sw; g.scoreVisita = sp; } else { g.scoreLocal = sp; g.scoreVisita = sw; }
      }
    }
    function posicion() { return posicionDe(PRED.calcularStandings14G(P.equipos, sim), nombreT); }
    return { muestrear: muestrear, posicion: posicion, hw: hw };
  }

  function califica(pos, obj) { return pos >= obj.min && pos <= obj.max; }

  // Probabilidad de "Q" (el equipo cumple el objetivo) con resultados forzados opcionales
  function probabilidadQ(P, T, obj, N, rng, forzados) {
    const S = crearSimulador(P, T, obj, rng);
    let ok = 0;
    for (let s = 0; s < N; s++) { S.muestrear(forzados); if (califica(S.posicion(), obj)) ok++; }
    return ok / N;
  }

  function monteCarloCompleto(P, T, obj, rng, ctxIn) {
    const ctx = ctxPorDefecto(ctxIn), N = P.o.sims, n = P.n, nEq = P.nEq;
    const S = crearSimulador(P, T, obj, rng);
    const propios = []; P.G.forEach(function (x, i) { if (x.iL === T || x.iV === T) propios.push(i); });
    const mT = propios.length;
    const posHist = new Array(nEq + 1).fill(0);
    const nL = new Float64Array(n), qL = new Float64Array(n), nV = new Float64Array(n), qV = new Float64Array(n);
    let ok = 0, sumaVict = 0;
    for (let s = 0; s < N; s++) {
      S.muestrear(null);
      const pos = S.posicion(); posHist[pos]++;
      const q = califica(pos, obj); if (q) ok++;
      for (let i = 0; i < n; i++) { if (S.hw[i]) { nL[i]++; if (q) qL[i]++; } else { nV[i]++; if (q) qV[i]++; } }
      let k = 0; for (let j = 0; j < mT; j++) { const x = P.G[propios[j]]; if ((x.iL === T) === !!S.hw[propios[j]]) k++; }
      sumaVict += k;
      if ((s & 4095) === 4095) { ctx.progreso('montecarlo', s / N); if (ctx.cancelado()) break; }
    }
    const p = ok / N, ic = 1.96 * Math.sqrt(Math.max(p * (1 - p), 1e-9) / N);
    // juegos clave
    const clave = [];
    for (let i = 0; i < n; i++) {
      if (P.G[i].forzado || nL[i] < 150 || nV[i] < 150) continue;
      const impacto = qL[i] / nL[i] - qV[i] / nV[i];
      const x = P.G[i];
      clave.push({ juegoId: i, jornada: x.jornada, local: x.local, visita: x.visita, aplazado: x.aplazado,
                   propio: (x.iL === T || x.iV === T), pLocal: x.pHome, impacto: impacto,
                   resultadoQueAyuda: impacto >= 0 ? 'local' : 'visita' });
    }
    clave.sort(function (a, b) { return Math.abs(b.impacto) - Math.abs(a.impacto); });
    const claveOtros = clave.filter(function (c) { return !c.propio; }).slice(0, 5);
    return { N: N, p: p, ic95: [Math.max(0, p - ic), Math.min(1, p + ic)], juegosClaveOtros: claveOtros,
             distribucionPosicion: posHist.slice(1).map(function (c) { return c / N; }),
             victoriasEsperadas: P.base[T] + sumaVict / N, juegosClave: clave.slice(0, 6), propios: propios };
  }

  // Tabla "según tus victorias propias": P(Q | T gana exactamente k de sus m pendientes)
  function tablaVictoriasPropias(P, T, obj, propios, rng) {
    const m = propios.length, N = P.o.simsVictorias, filas = [];
    if (m === 0) return filas;
    const S = crearSimulador(P, T, obj, rng);
    const pT = propios.map(function (i) { const x = P.G[i]; return x.iL === T ? x.pHome : 1 - x.pHome; });
    // distribución de Poisson-binomial de victorias propias
    let dist = [1];
    pT.forEach(function (p) { const nd = new Array(dist.length + 1).fill(0); dist.forEach(function (v, k) { nd[k] += v * (1 - p); nd[k + 1] += v * p; }); dist = nd; });
    for (let k = 0; k <= m; k++) {
      let ok = 0;
      for (let s = 0; s < N; s++) {
        // resultados propios condicionados a exactamente k victorias (rechazo; respaldo: subconjunto al azar)
        let sel = null;
        for (let t = 0; t < 300 && !sel; t++) {
          const v = pT.map(function (p) { return rng() < p; });
          if (v.filter(Boolean).length === k) sel = v;
        }
        if (!sel) { const ids = propios.map(function (_, j) { return j; }); for (let j = ids.length - 1; j > 0; j--) { const r = Math.floor(rng() * (j + 1)); const tmp = ids[j]; ids[j] = ids[r]; ids[r] = tmp; } sel = new Array(m).fill(false); for (let j = 0; j < k; j++) sel[ids[j]] = true; }
        const forz = new Map();
        propios.forEach(function (gi, j) { const x = P.G[gi]; forz.set(gi, x.iL === T ? sel[j] : !sel[j]); });
        S.muestrear(forz);
        if (califica(S.posicion(), obj)) ok++;
      }
      filas.push({ victorias: k, de: m, probabilidadDeEsaCantidad: dist[k], p: ok / N, sims: N });
    }
    return filas;
  }

  // ==========================================================================
  // Capa 2 — marcadores que resuelven un desempate (plan §6 Etapa 7)
  // ==========================================================================
  function resultadosDirectos(P, hw, miembros) {
    const pos = {}; miembros.forEach(function (t, i) { pos[t] = i; });
    const m = miembros.length, R = [];
    for (let i = 0; i < m; i++) R.push(new Array(m).fill(0));
    P.jugados.forEach(function (g) {
      const a = P.idx[g.local], b = P.idx[g.visita];
      if (!(a in pos) || !(b in pos) || g.scoreLocal === g.scoreVisita || g.scoreLocal + g.scoreVisita === 0) return;
      if (g.scoreLocal > g.scoreVisita) { R[pos[a]][pos[b]] = 1; R[pos[b]][pos[a]] = -1; } else { R[pos[b]][pos[a]] = 1; R[pos[a]][pos[b]] = -1; }
    });
    P.G.forEach(function (x, i) {
      if (!(x.iL in pos) || !(x.iV in pos)) return;
      if (hw[i]) { R[pos[x.iL]][pos[x.iV]] = 1; R[pos[x.iV]][pos[x.iL]] = -1; } else { R[pos[x.iV]][pos[x.iL]] = 1; R[pos[x.iL]][pos[x.iV]] = -1; }
    });
    return R;
  }

  function combinaciones(arr, k) {
    const out = [];
    (function rec(ini, acc) {
      if (acc.length === k) { out.push(acc.slice()); return; }
      for (let i = ini; i < arr.length; i++) { acc.push(arr[i]); rec(i + 1, acc); acc.pop(); }
    })(0, []);
    return out;
  }

  // Ajusta marcadores (sin cambiar ganadores) para que PC_x − PC_T ≥ 1 para todo x∈S,
  // moviendo de a 1 punto el marcador de mejor relación ganancia/costo de plausibilidad.
  function optimizarMarcadores(P, hw, T, S) {
    const n = P.n, MAXP = P.o.maxPuntos, sg = P.o.sigmaPuntos, dos = 2 * sg * sg;
    const base = marcadoresBase(P, hw);
    const sl = Int16Array.from(base.sl), sv = Int16Array.from(base.sv);
    const pc = Float64Array.from(P.pcBase);
    for (let i = 0; i < n; i++) { const x = P.G[i]; pc[x.iL] += sv[i]; pc[x.iV] += sl[i]; }
    for (let it = 0; it < 900; it++) {
      const viol = S.filter(function (x) { return pc[x] - pc[T] < 1; });
      if (!viol.length) break;
      let mejor = null;
      for (let i = 0; i < n; i++) {
        const x = P.G[i];
        for (let lado = 0; lado < 2; lado++) {
          const v = lado === 0 ? x.iV : x.iL;                  // quien "permite" estos puntos
          let g = 0; for (let q = 0; q < viol.length; q++) g += (v === viol[q] ? 1 : 0) - (v === T ? 1 : 0);
          if (g === 0) continue;
          const dl = g > 0 ? 1 : -1;
          const s0 = lado === 0 ? sl[i] : sv[i], b0 = lado === 0 ? base.sl[i] : base.sv[i], s1 = s0 + dl;
          if (s1 < 0 || s1 > MAXP) continue;
          const l1 = lado === 0 ? s1 : sl[i], v1 = lado === 1 ? s1 : sv[i];
          if (hw[i] ? (l1 - v1 < 1) : (v1 - l1 < 1)) continue;
          const costo = ((s1 - b0) * (s1 - b0) - (s0 - b0) * (s0 - b0)) / dos;
          const razon = Math.abs(g) / Math.max(costo, 1e-6);
          if (!mejor || razon > mejor.razon) mejor = { i: i, lado: lado, dl: dl, s1: s1, v: v, razon: razon };
        }
      }
      if (!mejor) return null;
      if (mejor.lado === 0) sl[mejor.i] = mejor.s1; else sv[mejor.i] = mejor.s1;
      pc[mejor.v] += mejor.dl;
    }
    if (S.some(function (x) { return pc[x] - pc[T] < 1; })) return null;
    let J = 0, devMax = 0;
    for (let i = 0; i < n; i++) {
      const dL = sl[i] - base.sl[i], dV = sv[i] - base.sv[i];
      J += (dL * dL + dV * dV) / dos; devMax = Math.max(devMax, Math.abs(dL) / sg, Math.abs(dV) / sg);
    }
    return { sl: sl, sv: sv, J: J, devMax: devMax, pc: pc };
  }
  function exigenciaDe(devMax) { return devMax < 0.5 ? 'facil' : (devMax < 1.5 ? 'exigente' : 'muy_exigente'); }

  // ¿Existe un marcador realista que le dé el lugar a T con estos ganadores? (vector EN EL FILO)
  function resolverDesempate(P, hw, T, obj) {
    const W = victorias(P, hw), base = marcadoresBase(P, hw);
    let A = 0; const grupo = [];
    for (let t = 0; t < P.nEq; t++) { if (t === T) continue; if (W[t] > W[T]) A++; else if (W[t] === W[T]) grupo.push(t); }
    const plazas = obj.max - A;
    if (plazas < 1) return { ok: false };
    const miembros = [T].concat(grupo);
    const R = resultadosDirectos(P, hw, miembros);
    let barrido = -1;
    for (let a = 0; a < miembros.length && barrido < 0; a++) {
      let todo = true; for (let b = 0; b < miembros.length; b++) { if (a !== b && R[a][b] !== 1) { todo = false; break; } }
      if (todo) barrido = a;
    }
    const nombres = miembros.map(function (t) { return P.equipos[t]; });
    if (barrido === 0) return { ok: true, via: 'resultado_directo', sl: base.sl, sv: base.sv, exigencia: 'facil', desempate: { grupo: nombres, plazas: plazas } };
    const rivales = grupo.filter(function (t, i) { return miembros[i + 1] !== (barrido > 0 ? miembros[barrido] : -1); });
    const posBase = barrido > 0 ? 2 : 1;
    const permitidos = plazas - posBase;
    if (permitidos < 0) return { ok: false };
    const necesita = rivales.length - permitidos;
    if (necesita <= 0) return { ok: true, via: 'resultado_directo', sl: base.sl, sv: base.sv, exigencia: 'facil', desempate: { grupo: nombres, plazas: plazas } };
    const desempateInfo = function (sl, sv) {
      const pc = Float64Array.from(P.pcBase);
      for (let i = 0; i < P.n; i++) { const x = P.G[i]; pc[x.iL] += sv[i]; pc[x.iV] += sl[i]; }
      return { grupo: nombres, plazas: plazas, pcEquipo: pc[T], pcRivales: grupo.map(function (t) { return { equipo: P.equipos[t], pc: pc[t] }; }) };
    };
    // atajo: con los marcadores esperados ya queda dentro
    let rows = tablaFinal(P, base.sl, base.sv);
    if (califica(posicionDe(rows, P.equipos[T]), obj)) return { ok: true, via: 'desempate_pc', sl: base.sl, sv: base.sv, exigencia: 'facil', desempate: desempateInfo(base.sl, base.sv) };
    let mejor = null;
    const combos = combinaciones(rivales.slice(0, 8), Math.min(necesita, rivales.length));
    for (let c = 0; c < combos.length && c < 80; c++) {
      const opt = optimizarMarcadores(P, hw, T, combos[c]);
      if (!opt) continue;
      if (mejor && opt.J >= mejor.J) continue;
      rows = tablaFinal(P, opt.sl, opt.sv);
      if (califica(posicionDe(rows, P.equipos[T]), obj)) mejor = opt;
    }
    if (!mejor) return { ok: false };
    return { ok: true, via: 'desempate_pc', sl: mejor.sl, sv: mejor.sv, exigencia: exigenciaDe(mejor.devMax), desempate: desempateInfo(mejor.sl, mejor.sv) };
  }

  // ==========================================================================
  // Evaluación de un vector de ganadores
  //   modo 'clasificar': el objetivo se cumple (Q)         modo 'riesgo': el objetivo FALLA (¬Q)
  // ==========================================================================
  function evaluarVector(P, hw, T, obj, modo) {
    const W = victorias(P, hw), c = clasificarVictorias(P, W, T, obj);
    if (modo === 'riesgo') {
      if (c === FUERA) { const b = marcadoresBase(P, hw); return { cumple: true, via: 'ganadores', sl: b.sl, sv: b.sv, exigencia: null }; }
      if (c === SEGURO) return { cumple: false };
      const b = marcadoresBase(P, hw), rows = tablaFinal(P, b.sl, b.sv);
      return califica(posicionDe(rows, P.equipos[T]), obj) ? { cumple: false } : { cumple: true, via: 'desempate_pc', sl: b.sl, sv: b.sv, exigencia: null };
    }
    if (c === FUERA) return { cumple: false };
    if (c === SEGURO) { const b = marcadoresBase(P, hw); return { cumple: true, via: 'ganadores', sl: b.sl, sv: b.sv, exigencia: null }; }
    const r = resolverDesempate(P, hw, T, obj);
    return r.ok ? Object.assign({ cumple: true }, r) : { cumple: false };
  }

  // ==========================================================================
  // Búsqueda best-first (plan §6 Etapa 5): subconjuntos de "sorpresas" por costo creciente
  // ==========================================================================
  function Heap() { this.a = []; }
  Heap.prototype.push = function (x) {
    const a = this.a; a.push(x); let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].c <= a[i].c) break; const t = a[p]; a[p] = a[i]; a[i] = t; i = p; }
  };
  Heap.prototype.pop = function () {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) { let m = i; const L = 2 * i + 1, R = L + 1;
        if (L < a.length && a[L].c < a[m].c) m = L; if (R < a.length && a[R].c < a[m].c) m = R;
        if (m === i) break; const t = a[m]; a[m] = a[i]; a[i] = t; i = m; }
    }
    return top;
  };
  Object.defineProperty(Heap.prototype, 'size', { get: function () { return this.a.length; } });

  function ordenCostos(P) {
    const vars = []; for (let i = 0; i < P.n; i++) if (!P.G[i].forzado) vars.push(i);
    vars.sort(function (a, b) { return P.G[a].costo - P.G[b].costo; });
    return vars;
  }

  // Devuelve, en orden de probabilidad, vectores distintos que cumplen `cumple(hw)`.
  function buscarVectores(P, cumple, maxVectores, ctxIn, extra) {
    const ctx = ctxPorDefecto(ctxIn), ord = ordenCostos(P), n = ord.length;
    const costo = ord.map(function (i) { return P.G[i].costo; });
    const baseHW = ganadoresFavoritos(P);
    const h = new Heap(); h.push({ c: 0, set: [], last: -1 });
    const out = []; let exp = 0; const t0 = Date.now();
    const maxExp = P.o.maxExp, maxMs = P.o.maxMsBusqueda;
    let parcial = false;
    while (h.size && out.length < maxVectores) {
      if (exp >= maxExp || Date.now() - t0 > maxMs) { parcial = true; break; }
      if ((exp & 255) === 0 && ctx.cancelado()) { parcial = true; break; }
      const s = h.pop(); exp++;
      const hw = baseHW.slice(); s.set.forEach(function (k) { hw[ord[k]] = !hw[ord[k]]; });
      if (extra && extra.subsumido && extra.subsumido(hw)) { /* ya cubierto por una familia previa: se sigue expandiendo */ }
      else if (cumple(hw)) {
        const r = extra && extra.alEncontrar ? extra.alEncontrar(hw, s) : { guardar: true };
        if (r.guardar) out.push({ hw: hw, costo: s.c, sorpresas: s.set.length });
        if (r.detener) break;
      }
      if (s.last === -1) { if (n > 0) h.push({ c: costo[0], set: [0], last: 0 }); }
      else if (s.last + 1 < n) {
        h.push({ c: s.c + costo[s.last + 1], set: s.set.concat([s.last + 1]), last: s.last + 1 });
        h.push({ c: s.c - costo[s.last] + costo[s.last + 1], set: s.set.slice(0, -1).concat([s.last + 1]), last: s.last + 1 });
      }
      if ((exp & 1023) === 0) ctx.progreso('busqueda', Math.min(0.99, (Date.now() - t0) / maxMs));
    }
    return { vectores: out, expansiones: exp, ms: Date.now() - t0, parcial: parcial };
  }

  // ==========================================================================
  // Familias de escenarios: condición mínima + probabilidad (plan §6 Etapa 6)
  // ==========================================================================
  function pivotes(P, hw, cumple) {
    const piv = [];
    for (let i = 0; i < P.n; i++) {
      if (P.G[i].forzado) continue;
      const h2 = hw.slice(); h2[i] = !h2[i];
      if (!cumple(h2)) piv.push(i);
    }
    return piv;
  }
  function probCondicion(P, hw, ids) {
    let p = 1; ids.forEach(function (i) { const x = P.G[i]; p *= hw[i] ? x.pHome : 1 - x.pHome; });
    return p;
  }

  function construirFamilia(P, T, obj, modo, hw, rng, cumple) {
    let C = pivotes(P, hw, cumple);
    const objetivoP = function (forzados, N) { const q = probabilidadQ(P, T, obj, N, rng, forzados); return modo === 'clasificar' ? q : 1 - q; };
    const forzadosDe = function (ids) { const f = new Map(); ids.forEach(function (i) { f.set(i, !!hw[i]); }); return f; };
    let pCond = objetivoP(forzadosDe(C), P.o.simsFamilia);
    // si la condición es demasiado floja, se agregan (voraz) los juegos que más la refuerzan
    let aumentos = 0;
    while (pCond < 0.5 && aumentos < 3 && C.length < P.n) {
      let mejor = null;
      const cand = ordenCostos(P).filter(function (i) { return C.indexOf(i) < 0; }).slice(0, 10);
      for (let c = 0; c < cand.length; c++) {
        const ids = C.concat([cand[c]]);
        const pr = objetivoP(forzadosDe(ids), 800);
        if (!mejor || pr > mejor.p) mejor = { i: cand[c], p: pr };
      }
      if (!mejor || mejor.p <= pCond * 0.98) break;
      C = C.concat([mejor.i]); aumentos++;
      pCond = objetivoP(forzadosDe(C), P.o.simsFamilia);
    }
    C.sort(function (a, b) { return a - b; });
    return { C: C, pCond: pCond, pC: probCondicion(P, hw, C) };
  }

  function nombreGanador(x, hwi) { return hwi ? x.local : x.visita; }

  function escenarioDesdeFamilia(P, T, obj, modo, fam, hwVector, idEsc) {
    // Vector a mostrar: favoritos con lo necesario fijado (si aún cumple); si no, el vector original
    const hwBase = ganadoresFavoritos(P), hwLimpio = hwBase.slice();
    fam.C.forEach(function (i) { hwLimpio[i] = hwVector[i]; });
    let ev = evaluarVector(P, hwLimpio, T, obj, modo), hw = hwLimpio;
    if (!ev.cumple) { hw = hwVector; ev = evaluarVector(P, hw, T, obj, modo); }
    const enC = new Set(fam.C);
    const base = marcadoresBase(P, hw);
    const necesarios = fam.C.map(function (i) {
      const x = P.G[i];
      return { juegoId: i, jornada: x.jornada, local: x.local, visita: x.visita, ganador: nombreGanador(x, hw[i]), sorpresa: hw[i] !== x.favHome, aplazado: x.aplazado };
    });
    const marcadores = P.G.map(function (x, i) {
      return { juegoId: i, jornada: x.jornada, local: x.local, visita: x.visita, scoreLocal: ev.sl[i], scoreVisita: ev.sv[i],
               rol: enC.has(i) ? 'necesario' : 'libre', sorpresa: hw[i] !== x.favHome, aplazado: x.aplazado,
               ajustado: ev.sl[i] !== base.sl[i] || ev.sv[i] !== base.sv[i] };
    }).sort(function (a, b) { return a.jornada - b.jornada || a.juegoId - b.juegoId; });
    const rows = tablaFinal(P, ev.sl, ev.sv);
    const tabla = rows.map(function (r) { return { pos: r.seed, equipo: r.equipo, pg: r.pg, pc: r.pc }; });
    const sorpresas = fam.C.filter(function (i) { return hw[i] !== P.G[i].favHome; }).length;
    return { id: idEsc, modo: modo, probabilidad: fam.pC * fam.pCond, probabilidadCondicion: fam.pCond, probabilidadDeLaCondicion: fam.pC,
             sorpresas: sorpresas, via: ev.via || 'ganadores', exigencia: ev.exigencia || null,
             necesarios: necesarios, libres: P.G.map(function (_, i) { return i; }).filter(function (i) { return !enC.has(i); }),
             marcadores: marcadores, desempate: ev.desempate || null, tablaFinal: tabla, completaciones: null };
  }

  // ==========================================================================
  // Situación del equipo y análisis completo
  // ==========================================================================
  function situacionEquipo(exacto, pMC, o) {
    if (exacto) {
      if (exacto.filo.n === 0 && exacto.fuera.n === 0) return 'clasificado';
      if (exacto.seguro.n === 0 && exacto.filo.n === 0) return 'eliminado';
      if (exacto.seguro.n === 0) return 'solo_desempate';
    }
    if (pMC >= o.umbralFavorito) return 'favorito';
    if (pMC <= o.umbralCasiEliminado) return 'casi_eliminado';
    return 'burbuja';
  }

  function analizar(datos, opciones, ctxIn) {
    const ctx = ctxPorDefecto(ctxIn), o = Object.assign({}, DEF, opciones || {});
    const t0 = Date.now(), adv = [];
    const jj = datos.d14_2026.jornadas_jugadas;
    const meta0 = { equipo: o.equipo, jornadasJugadas: jj, parametros: o };
    if (jj < o.jornadaMin) return { meta: meta0, estado: 'fuera_de_rango', mensaje: 'Disponible a partir de la Jornada ' + o.jornadaMin + ' concluida.' };
    if (jj > o.jornadaMax) return { meta: meta0, estado: 'fuera_de_rango', mensaje: 'La temporada regular ya concluyó.' };
    ctx.progreso('preparando', 0);
    const P = prepararProblema(datos, o);
    const T = P.idx[o.equipo];
    if (T === undefined) throw new Error('Equipo no encontrado en 14 Grandes: ' + o.equipo);
    const obj = Object.assign({}, o.objetivo || OBJETIVO_PLAYOFFS);
    const rng = crearRng(o.semilla + T * 7919 + jj);
    const nVar = P.G.filter(function (x) { return !x.forzado; }).length;
    const meta = { equipo: o.equipo, jornadasJugadas: jj, nPendientes: P.n, nVariables: nVar, aplazados: P.G.filter(function (x) { return x.aplazado; }).length,
                   parametros: { sigma: o.sigma || PRED.SIGMA_MARGEN[P.conferencia], pMin: o.pMin != null ? o.pMin : PRED.P_MIN, pMax: o.pMax != null ? o.pMax : PRED.P_MAX,
                                 sims: o.sims, semilla: o.semilla, K: o.K }, advertencias: adv };

    // Enumeración exacta (cotas)
    ctx.progreso('enumeracion', 0);
    const exacto = enumerarExacto(P, T, obj, null, ctx);
    if (!exacto) adv.push('No se calcularon las cotas exactas (demasiados juegos libres o cancelado).');

    // Monte Carlo
    ctx.progreso('montecarlo', 0);
    const mc = monteCarloCompleto(P, T, obj, rng, ctx);
    ctx.progreso('victorias', 0);
    const tabVict = tablaVictoriasPropias(P, T, obj, mc.propios, rng);
    const situacion = situacionEquipo(exacto, mc.p, o);
    const resultado = {
      meta: meta, estado: 'ok', situacion: situacion,
      probabilidad: { p: mc.p, ic95: mc.ic95, metodo: 'montecarlo',
                      cotasExactas: exacto ? { min: exacto.seguro.p, max: exacto.seguro.p + exacto.filo.p } : null },
      exacto: exacto, distribucionPosicion: mc.distribucionPosicion, victoriasEsperadas: mc.victoriasEsperadas,
      porVictoriasPropias: tabVict, juegosClave: mc.juegosClave, juegosClaveOtros: mc.juegosClaveOtros,
      escenarios: [], busqueda: null
    };

    // Búsqueda de escenarios (no aplica si ya está decidido o es prácticamente seguro)
    if (situacion === 'clasificado' || situacion === 'eliminado') { ctx.progreso('listo', 1); resultado.meta.ms = Date.now() - t0; return resultado; }
    if (situacion === 'favorito' && mc.p >= o.umbralPracticamenteSeguro) {
      resultado.busqueda = { omitida: true, motivo: 'practicamente_clasificado' };
      ctx.progreso('listo', 1); resultado.meta.ms = Date.now() - t0; return resultado;
    }
    if (situacion === 'casi_eliminado') P.o = Object.assign({}, P.o, { maxMsBusqueda: Math.min(P.o.maxMsBusqueda, o.maxMsCasiEliminado) });

    function buscarEnModo(modo) {
      const cumple = function (hw) { return evaluarVector(P, hw, T, obj, modo).cumple; };
      const condiciones = [], familias = [];
      const extra = {
        subsumido: function (hw) { return condiciones.some(function (c) { return c.length > 0 && c.every(function (i) { return hw[i] === c.hw[i]; }); }); },
        alEncontrar: function (hw) {
          const fam = construirFamilia(P, T, obj, modo, hw, rng, cumple);
          const cond = fam.C.slice(); cond.hw = hw; condiciones.push(cond);
          fam.hw = hw; familias.push(fam);
          return { guardar: false, detener: fam.C.length === 0 || familias.length >= o.K + 3 };
        }
      };
      ctx.progreso('busqueda', 0);
      const bus = buscarVectores(P, cumple, o.K + 3, ctx, extra);
      return { familias: familias, bus: bus };
    }

    let modo = situacion === 'favorito' ? 'riesgo' : 'clasificar';
    let b = buscarEnModo(modo);
    // Si con los resultados esperados el equipo YA clasifica sin condiciones (escenario vacío),
    // lo útil es mostrar qué podría hacerlo fallar.
    if (modo === 'clasificar' && b.familias.length === 1 && b.familias[0].C.length === 0 && Date.now() - t0 < o.presupuestoTotalMs) {
      modo = 'riesgo'; resultado.modoAutomatico = true; b = buscarEnModo(modo);
    }
    resultado.modo = modo;
    resultado.busqueda = { expansiones: b.bus.expansiones, ms: b.bus.ms, parcial: b.bus.parcial };
    if (b.bus.parcial) adv.push('Búsqueda parcial: se agotó el presupuesto de tiempo o expansiones.');
    ctx.progreso('escenarios', 0);
    const fams = b.familias.sort(function (a, c) { return c.pC * c.pCond - a.pC * a.pCond; }).slice(0, o.K);
    resultado.escenarios = fams.map(function (f, i) {
      const esc = escenarioDesdeFamilia(P, T, obj, modo, f, f.hw, i + 1);
      if (Date.now() - t0 < o.presupuestoTotalMs) {
        const fijos = new Map(); f.C.forEach(function (id) { fijos.set(id, !!f.hw[id]); });
        const ex = enumerarExacto(P, T, obj, fijos, { progreso: function () {}, cancelado: ctx.cancelado });
        if (ex && ex.libres <= o.verificarCompletacionesMaxF) esc.completaciones = { pSeguro: ex.seguro.p, pFilo: ex.filo.p, pFuera: ex.fuera.p, libres: ex.libres };
      }
      return esc;
    });
    resultado.meta.ms = Date.now() - t0;
    ctx.progreso('listo', 1);
    return resultado;
  }

  const API = {
    DEF: DEF, OBJETIVO_PLAYOFFS: OBJETIVO_PLAYOFFS, SEGURO: SEGURO, FILO: FILO, FUERA: FUERA,
    crearRng: crearRng, probit: probit,
    prepararProblema: prepararProblema, ganadoresFavoritos: ganadoresFavoritos, victorias: victorias,
    marcadoresBase: marcadoresBase, tablaFinal: tablaFinal, posicionDe: posicionDe,
    clasificarVictorias: clasificarVictorias, enumerarExacto: enumerarExacto,
    crearSimulador: crearSimulador, probabilidadQ: probabilidadQ, monteCarloCompleto: monteCarloCompleto,
    resolverDesempate: resolverDesempate, optimizarMarcadores: optimizarMarcadores,
    evaluarVector: evaluarVector, buscarVectores: buscarVectores, construirFamilia: construirFamilia,
    analizar: analizar
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; } else { global.ONEFA_ESC = API; }
})(typeof window !== 'undefined' ? window : globalThis);
