/* ============================================================================
   escenarios-nacional.js — Escenarios de clasificación a playoffs (Conferencia Nacional)
   ============================================================================
   Responde: "¿qué tiene que pasar para que el equipo X clasifique a playoffs?"
   Ver plan-nacional.md para el diseño completo. Misma arquitectura que escenarios.js
   (14 Grandes): enumeración exacta → Monte Carlo → búsqueda best-first →
   marcadores de desempate. Aquí solo vive lo que cambia en Nacional:

   · Clasifican el 1.º y 2.º de cada uno de los 3 grupos + los 2 mejores terceros.
   · Todos los equipos juegan los mismos juegos oficiales y la liga ordena por
     partidos ganados (PG), así que TODO el motor trabaja con victorias.
   · Desempate (regla de ONEFA, ONEFA_PRED.ordenarEmpatados): quien venció a todos los
     demás empatados va primero; el resto, por menor puntaje en contra (PC). Entre los
     3 terceros (de grupos distintos) se compara por PG y luego por menor PC.
   · Toda tabla final sale de ONEFA_PRED.calcularStandingsNacional: aquí NO se
     reimplementa la regla de clasificación (solo una versión rápida "por victorias"
     para la enumeración, siempre verificada contra la tabla real en la capa de marcadores).

   REUSO: lo genérico se toma de escenarios.js (ONEFA_ESC): RNG, probit, victorias,
   marcadoresBase, optimizarMarcadores y la búsqueda best-first (buscarVectores).
   Por eso escenarios.js debe cargarse ANTES que este archivo.

   Temporadas: no hay año escrito a mano. Se usa el JSON "dnac_<año>" más reciente que venga
   en `datos` y la última jornada regular sale de los juegos (jornadaMax = última − 1).
   OJO 2027: ONEFA_PRED.construirModelosPorConferencia hoy lee dnac_2026/dnac_2025; al
   agregar una temporada nueva hay que actualizarlo ahí (ver CLAUDE.md), no aquí.

   Módulo PURO (sin DOM): funciona en Node, en el navegador y en un Web Worker.
   ============================================================================ */
(function (global) {
  'use strict';

  const NODE = (typeof module !== 'undefined' && module.exports);
  const PRED = NODE ? require('./prediccion.js') : global.ONEFA_PRED;
  const ESC  = NODE ? require('./escenarios.js')  : global.ONEFA_ESC;
  if (!PRED || !ESC) throw new Error('escenarios-nacional.js necesita prediccion.js y escenarios.js cargados antes');

  const SEGURO = ESC.SEGURO, FILO = ESC.FILO, FUERA = ESC.FUERA;
  const crearRng = ESC.crearRng, probit = ESC.probit, victorias = ESC.victorias,
        marcadoresBase = ESC.marcadoresBase, ganadoresFavoritos = ESC.ganadoresFavoritos,
        optimizarMarcadores = ESC.optimizarMarcadores, buscarVectores = ESC.buscarVectores;

  // ==========================================================================
  // PARÁMETROS (sobrescribibles vía opciones). Se heredan los de 14G salvo lo medido en Nacional.
  // ==========================================================================
  const DEF = Object.assign({}, ESC.DEF, {
    conferencia: 'nacional',
    jornadaMin: 6,
    jornadaMax: null,       // null = última jornada regular − 1 (se deriva de los datos)
    sigmaTotal: 12.4,       // medido en Nacional 2026: SD del residuo de los puntos totales vs predecirPartido
    sigmaPuntos: 15.0,      // medido en Nacional 2025+2026: SD de los puntos de un equipo por juego (sin forfaits)
    maxPuntos: 70,          // máximo de puntos de un equipo observado en juegos oficiales de Nacional 2025+2026
    semilla: 20261029
  });

  function ctxPorDefecto(ctx) {
    return Object.assign({ progreso: function () {}, cancelado: function () { return false; } }, ctx || {});
  }

  // ==========================================================================
  // Datos de la temporada actual (sin años escritos a mano)
  // ==========================================================================
  function datosNacionalActual(datos) {
    let json = null, anio = -1;
    Object.keys(datos).forEach(function (k) {
      const m = /^dnac_(\d{4})$/.exec(k);
      if (m && +m[1] > anio && datos[k] && datos[k].grupos) { anio = +m[1]; json = datos[k]; }
    });
    return { json: json, anio: anio };
  }
  function ultimaJornada(json) {
    let u = 0; json.juegos.forEach(function (g) { if (g.jornada > u) u = g.jornada; });
    return u;
  }

  // ==========================================================================
  // Etapa 0 y 1 — Preparación del problema y probabilidades por juego
  // ==========================================================================
  function prepararProblema(datos, opciones) {
    const o = Object.assign({}, DEF, opciones || {});
    const act = datosNacionalActual(datos), d = act.json;
    if (!d) throw new Error('No hay datos de Conferencia Nacional (dnac_<año>) en `datos`');
    const jj = d.jornadas_jugadas;
    const modelo = PRED.construirModelosPorConferencia(datos).modeloNac;
    const nombresGrupo = Object.keys(d.grupos);
    if (nombresGrupo.length !== 3) throw new Error('El motor de Nacional supone 3 grupos (top 2 + 2 mejores terceros)');

    const equipos = [], idx = {}, grupoDe = [], miembros = nombresGrupo.map(function () { return []; });
    nombresGrupo.forEach(function (gn, gi) {
      d.grupos[gn].forEach(function (t) { idx[t] = equipos.length; miembros[gi].push(equipos.length); grupoDe.push(gi); equipos.push(t); });
    });
    const nEq = equipos.length;
    const adv = [];

    // Pendiente = jornada posterior a jj O sin marcador (incluye aplazados). Se conserva el orden
    // original de los juegos: getDirecto toma el PRIMER juego entre dos equipos.
    const todos = d.juegos, jugados = [], pend = [], posPend = [];
    todos.forEach(function (g, k) { if (PRED.esPendiente(g, jj)) { pend.push(g); posPend.push(k); } else jugados.push(g); });

    const cuenta = function (g, t) { return !g.cuentaSoloPara || g.cuentaSoloPara.indexOf(t) >= 0; };
    const base = new Int8Array(nEq), pcBase = new Float64Array(nEq), pj = new Int16Array(nEq), pendientesDe = new Int16Array(nEq);
    todos.forEach(function (g) {
      const iL = idx[g.local], iV = idx[g.visita];
      if (iL === undefined || iV === undefined) return;
      if (cuenta(g, g.local)) pj[iL]++;
      if (cuenta(g, g.visita)) pj[iV]++;
    });
    jugados.forEach(function (g) {
      const sl = g.scoreLocal, sv = g.scoreVisita, iL = idx[g.local], iV = idx[g.visita];
      if (iL === undefined || iV === undefined || sl + sv === 0 || sl === sv) return;
      if (cuenta(g, g.local))  { pcBase[iL] += sv; if (sl > sv) base[iL]++; }
      if (cuenta(g, g.visita)) { pcBase[iV] += sl; if (sv > sl) base[iV]++; }
    });
    pend.forEach(function (g) {
      if (g.cuentaSoloPara) adv.push('Un juego pendiente trae cuentaSoloPara: el motor no lo modela (suma victoria a ambos).');
      if (idx[g.local] !== undefined) pendientesDe[idx[g.local]]++;
      if (idx[g.visita] !== undefined) pendientesDe[idx[g.visita]]++;
    });
    // Aserción de juegos iguales: el motor ordena por PG; la tabla de la app ordena por %.
    let pjDistinto = false; for (let t = 1; t < nEq; t++) if (pj[t] !== pj[0]) pjDistinto = true;
    if (pjDistinto) adv.push('Los equipos no terminan con los mismos juegos oficiales: el motor ordena por victorias y la tabla de la app por porcentaje; el resultado puede diferir.');

    // Resultado directo (mismo criterio que getDirecto: el PRIMER juego entre la pareja).
    // pk: 0 sin juego · 1 jugado (pv = 1/-1/0 desde la óptica de a) · 2 pendiente (pv = id del juego)
    const pk = new Uint8Array(nEq * nEq), pv = new Int16Array(nEq * nEq);
    let ip = 0;
    todos.forEach(function (g) {
      const a = idx[g.local], b = idx[g.visita];
      if (a === undefined || b === undefined) return;
      const esPend = PRED.esPendiente(g, jj);
      const id = esPend ? ip++ : -1;
      if (pk[a * nEq + b] !== 0) return;
      if (esPend) { pk[a * nEq + b] = pk[b * nEq + a] = 2; pv[a * nEq + b] = pv[b * nEq + a] = id; }
      else {
        const r = g.scoreLocal === g.scoreVisita ? 0 : (g.scoreLocal > g.scoreVisita ? 1 : -1);
        pk[a * nEq + b] = pk[b * nEq + a] = 1; pv[a * nEq + b] = r; pv[b * nEq + a] = -r;
      }
    });

    const popc = { conferencia: 'nacional', sigma: o.sigma || undefined };
    if (o.pMin != null) popc.pMin = o.pMin;
    if (o.pMax != null) popc.pMax = o.pMax;
    const G = pend.map(function (g, id) {
      const pv2 = PRED.probabilidadVictoria(g.local, g.visita, modelo, popc);
      const pr = PRED.predecirPartido(g.local, g.visita, modelo);
      let a = pr.scoreLocal, b = pr.scoreVisita;
      if (a === b) a++;                                   // sin empates
      const pHome = pv2.p, pf = Math.max(pHome, 1 - pHome);
      const iL = idx[g.local], iV = idx[g.visita];
      return {
        id: id, g: g, jornada: g.jornada, local: g.local, visita: g.visita,
        iL: iL, iV: iV, aplazado: g.jornada <= jj, cruce: grupoDe[iL] !== grupoDe[iV],
        mu: pv2.mu, pHome: pHome, favHome: pHome >= 0.5, pf: pf, forzado: pv2.forzado,
        costo: pv2.forzado ? Infinity : Math.log(pf / (1 - pf)),
        predHome: a > b, a: a, b: b
      };
    });
    o.jornadaMax = (o.jornadaMax != null) ? o.jornadaMax : ultimaJornada(d) - 1;
    const gruposObj = {}; nombresGrupo.forEach(function (gn) { gruposObj[gn] = d.grupos[gn].slice(); });
    return { o: o, conferencia: 'nacional', anio: act.anio, jj: jj, ultima: ultimaJornada(d), modelo: modelo,
             equipos: equipos, idx: idx, nEq: nEq, nombresGrupo: nombresGrupo, grupoDe: grupoDe, miembros: miembros,
             gruposObj: gruposObj, todos: todos, posPend: posPend, jugados: jugados, G: G, n: G.length,
             base: base, pcBase: pcBase, pj: pj, pendientesDe: pendientesDe, pk: pk, pv: pv,
             emp: new Int16Array(nEq), adv: adv, excluidos: PRED.EQUIPOS_EXCLUIDOS || [] };
  }

  // Juegos de la temporada completa (orden original) con los marcadores de los pendientes
  function juegosCompletos(P, sl, sv) {
    const out = P.todos.slice();
    for (let i = 0; i < P.n; i++) {
      const x = P.G[i];
      out[P.posPend[i]] = { jornada: x.jornada, local: x.local, visita: x.visita, scoreLocal: sl[i], scoreVisita: sv[i] };
    }
    return out;
  }
  function tablaFinal(P, sl, sv) { return PRED.calcularStandingsNacional(P.gruposObj, juegosCompletos(P, sl, sv)); }

  // Estado de un equipo en una tabla final: { clasifica, grupo, posGrupo (1..n), via }
  function estadoDe(P, res, T) {
    const nombre = P.equipos[T], gn = P.nombresGrupo[P.grupoDe[T]], rows = res.allRows[gn];
    let pos = -1; for (let i = 0; i < rows.length; i++) if (rows[i].equipo === nombre) { pos = i + 1; break; }
    let enSeeds = false; for (let i = 0; i < res.seeds.length; i++) if (res.seeds[i].equipo === nombre) { enSeeds = true; break; }
    return { clasifica: enSeeds, grupo: gn, posGrupo: pos, via: pos <= 2 ? 'top2' : (enSeeds ? 'comodin' : 'fuera') };
  }

  // ==========================================================================
  // Clasificación rápida con SOLO victorias y ganadores (plan-nacional §4.3)
  //   SEGURO: clasifica pase lo que pase con los marcadores
  //   FUERA : no clasifica pase lo que pase con los marcadores
  //   FILO  : depende de un desempate por PC (necesita marcadores)
  // El resultado directo SÍ se resuelve aquí: con los ganadores fijos ya se conoce.
  // `info` (opcional) recibe { empGrupo, barrido: 0 nadie · 1 T · 2 otro } para etiquetar la vía.
  // ==========================================================================
  function h2h(P, hw, a, b) {
    const k = a * P.nEq + b, t = P.pk[k];
    if (t === 0) return 0;
    if (t === 1) return P.pv[k];
    const i = P.pv[k], x = P.G[i];
    return ((x.iL === a) === !!hw[i]) ? 1 : -1;
  }
  function tercerMayor(P, W, h) {
    let a = -1, b = -1, c = -1;
    const mem = P.miembros[h];
    for (let k = 0; k < mem.length; k++) {
      const w = W[mem[k]];
      if (w > a) { c = b; b = a; a = w; } else if (w > b) { c = b; b = w; } else if (w > c) c = w;
    }
    return c;
  }
  function evaluarVictoriasNac(P, W, hw, T, info) {
    const g = P.grupoDe[T], wT = W[T], mem = P.miembros[g], emp = P.emp;
    let A = 0, nEmp = 0;
    for (let k = 0; k < mem.length; k++) {
      const u = mem[k]; if (u === T) continue;
      const w = W[u];
      if (w > wT) A++; else if (w === wT) emp[nEmp++] = u;
    }
    let mejor = A + 1, peor = A + nEmp + 1, barrido = 0;
    if (nEmp > 0) {
      // ¿alguien venció a TODOS los demás empatados (T incluido)? va primero; el resto, por PC
      let tBarre = true;
      for (let k = 0; k < nEmp; k++) if (h2h(P, hw, T, emp[k]) !== 1) { tBarre = false; break; }
      let barredor = -1;
      if (tBarre) { barrido = 1; mejor = peor = A + 1; }
      else {
        for (let a = 0; a < nEmp && barredor < 0; a++) {
          const ua = emp[a];
          let ok = h2h(P, hw, ua, T) === 1;
          for (let b = 0; b < nEmp && ok; b++) if (b !== a && h2h(P, hw, ua, emp[b]) !== 1) ok = false;
          if (ok) barredor = ua;
        }
        if (barredor >= 0) { barrido = 2; mejor = A + 2; }
        // Si T y todos los empatados ya no tienen juegos pendientes su PC es fijo: lugar exacto
        let fijos = P.pendientesDe[T] === 0;
        for (let k = 0; k < nEmp && fijos; k++) if (P.pendientesDe[emp[k]] !== 0) fijos = false;
        if (fijos) {
          const pcT = P.pcBase[T]; let menor = 0, igual = 0;
          for (let k = 0; k < nEmp; k++) { const u = emp[k]; if (u === barredor) continue; const pu = P.pcBase[u]; if (pu < pcT) menor++; else if (pu === pcT) igual++; }
          mejor = A + 1 + (barredor >= 0 ? 1 : 0) + menor; peor = mejor + igual;
        }
      }
    }
    if (info) { info.empGrupo = nEmp > 0; info.barrido = barrido; }
    if (mejor > 3) return FUERA;                     // ni con todos los desempates a favor
    if (peor <= 2) return SEGURO;                    // top 2 pase lo que pase
    // Carrera por el comodín: pasan 2 de los 3 terceros; T (3.º) clasifica si no es el peor
    let leGana = false, leEmpata = false;
    for (let h = 0; h < 3; h++) {
      if (h === g) continue;
      const t3 = tercerMayor(P, W, h);
      if (t3 < wT) leGana = true;
      if (t3 <= wT) leEmpata = true;
    }
    const optimista = (mejor <= 2) || (mejor === 3 && leEmpata);
    const pesimista = (peor <= 2) || (peor === 3 && leGana);
    return pesimista ? SEGURO : (optimista ? FILO : FUERA);
  }

  // ==========================================================================
  // Enumeración exacta con código Gray (solo ganadores). Con `fijos` (Map id→bool)
  // calcula la distribución CONDICIONADA a esos resultados.
  // ==========================================================================
  function enumerarExacto(P, T, fijos, ctxIn) {
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
    const total = Math.pow(2, m), paso = 1 << 18;
    const cnt = [0, 0, 0], pr = [0, 0, 0];
    const hl = new Uint8Array(m);
    for (let k = 0; k < total; k++) {
      if (k > 0) {
        const b = 31 - Math.clz32(k & -k);
        if (hl[b]) { hl[b] = 0; hw[libres[b]] = 0; W[iLs[b]]--; W[iVs[b]]++; prod /= ratio[b]; }
        else       { hl[b] = 1; hw[libres[b]] = 1; W[iLs[b]]++; W[iVs[b]]--; prod *= ratio[b]; }
        if ((k & (paso - 1)) === 0) { ctx.progreso('enumeracion', k / total); if (ctx.cancelado()) return null; }
      }
      const c = evaluarVictoriasNac(P, W, hw, T, null);
      cnt[c]++; pr[c] += prod;
    }
    return { libres: m, total: total,
             seguro: { n: cnt[SEGURO], p: pr[SEGURO] }, filo: { n: cnt[FILO], p: pr[FILO] }, fuera: { n: cnt[FUERA], p: pr[FUERA] } };
  }

  // ==========================================================================
  // Monte Carlo: ganadores con p acotada y marcadores plausibles; el estado del equipo sale de
  // la tabla completa (misma regla de la app). El muestreo es una copia de crearSimulador (14G):
  // allí posicion() está atada a calcularStandings14G y no se puede inyectar sin tocar ese módulo.
  // ==========================================================================
  function crearSimulador(P, T, rng) {
    const o = P.o, n = P.n, MAXP = o.maxPuntos, sigT = o.sigmaTotal;
    const sigma = o.sigma || PRED.SIGMA_MARGEN.nacional;
    const sim = P.todos.map(function (g) { return { jornada: g.jornada, local: g.local, visita: g.visita, scoreLocal: g.scoreLocal, scoreVisita: g.scoreVisita, cuentaSoloPara: g.cuentaSoloPara }; });
    const ref = P.posPend.map(function (k) { return sim[k]; });
    const hw = new Uint8Array(n);
    let spare = null;
    function normal() {
      if (spare !== null) { const s = spare; spare = null; return s; }
      let u = 0, v = 0; while (u === 0) u = rng(); v = rng();
      const r = Math.sqrt(-2 * Math.log(u));
      spare = r * Math.sin(2 * Math.PI * v);
      return r * Math.cos(2 * Math.PI * v);
    }
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
        const g = ref[i];
        if (gl) { g.scoreLocal = sw; g.scoreVisita = sp; } else { g.scoreLocal = sp; g.scoreVisita = sw; }
      }
    }
    function estado() { return estadoDe(P, PRED.calcularStandingsNacional(P.gruposObj, sim), T); }
    return { muestrear: muestrear, estado: estado, hw: hw };
  }

  function probabilidadQ(P, T, N, rng, forzados) {
    const S = crearSimulador(P, T, rng);
    let ok = 0;
    for (let s = 0; s < N; s++) { S.muestrear(forzados); if (S.estado().clasifica) ok++; }
    return ok / N;
  }

  // relación de un juego con el equipo: propio · mi_grupo · carrera_comodin (ningún equipo de su grupo)
  function relacionJuego(P, T, x) {
    if (x.iL === T || x.iV === T) return 'propio';
    const g = P.grupoDe[T];
    return (P.grupoDe[x.iL] === g || P.grupoDe[x.iV] === g) ? 'mi_grupo' : 'carrera_comodin';
  }

  function monteCarloCompleto(P, T, rng, ctxIn) {
    const ctx = ctxPorDefecto(ctxIn), N = P.o.sims, n = P.n;
    const S = crearSimulador(P, T, rng);
    const tam = P.miembros[P.grupoDe[T]].length;
    const propios = []; P.G.forEach(function (x, i) { if (x.iL === T || x.iV === T) propios.push(i); });
    const mT = propios.length;
    const posHist = new Array(tam + 1).fill(0), via = { top2: 0, comodin: 0, fuera: 0 };
    const nL = new Float64Array(n), qL = new Float64Array(n), nV = new Float64Array(n), qV = new Float64Array(n);
    let ok = 0, sumaVict = 0, hechas = 0;
    for (let s = 0; s < N; s++) {
      S.muestrear(null);
      const e = S.estado(); posHist[e.posGrupo]++; via[e.via]++;
      const q = e.clasifica; if (q) ok++;
      for (let i = 0; i < n; i++) { if (S.hw[i]) { nL[i]++; if (q) qL[i]++; } else { nV[i]++; if (q) qV[i]++; } }
      let k = 0; for (let j = 0; j < mT; j++) { const x = P.G[propios[j]]; if ((x.iL === T) === !!S.hw[propios[j]]) k++; }
      sumaVict += k; hechas++;
      if ((s & 1023) === 1023) { ctx.progreso('montecarlo', s / N); if (ctx.cancelado()) break; }
    }
    const p = ok / hechas, ic = 1.96 * Math.sqrt(Math.max(p * (1 - p), 1e-9) / hechas);
    const clave = [];
    for (let i = 0; i < n; i++) {
      if (P.G[i].forzado || nL[i] < 150 || nV[i] < 150) continue;
      const impacto = qL[i] / nL[i] - qV[i] / nV[i];
      const x = P.G[i];
      clave.push({ juegoId: i, jornada: x.jornada, local: x.local, visita: x.visita, aplazado: x.aplazado,
                   propio: (x.iL === T || x.iV === T), relacion: relacionJuego(P, T, x), cruce: x.cruce,
                   pLocal: x.pHome, impacto: impacto, resultadoQueAyuda: impacto >= 0 ? 'local' : 'visita' });
    }
    clave.sort(function (a, b) { return Math.abs(b.impacto) - Math.abs(a.impacto); });
    return { N: hechas, p: p, ic95: [Math.max(0, p - ic), Math.min(1, p + ic)],
             juegosClaveOtros: clave.filter(function (c) { return !c.propio; }).slice(0, 5),
             distribucionGrupo: posHist.slice(1).map(function (c) { return c / hechas; }),
             viaClasificacion: { top2: via.top2 / hechas, comodin: via.comodin / hechas, fuera: via.fuera / hechas },
             victoriasEsperadas: P.base[T] + sumaVict / hechas, juegosClave: clave.slice(0, 6), propios: propios };
  }

  // Tabla "según tus victorias propias": P(clasifica | T gana exactamente k de sus m pendientes)
  function tablaVictoriasPropias(P, T, propios, rng) {
    const m = propios.length, N = P.o.simsVictorias, filas = [];
    if (m === 0) return filas;
    const S = crearSimulador(P, T, rng);
    const pT = propios.map(function (i) { const x = P.G[i]; return x.iL === T ? x.pHome : 1 - x.pHome; });
    let dist = [1];
    pT.forEach(function (p) { const nd = new Array(dist.length + 1).fill(0); dist.forEach(function (v, k) { nd[k] += v * (1 - p); nd[k + 1] += v * p; }); dist = nd; });
    for (let k = 0; k <= m; k++) {
      let ok = 0;
      for (let s = 0; s < N; s++) {
        let sel = null;
        for (let t = 0; t < 300 && !sel; t++) {
          const v = pT.map(function (p) { return rng() < p; });
          if (v.filter(Boolean).length === k) sel = v;
        }
        if (!sel) { const ids = propios.map(function (_, j) { return j; }); for (let j = ids.length - 1; j > 0; j--) { const r = Math.floor(rng() * (j + 1)); const tmp = ids[j]; ids[j] = ids[r]; ids[r] = tmp; } sel = new Array(m).fill(false); for (let j = 0; j < k; j++) sel[ids[j]] = true; }
        const forz = new Map();
        propios.forEach(function (gi, j) { const x = P.G[gi]; forz.set(gi, x.iL === T ? sel[j] : !sel[j]); });
        S.muestrear(forz);
        if (S.estado().clasifica) ok++;
      }
      filas.push({ victorias: k, de: m, probabilidadDeEsaCantidad: dist[k], p: ok / N, sims: N });
    }
    return filas;
  }

  // ==========================================================================
  // Capa 2 — marcadores que resuelven un desempate por PC (plan-nacional §4.8)
  // Método genérico: rivales con las mismas victorias → subconjuntos → optimizarMarcadores
  // → verificación con la tabla real (no puede haber falsos positivos).
  // ==========================================================================
  function combinaciones(arr, k) {
    const out = [];
    (function rec(s, cur) {
      if (cur.length === k) { out.push(cur.slice()); return; }
      for (let i = s; i < arr.length && out.length < 400; i++) { cur.push(arr[i]); rec(i + 1, cur); cur.pop(); }
    })(0, []);
    return out;
  }
  function exigenciaDe(devMax) { return devMax < 0.5 ? 'facil' : (devMax < 1.5 ? 'exigente' : 'muy_exigente'); }

  function viaDe(info) { return (info.empGrupo && info.barrido !== 1) ? 'desempate_pc' : 'desempate_comodin'; }

  function resolverDesempate(P, hw, T) {
    const W = victorias(P, hw), base = marcadoresBase(P, hw), info = {};
    evaluarVictoriasNac(P, W, hw, T, info);
    const via = viaDe(info);
    // rivales: mismas victorias que T; primero los de su grupo
    // Rivales RELEVANTES: los empatados de su grupo y, de otros grupos, solo quien pelea el comodín
    // con él (un equipo con sus mismas victorias que es el 3.º de su grupo).
    const g = P.grupoDe[T], R = [], terc = [];
    for (let h = 0; h < 3; h++) terc.push(tercerMayor(P, W, h));
    for (let t = 0; t < P.nEq; t++) {
      if (t === T || W[t] !== W[T]) continue;
      if (P.grupoDe[t] === g || terc[P.grupoDe[t]] === W[t]) R.push(t);
    }
    R.sort(function (a, b) { return ((P.grupoDe[a] === g) ? 0 : 1) - ((P.grupoDe[b] === g) ? 0 : 1); });
    const desempateInfo = function (sl, sv) {
      const pc = Float64Array.from(P.pcBase);
      for (let i = 0; i < P.n; i++) { const x = P.G[i]; pc[x.iL] += sv[i]; pc[x.iV] += sl[i]; }
      return { grupo: [P.equipos[T]].concat(R.map(function (t) { return P.equipos[t]; })), pcEquipo: pc[T],
               pcRivales: R.map(function (t) { return { equipo: P.equipos[t], pc: pc[t], mismoGrupo: P.grupoDe[t] === g }; }) };
    };
    // atajo: con los marcadores esperados ya clasifica
    if (estadoDe(P, tablaFinal(P, base.sl, base.sv), T).clasifica)
      return { ok: true, via: via, sl: base.sl, sv: base.sv, exigencia: 'facil', desempate: desempateInfo(base.sl, base.sv) };
    let mejor = null;
    const Rc = R.slice(0, 6);
    for (let k = 1; k <= Math.min(3, Rc.length) && !mejor; k++) {
      const combos = combinaciones(Rc, k);
      for (let c = 0; c < combos.length && c < 80; c++) {
        const opt = optimizarMarcadores(P, hw, T, combos[c]);
        if (!opt) continue;
        if (mejor && opt.J >= mejor.J) continue;
        if (estadoDe(P, tablaFinal(P, opt.sl, opt.sv), T).clasifica) mejor = opt;
      }
    }
    if (!mejor) return { ok: false };
    return { ok: true, via: via, sl: mejor.sl, sv: mejor.sv, exigencia: exigenciaDe(mejor.devMax), desempate: desempateInfo(mejor.sl, mejor.sv) };
  }

  // Evalúa un vector completo de ganadores.
  //   modo 'clasificar': el equipo clasifica (Q)          modo 'riesgo': el equipo NO clasifica (¬Q)
  function evaluarVector(P, hw, T, modo) {
    const W = victorias(P, hw), info = {}, c = evaluarVictoriasNac(P, W, hw, T, info);
    const viaGanadores = (info.empGrupo && info.barrido === 1) ? 'resultado_directo' : 'ganadores';
    if (modo === 'riesgo') {
      if (c === FUERA) { const b = marcadoresBase(P, hw); return { cumple: true, via: viaGanadores, sl: b.sl, sv: b.sv, exigencia: null }; }
      if (c === SEGURO) return { cumple: false };
      const b = marcadoresBase(P, hw);
      return estadoDe(P, tablaFinal(P, b.sl, b.sv), T).clasifica ? { cumple: false } : { cumple: true, via: viaDe(info), sl: b.sl, sv: b.sv, exigencia: null };
    }
    if (c === FUERA) return { cumple: false };
    if (c === SEGURO) { const b = marcadoresBase(P, hw); return { cumple: true, via: viaGanadores, sl: b.sl, sv: b.sv, exigencia: null }; }
    const r = resolverDesempate(P, hw, T);
    return r.ok ? Object.assign({ cumple: true }, r) : { cumple: false };
  }

  // ==========================================================================
  // Familias de escenarios: condición mínima + probabilidad
  // ==========================================================================
  function ordenCostos(P) {
    const vars = []; for (let i = 0; i < P.n; i++) if (!P.G[i].forzado) vars.push(i);
    vars.sort(function (a, b) { return P.G[a].costo - P.G[b].costo; });
    return vars;
  }
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
  function construirFamilia(P, T, modo, hw, rng, cumple) {
    let C = pivotes(P, hw, cumple);
    const objetivoP = function (forzados, N) { const q = probabilidadQ(P, T, N, rng, forzados); return modo === 'clasificar' ? q : 1 - q; };
    const forzadosDe = function (ids) { const f = new Map(); ids.forEach(function (i) { f.set(i, !!hw[i]); }); return f; };
    let pCond = objetivoP(forzadosDe(C), P.o.simsFamilia);
    let aumentos = 0;
    // A diferencia de 14G, un juego solo se agrega a la condición si mejora la probabilidad MÁS de lo que
    // explica el ruido de la simulación (en Nacional la condición suele depender de PC y de marcadores
    // aleatorios, y sin este umbral se colaban juegos que no influyen).
    const ruido = function (p, N) { return 2.5 * Math.sqrt(2 * Math.max(p * (1 - p), 1e-4) / N); };
    while (pCond < 0.5 && aumentos < 3 && C.length < P.n) {
      let mejor = null;
      const cand = ordenCostos(P).filter(function (i) { return C.indexOf(i) < 0; }).slice(0, 10);
      for (let c = 0; c < cand.length; c++) {
        const pr = objetivoP(forzadosDe(C.concat([cand[c]])), 800);
        if (!mejor || pr > mejor.p) mejor = { i: cand[c], p: pr };
      }
      if (!mejor || mejor.p <= pCond + ruido(pCond, 800)) break;
      const pNueva = objetivoP(forzadosDe(C.concat([mejor.i])), P.o.simsFamilia);
      if (pNueva <= pCond + ruido(pCond, P.o.simsFamilia)) break;
      C = C.concat([mejor.i]); aumentos++; pCond = pNueva;
    }
    C.sort(function (a, b) { return a - b; });
    return { C: C, pCond: pCond, pC: probCondicion(P, hw, C) };
  }

  function nombreGanador(x, hwi) { return hwi ? x.local : x.visita; }

  // Tablas finales de un escenario: 3 tablas de grupo (con marca de clasificación) + los 8 sembrados
  function tablaDeEscenario(P, sl, sv) {
    const res = tablaFinal(P, sl, sv), enSeeds = {};
    res.seeds.forEach(function (r) { enSeeds[r.equipo] = r.seed; });
    const grupos = {};
    P.nombresGrupo.forEach(function (gn) {
      grupos[gn] = res.allRows[gn].map(function (r, i) {
        return { pos: i + 1, equipo: r.equipo, pg: r.pg, pc: r.pc, estado: i < 2 ? 'top2' : (enSeeds[r.equipo] ? 'comodin' : 'fuera') };
      });
    });
    return { grupos: grupos, seeds: res.seeds.map(function (r) { return { pos: r.seed, equipo: r.equipo, grupo: r.grupo, pg: r.pg, pc: r.pc }; }) };
  }

  function escenarioDesdeFamilia(P, T, modo, fam, hwVector, idEsc) {
    const hwBase = ganadoresFavoritos(P), hwLimpio = hwBase.slice();
    fam.C.forEach(function (i) { hwLimpio[i] = hwVector[i]; });
    let ev = evaluarVector(P, hwLimpio, T, modo), hw = hwLimpio;
    if (!ev.cumple) { hw = hwVector; ev = evaluarVector(P, hw, T, modo); }
    const enC = new Set(fam.C);
    const base = marcadoresBase(P, hw);
    const necesarios = fam.C.map(function (i) {
      const x = P.G[i];
      return { juegoId: i, jornada: x.jornada, local: x.local, visita: x.visita, ganador: nombreGanador(x, hw[i]), sorpresa: hw[i] !== x.favHome, aplazado: x.aplazado,
               relacion: relacionJuego(P, T, x), cruce: x.cruce };
    });
    const marcadores = P.G.map(function (x, i) {
      return { juegoId: i, jornada: x.jornada, local: x.local, visita: x.visita, scoreLocal: ev.sl[i], scoreVisita: ev.sv[i],
               rol: enC.has(i) ? 'necesario' : 'libre', sorpresa: hw[i] !== x.favHome, aplazado: x.aplazado, cruce: x.cruce,
               ajustado: ev.sl[i] !== base.sl[i] || ev.sv[i] !== base.sv[i] };
    }).sort(function (a, b) { return a.jornada - b.jornada || a.juegoId - b.juegoId; });
    const sorpresas = fam.C.filter(function (i) { return hw[i] !== P.G[i].favHome; }).length;
    return { id: idEsc, modo: modo, probabilidad: fam.pC * fam.pCond, probabilidadCondicion: fam.pCond, probabilidadDeLaCondicion: fam.pC,
             sorpresas: sorpresas, via: ev.via || 'ganadores', exigencia: ev.exigencia || null,
             necesarios: necesarios, libres: P.G.map(function (_, i) { return i; }).filter(function (i) { return !enC.has(i); }),
             marcadores: marcadores, desempate: ev.desempate || null, tablaFinal: tablaDeEscenario(P, ev.sl, ev.sv), completaciones: null };
  }

  // ==========================================================================
  // Situación del equipo, explicación y análisis completo
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

  // Texto con números concretos para equipos ya decididos (sin simular)
  function explicacionDecidido(P, T, situacion) {
    const m = P.pendientesDe[T], w = P.base[T], pj = P.pj[T];
    const gn = P.nombresGrupo[P.grupoDe[T]];
    if (situacion === 'clasificado')
      return ['Ya estás clasificado a playoffs: con cualquier resultado de los juegos que quedan' + (m ? ' (incluso si pierdes ' + (m === 1 ? 'el tuyo' : 'los ' + m + ' tuyos') + ')' : '') + ' terminas dentro de los 8 de la Conferencia Nacional.'];
    const wMax = w + m;
    return ['Estás eliminado matemáticamente. Llevas ' + w + ' victoria' + (w === 1 ? '' : 's') + (m ? '; aun ganando ' + (m === 1 ? 'tu juego restante' : 'tus ' + m + ' juegos restantes') + ' llegarías a ' + wMax + ' de ' + pj : ' de ' + pj + ' y ya no te quedan juegos') +
            '. En todas las combinaciones posibles de los juegos que faltan quedas fuera del top 2 de ' + gn + ' y de los 2 mejores terceros lugares, sin importar los desempates.'];
  }

  function validarEquipo(P, o) {
    const T = P.idx[o.equipo];
    if (T === undefined) throw new Error('Equipo no encontrado en Conferencia Nacional: ' + o.equipo);
    return T;
  }
  function compuertas(d, o) {
    const jj = d.jornadas_jugadas, jmax = (o.jornadaMax != null) ? o.jornadaMax : ultimaJornada(d) - 1;
    if (jj < o.jornadaMin) return 'Disponible a partir de la Jornada ' + o.jornadaMin + ' concluida.';
    if (jj > jmax) return 'La temporada regular ya concluyó.';
    return null;
  }

  function analizar(datos, opciones, ctxIn) {
    const ctx = ctxPorDefecto(ctxIn), o = Object.assign({}, DEF, opciones || {});
    const t0 = Date.now();
    const act = datosNacionalActual(datos);
    if (!act.json) throw new Error('No hay datos de Conferencia Nacional (dnac_<año>)');
    const jj = act.json.jornadas_jugadas;
    const meta0 = { equipo: o.equipo, jornadasJugadas: jj, parametros: o };
    const msg = compuertas(act.json, o);
    if (msg) return { meta: meta0, estado: 'fuera_de_rango', mensaje: msg };
    if ((PRED.EQUIPOS_EXCLUIDOS || []).indexOf(o.equipo) >= 0)
      return { meta: meta0, estado: 'fuera_de_rango', mensaje: o.equipo + ' no participa en la clasificación (sus juegos se resuelven por default).' };
    ctx.progreso('preparando', 0);
    const P = prepararProblema(datos, o);
    const T = validarEquipo(P, o);
    const rng = crearRng(o.semilla + T * 7919 + jj);
    const adv = P.adv.slice();
    const nVar = P.G.filter(function (x) { return !x.forzado; }).length;
    const meta = { equipo: o.equipo, grupo: P.nombresGrupo[P.grupoDe[T]], jornadasJugadas: jj, jornadaFinal: P.ultima, juegosPorEquipo: P.pj[T],
                   nPendientes: P.n, nVariables: nVar, aplazados: P.G.filter(function (x) { return x.aplazado; }).length,
                   parametros: { sigma: o.sigma || PRED.SIGMA_MARGEN.nacional, pMin: o.pMin != null ? o.pMin : PRED.P_MIN, pMax: o.pMax != null ? o.pMax : PRED.P_MAX,
                                 sims: o.sims, semilla: o.semilla, K: o.K }, advertencias: adv };

    // Enumeración exacta (cotas y prueba de eliminado/clasificado)
    ctx.progreso('enumeracion', 0);
    const exacto = enumerarExacto(P, T, null, ctx);
    if (!exacto) adv.push('No se calcularon las cotas exactas (demasiados juegos libres o cancelado).');

    // Equipos ya decididos: respuesta exacta, sin simular
    const sit0 = situacionEquipo(exacto, 0.5, o);
    if (exacto && (sit0 === 'clasificado' || sit0 === 'eliminado')) {
      const p = sit0 === 'clasificado' ? 1 : 0;
      ctx.progreso('listo', 1);
      meta.ms = Date.now() - t0;
      return { meta: meta, estado: 'ok', situacion: sit0, explicacion: explicacionDecidido(P, T, sit0),
               probabilidad: { p: p, ic95: [p, p], metodo: 'exacto', cotasExactas: { min: p, max: p } }, exacto: exacto,
               distribucionGrupo: null, viaClasificacion: null, victoriasEsperadas: null,
               porVictoriasPropias: [], juegosClave: [], juegosClaveOtros: [], escenarios: [], busqueda: null };
    }

    ctx.progreso('montecarlo', 0);
    const mc = monteCarloCompleto(P, T, rng, ctx);
    ctx.progreso('victorias', 0);
    const tabVict = tablaVictoriasPropias(P, T, mc.propios, rng);
    const situacion = situacionEquipo(exacto, mc.p, o);
    const resultado = {
      meta: meta, estado: 'ok', situacion: situacion, explicacion: null,
      probabilidad: { p: mc.p, ic95: mc.ic95, metodo: 'montecarlo',
                      cotasExactas: exacto ? { min: exacto.seguro.p, max: exacto.seguro.p + exacto.filo.p } : null },
      exacto: exacto, distribucionGrupo: mc.distribucionGrupo, viaClasificacion: mc.viaClasificacion, victoriasEsperadas: mc.victoriasEsperadas,
      porVictoriasPropias: tabVict, juegosClave: mc.juegosClave, juegosClaveOtros: mc.juegosClaveOtros,
      escenarios: [], busqueda: null
    };
    if (situacion === 'favorito' && mc.p >= o.umbralPracticamenteSeguro) {
      resultado.busqueda = { omitida: true, motivo: 'practicamente_clasificado' };
      ctx.progreso('listo', 1); resultado.meta.ms = Date.now() - t0; return resultado;
    }
    if (situacion === 'casi_eliminado') P.o = Object.assign({}, P.o, { maxMsBusqueda: Math.min(P.o.maxMsBusqueda, o.maxMsCasiEliminado) });

    function buscarEnModo(modo) {
      const cumple = function (hw) { return evaluarVector(P, hw, T, modo).cumple; };
      const condiciones = [], familias = [];
      const extra = {
        subsumido: function (hw) { return condiciones.some(function (c) { return c.length > 0 && c.every(function (i) { return hw[i] === c.hw[i]; }); }); },
        alEncontrar: function (hw) {
          const fam = construirFamilia(P, T, modo, hw, rng, cumple);
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
    if (modo === 'clasificar' && b.familias.length === 1 && b.familias[0].C.length === 0 && Date.now() - t0 < o.presupuestoTotalMs) {
      modo = 'riesgo'; resultado.modoAutomatico = true; b = buscarEnModo(modo);
    }
    resultado.modo = modo;
    resultado.busqueda = { expansiones: b.bus.expansiones, ms: b.bus.ms, parcial: b.bus.parcial };
    if (b.bus.parcial) adv.push('Búsqueda parcial: se agotó el presupuesto de tiempo o expansiones.');
    ctx.progreso('escenarios', 0);
    const fams = b.familias.sort(function (a, c) { return c.pC * c.pCond - a.pC * a.pCond; }).slice(0, o.K);
    resultado.escenarios = fams.map(function (f, i) {
      const esc = escenarioDesdeFamilia(P, T, modo, f, f.hw, i + 1);
      if (Date.now() - t0 < o.presupuestoTotalMs) {
        const fijos = new Map(); f.C.forEach(function (id) { fijos.set(id, !!f.hw[id]); });
        const ex = enumerarExacto(P, T, fijos, { progreso: function () {}, cancelado: ctx.cancelado });
        if (ex && ex.libres <= o.verificarCompletacionesMaxF) esc.completaciones = { pSeguro: ex.seguro.p, pFilo: ex.filo.p, pFuera: ex.fuera.p, libres: ex.libres };
      }
      return esc;
    });
    resultado.meta.ms = Date.now() - t0;
    ctx.progreso('listo', 1);
    return resultado;
  }

  // ==========================================================================
  // Panorama: estado exacto de TODOS los equipos (selector con ✓ / ✕ antes de analizar)
  //   'clasificado' | 'eliminado' | 'abierto' | null (sin prueba exacta: demasiados juegos libres)
  // ==========================================================================
  function panorama(datos, opciones, ctxIn) {
    const ctx = ctxPorDefecto(ctxIn), o = Object.assign({}, DEF, opciones || {});
    const act = datosNacionalActual(datos);
    if (!act.json) throw new Error('No hay datos de Conferencia Nacional (dnac_<año>)');
    const msg = compuertas(act.json, o);
    if (msg) return { estado: 'fuera_de_rango', mensaje: msg, equipos: [] };
    const P = prepararProblema(datos, o), out = [];
    const excl = new Set(PRED.EQUIPOS_EXCLUIDOS || []);
    for (let T = 0; T < P.nEq; T++) {
      ctx.progreso('panorama', T / P.nEq);
      if (ctx.cancelado()) break;
      if (excl.has(P.equipos[T])) continue;
      const ex = enumerarExacto(P, T, null, { progreso: function () {}, cancelado: ctx.cancelado });
      let estado = null, min = null, max = null;
      if (ex) {
        min = ex.seguro.p; max = ex.seguro.p + ex.filo.p;
        estado = (ex.filo.n === 0 && ex.fuera.n === 0) ? 'clasificado' : ((ex.seguro.n === 0 && ex.filo.n === 0) ? 'eliminado' : 'abierto');
      }
      out.push({ equipo: P.equipos[T], grupo: P.nombresGrupo[P.grupoDe[T]], estado: estado, min: min, max: max });
    }
    ctx.progreso('listo', 1);
    return { estado: 'ok', jornadasJugadas: act.json.jornadas_jugadas, equipos: out };
  }

  const API = {
    DEF: DEF, datosNacionalActual: datosNacionalActual, ultimaJornada: ultimaJornada,
    prepararProblema: prepararProblema, juegosCompletos: juegosCompletos, tablaFinal: tablaFinal, estadoDe: estadoDe,
    evaluarVictoriasNac: evaluarVictoriasNac, enumerarExacto: enumerarExacto, crearSimulador: crearSimulador,
    probabilidadQ: probabilidadQ, monteCarloCompleto: monteCarloCompleto,
    resolverDesempate: resolverDesempate, evaluarVector: evaluarVector, construirFamilia: construirFamilia,
    analizar: analizar, panorama: panorama
  };
  if (NODE) { module.exports = API; } else { global.ONEFA_ESC_NAC = API; }
})(typeof window !== 'undefined' ? window : globalThis);
