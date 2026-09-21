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

  // Peso del rating de la temporada anterior (2025) al arrancar 2026, y cuántas
  // jornadas tarda en decaer. Se interpreta como "el prior vale como si el
  // equipo ya hubiera jugado K partidos reales en 2026, y esa equivalencia se
  // reduce a la mitad cada N jornadas jugadas":
  //     peso(jornada) = K / (1 + jornadasJugadas / N)
  // Con K=3.5 y N=4: en la jornada 0 el prior domina casi todo el rating
  // (100%); hacia la jornada 4 su influencia real ya bajó a ~30%; sigue
  // bajando después, cada vez más despacio. Se aplica IGUAL a todos los
  // equipos, incluidos los que cambiaron de conferencia (ver nota abajo
  // sobre "equipos puente") — no hay un decaimiento especial para ellos.
  //   - Sube K si quieres que la app "confíe más" en 2025 desde el arranque.
  //   - Sube N si quieres que tarde MÁS jornadas en apagarse (decaimiento
  //     más lento); bájalo para que se apague más rápido.
  //   - Pon K en 0 para ignorar 2025 por completo.
  const K_PESO_TEMPORADA_ANTERIOR = 3.5;
  const JORNADAS_TRANSICION = 4;

  // "Equipos puente": los que cambiaron de conferencia entre 2025 y 2026
  // (ascenso Nacional→14G o descenso 14G→Nacional). No reciben un prior con
  // más peso ni un decaimiento distinto — usan la MISMA fórmula de arriba
  // que cualquier otro equipo. Lo que sí los hace un puente real entre
  // conferencias son dos cosas que YA ocurren de forma natural en el
  // sistema, sin necesidad de tocar su peso: (1) su prior 2025 viene de la
  // escala de SU liga anterior, y (2) sus juegos oficiales 2026 (peso 1.0,
  // igual que cualquier juego) ya se resuelven en la conferencia nueva, así
  // que ellos + las scrimmages cruzadas son la señal real que calibra el
  // nivel relativo entre 14 Grandes y Nacional. Solo se detectan aquí para
  // mostrarlos marcados en el ranking (badge "sube"/"baja").

  // Peso de cada scrimmage (juego de preparación) dentro del sistema de
  // ratings, relativo a un juego oficial de temporada regular (peso 1.0).
  // Se distingue entre scrimmage DENTRO de la misma conferencia (aporta poco
  // que los juegos oficiales ya no den) y CRUZADA entre 14G y Nacional (es
  // una de las pocas señales reales de puente entre conferencias esta
  // temporada, así que pesa más — aunque menos que un juego oficial de los
  // equipos puente, que sigue pesando 1.0 por ser temporada regular real).
  const PESO_SCRIMMAGE_MISMA_CONFERENCIA = 0.2;
  const PESO_SCRIMMAGE_CRUZADA = 0.5;

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

  // peso(jornada) = K / (1 + jornadasJugadas / N) — ver constantes arriba.
  function pesoPrior(K, N, jornadasJugadas) {
    return K / (1 + jornadasJugadas / N);
  }

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

    // ---- 0) Roster unificado 2026 y detección de equipos puente — esto va
    //         ANTES de calcular los priors 2025 porque la brecha entre
    //         conferencias (paso 1b) depende de saber quién ascendió y quién
    //         descendió. ----
    const excl = new Set(EQUIPOS_EXCLUIDOS);
    const teamsSet14_2026 = new Set(d14_2026.equipos);
    const teamsSetNac_2026 = new Set(equiposNacional(dnac_2026));
    const teams2026 = Array.from(new Set([
      ...d14_2026.equipos,
      ...equiposNacional(dnac_2026)
    ])).filter(t => !excl.has(t));

    // Conferencia de cada equipo en 2026 — se usa para (a) marcar scrimmages
    // cruzadas y (b) detectar equipos puente comparando contra su conferencia
    // en 2025.
    const conf2026 = {};
    teams2026.forEach(t => { conf2026[t] = teamsSet14_2026.has(t) ? '14g' : 'nacional'; });

    // Equipos puente: cambiaron de conferencia 2025 → 2026 (ascenso/descenso).
    const teamsSet14_2025 = new Set(d14_2025.equipos);
    const teamsSetNac_2025 = new Set(equiposNacional(dnac_2025));
    const equiposPuente = {}; // equipo -> 'sube' (Nac→14G) | 'baja' (14G→Nac)
    teams2026.forEach(t => {
      const estabaEn14 = teamsSet14_2025.has(t);
      const estabaEnNac = teamsSetNac_2025.has(t);
      if (estabaEnNac && conf2026[t] === '14g') equiposPuente[t] = 'sube';
      else if (estabaEn14 && conf2026[t] === 'nacional') equiposPuente[t] = 'baja';
    });
    const equipoAscendido  = Object.keys(equiposPuente).find(t => equiposPuente[t] === 'sube')  || null;
    const equipoDescendido = Object.keys(equiposPuente).find(t => equiposPuente[t] === 'baja') || null;

    // ---- 1) Ratings 2025 por liga, cada una centrada en su propio promedio ----
    // La liguilla (playoffs) 2025 SÍ debe contar para el rating de cada liga:
    // es el resultado de más peso de toda la temporada (define al campeón
    // real), y omitirla deja huecos graves — ej. un equipo invicto en
    // temporada regular que perdió la final se vería, sin la liguilla, mejor
    // que el campeón real.
    const teams14_2025 = d14_2025.equipos;
    const juegos14_2025 = [...d14_2025.juegos, ...(d14_2025.liguilla || [])];
    const ratings14_2025 = centrar(masseyRatings(teams14_2025, juegos14_2025));

    const teamsNac_2025 = equiposNacional(dnac_2025);
    const juegosNac_2025 = [...dnac_2025.juegos, ...(dnac_2025.liguilla || [])];
    const ratingsNac_2025_crudo = centrar(masseyRatings(teamsNac_2025, juegosNac_2025));

    // ---- 1b) Brecha entre conferencias — CLAVE del sistema unificado.
    // Nacional y 14G se calculan cada una centrada en su propio promedio
    // (paso 1), así que por sí solas no dicen nada sobre cuál liga es más
    // fuerte. La única evidencia real y verificable de esa diferencia son los
    // propios equipos puente: el ascendido fue el MEJOR de Nacional, y el
    // descendido fue el PEOR de 14G — ese es, por definición del sistema de
    // ascenso/descenso, el punto donde ambas escalas se tocan.
    //
    // Se calcula brecha = rating14G[descendido] − ratingNacional[ascendido],
    // y se suma esa misma brecha a TODOS los ratings de Nacional 2025. Dos
    // efectos simultáneos, con una sola operación:
    //   (a) Nacional completo queda desplazado por debajo de 14G (no solo el
    //       ascendido/descendido) — resuelve el problema de fondo de que
    //       ningún equipo de Nacional debería lucir más fuerte que uno de 14G.
    //   (b) El ascendido, ya desplazado, queda EXACTAMENTE en el nivel que
    //       tenía el descendido en 14G — y el descendido (que no se toca,
    //       pues ya vive en la escala de 14G) queda en ese mismo número. Es
    //       decir, "intercambian nivel" de forma exacta y automática, sin
    //       tocarlos a mano.
    // Si en algún año no se detecta un par ascenso/descenso claro (roster
    // incompleto, etc.), la brecha cae a 0 y el sistema se comporta como
    // antes (sin descuento estructural) — se prefiere no inventar un número
    // sin evidencia real que lo respalde.
    let gapConferencia = 0;
    if (equipoAscendido && equipoDescendido &&
        ratings14_2025[equipoDescendido] != null &&
        ratingsNac_2025_crudo[equipoAscendido] != null) {
      gapConferencia = ratings14_2025[equipoDescendido] - ratingsNac_2025_crudo[equipoAscendido];
    }
    const ratingsNac_2025 = {};
    Object.keys(ratingsNac_2025_crudo).forEach(t => {
      ratingsNac_2025[t] = ratingsNac_2025_crudo[t] + gapConferencia;
    });

    const priorMap2025 = Object.assign({}, ratings14_2025, ratingsNac_2025);

    // ---- 4) Juegos jugados por equipo en 2026 (para decaer el peso del prior) ----
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

    // ---- 5) Priors 2026 con shrinkage decayente — MISMA fórmula para todos
    //         los equipos, incluidos los puente (ver nota en las constantes) ----
    const priors2026 = {};
    teams2026.forEach(t => {
      if (t in priorMap2025) {
        const jj = juegosJugados[t] || 0;
        priors2026[t] = { valor: priorMap2025[t], peso: pesoPrior(K_PESO_TEMPORADA_ANTERIOR, JORNADAS_TRANSICION, jj) };
      }
    });

    // ---- 6) Lista unificada de juegos 2026 (oficiales + scrimmages puente) ----
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
      const cruzada = conf2026[g.local] !== conf2026[g.visita];
      const peso = cruzada ? PESO_SCRIMMAGE_CRUZADA : PESO_SCRIMMAGE_MISMA_CONFERENCIA;
      juegosUnificados.push({ local: g.local, visita: g.visita, scoreLocal: g.scoreLocal, scoreVisita: g.scoreVisita, _peso: peso });
    });

    // ---- 7) Resolver el sistema unificado ----
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
      conf2026,
      equiposPuente,
      // se exponen por si se quieren mostrar/depurar en la UI
      ratings2025: { catorceGrandes: ratings14_2025, nacional: ratingsNac_2025, nacionalCrudo: ratingsNac_2025_crudo },
      gapConferencia,
      equipoAscendido,
      equipoDescendido
    };
  }

  // Ranking lineal (todos los equipos, ambas conferencias, una sola escala),
  // ordenado de mejor a peor — para verificar visualmente que el modelo tiene
  // sentido (ej. confirmar que un equipo recién descendido de 14G queda
  // arriba dentro de Nacional, o que uno recién ascendido queda abajo en 14G).
  function rankingUnificado(modelo) {
    return Object.keys(modelo.ratings)
      .map(equipo => ({
        equipo,
        rating: modelo.ratings[equipo],
        conferencia: modelo.conf2026[equipo],
        puente: modelo.equiposPuente[equipo] || null
      }))
      .sort((a, b) => b.rating - a.rating);
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
    JORNADAS_TRANSICION,
    PESO_SCRIMMAGE_MISMA_CONFERENCIA,
    PESO_SCRIMMAGE_CRUZADA,
    VENTAJA_LOCAL,
    EQUIPOS_EXCLUIDOS,
    masseyRatings,
    construirModeloUnificado,
    rankingUnificado,
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
