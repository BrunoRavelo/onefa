/* ============================================================================
   prediccion.js — Predicción matemática de marcadores ONEFA (14 Grandes + Nacional)
   ============================================================================
   Método: Massey ratings (margen de puntos) resuelto por mínimos cuadrados,
   con:
     - Sistema UNIFICADO: 14 Grandes y Nacional se resuelven juntos en una sola
       escala, usando las scrimmages 2026 que cruzan ambas conferencias como
       "puente" real entre niveles (así el modelo aprende solo que 14G es más
       fuerte que Nacional, con datos reales, sin que nadie lo capture a mano).
     - Prior de temporada anterior (2025) por equipo, con "shrinkage": pesa
       fuerte en la jornada 1 y su peso baja solo conforme el equipo acumula
       juegos reales en 2026. Ver K_PESO_TEMPORADA_ANTERIOR abajo.
     - Liebres CD Juárez excluido del sistema de ratings por completo (perdió
       todos sus juegos por default 1-0); sus partidos futuros se fuerzan a
       1-0 sin pasar por el modelo.
     - Equipos desaparecidos (ej. Borregos Tec QRO) simplemente no existen en
       el roster 2026, así que nunca entran al cálculo — no requieren código
       especial.

   Este archivo NO tiene resultados precalculados: cada vez que se llama,
   vuelve a leer los 4 JSON (fetch) y recalcula todo desde cero. Funciona
   tanto en navegador (usa fetch) como en Node (para pruebas), vía el patrón
   UMD al final del archivo.
   ============================================================================ */

(function (global) {
  'use strict';

  // ==========================================================================
  // PARÁMETROS AJUSTABLES — todos los "qué tanto pesa X" viven aquí arriba.
  // ==========================================================================

  // Peso del rating de la temporada anterior (2025) al arrancar 2026.
  // Se interpreta como "el prior vale como si el equipo ya hubiera jugado
  // este número de partidos reales en 2026". Con K=3: en la jornada 0 el
  // prior pesa tanto como 3 juegos reales; después de 3 juegos jugados en
  // 2026 ya pesa la mitad que la evidencia nueva; hacia la jornada 8-9 su
  // influencia es casi nula.
  //   - Súbelo (ej. 5-6) si quieres que la app "confíe más" en 2025 y tarde
  //     más en corregirse con resultados nuevos.
  //   - Bájalo (ej. 1-2) si quieres que 2 o 3 jornadas de 2026 basten para
  //     borrar casi todo el efecto de 2025 (útil si sospechas cambios
  //     grandes de plantilla/staff en muchos equipos).
  //   - Ponlo en 0 para ignorar 2025 por completo.
  const K_PESO_TEMPORADA_ANTERIOR = 3;

  // Peso de cada scrimmage (juego de preparación) dentro del sistema de
  // ratings, relativo a un juego oficial de temporada regular (peso 1.0).
  // Son los que conectan 14 Grandes con Nacional en pretemporada, así que
  // son importantes para calibrar el nivel relativo entre conferencias,
  // pero al ser pretemporada no deben pesar igual que un juego oficial.
  const PESO_SCRIMMAGE = 0.3;

  // Ventaja de localía, en puntos, sumada al margen esperado del equipo local.
  const VENTAJA_LOCAL = 3;

  // Ridge de estabilidad numérica (evita sistemas singulares con equipos
  // aislados o sin juegos). Muy pequeño a propósito — no debe notarse en los
  // ratings de equipos con datos reales, solo evita divisiones por cero.
  const RIDGE_ESTABILIDAD = 0.05;

  // Equipo(s) excluido(s) del modelo por completo (deserción / no se
  // presentó). Sus juegos futuros se fuerzan a un marcador fijo.
  const EQUIPOS_EXCLUIDOS = ['Liebres CD Juárez'];
  const MARCADOR_FORZADO_VS_EXCLUIDO = { ganador: 1, excluido: 0 }; // 1-0 en contra del excluido

  // ==========================================================================
  // Álgebra: resolver sistema lineal simétrico por eliminación gaussiana con
  // pivoteo parcial (idéntico en espíritu al solveGauss ya usado en index.html
  // para Colley — se reimplementa aquí para que este archivo sea autónomo).
  // ==========================================================================
  function solveGauss(Ain, bin) {
    const n = bin.length, A = Ain.map(r => [...r]), b = [...bin];
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let i = c + 1; i < n; i++) if (Math.abs(A[i][c]) > Math.abs(A[piv][c])) piv = i;
      if (Math.abs(A[piv][c]) < 1e-12) continue;
      if (piv !== c) { [A[c], A[piv]] = [A[piv], A[c]]; [b[c], b[piv]] = [b[piv], b[c]]; }
      const d = A[c][c];
      for (let j = c; j < n; j++) A[c][j] /= d;
      b[c] /= d;
      for (let i = 0; i < n; i++) {
        if (i === c) continue;
        const f = A[i][c];
        if (!f) continue;
        for (let j = c; j < n; j++) A[i][j] -= f * A[c][j];
        b[i] -= f * b[c];
      }
    }
    return b;
  }

  // Construye ratings Massey (margen esperado de puntos) para un conjunto de
  // equipos, a partir de una lista de juegos ya jugados. Un rating alto ↔
  // el equipo tiende a ganar por más margen contra rivales de nivel dado.
  // Esto YA incorpora "rivales en común" y fuerza de calendario de forma
  // nativa: no hace falta ninguna regla de transitividad manual.
  //
  //   juegos: [{local, visita, scoreLocal, scoreVisita, _peso?}]
  //   priors: { equipoNombre: { valor, peso } } — ancla opcional por equipo.
  function masseyRatings(teams, juegos, priors) {
    priors = priors || {};
    const idx = {};
    teams.forEach((t, i) => { idx[t] = i; });
    const n = teams.length;
    const A = Array.from({ length: n }, () => new Array(n).fill(0));
    const b = new Array(n).fill(0);

    juegos.forEach(g => {
      if (!(g.local in idx) || !(g.visita in idx)) return;
      if ((g.scoreLocal || 0) + (g.scoreVisita || 0) === 0) return; // no jugado
      const w = (g._peso != null) ? g._peso : 1;
      const iL = idx[g.local], iV = idx[g.visita];
      const margen = g.scoreLocal - g.scoreVisita;
      A[iL][iL] += w; A[iV][iV] += w;
      A[iL][iV] -= w; A[iV][iL] -= w;
      b[iL] += w * margen; b[iV] -= w * margen;
    });

    for (let i = 0; i < n; i++) A[i][i] += RIDGE_ESTABILIDAD;

    teams.forEach((t, i) => {
      const p = priors[t];
      if (p && p.peso > 0) { A[i][i] += p.peso; b[i] += p.peso * p.valor; }
    });

    const r = solveGauss(A, b);
    const out = {};
    teams.forEach((t, i) => { out[t] = isFinite(r[i]) ? r[i] : 0; });
    return out;
  }

  // Centra un conjunto de ratings para que su promedio sea 0 — así, al usar
  // el rating 2025 de una liga como "prior" de otra liga en 2026, no se
  // arrastra el nivel absoluto de la liga vieja, solo la posición relativa
  // del equipo DENTRO de su liga vieja.
  function centrar(ratingsObj) {
    const vals = Object.values(ratingsObj);
    if (!vals.length) return {};
    const mean = vals.reduce((a, x) => a + x, 0) / vals.length;
    const out = {};
    Object.keys(ratingsObj).forEach(k => { out[k] = ratingsObj[k] - mean; });
    return out;
  }

  function equiposNacional(json) {
    return Object.values(json.grupos || {}).flat();
  }

  // ==========================================================================
  // Construcción del modelo unificado a partir de los 4 JSON ya parseados.
  // ==========================================================================
  function construirModeloUnificado(datos) {
    const { d14_2025, d14_2026, dnac_2025, dnac_2026 } = datos;

    // ---- 1) Ratings 2025 por liga, cada una centrada en su propio promedio ----
    const teams14_2025 = d14_2025.equipos;
    const ratings14_2025 = centrar(masseyRatings(teams14_2025, d14_2025.juegos));

    const teamsNac_2025 = equiposNacional(dnac_2025);
    const ratingsNac_2025 = centrar(masseyRatings(teamsNac_2025, dnac_2025.juegos));

    const priorMap2025 = Object.assign({}, ratings14_2025, ratingsNac_2025);

    // ---- 2) Roster unificado 2026 (excluyendo equipos fuera del modelo) ----
    const excl = new Set(EQUIPOS_EXCLUIDOS);
    const teams2026 = Array.from(new Set([
      ...d14_2026.equipos,
      ...equiposNacional(dnac_2026)
    ])).filter(t => !excl.has(t));

    // ---- 3) Juegos jugados por equipo en 2026 (para decaer el peso del prior) ----
    const juegosJugados = {};
    teams2026.forEach(t => { juegosJugados[t] = 0; });
    const contarJugados = (juegos, jj) => {
      juegos.forEach(g => {
        if (g.jornada > jj) return;
        if ((g.scoreLocal || 0) + (g.scoreVisita || 0) === 0) return;
        if (g.local in juegosJugados) juegosJugados[g.local]++;
        if (g.visita in juegosJugados) juegosJugados[g.visita]++;
      });
    };
    contarJugados(d14_2026.juegos, d14_2026.jornadas_jugadas);
    contarJugados(dnac_2026.juegos, dnac_2026.jornadas_jugadas);

    // ---- 4) Priors 2026 con shrinkage decayente ----
    const priors2026 = {};
    teams2026.forEach(t => {
      if (t in priorMap2025) {
        const jj = juegosJugados[t] || 0;
        priors2026[t] = {
          valor: priorMap2025[t],
          peso: K_PESO_TEMPORADA_ANTERIOR / (1 + jj)
        };
      }
    });

    // ---- 5) Lista unificada de juegos 2026 (oficiales + scrimmages puente) ----
    const juegosUnificados = [];
    const agregarOficiales = (juegos, jj) => {
      juegos.forEach(g => {
        if (g.jornada > jj) return;
        if (excl.has(g.local) || excl.has(g.visita)) return;
        if ((g.scoreLocal || 0) + (g.scoreVisita || 0) === 0) return;
        juegosUnificados.push({ local: g.local, visita: g.visita, scoreLocal: g.scoreLocal, scoreVisita: g.scoreVisita, _peso: 1 });
      });
    };
    agregarOficiales(d14_2026.juegos, d14_2026.jornadas_jugadas);
    agregarOficiales(dnac_2026.juegos, dnac_2026.jornadas_jugadas);

    const teamSet2026 = new Set(teams2026);
    (dnac_2026.scrimmages || []).forEach(g => {
      if (excl.has(g.local) || excl.has(g.visita)) return;
      if (!teamSet2026.has(g.local) || !teamSet2026.has(g.visita)) return; // ignora rivales externos (ej. "Tepeyac")
      if ((g.scoreLocal || 0) + (g.scoreVisita || 0) === 0) return;
      juegosUnificados.push({ local: g.local, visita: g.visita, scoreLocal: g.scoreLocal, scoreVisita: g.scoreVisita, _peso: PESO_SCRIMMAGE });
    });

    // ---- 6) Resolver el sistema unificado ----
    const ratings2026 = masseyRatings(teams2026, juegosUnificados, priors2026);

    // ---- 7) Estadísticas ofensa/defensa 2026 (solo temporada regular oficial,
    //         sin scrimmages) para estimar el TOTAL de puntos de un partido;
    //         el rating Massey ya decide cómo se REPARTE ese total. ----
    const statsOD = {};
    teams2026.forEach(t => { statsOD[t] = { pf: 0, pa: 0, gp: 0 }; });
    const acumularOD = (juegos, jj) => {
      juegos.forEach(g => {
        if (g.jornada > jj) return;
        if ((g.scoreLocal || 0) + (g.scoreVisita || 0) === 0) return;
        if (g.local in statsOD) { statsOD[g.local].pf += g.scoreLocal; statsOD[g.local].pa += g.scoreVisita; statsOD[g.local].gp++; }
        if (g.visita in statsOD) { statsOD[g.visita].pf += g.scoreVisita; statsOD[g.visita].pa += g.scoreLocal; statsOD[g.visita].gp++; }
      });
    };
    acumularOD(d14_2026.juegos, d14_2026.jornadas_jugadas);
    acumularOD(dnac_2026.juegos, dnac_2026.jornadas_jugadas);

    let sumaPF = 0, sumaGP = 0;
    teams2026.forEach(t => { sumaPF += statsOD[t].pf; sumaGP += statsOD[t].gp; });
    const promedioLigaPF = sumaGP > 0 ? sumaPF / sumaGP : 24; // 24 pts como último respaldo razonable

    return {
      ratings: ratings2026,
      statsOD,
      promedioLigaPF,
      priors2026,
      juegosJugados2026: juegosJugados,
      // se exponen por si se quieren mostrar/depurar en la UI
      ratings2025: { catorceGrandes: ratings14_2025, nacional: ratingsNac_2025 }
    };
  }

  function avgOD(statsOD, equipo, campo, fallback) {
    const s = statsOD[equipo];
    if (!s || s.gp === 0) return fallback;
    return s[campo] / s.gp;
  }

  // ==========================================================================
  // Predicción de un solo partido, dado el modelo ya construido.
  // ==========================================================================
  function predecirPartido(local, visita, modelo) {
    const excl = new Set(EQUIPOS_EXCLUIDOS);
    if (excl.has(local) && !excl.has(visita)) {
      return { scoreLocal: MARCADOR_FORZADO_VS_EXCLUIDO.excluido, scoreVisita: MARCADOR_FORZADO_VS_EXCLUIDO.ganador, forzado: true };
    }
    if (excl.has(visita) && !excl.has(local)) {
      return { scoreLocal: MARCADOR_FORZADO_VS_EXCLUIDO.ganador, scoreVisita: MARCADOR_FORZADO_VS_EXCLUIDO.excluido, forzado: true };
    }

    const rL = modelo.ratings[local] != null ? modelo.ratings[local] : 0;
    const rV = modelo.ratings[visita] != null ? modelo.ratings[visita] : 0;
    const margen = (rL - rV) + VENTAJA_LOCAL;

    const pf = modelo.promedioLigaPF;
    const totalEsperado =
      ((avgOD(modelo.statsOD, local, 'pf', pf) + avgOD(modelo.statsOD, visita, 'pa', pf)) +
       (avgOD(modelo.statsOD, visita, 'pf', pf) + avgOD(modelo.statsOD, local, 'pa', pf))) / 2;

    let scoreLocal = Math.round((totalEsperado + margen) / 2);
    let scoreVisita = Math.round((totalEsperado - margen) / 2);
    scoreLocal = Math.max(0, scoreLocal);
    scoreVisita = Math.max(0, scoreVisita);
    return { scoreLocal, scoreVisita, forzado: false };
  }

  // ==========================================================================
  // Genera las predicciones de todos los partidos pendientes de UNA
  // conferencia ('14g' | 'nacional'), usando el modelo unificado.
  // ==========================================================================
  function generarPredicciones(datos, conferencia) {
    const modelo = construirModeloUnificado(datos);
    const json = conferencia === '14g' ? datos.d14_2026 : datos.dnac_2026;
    const jj = json.jornadas_jugadas;

    const predicciones = json.juegos
      .filter(g => g.jornada > jj)
      .map(g => {
        const p = predecirPartido(g.local, g.visita, modelo);
        return { jornada: g.jornada, local: g.local, visita: g.visita, scoreLocal: p.scoreLocal, scoreVisita: p.scoreVisita, forzado: p.forzado };
      });

    return { predicciones, modelo };
  }

  // ==========================================================================
  // Carga los 4 JSON desde la raíz del proyecto (solo navegador) y genera
  // las predicciones de una conferencia. Esta es la función que llamaría el
  // botón de la UI.
  // ==========================================================================
  async function calcularPredicciones(conferencia, baseUrl) {
    baseUrl = baseUrl || './';
    const fetchJSON = async (nombre) => {
      const res = await fetch(baseUrl + nombre, { cache: 'no-store' });
      return res.json();
    };
    const [d14_2025, d14_2026, dnac_2025, dnac_2026] = await Promise.all([
      fetchJSON('onefa_data_2025.json'),
      fetchJSON('onefa_data_2026.json'),
      fetchJSON('onefa_nacional_2025.json'),
      fetchJSON('onefa_nacional_2026.json')
    ]);
    return generarPredicciones({ d14_2025, d14_2026, dnac_2025, dnac_2026 }, conferencia);
  }

  const API = {
    K_PESO_TEMPORADA_ANTERIOR,
    PESO_SCRIMMAGE,
    VENTAJA_LOCAL,
    EQUIPOS_EXCLUIDOS,
    masseyRatings,
    construirModeloUnificado,
    predecirPartido,
    generarPredicciones,
    calcularPredicciones
  };

  // UMD simple: funciona en Node (module.exports) y en navegador (window.ONEFA_PRED)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    global.ONEFA_PRED = API;
  }
})(typeof window !== 'undefined' ? window : globalThis);
