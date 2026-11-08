#!/usr/bin/env node
/* tools/nueva-temporada.js — crea los JSON «esqueleto» de una temporada nueva
   Uso:   node tools/nueva-temporada.js 2027  [--forzar]
   Parte de los equipos y grupos de la temporada anterior más reciente; deja los juegos vacíos para que
   los llenes con el calendario. No toca temporadas.js (eso lo haces tú al final: ver el checklist).
   No tiene dependencias (solo Node). */
'use strict';
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');
const anio = parseInt(process.argv[2], 10), forzar = process.argv.includes('--forzar');
if (!(anio >= 2000)) { console.error('Uso: node tools/nueva-temporada.js AAAA [--forzar]'); process.exit(1); }

// temporada anterior más reciente con sus dos archivos
const previos = fs.readdirSync(RAIZ).map(f => /^onefa_data_(\d{4})\.json$/.exec(f)).filter(Boolean).map(m => +m[1])
  .filter(y => y < anio && fs.existsSync(path.join(RAIZ, 'onefa_nacional_' + y + '.json'))).sort((a, b) => b - a);
if (!previos.length) { console.error('No hay una temporada anterior con onefa_data_AAAA.json y onefa_nacional_AAAA.json.'); process.exit(1); }
const prev = previos[0];
const lee = f => JSON.parse(fs.readFileSync(path.join(RAIZ, f), 'utf8'));
const d14 = lee('onefa_data_' + prev + '.json'), dnac = lee('onefa_nacional_' + prev + '.json');

const salida = [
  ['onefa_data_' + anio + '.json', {
    temporada: anio, jornadas_jugadas: 0, equipos: d14.equipos.slice(), juegos: [],
    _nota: 'Esqueleto generado desde la temporada ' + prev + ': revisa ascensos/descensos en "equipos" y llena "juegos" con el calendario (jornada, local, visita, scoreLocal 0, scoreVisita 0).'
  }],
  ['onefa_nacional_' + anio + '.json', {
    temporada: anio, conferencia: 'Nacional', jornadas_jugadas: 0,
    grupos: JSON.parse(JSON.stringify(dnac.grupos)),
    nota_desempate: dnac.nota_desempate || '', juegos: [], scrimmages: [],
    _nota: 'Esqueleto generado desde la temporada ' + prev + ': revisa equipos y grupos y llena "juegos" (los juegos entre grupos también). Si algún juego solo cuenta para un equipo, agrega "cuentaSoloPara":["Equipo"].'
  }]
];
let creados = 0;
salida.forEach(([nombre, obj]) => {
  const ruta = path.join(RAIZ, nombre);
  if (fs.existsSync(ruta) && !forzar) { console.log('  ya existe (no se sobrescribe): ' + nombre + '   (usa --forzar para rehacerlo)'); return; }
  fs.writeFileSync(ruta, JSON.stringify(obj, null, 2) + '\n'); creados++; console.log('  creado: ' + nombre);
});
console.log('\nListo (' + creados + ' archivo(s)) a partir de la temporada ' + prev + '. Faltan estos pasos:');
console.log('  1) Edita los equipos/grupos y llena los juegos de ambos JSON.');
console.log('  2) node tools/validar-temporada.js ' + anio + '      (revisa nombres, juegos por equipo, jornadas)');
console.log('  3) En temporadas.js: ACTUAL = ' + anio + ' y agrega ' + anio + ' al inicio de DISPONIBLES.');
console.log('  4) En sw.js sube VERSION (v5, v6…) para que todos descarguen lo nuevo.');
console.log('  5) Revisa EQUIPOS_EXCLUIDOS en prediccion.js y EQUIPOS_14G en nacional.html (listas por temporada).');
