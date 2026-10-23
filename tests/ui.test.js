// Pruebas de interfaz de "Escenarios de playoffs" (U1–U7). Uso:  cd tests/ui && npm install && node ui.test.js
// Comprueban comportamiento y DOM (no el aspecto visual: jsdom no calcula estilos ni layout).
const { abrirPagina, esperar } = require('./harness.js');
let ok = 0, mal = 0; const prueba = (n, c, d) => { if (c) { ok++; console.log('  ✔ ' + n); } else { mal++; console.log('  ✘ ' + n + (d ? ' → ' + d : '')); } };
const sec = t => console.log('\n' + t);
const escoger = (d, nombre) => { const s = d.getElementById('escEquipo'); const op = [...s.options].find(o => o.value === nombre); s.value = op.value; s.dispatchEvent(new d.defaultView.Event('change')); };

(async () => {
  sec('U1  Botón y apertura del overlay (con Web Worker emulado)');
  let { w, d, errores, estado } = await abrirPagina({});
  const btn = d.getElementById('btnEscenarios');
  prueba('el botón "Escenarios de playoffs" existe en index.html', !!btn && /Escenarios/.test(btn.textContent));
  prueba('el overlay no existe hasta que se abre (carga perezosa)', !d.getElementById('escOverlay'));
  btn.click();
  await esperar(() => !d.getElementById('escEquipo').disabled, 5000, 'selector de equipos habilitado');
  prueba('el overlay queda abierto y bloquea el scroll del fondo', d.getElementById('escOverlay').classList.contains('open') && d.body.style.overflow === 'hidden');
  const opts = [...d.getElementById('escEquipo').options].map(o => o.textContent);
  prueba('el selector lista los 14 equipos ordenados como la tabla (posición. equipo (G-P))', opts.length === 15 && /^1\. /.test(opts[1]) && /\(\d+-\d+\)$/.test(opts[1]), opts[1]);
  prueba('el hero indica la jornada concluida', /Jornada 6 concluida/.test(d.getElementById('escMeta').textContent));

  sec('U2  Análisis de un equipo en la burbuja (Linces UVM) por la vía del Worker');
  escoger(d, 'Linces UVM'); const anchos = [];
  const mo = new w.MutationObserver(() => anchos.push(d.getElementById('escBarraFill').style.width)); mo.observe(d.getElementById('escBarraFill'), { attributes: true });
  d.getElementById('escAnalizar').click();
  prueba('mientras calcula se ve "Simulando opciones…" y el botón se bloquea', !d.getElementById('escProgreso').hidden && /Simulando opciones/.test(d.getElementById('escProgreso').textContent) && d.getElementById('escAnalizar').disabled);
  await esperar(() => d.querySelector('#escResultado .esc-resumen'), 60000, 'resultado');
  mo.disconnect();
  const txt = d.getElementById('escResultado').textContent;
  prueba('se creó exactamente un Worker y ya se cerró', estado.creados.length === 1 && estado.terminados === 1);
  prueba('la barra de progreso avanzó por etapas', new Set(anchos).size >= 3, [...new Set(anchos)].join(' '));
  prueba('el progreso se oculta y los controles se rehabilitan', d.getElementById('escProgreso').hidden && !d.getElementById('escAnalizar').disabled);
  prueba('muestra el equipo, la probabilidad y la situación', /Linces UVM/.test(txt) && /\d+\.\d %/.test(txt) && /En la burbuja/.test(txt));
  prueba('muestra la tabla "según tus victorias propias"', /Según tus victorias propias/.test(txt) && d.querySelectorAll('#escResultado .s-tbl')[0].querySelectorAll('tbody tr').length >= 2);
  prueba('muestra juegos clave y ayuda de otros equipos', /Juegos clave/.test(txt) && /Ayuda de otros equipos/.test(txt));
  const tabs = d.querySelectorAll('.esc-tab');
  prueba('hay pestañas de escenarios y solo el primer panel visible', tabs.length >= 2 && d.querySelectorAll('.esc-panel.on').length === 1);
  prueba('el escenario muestra resultados necesarios y marcadores por jornada', /Resultados necesarios/.test(txt) && d.querySelectorAll('.esc-panel.on .esc-tbl tbody tr').length >= 20);
  tabs[1].click();
  prueba('al cambiar de pestaña cambia el panel visible', d.querySelector('.esc-panel.on').getAttribute('data-i') === '1' && tabs[1].classList.contains('on') && !tabs[0].classList.contains('on'));
  prueba('el juego aplazado Tigres–MTY aparece marcado como APLAZADO', /APLAZADO/.test(d.getElementById('escResultado').innerHTML));
  prueba('incluye el aviso de límites del modelo', /sugerencias plausibles/.test(txt) && /3 %–97 %/.test(txt));
  prueba('el juego de Linces se resalta en la tabla de marcadores', d.querySelectorAll('.esc-panel.on .esc-row-eq').length >= 1);
  prueba('la tabla final proyectada marca el corte del Top 8', d.querySelectorAll('.esc-panel.on details .r-cutoff').length === 1);
  prueba('sin errores de JavaScript', errores.length === 0, errores.join(' | '));

  sec('U3  Cerrar, reabrir y solo lectura');
  d.getElementById('escBack').click();
  prueba('"Regresar" cierra el overlay y restaura el scroll', !d.getElementById('escOverlay').classList.contains('open') && d.body.style.overflow !== 'hidden');
  const antes = JSON.stringify(Object.entries(w.localStorage));
  btn.click();
  prueba('reabrir conserva el último equipo elegido', d.getElementById('escEquipo').value === 'Linces UVM');
  prueba('no escribe en localStorage (solo lectura)', JSON.stringify(Object.entries(w.localStorage)) === antes && w.localStorage.length === 0);
  d.getElementById('escBack').click();

  sec('U4  Equipo favorito (Tigres): búsqueda de riesgos omitida');
  btn.click(); await esperar(() => !d.getElementById('escEquipo').disabled, 5000, 'selector');
  escoger(d, 'Auténticos Tigres'); d.getElementById('escAnalizar').click();
  await esperar(() => d.querySelector('#escResultado .esc-resumen'), 60000, 'resultado Tigres');
  prueba('indica "Prácticamente clasificado" en lugar de escenarios inútiles', /Prácticamente clasificado/.test(d.getElementById('escResultado').textContent) && d.querySelectorAll('.esc-tab').length === 0);
  prueba('sin errores de JavaScript', errores.length === 0, errores.join(' | '));
  d.getElementById('escBack').click();

  sec('U5  Cancelar un análisis en curso');
  btn.click(); await esperar(() => !d.getElementById('escEquipo').disabled, 5000, 'selector');
  escoger(d, 'Borregos GDL'); const t0 = estado.terminados; d.getElementById('escAnalizar').click();
  prueba('mientras calcula aparece el botón Cancelar', !d.getElementById('escCancelar').hidden);
  d.getElementById('escCancelar').click();
  prueba('cancelar termina el Worker, oculta el progreso y avisa', estado.terminados === t0 + 1 && d.getElementById('escProgreso').hidden && /Análisis cancelado/.test(d.getElementById('escResultado').textContent));
  await new Promise(r => setTimeout(r, 400));
  prueba('después de cancelar no aparece ningún resultado tardío', !d.querySelector('#escResultado .esc-resumen'));
  prueba('los controles quedan listos para analizar otra vez', !d.getElementById('escAnalizar').disabled && !d.getElementById('escEquipo').disabled);
  d.getElementById('escBack').click();

  sec('U6  Respaldo sin Web Worker (hilo principal)');
  ({ w, d, errores, estado } = await abrirPagina({ worker: 'roto' }));
  d.getElementById('btnEscenarios').click(); await esperar(() => !d.getElementById('escEquipo').disabled, 5000, 'selector');
  escoger(d, 'Borregos CEM'); d.getElementById('escAnalizar').click();
  await esperar(() => !d.getElementById('escProgreso').hidden, 5000, 'progreso en modo compatible');
  prueba('avisa que está en modo compatible y oculta Cancelar', /Modo compatible/.test(d.getElementById('escProgresoNota').textContent) && d.getElementById('escCancelar').hidden);
  await esperar(() => d.querySelector('#escResultado .esc-resumen'), 60000, 'resultado en modo compatible');
  prueba('el resultado se muestra igual (carga escenarios.js por su cuenta)', /Borregos CEM/.test(d.getElementById('escResultado').textContent) && typeof w.ONEFA_ESC === 'object');
  prueba('Borregos CEM (ya clasifica con lo esperado) muestra "Qué podría hacerte fallar"', /Qué podría hacerte fallar/.test(d.getElementById('escResultado').textContent) && /ya clasificas/.test(d.getElementById('escResultado').textContent));
  prueba('sin errores de JavaScript', errores.length === 0, errores.join(' | '));

  sec('U7  Compuertas');
  ({ w, d, errores } = await abrirPagina({ query: '?temporada=2025' }));
  prueba('en el histórico 2025 el botón se oculta', d.getElementById('btnEscenarios').style.display === 'none');
  ({ w, d, errores } = await abrirPagina({ jornadas: 5 }));
  d.getElementById('btnEscenarios').click(); await esperar(() => /Disponible a partir/.test(d.getElementById('escResultado').textContent), 5000, 'mensaje de compuerta');
  prueba('con J5 concluida muestra "Disponible a partir de la Jornada 6" y bloquea los controles', d.getElementById('escAnalizar').disabled && d.getElementById('escEquipo').disabled);
  ({ w, d, errores } = await abrirPagina({ jornadas: 10 }));
  d.getElementById('btnEscenarios').click(); await esperar(() => /ya concluyó/.test(d.getElementById('escResultado').textContent), 5000, 'mensaje de temporada concluida');
  prueba('con J10 concluida avisa que la temporada ya terminó', true);

  console.log('\n' + '='.repeat(60) + '\n' + ok + ' correctas, ' + mal + ' fallidas');
  process.exit(mal ? 1 : 0);
})().catch(e => { console.error('ERROR DEL ARNÉS:', e); process.exit(2); });
