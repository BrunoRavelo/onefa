/* temporadas.js — ÚNICO lugar donde se declaran las temporadas del sitio
   ============================================================================
   Lo leen: las 3 páginas (selector de temporada, archivo JSON a cargar, banner de histórico),
   prediccion.js (qué archivos descargar y cuál es la temporada «anterior» para los priors),
   los motores de escenarios (usan el JSON más reciente que reciban, sin año a mano) y sw.js
   (qué archivos guardar en el celular).

   PARA AGREGAR UNA TEMPORADA NUEVA (p. ej. 2027):
     1) Crea los JSON:  node tools/nueva-temporada.js 2027   (parte de los equipos de la temporada anterior)
     2) Edítalos (ascensos/descensos, calendario) y revísalos:  node tools/validar-temporada.js 2027
     3) Aquí: pon  ACTUAL = 2027  y agrega 2027 al inicio de DISPONIBLES.
     4) Sube VERSION en sw.js (para que todos descarguen lo nuevo).
     5) Revisa las listas por temporada de prediccion.js (EQUIPOS_EXCLUIDOS) y nacional.html (EQUIPOS_14G).
   ============================================================================ */
(function (global) {
  'use strict';

  const ACTUAL = 2026;
  const DISPONIBLES = [2026, 2025];          // orden del selector: la más reciente primero

  const API = {
    actual: ACTUAL,
    disponibles: DISPONIBLES.slice(),
    // Temporada pedida en la URL (?temporada=…): si no está disponible, la actual
    resolver: function (param) {
      const y = parseInt(param, 10);
      return DISPONIBLES.indexOf(y) >= 0 ? y : ACTUAL;
    },
    esActual: function (y) { return Number(y) === ACTUAL; },
    // Temporada disponible inmediatamente anterior a `y` (null si no hay)
    anterior: function (y) {
      let mejor = null;
      DISPONIBLES.forEach(function (d) { if (d < y && (mejor === null || d > mejor)) mejor = d; });
      return mejor;
    },
    archivo14: function (y) { return './onefa_data_' + y + '.json'; },
    archivoNac: function (y) { return './onefa_nacional_' + y + '.json'; },
    // Temporadas que necesita el modelo de predicción: la actual y su anterior (prior)
    paraModelo: function () {
      const prev = API.anterior(ACTUAL);
      return prev === null ? [ACTUAL] : [ACTUAL, prev];
    },
    // Todos los archivos de datos (para guardarlos en el celular)
    archivos: function () {
      const a = [];
      DISPONIBLES.forEach(function (y) { a.push(API.archivo14(y), API.archivoNac(y)); });
      return a;
    },
    // <option> del selector de temporada
    opcionesSelector: function () {
      return DISPONIBLES.map(function (y) { return '<option value="' + y + '">' + y + '</option>'; }).join('');
    }
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = API; }
  else { global.ONEFA_TEMP = API; }
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));
