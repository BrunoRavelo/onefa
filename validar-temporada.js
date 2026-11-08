#!/usr/bin/env node
/* tools/validar-temporada.js — revisa los JSON de una temporada antes de publicarla
   Uso:   node tools/validar-temporada.js 2027      (o sin año: la temporada ACTUAL de temporadas.js)
   Revisa: estructura, nombres de equipos, juegos por equipo, jornadas, resultados «del futuro», juegos
   repetidos entre dos equipos y que la temporada esté en temporadas.js. Sin dependencias (solo Node).
   Termina con código 1 si hay ERRORES (los AVISOS no). */
'use strict';
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');
const T = require('../temporadas.js');
const anio = parseInt(process.argv[2], 10) || T.actual;
let errores = 0, avisos = 0;
const err = m => { errores++; console.log('  ✘ ERROR: ' + m); }, av = m => { avisos++; console.log('  ! aviso: ' + m); }, ok = m => console.log('  ✔ ' + m);
const carga = f => {
  const ruta = path.join(RAIZ, f);
  if (!fs.existsSync(ruta)) { err('no existe ' + f); return null; }
  try { return JSON.parse(fs.readFileSync(ruta, 'utf8')); } catch (e) { err(f + ' no es JSON válido: ' + e.message); return null; }
};

function revisa(nombre, d, equipos, esNac) {
  console.log('\n' + nombre + ' (' + equipos.length + ' equipos, ' + (d.juegos || []).length + ' juegos)');
  if (!d) return;
  if (d.temporada != null && d.temporada !== anio) av('el campo "temporada" dice ' + d.temporada + ' y se esperaba ' + anio);
  if (!Number.isInteger(d.jornadas_jugadas) || d.jornadas_jugadas < 0) err('"jornadas_jugadas" debe ser un entero ≥ 0');
  const set = new Set(equipos);
  if (set.size !== equipos.length) err('hay equipos repetidos en la lista');
  if (!Array.isArray(d.juegos)) { err('"juegos" debe ser un arreglo'); return; }
  const jj = d.jornadas_jugadas, cuenta = {}, porJornada = {}, parejas = {};
  equipos.forEach(t => cuenta[t] = 0);
  let ultima = 0;
  d.juegos.forEach((g, i) => {
    const id = 'juego #' + (i + 1) + ' (J' + g.jornada + ' ' + g.local + ' vs ' + g.visita + ')';
    if (!set.has(g.local)) err(id + ': "' + g.local + '" no está en la lista de equipos');
    if (!set.has(g.visita)) err(id + ': "' + g.visita + '" no está en la lista de equipos');
    if (g.local === g.visita) err(id + ': un equipo no puede jugar contra sí mismo');
    if (!Number.isInteger(g.jornada) || g.jornada < 0) err(id + ': jornada no válida');
    if (!Number.isInteger(g.scoreLocal) || !Number.isInteger(g.scoreVisita) || g.scoreLocal < 0 || g.scoreVisita < 0) err(id + ': marcadores no válidos');
    if (g.jornada > ultima) ultima = g.jornada;
    const total = (g.scoreLocal || 0) + (g.scoreVisita || 0);
    if (g.jornada <= jj && g.jornada >= 0 && total === 0) av(id + ': jornada ya jugada pero sin marcador (se tratará como aplazado/pendiente)');
    if (g.jornada > jj && total > 0) av(id + ': tiene marcador pero su jornada es posterior a "jornadas_jugadas" (' + jj + '): no se contará');
    if (g.scoreLocal === g.scoreVisita && total > 0) av(id + ': empate ' + g.scoreLocal + '-' + g.scoreVisita + ' (no cuenta para la tabla)');
    const cs = g.cuentaSoloPara;
    [g.local, g.visita].forEach(t => { if (t in cuenta && (!cs || cs.indexOf(t) >= 0)) cuenta[t]++; });
    ((porJornada[g.jornada] = porJornada[g.jornada] || {})[g.local] = (porJornada[g.jornada][g.local] || 0) + 1);
    porJornada[g.jornada][g.visita] = (porJornada[g.jornada][g.visita] || 0) + 1;
    const k = [g.local, g.visita].sort().join(' | '); (parejas[k] = parejas[k] || []).push('J' + g.jornada);
  });
  Object.keys(porJornada).forEach(j => Object.keys(porJornada[j]).forEach(t => { if (porJornada[j][t] > 1) err('J' + j + ': "' + t + '" juega ' + porJornada[j][t] + ' veces en la misma jornada'); }));
  if (d.juegos.length) {
    if (jj > ultima) err('"jornadas_jugadas" (' + jj + ') es mayor que la última jornada del calendario (' + ultima + ')');
    const vals = Object.values(cuenta), min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    if (min === max) ok('todos los equipos tienen ' + min + ' juegos oficiales');
    else (esNac ? err : av)('juegos oficiales distintos por equipo (mín ' + min + ', máx ' + max + '): ' + Object.keys(cuenta).filter(t => cuenta[t] !== max).map(t => t + '=' + cuenta[t]).join(', ') +
      (esNac ? '. En Nacional todos deben tener los mismos (usa "cuentaSoloPara" para igualar).' : ''));
    Object.keys(parejas).filter(k => parejas[k].length > 1).forEach(k => av('se enfrentan más de una vez: ' + k + ' (' + parejas[k].join(', ') + '). El resultado directo usa el PRIMER juego del arreglo.'));
    ok('última jornada del calendario: J' + ultima + ' · jornadas jugadas: ' + jj + ' · el módulo de escenarios funciona de la J6 a la J' + (ultima - 1));
  } else av('sin juegos todavía (esqueleto): llénalos con el calendario');
}

console.log('Validando la temporada ' + anio);
const d14 = carga('onefa_data_' + anio + '.json'), dn = carga('onefa_nacional_' + anio + '.json');
if (d14) revisa('onefa_data_' + anio + '.json (14 Grandes)', d14, d14.equipos || [], false);
if (dn) {
  const grupos = dn.grupos || {}, todos = [].concat.apply([], Object.values(grupos));
  if (Object.keys(grupos).length !== 3) err('Nacional debe tener 3 grupos (top 2 + 2 mejores terceros); tiene ' + Object.keys(grupos).length);
  revisa('onefa_nacional_' + anio + '.json (Nacional)', dn, todos, true);
}
console.log('\nConfiguración (temporadas.js)');
if (T.disponibles.indexOf(anio) >= 0) ok(anio + ' está en DISPONIBLES' + (T.actual === anio ? ' y es la temporada ACTUAL' : ' (histórica)'));
else av(anio + ' NO está en temporadas.js: las páginas todavía no la muestran (agrégala al inicio de DISPONIBLES y pon ACTUAL = ' + anio + ' cuando esté lista)');
console.log('\n' + (errores ? '✘ ' + errores + ' error(es)' : '✔ sin errores') + ' · ' + avisos + ' aviso(s)');
process.exit(errores ? 1 : 0);
