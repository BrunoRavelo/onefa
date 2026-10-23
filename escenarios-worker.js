/* escenarios-worker.js — Web Worker del módulo de escenarios
   ============================================================================
   Ejecuta el motor (escenarios.js) fuera del hilo principal para que la pantalla
   no se congele mientras se simula (puede tardar varios segundos).

   Protocolo de mensajes:
     página → worker : { tipo:'analizar', id, datos, opciones }
     worker → página : { tipo:'progreso', id, fase, pct }
                       { tipo:'resultado', id, resultado }
                       { tipo:'error', id, mensaje }

   Cancelar = que la página llame a worker.terminate() (el motor corre de forma
   síncrona dentro del worker, así que no puede leer mensajes mientras calcula).
   Las rutas de importScripts son relativas a ESTE archivo (misma carpeta raíz).
   ============================================================================ */
'use strict';
importScripts('prediccion.js', 'escenarios.js');

self.onmessage = function (e) {
  const m = e.data || {};
  if (m.tipo !== 'analizar') return;
  try {
    const resultado = self.ONEFA_ESC.analizar(m.datos, m.opciones, {
      progreso: function (fase, pct) { self.postMessage({ tipo: 'progreso', id: m.id, fase: fase, pct: pct }); },
      cancelado: function () { return false; }
    });
    self.postMessage({ tipo: 'resultado', id: m.id, resultado: resultado });
  } catch (err) {
    self.postMessage({ tipo: 'error', id: m.id, mensaje: String((err && err.message) || err) });
  }
};
