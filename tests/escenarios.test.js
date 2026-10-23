/* Pruebas del módulo de escenarios (plan.md §14).  Uso:  node tests/escenarios.test.js
   Sin dependencias. Usa los JSON reales de la carpeta raíz del proyecto. */
const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');
const PRED = require(path.join(RAIZ, 'prediccion.js'));
const ESC = require(path.join(RAIZ, 'escenarios.js'));
const leer = f => JSON.parse(fs.readFileSync(path.join(RAIZ, f), 'utf8'));
const DATOS = { d14_2025: leer('onefa_data_2025.json'), d14_2026: leer('onefa_data_2026.json'),
                dnac_2025: leer('onefa_nacional_2025.json'), dnac_2026: leer('onefa_nacional_2026.json') };

let ok = 0, mal = 0; const fallos = [];
function prueba(nombre, cond, detalle) {
  if (cond) { ok++; console.log('  ✔ ' + nombre); }
  else { mal++; fallos.push(nombre); console.log('  ✘ ' + nombre + (detalle ? '  → ' + detalle : '')); }
}
function seccion(t) { console.log('\n' + t); }
const clon = x => JSON.parse(JSON.stringify(x));

// Corte simulado: las jornadas ≤ jj sin marcador (incluido el aplazado) se rellenan con la predicción
function datosConCorte(jj) {
  const d = clon(DATOS), modelo = PRED.construirModelosPorConferencia(DATOS).modelo14;
  d.d14_2026.jornadas_jugadas = jj;
  d.d14_2026.juegos.forEach(g => {
    if (g.jornada <= jj && g.scoreLocal + g.scoreVisita === 0) {
      const p = PRED.predecirPartido(g.local, g.visita, modelo);
      g.scoreLocal = p.scoreLocal; g.scoreVisita = p.scoreVisita; if (g.scoreLocal === g.scoreVisita) g.scoreLocal++;
    }
  });
  return d;
}

// Implementación de REFERENCIA de la regla de tabla (port directo de calcStandings de index.html)
function tablaReferencia(equipos, juegos) {
  const st = {}; equipos.forEach(t => st[t] = { pj: 0, pg: 0, pc: 0 });
  juegos.forEach(g => { const a = g.scoreLocal, b = g.scoreVisita;
    if (a + b > 0 && a !== b) { st[g.local].pj++; st[g.visita].pj++; st[g.local].pc += b; st[g.visita].pc += a; if (a > b) st[g.local].pg++; else st[g.visita].pg++; } });
  const directo = (x, y) => { const g = juegos.find(q => (q.local === x && q.visita === y) || (q.local === y && q.visita === x));
    if (!g || g.scoreLocal + g.scoreVisita === 0 || g.scoreLocal === g.scoreVisita) return null;
    return g.local === x ? (g.scoreLocal > g.scoreVisita ? 1 : -1) : (g.scoreVisita > g.scoreLocal ? 1 : -1); };
  let rows = equipos.map(t => ({ equipo: t, pg: st[t].pg, pc: st[t].pc, pct: st[t].pj ? st[t].pg / st[t].pj : 0 })).sort((a, b) => b.pct - a.pct);
  let i = 0;
  while (i < rows.length) {
    const s = i, p = rows[i].pct; while (i < rows.length && rows[i].pct === p) i++;
    const grp = rows.slice(s, i);
    if (grp.length > 1) {
      const win = grp.find(t => grp.every(o => o === t || directo(t.equipo, o.equipo) === 1)) || null;
      grp.sort((a, b) => (win ? (a === win ? -1 : b === win ? 1 : 0) : 0) || a.pc - b.pc);
      rows.splice(s, grp.length, ...grp);
    }
  }
  return rows.map(r => r.equipo);
}

const rng = ESC.crearRng(777);
const t0 = Date.now();

// ---------------------------------------------------------------------------
seccion('T0  Datos y compuertas');
{
  const P = ESC.prepararProblema(DATOS, {});
  prueba('el juego aplazado Tigres–MTY de J5 cuenta como pendiente', P.G.some(x => x.aplazado && x.local === 'Auténticos Tigres' && x.visita === 'Borregos MTY'));
  prueba('con J6 concluida hay 25 pendientes (24 + 1 aplazado)', P.n === 25, 'n=' + P.n);
  prueba('probabilidades acotadas a [3 %, 97 %] (D9)', P.G.every(x => x.forzado || (x.pHome >= 0.03 - 1e-12 && x.pHome <= 0.97 + 1e-12)));
  prueba('todos los equipos juegan 9 juegos (63 juegos × 2 / 14)', DATOS.d14_2026.equipos.every(t => DATOS.d14_2026.juegos.filter(g => g.local === t || g.visita === t).length === 9));
  const bajo = clon(DATOS); bajo.d14_2026.jornadas_jugadas = 5;
  prueba('con J5 concluida el módulo no está disponible', ESC.analizar(bajo, { equipo: 'Linces UVM' }).estado === 'fuera_de_rango');
  const alto = clon(DATOS); alto.d14_2026.jornadas_jugadas = 10;
  prueba('con J10 concluida la temporada ya terminó', ESC.analizar(alto, { equipo: 'Linces UVM' }).estado === 'fuera_de_rango');
  const pn = PRED.generarPredicciones(DATOS, 'nacional');
  prueba('Nacional: el aplazado Cimarrones–ITSON también cuenta como pendiente', pn.predicciones.some(p => p.jornada <= DATOS.dnac_2026.jornadas_jugadas));
}

// ---------------------------------------------------------------------------
seccion('T1  Paridad de la tabla (regla de desempate)');
{
  const eq = DATOS.d14_2026.equipos, P = ESC.prepararProblema(DATOS, {});
  const real = DATOS.d14_2026.juegos.filter(g => !PRED.esPendiente(g, 6));
  prueba('tabla real actual: mismo orden que la referencia', JSON.stringify(PRED.calcularStandings14G(eq, real).map(r => r.equipo)) === JSON.stringify(tablaReferencia(eq, real)));
  let iguales = 0; const N = 300;
  for (let s = 0; s < N; s++) {
    const hw = P.G.map(() => rng() < 0.5), sc = ESC.marcadoresBase(P, hw);
    for (let i = 0; i < P.n; i++) { const d = Math.floor(rng() * 15); if (hw[i]) sc.sl[i] += d; else sc.sv[i] += d; }
    const juegos = P.jugados.concat(P.G.map((x, i) => ({ jornada: x.jornada, local: x.local, visita: x.visita, scoreLocal: sc.sl[i], scoreVisita: sc.sv[i] })));
    if (JSON.stringify(PRED.calcularStandings14G(eq, juegos).map(r => r.equipo)) === JSON.stringify(tablaReferencia(eq, juegos))) iguales++;
  }
  prueba(N + ' temporadas completas al azar: mismo orden que la referencia', iguales === N, iguales + '/' + N);
}

// ---------------------------------------------------------------------------
seccion('T2  Enumeración exacta (código Gray) contra fuerza bruta  [corte simulado J8: 12 juegos]');
{
  const d8 = datosConCorte(8), P = ESC.prepararProblema(d8, {}), obj = ESC.OBJETIVO_PLAYOFFS;
  prueba('corte J8: 12 pendientes', P.n === 12, 'n=' + P.n);
  let todoBien = true, sumaOk = true;
  P.equipos.forEach((nombre, T) => {
    const ex = ESC.enumerarExacto(P, T, obj, null);
    const cnt = [0, 0, 0], pr = [0, 0, 0];
    for (let v = 0; v < (1 << P.n); v++) {
      const hw = P.G.map((_, i) => !!((v >> i) & 1)); let prod = 1; P.G.forEach((x, i) => { prod *= hw[i] ? x.pHome : 1 - x.pHome; });
      const c = ESC.clasificarVictorias(P, ESC.victorias(P, hw), T, obj); cnt[c]++; pr[c] += prod;
    }
    const igual = ex.seguro.n === cnt[0] && ex.filo.n === cnt[1] && ex.fuera.n === cnt[2] &&
      Math.abs(ex.seguro.p - pr[0]) < 1e-9 && Math.abs(ex.filo.p - pr[1]) < 1e-9 && Math.abs(ex.fuera.p - pr[2]) < 1e-9;
    if (!igual) todoBien = false;
    if (Math.abs(ex.seguro.p + ex.filo.p + ex.fuera.p - 1) > 1e-9) sumaOk = false;
  });
  prueba('los 14 equipos: conteos y probabilidades idénticos a la fuerza bruta', todoBien);
  prueba('Σ de probabilidades = 1 en los 14 equipos', sumaOk);
  const T = P.idx['Borregos GDL'], fijos = new Map([[0, true], [3, false]]);
  const ex = ESC.enumerarExacto(P, T, obj, fijos);
  let ref = [0, 0, 0], prr = [0, 0, 0];
  for (let v = 0; v < (1 << P.n); v++) {
    const hw = P.G.map((_, i) => !!((v >> i) & 1)); if (hw[0] !== true || hw[3] !== false) continue;
    let prod = 1; P.G.forEach((x, i) => { if (i !== 0 && i !== 3) prod *= hw[i] ? x.pHome : 1 - x.pHome; });
    const c = ESC.clasificarVictorias(P, ESC.victorias(P, hw), T, obj); ref[c]++; prr[c] += prod;
  }
  prueba('con resultados fijos (distribución condicionada) también coincide', ex.seguro.n === ref[0] && ex.filo.n === ref[1] && ex.fuera.n === ref[2] && Math.abs(ex.seguro.p - prr[0]) < 1e-9);
}

// ---------------------------------------------------------------------------
// Análisis completos con datos reales (se reutilizan en T3–T8)
const EQUIPOS_PRUEBA = ['Burros Blancos', 'Linces UVM', 'Borregos GDL', 'Borregos CEM', 'Zorros CETYS', 'Auténticos Tigres'];
const RES = {}, MS = {};
EQUIPOS_PRUEBA.forEach(eq => { const t = Date.now(); RES[eq] = ESC.analizar(DATOS, { equipo: eq }); MS[eq] = Date.now() - t; });

seccion('T3  Invariantes de probabilidad (datos reales, J6 concluida)');
EQUIPOS_PRUEBA.forEach(eq => {
  const r = RES[eq], c = r.probabilidad.cotasExactas, ic = (r.probabilidad.ic95[1] - r.probabilidad.ic95[0]) / 2;
  const sumaDist = r.distribucionPosicion.reduce((a, b) => a + b, 0);
  const top8 = r.distribucionPosicion.slice(0, 8).reduce((a, b) => a + b, 0);
  prueba(eq + ': P(Monte Carlo) dentro de las cotas exactas [' + (c.min * 100).toFixed(1) + '%, ' + (c.max * 100).toFixed(1) + '%]',
    r.probabilidad.p >= c.min - ic - 0.004 && r.probabilidad.p <= c.max + ic + 0.004, 'P=' + (r.probabilidad.p * 100).toFixed(2) + '%');
  prueba(eq + ': distribución de posición suma 1 y P(Top 8) = Σ posiciones 1–8', Math.abs(sumaDist - 1) < 1e-9 && Math.abs(top8 - r.probabilidad.p) < 1e-9);
});

seccion('T4  Los escenarios devueltos cumplen el objetivo al reevaluarlos con la tabla completa');
EQUIPOS_PRUEBA.forEach(eq => {
  const r = RES[eq], P = ESC.prepararProblema(DATOS, {}), T = P.idx[eq]; let bien = true, detalle = '';
  r.escenarios.forEach(e => {
    const sl = new Int16Array(P.n), sv = new Int16Array(P.n);
    e.marcadores.forEach(m => { sl[m.juegoId] = m.scoreLocal; sv[m.juegoId] = m.scoreVisita; });
    const pos = ESC.posicionDe(ESC.tablaFinal(P, sl, sv), eq), en8 = pos >= 1 && pos <= 8;
    if ((e.modo === 'clasificar') !== en8) { bien = false; detalle = 'escenario ' + e.id + ' pos ' + pos; }
    e.marcadores.forEach(m => {
      if (m.scoreLocal === m.scoreVisita || m.scoreLocal < 0 || m.scoreVisita < 0 || m.scoreLocal > 73 || m.scoreVisita > 73) { bien = false; detalle = 'marcador inválido en escenario ' + e.id; }
    });
    e.necesarios.forEach(n => { const m = e.marcadores.find(q => q.juegoId === n.juegoId); const gl = m.scoreLocal > m.scoreVisita; if ((gl ? m.local : m.visita) !== n.ganador) { bien = false; detalle = 'ganador necesario no coincide'; } });
    if (e.probabilidad < -1e-12 || e.probabilidad > 1 + 1e-12) { bien = false; detalle = 'probabilidad fuera de [0,1]'; }
  });
  prueba(eq + ' (' + r.escenarios.length + ' escenarios, modo ' + (r.modo || 'n/a') + (r.busqueda && r.busqueda.omitida ? ', búsqueda omitida' : '') + ')', bien, detalle);
});

seccion('T5  Suficiencia de la condición mínima (verificada por enumeración de las completaciones)');
{
  let verificados = 0, incoherentes = 0;
  EQUIPOS_PRUEBA.forEach(eq => RES[eq].escenarios.forEach(e => {
    if (!e.completaciones) return; verificados++;
    const c = e.completaciones, s = c.pSeguro + c.pFilo + c.pFuera;
    // P(objetivo | condición) por Monte Carlo debe caer dentro de las cotas exactas de las completaciones
    const lo = e.modo === 'clasificar' ? c.pSeguro : c.pFuera, hi = e.modo === 'clasificar' ? c.pSeguro + c.pFilo : c.pFuera + c.pFilo;
    if (Math.abs(s - 1) > 1e-6 || e.probabilidadCondicion < lo - 0.03 || e.probabilidadCondicion > hi + 0.03) incoherentes++;
  }));
  prueba('P(objetivo | condición) por Monte Carlo cae dentro de las cotas exactas (' + verificados + ' escenarios verificados)', verificados > 0 && incoherentes === 0, incoherentes + ' incoherentes');
}

seccion('T6  Coherencia con la proyección de playoffs existente');
{
  const P = ESC.prepararProblema(DATOS, {}), hw = ESC.ganadoresFavoritos(P), b = ESC.marcadoresBase(P, hw);
  const rows = ESC.tablaFinal(P, b.sl, b.sv), top8 = new Set(rows.filter(r => r.seed <= 8).map(r => r.equipo));
  const proy = PRED.proyectarPlayoffs(DATOS, '14g'), top8Proy = new Set(proy.seeds.map(s => s.equipo));
  prueba('los 8 clasificados con los resultados esperados coinciden con proyectarPlayoffs', [...top8].every(t => top8Proy.has(t)) && top8.size === top8Proy.size,
    'motor: ' + [...top8].join(', '));
}

seccion('T7  Monotonía: ganar un juego propio de más nunca empeora el rango de posición');
{
  const P = ESC.prepararProblema(DATOS, {}); let viol = 0, total = 0;
  for (let s = 0; s < 3000; s++) {
    const T = Math.floor(rng() * P.nEq), hw = P.G.map(() => rng() < 0.5);
    const propios = P.G.map((x, i) => i).filter(i => P.G[i].iL === T || P.G[i].iV === T); if (!propios.length) continue;
    const i = propios[Math.floor(rng() * propios.length)], gana = (P.G[i].iL === T) === hw[i];
    if (gana) continue; total++;
    const hw2 = hw.slice(); hw2[i] = !hw2[i];
    const rg = w => { let A = 0, B = 0; for (let t = 0; t < P.nEq; t++) { if (t === T) continue; if (w[t] > w[T]) A++; else if (w[t] === w[T]) B++; } return [A + 1, A + B + 1]; };
    const [l1, h1] = rg(ESC.victorias(P, hw)), [l2, h2] = rg(ESC.victorias(P, hw2));
    if (l2 > l1 || h2 > h1) viol++;
  }
  prueba(total + ' casos aleatorios sin violaciones', viol === 0, viol + ' violaciones');
}

seccion('T8  Determinismo (misma semilla ⇒ mismos resultados)');
{
  const a = ESC.analizar(DATOS, { equipo: 'Linces UVM' }), b = ESC.analizar(DATOS, { equipo: 'Linces UVM' });
  const limpiar = r => JSON.stringify(r, (k, v) => (k === 'ms' ? undefined : v));
  prueba('dos corridas idénticas dan el mismo resultado', limpiar(a) === limpiar(b));
  const c = ESC.analizar(DATOS, { equipo: 'Linces UVM', semilla: 999 });
  prueba('otra semilla cambia el Monte Carlo pero no las cotas exactas', c.probabilidad.p !== a.probabilidad.p && c.probabilidad.cotasExactas.min === a.probabilidad.cotasExactas.min);
}

seccion('T9  Rendimiento (escritorio; en teléfono se estima ~4× más lento)');
EQUIPOS_PRUEBA.forEach(eq => prueba(eq + ': ' + (MS[eq] / 1000).toFixed(1) + ' s (presupuesto total 45 s)', MS[eq] < 45000));

seccion('T10  Marcadores de desempate: válidos y efectivos');
{
  const P = ESC.prepararProblema(DATOS, {}), obj = ESC.OBJETIVO_PLAYOFFS; let probados = 0, malos = 0, optimizados = 0;
  for (const eq of ['Burros Blancos', 'Linces UVM', 'Borregos GDL', 'Borregos CEM']) {
    const T = P.idx[eq];
    for (let s = 0; s < 400; s++) {
      const hw = P.G.map(x => rng() < x.pHome);
      if (ESC.clasificarVictorias(P, ESC.victorias(P, hw), T, obj) !== ESC.FILO) continue;
      const r = ESC.resolverDesempate(P, hw, T, obj); if (!r.ok) continue; probados++;
      const pos = ESC.posicionDe(ESC.tablaFinal(P, r.sl, r.sv), eq);
      let valido = pos <= 8;
      for (let i = 0; i < P.n; i++) { if (r.sl[i] === r.sv[i] || r.sl[i] < 0 || r.sv[i] < 0 || r.sl[i] > 73 || r.sv[i] > 73 || (r.sl[i] > r.sv[i]) !== !!hw[i]) valido = false; }
      if (!valido) malos++;
      if (r.exigencia && r.exigencia !== 'facil') optimizados++;
    }
  }
  prueba(probados + ' vectores "en el filo" resueltos: todos dejan al equipo en el Top 8 con marcadores válidos y ganadores respetados', probados > 50 && malos === 0, malos + ' inválidos de ' + probados);
  console.log('     (' + optimizados + ' de ellos requirieron marcadores ajustados "exigentes"/"muy exigentes")');
}

seccion('T11  Simulador: las frecuencias respetan las probabilidades del modelo');
{
  const P = ESC.prepararProblema(DATOS, {}), N = 60000, S = ESC.crearSimulador(P, 0, ESC.OBJETIVO_PLAYOFFS, ESC.crearRng(2468));
  const gan = new Float64Array(P.n);
  for (let s = 0; s < N; s++) { S.muestrear(null); for (let i = 0; i < P.n; i++) gan[i] += S.hw[i]; }
  let maxDif = 0, peor = '';
  P.G.forEach((x, i) => { const dif = Math.abs(gan[i] / N - x.pHome); if (dif > maxDif) { maxDif = dif; peor = x.local + ' vs ' + x.visita; } });
  prueba('en los ' + P.n + ' juegos la frecuencia simulada difiere de p en menos de 1 punto', maxDif < 0.01, 'máx ' + (maxDif * 100).toFixed(2) + ' pts en ' + peor);
  const tigresCetys = P.G.find(x => x.local === 'Zorros CETYS' || x.visita === 'Zorros CETYS');
  prueba('un juego "casi imposible" nunca baja del 3 % ni sube del 97 % (se ve en la simulación)', gan.every((g, i) => g / N > 0.02 && g / N < 0.98));
}

seccion('T12  Optimalidad: el primer vector que halla la búsqueda es el MÁS PROBABLE (fuerza bruta, corte J8)');
{
  const d8 = datosConCorte(8), P8 = ESC.prepararProblema(d8, {}), obj = ESC.OBJETIVO_PLAYOFFS; let comparados = 0, iguales = 0;
  P8.equipos.forEach(eq => {
    const T = P8.idx[eq], cumple = hw => ESC.evaluarVector(P8, hw, T, obj, 'clasificar').cumple;
    if (cumple(ESC.ganadoresFavoritos(P8))) return;
    let mejor = Infinity;
    for (let v = 0; v < (1 << P8.n); v++) {
      const hw = P8.G.map((_, i) => !!((v >> i) & 1)); let c = 0; P8.G.forEach((x, i) => { if (hw[i] !== x.favHome) c += x.costo; });
      if (c < mejor && cumple(hw)) mejor = c;
    }
    const r = ESC.buscarVectores(P8, cumple, 1, null, null), hallado = r.vectores.length ? r.vectores[0].costo : Infinity;
    comparados++; if ((mejor === Infinity && hallado === Infinity) || Math.abs(mejor - hallado) < 1e-9) iguales++;
  });
  prueba('coincide con la fuerza bruta en los ' + comparados + ' equipos que necesitan sorpresas (incluye los imposibles)', comparados >= 3 && iguales === comparados, iguales + '/' + comparados);
}

seccion('T13  Sin falsos negativos evidentes del optimizador de marcadores');
{
  const P = ESC.prepararProblema(DATOS, {}), obj = ESC.OBJETIVO_PLAYOFFS, r2 = ESC.crearRng(31337); let filo = 0, dicenNo = 0, rescatados = 0;
  for (const eq of ['Burros Blancos', 'Linces UVM', 'Borregos GDL', 'Borregos CEM']) {
    const T = P.idx[eq];
    for (let s = 0; s < 400; s++) {
      const hw = P.G.map(x => r2() < x.pHome);
      if (ESC.clasificarVictorias(P, ESC.victorias(P, hw), T, obj) !== ESC.FILO) continue; filo++;
      if (ESC.resolverDesempate(P, hw, T, obj).ok) continue; dicenNo++;
      const base = ESC.marcadoresBase(P, hw); let hallado = false;
      for (let k = 0; k < 1200 && !hallado; k++) {
        const sl = Int16Array.from(base.sl), sv = Int16Array.from(base.sv);
        for (let i = 0; i < P.n; i++) {
          let a = base.sl[i] + Math.floor((r2() - 0.5) * 40), b = base.sv[i] + Math.floor((r2() - 0.5) * 40);
          a = Math.min(73, Math.max(0, a)); b = Math.min(73, Math.max(0, b));
          if (hw[i] && a <= b) a = Math.min(73, b + 1 + Math.floor(r2() * 10)); if (!hw[i] && b <= a) b = Math.min(73, a + 1 + Math.floor(r2() * 10));
          if (a === b || (hw[i] ? a < b : b < a)) { a = base.sl[i]; b = base.sv[i]; }
          sl[i] = a; sv[i] = b;
        }
        if (ESC.posicionDe(ESC.tablaFinal(P, sl, sv), eq) <= 8) hallado = true;
      }
      if (hallado) rescatados++;
    }
  }
  prueba(filo + ' vectores EN EL FILO; el motor dijo "no" en ' + dicenNo + ' y la búsqueda aleatoria no rescató ninguno', filo > 100 && rescatados === 0, rescatados + ' rescatados');
}

seccion('T14  Protocolo del Web Worker (escenarios-worker.js ejecutado en un contexto aislado)');
{
  const vm = require('vm');
  const mensajes = [];
  const ctx = { console: console, structuredClone: structuredClone };
  ctx.self = ctx; ctx.postMessage = m => mensajes.push(m);
  ctx.importScripts = (...archivos) => archivos.forEach(f => vm.runInContext(fs.readFileSync(path.join(RAIZ, f), 'utf8'), ctx, { filename: f }));
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, 'escenarios-worker.js'), 'utf8'), ctx, { filename: 'escenarios-worker.js' });
  prueba('el worker carga prediccion.js y escenarios.js con importScripts', typeof ctx.ONEFA_PRED === 'object' && typeof ctx.ONEFA_ESC === 'object');
  ctx.onmessage({ data: { tipo: 'analizar', id: 7, datos: clon(DATOS), opciones: { equipo: 'Linces UVM', sims: 3000, simsVictorias: 500, simsFamilia: 800 } } });
  const progreso = mensajes.filter(m => m.tipo === 'progreso'), res = mensajes.filter(m => m.tipo === 'resultado');
  prueba('emite mensajes de progreso con las fases esperadas', ['enumeracion', 'montecarlo', 'busqueda'].every(f => progreso.some(m => m.fase === f)), progreso.map(m => m.fase).filter((v, i, a) => a.indexOf(v) === i).join(','));
  prueba('todos los mensajes llevan el id de la petición', mensajes.every(m => m.id === 7));
  prueba('termina con exactamente un mensaje "resultado" (estado ok)', res.length === 1 && res[0].resultado.estado === 'ok' && res[0].resultado.meta.equipo === 'Linces UVM');
  let clonable = true; try { structuredClone(res[0]); } catch (e) { clonable = false; }
  prueba('el resultado es clonable por postMessage (sin funciones ni tipos raros)', clonable);
  mensajes.length = 0;
  ctx.onmessage({ data: { tipo: 'analizar', id: 8, datos: clon(DATOS), opciones: { equipo: 'Equipo Inexistente' } } });
  prueba('un equipo inexistente produce un mensaje "error" (no revienta el worker)', mensajes.some(m => m.tipo === 'error' && m.id === 8 && /no encontrado/i.test(m.mensaje)));
  mensajes.length = 0;
  ctx.onmessage({ data: { tipo: 'otra-cosa' } });
  prueba('ignora mensajes que no conoce', mensajes.length === 0);
}

console.log('\n' + '='.repeat(70));
console.log(ok + ' pruebas correctas, ' + mal + ' fallidas   (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)');
if (mal) { console.log('Fallaron: ' + fallos.join(' | ')); process.exit(1); }
