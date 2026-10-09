/* ============================================================================
   prediccion.js — Predicción matemática de marcadores ONEFA (14 Grandes + Nacional)
   ============================================================================
   Método: Massey ratings (margen de puntos) resuelto por mínimos cuadrados,
   con:
     - Sistemas SEPARADOS: 14 Grandes y Nacional se resuelven cada uno en su
       propia escala, con sus propios juegos oficiales — nunca se combinan en
       un solo cálculo. Como nunca comparten escala, nunca se muestran en una
       sola tabla ordenada; cada conferencia tiene su propio ranking.
     - Prior de temporada anterior (2025) por equipo, con "shrinkage": pesa
       fuerte en la jornada 1 y su peso baja solo conforme el equipo acumula
       juegos reales en 2026. Ver K_PESO_TEMPORADA_ANTERIOR abajo.
     - Equipos puente (ascenso/descenso): su prior 2026 no es su propio rating
       2025, sino el rating 2025 QUE TENÍA EL OTRO equipo puente en la liga a
       la que ahora entra — ver la nota completa más abajo, junto a
       construirModelosPorConferencia.
     - Liebres CD Juárez excluido del sistema de ratings por completo (perdió
       todos sus juegos por default 1-0); sus partidos futuros se fuerzan a
       1-0 sin pasar por el modelo.
     - Equipos desaparecidos (ej. Borregos Tec QRO) simplemente no existen en
       el roster 2026, así que nunca entran al cálculo — no requieren código
       especial.
     - Las scrimmages (juegos de preparación) NO entran al modelo de ratings,
       aunque existan en el JSON para mostrarse en el calendario: como las
       conferencias ya no se resuelven juntas, no hay nada que "puentear".

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
  // equipos, incluidos los puente (ver nota junto a
  // construirModelosPorConferencia) — no hay un decaimiento especial para
  // ellos, solo un prior de ENTRADA distinto.
  //   - Sube K si quieres que la app "confíe más" en 2025 desde el arranque.
  //   - Sube N si quieres que tarde MÁS jornadas en apagarse (decaimiento
  //     más lento); bájalo para que se apague más rápido.
  //   - Pon K en 0 para ignorar 2025 por completo.
  const K_PESO_TEMPORADA_ANTERIOR = 3.5;
  const JORNADAS_TRANSICION = 4;

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
  // Construye el modelo de UNA conferencia: priors 2026 (con shrinkage por
  // jornada) + ratings Massey usando SOLO los juegos oficiales de ESA
  // conferencia. Nada de scrimmages, nada de la otra conferencia.
  //   teams          — roster 2026 de esta conferencia (ya sin excluidos)
  //   juegos2026     — arreglo "juegos" del JSON 2026 de esta conferencia
  //   jornadasJugadas— "jornadas_jugadas" del mismo JSON
  //   priorMap       — { equipo: valorPrior2025 } (ya con el intercambio
  //                     aplicado a los equipos puente, ver función que llama)
  //   equipoPuente   — { equipo: 'sube'|'baja' } — 0 o 1 entradas, solo para
  //                     poder marcarlo en el ranking/UI
  // ==========================================================================
  function construirModeloConferencia(teams, juegos2026, jornadasJugadas, priorMap, equipoPuente) {
    // ---- Juegos jugados por equipo en 2026 (para decaer el peso del prior) ----
    const juegosJugados = {};
    teams.forEach(t => { juegosJugados[t] = 0; });
    juegos2026.forEach(g => {
      if (g.jornada > jornadasJugadas) return;
      if ((g.scoreLocal || 0) + (g.scoreVisita || 0) === 0) return;
      if (g.local in juegosJugados) juegosJugados[g.local]++;
      if (g.visita in juegosJugados) juegosJugados[g.visita]++;
    });

    // ---- Priors 2026 con shrinkage decayente ----
    const priors2026 = {};
    teams.forEach(t => {
      if (t in priorMap) {
        const jj = juegosJugados[t] || 0;
        priors2026[t] = { valor: priorMap[t], peso: pesoPrior(K_PESO_TEMPORADA_ANTERIOR, JORNADAS_TRANSICION, jj) };
      }
    });

    // ---- Solo juegos oficiales de temporada regular jugados de ESTA
    //      conferencia — nada de scrimmages, nada cruzado. ----
    const juegosOficiales = [];
    juegos2026.forEach(g => {
      if (g.jornada > jornadasJugadas) return;
      if ((g.scoreLocal || 0) + (g.scoreVisita || 0) === 0) return;
      juegosOficiales.push({ local: g.local, visita: g.visita, scoreLocal: g.scoreLocal, scoreVisita: g.scoreVisita, _peso: 1 });
    });

    const ratings = masseyRatings(teams, juegosOficiales, priors2026);

    // ---- Estadísticas ofensa/defensa 2026 (solo temporada regular oficial)
    //      para estimar el TOTAL de puntos de un partido; el rating Massey
    //      ya decide cómo se REPARTE ese total. ----
    const statsOD = {};
    teams.forEach(t => { statsOD[t] = { pf: 0, pa: 0, gp: 0 }; });
    juegos2026.forEach(g => {
      if (g.jornada > jornadasJugadas) return;
      if ((g.scoreLocal || 0) + (g.scoreVisita || 0) === 0) return;
      if (g.local in statsOD) { statsOD[g.local].pf += g.scoreLocal; statsOD[g.local].pa += g.scoreVisita; statsOD[g.local].gp++; }
      if (g.visita in statsOD) { statsOD[g.visita].pf += g.scoreVisita; statsOD[g.visita].pa += g.scoreLocal; statsOD[g.visita].gp++; }
    });
    let sumaPF = 0, sumaGP = 0;
    teams.forEach(t => { sumaPF += statsOD[t].pf; sumaGP += statsOD[t].gp; });
    const promedioLigaPF = sumaGP > 0 ? sumaPF / sumaGP : 24; // 24 pts como último respaldo razonable

    return { ratings, statsOD, promedioLigaPF, priors2026, juegosJugados2026: juegosJugados, equipoPuente };
  }

  // ==========================================================================
  // Construye los DOS modelos (14 Grandes y Nacional) a partir de los 4 JSON
  // ya parseados. Cada conferencia se resuelve por completo por separado —
  // nunca comparten un sistema de ecuaciones ni una escala de rating.
  //
  // El único punto de contacto entre ambas es el intercambio de prior entre
  // los equipos puente (ascenso/descenso), y es puramente aritmético, sin
  // resolver nada en conjunto:
  //   - El equipo ASCENDIDO (Nacional→14G) entra a 14G en 2026 usando como
  //     prior el rating 2025 que tenía el equipo DESCENDIDO **dentro de
  //     14G** — es decir, hereda el nivel del peor equipo de 14G, que es
  //     justo el nivel de entrada esperado para un recién ascendido.
  //   - El equipo DESCENDIDO (14G→Nacional) entra a Nacional en 2026 usando
  //     como prior el rating 2025 que tenía el equipo ASCENDIDO **dentro de
  //     Nacional** — hereda el nivel del campeón de Nacional, el nivel de
  //     entrada esperado para quien llega desde 14G a competir ahí.
  // En efecto, "intercambian nivel" entre sí. El resto de cada conferencia
  // no se toca: no hace falta subir ni bajar a nadie más, porque las dos
  // conferencias ya nunca se comparan en una sola tabla.
  // ==========================================================================
  function construirModelosPorConferencia(datos) {
    const { d14_2025, d14_2026, dnac_2025, dnac_2026 } = datos;
    const excl = new Set(EQUIPOS_EXCLUIDOS);

    const teams14_2026 = d14_2026.equipos.filter(t => !excl.has(t));
    const teamsNac_2026 = equiposNacional(dnac_2026).filter(t => !excl.has(t));

    // ---- Detección de equipos puente (comparando rosters 2025 vs 2026) ----
    const teamsSet14_2025 = new Set(d14_2025.equipos);
    const teamsSetNac_2025 = new Set(equiposNacional(dnac_2025));
    let equipoAscendido = null, equipoDescendido = null;
    teams14_2026.forEach(t => { if (teamsSetNac_2025.has(t)) equipoAscendido = t; });
    teamsNac_2026.forEach(t => { if (teamsSet14_2025.has(t)) equipoDescendido = t; });

    // ---- Ratings 2025, cada conferencia calculada y centrada por separado.
    // La liguilla (playoffs) 2025 SÍ debe contar para el rating de cada liga:
    // es el resultado de más peso de toda la temporada (define al campeón
    // real), y omitirla deja huecos graves — ej. un equipo invicto en
    // temporada regular que perdió la final se vería, sin la liguilla, mejor
    // que el campeón real. ----
    const teams14_2025 = d14_2025.equipos;
    const juegos14_2025 = [...d14_2025.juegos, ...(d14_2025.liguilla || [])];
    const ratings14_2025 = centrar(masseyRatings(teams14_2025, juegos14_2025));

    const teamsNac_2025 = equiposNacional(dnac_2025);
    const juegosNac_2025 = [...dnac_2025.juegos, ...(dnac_2025.liguilla || [])];
    const ratingsNac_2025 = centrar(masseyRatings(teamsNac_2025, juegosNac_2025));

    // ---- Intercambio de prior entre los equipos puente (ver comentario de
    // la función completo arriba). Si por lo que sea no se detecta un par
    // ascenso/descenso claro, cada quien usa su propio rating 2025 sin tocar
    // — no hay arithmetic de respaldo que inventar. ----
    const prior14 = Object.assign({}, ratings14_2025);
    const priorNac = Object.assign({}, ratingsNac_2025);
    if (equipoAscendido && equipoDescendido) {
      if (ratings14_2025[equipoDescendido] != null) prior14[equipoAscendido] = ratings14_2025[equipoDescendido];
      if (ratingsNac_2025[equipoAscendido] != null) priorNac[equipoDescendido] = ratingsNac_2025[equipoAscendido];
    }

    const modelo14 = construirModeloConferencia(
      teams14_2026, d14_2026.juegos, d14_2026.jornadas_jugadas, prior14,
      equipoAscendido ? { [equipoAscendido]: 'sube' } : {}
    );
    const modeloNac = construirModeloConferencia(
      teamsNac_2026, dnac_2026.juegos, dnac_2026.jornadas_jugadas, priorNac,
      equipoDescendido ? { [equipoDescendido]: 'baja' } : {}
    );

    return {
      modelo14,
      modeloNac,
      equipoAscendido,
      equipoDescendido,
      // se expone por si se quiere mostrar/depurar en la UI
      ratings2025: { catorceGrandes: ratings14_2025, nacional: ratingsNac_2025 }
    };
  }

  // Ranking de UNA conferencia (su propio modelo), de mejor a peor — ya no
  // existe un ranking que junte ambas conferencias, porque ya no comparten
  // escala.
  function rankingConferencia(modelo) {
    return Object.keys(modelo.ratings)
      .map(equipo => ({
        equipo,
        rating: modelo.ratings[equipo],
        puente: modelo.equipoPuente[equipo] || null
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
  // PROYECCIÓN DE PLAYOFFS — "si se dieran los resultados de predicción,
  // ¿cómo quedarían los playoffs?"
  //
  // Idea: se completan TODOS los juegos pendientes de temporada regular con
  // el marcador que predice el modelo (los ya jugados no se tocan), y sobre
  // esa temporada ya completa se corre EXACTAMENTE la misma lógica de tabla
  // de posiciones y desempate que ya usan index.html (14G) y nacional.html
  // (Nacional) — por diseño, la clasificación a playoffs se decide por
  // récord real (PG/PCT + desempates), nunca por el rating Massey; el rating
  // solo se usa para poner el marcador a los partidos que aún no se juegan,
  // incluyendo los de la propia liguilla proyectada.
  // ==========================================================================

  // Resultado directo entre dos equipos dentro de un arreglo de juegos ya
  // completo (real + proyectado). Empate en el marcador o juego inexistente
  // -> null (no cuenta para desempate). Idéntica lógica a la que ya usan
  // index.html y nacional.html.
  function getDirecto(juegos, t1, t2) {
    const g = juegos.find(x => (x.local === t1 && x.visita === t2) || (x.local === t2 && x.visita === t1));
    if (!g || (g.scoreLocal + g.scoreVisita) === 0 || g.scoreLocal === g.scoreVisita) return null;
    return g.local === t1 ? (g.scoreLocal > g.scoreVisita ? 1 : -1) : (g.scoreVisita > g.scoreLocal ? 1 : -1);
  }

  // Rellena con el marcador predicho todo juego cuya jornada sea posterior a
  // "jornadasJugadas" (misma condición que usa generarPredicciones); los
  // juegos ya jugados se devuelven sin tocar. No modifica el arreglo original.
  function proyectarJuegos(juegos, jornadasJugadas, modelo) {
    return juegos.map(g => {
      if (g.jornada > jornadasJugadas) {
        const p = predecirPartido(g.local, g.visita, modelo);
        return Object.assign({}, g, { scoreLocal: p.scoreLocal, scoreVisita: p.scoreVisita, _proyectado: true });
      }
      return g;
    });
  }

  // Tabla de posiciones de 14 Grandes (una sola tabla) — misma lógica que
  // calcStandings() en index.html, aplicada aquí sobre la temporada ya
  // completa (real + proyectada). Devuelve las filas ordenadas, mejor primero.
  function calcularStandings14G(teams, juegos) {
    const stats = {};
    teams.forEach(t => { stats[t] = { pj: 0, pg: 0, pf: 0, pc: 0 }; });
    juegos.forEach(g => {
      const sl = g.scoreLocal, sv = g.scoreVisita;
      if (sl + sv > 0 && sl !== sv && stats[g.local] && stats[g.visita]) {
        stats[g.local].pj++; stats[g.visita].pj++;
        stats[g.local].pf += sl; stats[g.local].pc += sv;
        stats[g.visita].pf += sv; stats[g.visita].pc += sl;
        if (sl > sv) stats[g.local].pg++; else stats[g.visita].pg++;
      }
    });
    let rows = teams.map(eq => Object.assign({ equipo: eq }, stats[eq], {
      pp: stats[eq].pj - stats[eq].pg,
      pct: stats[eq].pj ? stats[eq].pg / stats[eq].pj : 0
    })).sort((a, b) => b.pct - a.pct);

    let i = 0;
    while (i < rows.length) {
      const s = i, p = rows[i].pct;
      while (i < rows.length && rows[i].pct === p) i++;
      const grp = rows.slice(s, i);
      if (grp.length > 1) {
        let win = null;
        for (const t of grp) {
          if (grp.every(o => o.equipo === t.equipo || getDirecto(juegos, t.equipo, o.equipo) === 1)) { win = t; break; }
        }
        grp.sort((a, b) => {
          if (win) { if (a.equipo === win.equipo) return -1; if (b.equipo === win.equipo) return 1; }
          return a.pc - b.pc;
        });
        rows.splice(s, grp.length, ...grp);
      }
    }
    rows.forEach((r, i) => { r.seed = i + 1; });
    return rows;
  }

  // Tablas de grupo + sembrado general de Conferencia Nacional — misma
  // lógica que calcGroupStandings()/renderPlayoffs() en nacional.html:
  // top 2 de cada grupo + los 2 mejores terceros lugares (comodines, tope de
  // 3 equipos por grupo), sembrado general 1-8 por PG con desempate por
  // resultado directo -> menor PC.
  function calcularStandingsNacional(grupos, juegos) {
    const stats = {};
    Object.values(grupos).forEach(teams => teams.forEach(t => { stats[t] = { pj: 0, pg: 0, pc: 0 }; }));
    juegos.forEach(g => {
      const sl = g.scoreLocal, sv = g.scoreVisita;
      if (sl + sv === 0 || sl === sv) return;
      const cLocal  = !g.cuentaSoloPara || g.cuentaSoloPara.includes(g.local);
      const cVisita = !g.cuentaSoloPara || g.cuentaSoloPara.includes(g.visita);
      if (cLocal && stats[g.local])   { stats[g.local].pj++;  stats[g.local].pc += sv;  if (sl > sv) stats[g.local].pg++; }
      if (cVisita && stats[g.visita]) { stats[g.visita].pj++; stats[g.visita].pc += sl; if (sv > sl) stats[g.visita].pg++; }
    });

    const ordenarEmpateDirecto = (tied) => [...tied].sort((a, b) => {
      const h2h = getDirecto(juegos, a.equipo, b.equipo);
      if (h2h === 1) return -1;
      if (h2h === -1) return 1;
      return a.pc - b.pc;
    });

    const allRows = {};
    Object.entries(grupos).forEach(([grp, teams]) => {
      let rows = teams.map(eq => {
        const s = stats[eq] || { pj: 0, pg: 0, pc: 0 };
        return { equipo: eq, grupo: grp, pg: s.pg, pp: s.pj - s.pg, pct: s.pj ? s.pg / s.pj : 0, pc: s.pc, pj: s.pj };
      });
      rows.sort((a, b) => b.pct - a.pct);
      let i = 0;
      while (i < rows.length) {
        const s0 = i, p = rows[i].pct;
        while (i < rows.length && rows[i].pct === p) i++;
        if (i - s0 > 1) rows.splice(s0, i - s0, ...ordenarEmpateDirecto(rows.slice(s0, i)));
      }
      allRows[grp] = rows;
    });

    const playoffs = new Set();
    Object.values(allRows).forEach(rows => rows.slice(0, 2).forEach(r => playoffs.add(r.equipo)));
    const terceros = Object.values(allRows).map(rows => rows[2]).filter(Boolean);
    terceros.sort((a, b) => b.pct - a.pct || a.pc - b.pc);
    terceros.slice(0, 2).forEach(r => playoffs.add(r.equipo));

    const flat = {};
    Object.values(allRows).forEach(rows => rows.forEach(r => { flat[r.equipo] = r; }));
    let seeds = [...playoffs].map(eq => flat[eq]);
    seeds.sort((a, b) => b.pg - a.pg);
    let gi = 0;
    while (gi < seeds.length) {
      let gj = gi;
      while (gj < seeds.length && seeds[gj].pg === seeds[gi].pg) gj++;
      if (gj - gi > 1) seeds.splice(gi, gj - gi, ...ordenarEmpateDirecto(seeds.slice(gi, gj)));
      gi = gj;
    }
    seeds.forEach((t, i) => { t.seed = i + 1; });

    return { allRows, seeds };
  }

  // Bracket clásico de 8 equipos (1v8, 2v7, 3v6, 4v5 en cuartos; el mejor
  // sembrado de los dos avanzados es local en cada ronda siguiente, incluida
  // la final) — mismo formato que ya usa nacional.html para el bracket en
  // vivo, y el mismo que confirman los brackets reales 2025 de ambas
  // conferencias. Cada partido se predice con el modelo de ESA conferencia.
  function construirBracketPrediccion(seeds8, modelo) {
    if (!seeds8 || seeds8.length < 8) return null;

    const jugar = (a, b) => {
      const p = predecirPartido(a.equipo, b.equipo, modelo);
      const ganador = p.scoreLocal >= p.scoreVisita ? a : b;
      return { local: a, visita: b, scoreLocal: p.scoreLocal, scoreVisita: p.scoreVisita, ganador, forzado: p.forzado };
    };
    const mejorLocal = (x, y) => (x.seed <= y.seed ? [x, y] : [y, x]);

    const cf1 = jugar(seeds8[0], seeds8[7]); // 1 vs 8
    const cf2 = jugar(seeds8[3], seeds8[4]); // 4 vs 5
    const cf3 = jugar(seeds8[1], seeds8[6]); // 2 vs 7
    const cf4 = jugar(seeds8[2], seeds8[5]); // 3 vs 6

    const [sf1L, sf1V] = mejorLocal(cf1.ganador, cf2.ganador);
    const sf1 = jugar(sf1L, sf1V);
    const [sf2L, sf2V] = mejorLocal(cf3.ganador, cf4.ganador);
    const sf2 = jugar(sf2L, sf2V);

    const [fL, fV] = mejorLocal(sf1.ganador, sf2.ganador);
    const final = jugar(fL, fV);

    return { cuartos: [cf1, cf2, cf3, cf4], semifinal: [sf1, sf2], final, campeon: final.ganador };
  }

  // ==========================================================================
  // Punto de entrada: dado el estado real de la temporada, proyecta el resto
  // de los juegos con el modelo y arma tabla(s) + bracket de ESA conferencia.
  // Recibe los modelos ya construidos para no recalcularlos si el llamador
  // (generarPredicciones) ya los tiene a la mano.
  // ==========================================================================
  function proyectarPlayoffsConModelos(datos, conferencia, modelos) {
    const { d14_2026, dnac_2026 } = datos;
    if (conferencia === '14g') {
      const modelo = modelos.modelo14;
      const juegosProyectados = proyectarJuegos(d14_2026.juegos, d14_2026.jornadas_jugadas, modelo);
      const standings = calcularStandings14G(d14_2026.equipos, juegosProyectados);
      const seeds = standings.slice(0, 8);
      const bracket = construirBracketPrediccion(seeds, modelo);
      return { standings, seeds, bracket };
    } else {
      const modelo = modelos.modeloNac;
      const juegosProyectados = proyectarJuegos(dnac_2026.juegos, dnac_2026.jornadas_jugadas, modelo);
      const { allRows, seeds } = calcularStandingsNacional(dnac_2026.grupos, juegosProyectados);
      const bracket = construirBracketPrediccion(seeds, modelo);
      return { allRows, seeds, bracket };
    }
  }

  // Versión standalone (construye sus propios modelos) — útil para llamarla
  // suelta desde consola/pruebas sin pasar por generarPredicciones.
  function proyectarPlayoffs(datos, conferencia) {
    const modelos = construirModelosPorConferencia(datos);
    return Object.assign({ modelos }, proyectarPlayoffsConModelos(datos, conferencia, modelos));
  }

  // ==========================================================================
  // Genera las predicciones de todos los partidos pendientes de UNA
  // conferencia ('14g' | 'nacional'), usando SOLO el modelo de esa
  // conferencia (los dos modelos se construyen siempre juntos porque el
  // intercambio de prior entre equipos puente necesita ver ambos rosters,
  // pero de ahí en adelante cada uno vive en su propio mundo).
  // ==========================================================================
  function generarPredicciones(datos, conferencia) {
    const modelos = construirModelosPorConferencia(datos);
    const modelo = conferencia === '14g' ? modelos.modelo14 : modelos.modeloNac;
    const json = conferencia === '14g' ? datos.d14_2026 : datos.dnac_2026;
    const jj = json.jornadas_jugadas;

    const predicciones = json.juegos
      .filter(g => g.jornada > jj)
      .map(g => {
        const p = predecirPartido(g.local, g.visita, modelo);
        return { jornada: g.jornada, local: g.local, visita: g.visita, scoreLocal: p.scoreLocal, scoreVisita: p.scoreVisita, forzado: p.forzado };
      });

    const playoffs = proyectarPlayoffsConModelos(datos, conferencia, modelos);

    return { predicciones, modelo, modelos, playoffs };
  }

  // ==========================================================================
  // Carga los 4 JSON desde la raíz del proyecto (solo navegador) y genera
  // las predicciones de una conferencia. Esta es la función que llamaría el
  // botón de la UI.
  // ==========================================================================
  async function calcularPredicciones(conferencia, baseUrl) {
    baseUrl = baseUrl || './';
    const fetchJSON = async (nombre) => {
      const res = await fetch(baseUrl + nombre, { cache: 'no-cache' });
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
    VENTAJA_LOCAL,
    EQUIPOS_EXCLUIDOS,
    masseyRatings,
    construirModelosPorConferencia,
    rankingConferencia,
    predecirPartido,
    generarPredicciones,
    calcularPredicciones,
    proyectarPlayoffs,
    calcularStandings14G,
    calcularStandingsNacional
  };

  // UMD simple: funciona en Node (module.exports) y en navegador (window.ONEFA_PRED)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    global.ONEFA_PRED = API;
  }
})(typeof window !== 'undefined' ? window : globalThis);
