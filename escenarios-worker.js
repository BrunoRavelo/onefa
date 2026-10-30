/* escenarios-worker.js — Web Worker del módulo de escenarios
   ============================================================================
   Ejecuta el motor (escenarios.js para 14 Grandes, escenarios-nacional.js para
   Conferencia Nacional) fuera del hilo principal para que la pantalla no se
   congele mientras se simula (puede tardar varios segundos).

   Protocolo de mensajes:
     página → worker : { tipo:'analizar', id, datos, opciones }     (opciones.conferencia: '14g' | 'nacional')
                       { tipo:'panorama', id, datos, opciones }     (solo Nacional: estado exacto de todos los equipos)
     worker → página : { tipo:'progreso', id, fase, pct }
                       { tipo:'resultado', id, resultado }
                       { tipo:'error', id, mensaje }

   Cancelar = que la página llame a worker.terminate() (el motor corre de forma
   síncrona dentro del worker, así que no puede leer mensajes mientras calcula).
   Las rutas de importScripts son relativas a ESTE archivo (misma carpeta raíz).
   ============================================================================ */
'use strict';
importScripts('prediccion.js', 'escenarios.js');
// El motor de Nacional va aparte: si no se pudiera cargar, 14 Grandes sigue funcionando.
try { importScripts('escenarios-nacional.js'); } catch (e) { /* Nacional no disponible */ }

function motorDe(opciones) {
  const nac = !!(opciones && opciones.conferencia === 'nacional');
  const motor = nac ? self.ONEFA_ESC_NAC : self.ONEFA_ESC;
  if (!motor) throw new Error('El motor de ' + (nac ? 'Conferencia Nacional' : '14 Grandes') + ' no está disponible');
  return motor;
}

self.onmessage = function (e) {
  const m = e.data || {};
  if (m.tipo !== 'analizar' && m.tipo !== 'panorama') return;
  try {
    const motor = motorDe(m.opciones);
    const ctx = {
      progreso: function (fase, pct) { self.postMessage({ tipo: 'progreso', id: m.id, fase: fase, pct: pct }); },
      cancelado: function () { return false; }
    };
    const resultado = (m.tipo === 'panorama') ? motor.panorama(m.datos, m.opciones, ctx) : motor.analizar(m.datos, m.opciones, ctx);
    self.postMessage({ tipo: 'resultado', id: m.id, resultado: resultado });
  } catch (err) {
    self.postMessage({ tipo: 'error', id: m.id, mensaje: String((err && err.message) || err) });
  }
};
