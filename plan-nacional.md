# Plan — Motor de escenarios de clasificación para Conferencia Nacional

> Versión 2 · 2026-10-28 · Reemplaza el borrador anterior.
> Nombre: `plan-nacional.md`, para no pisar el `plan.md` de 14 Grandes.
>
> **Leído:** `CLAUDE.md`, `plan.md` (14G), `prediccion.js`, `escenarios.js`, `escenarios-worker.js`, `escenarios-ui.js`, `harness.js`, `sw.js`,
> `nacional.html`, `index.html`, `calendario_equipo.html`, `onefa_nacional_2025.json`, `onefa_nacional_2026.json`, `onefa_data_2026.json`.
> **Datos medidos:** todo lo marcado *(medido)* sale de scripts que corrí sobre tus JSON reales de hoy (`jornadas_jugadas = 8`).
> **Pruebas (tests):** fuera de este sprint, por indicación tuya. La sección 7 solo deja anotado qué se probará después.

---

## Estado de implementación (2026-10-29)

Fases 0, 1, 2, 3 y 4 programadas; **pruebas (fase 5) pendientes para el siguiente sprint**. Cambios respecto al diseño original:

- **Regla de desempate confirmada por el usuario** = la de `nacional.html` (venció a todos los demás empatados → primero; el resto por menor PC). Quedó en **una sola función**,
  `ONEFA_PRED.ordenarEmpatados`, usada por 14G y por los grupos de Nacional (verificado: 0 diferencias en 3,000 temporadas aleatorias de 14G y de Nacional).
- **Sin duplicar donde se pudo:** `escenarios-nacional.js` toma de `escenarios.js` el RNG, `probit`, `victorias`, `marcadoresBase`, `optimizarMarcadores` y la búsqueda `buscarVectores`.
  Se duplicó solo lo que allí estaba atado a 14G. `escenarios.js` no se modificó.
- **Sin topes en la enumeración:** con J6 son 19 variables y tarda decenas de milisegundos; el panorama completo de los 18 equipos tarda ~0.6 s.
- **Sin años escritos a mano** (válido para 2027 salvo `construirModelosPorConferencia`/`cargarDatos` de `prediccion.js`, que hay que actualizar al agregar la temporada).
- **Se corrigió un detalle de 14G que aquí no se heredó:** `construirFamilia` solo refuerza la condición con un juego si mejora la probabilidad más que el ruido de la simulación.
- **Constantes medidas en Nacional:** `sigmaPuntos = 15.0`, `maxPuntos = 70`, `sigmaTotal = 12.4`.

---

## 0. Resumen

**Qué se quiere:** el usuario elige un equipo de Nacional y la página le dice qué tiene que pasar para que clasifique a playoffs: probabilidad, juegos clave, escenarios con marcadores, y si ya está clasificado o eliminado.

**Qué propongo:**

1. Un archivo **nuevo**, `escenarios-nacional.js`, que es una **copia adaptada** de `escenarios.js` (no una generalización). Se publica como `ONEFA_ESC_NAC`. **No se toca `escenarios.js`.**
2. Misma arquitectura que ya funciona en 14G: enumeración exacta → Monte Carlo → búsqueda best-first → marcadores de desempate.
3. Se reescriben solo **4 piezas**: preparación de datos, clasificación rápida por victorias, la regla «¿clasifica?» (pertenecer a los 8, no ocupar una posición) y la búsqueda de marcadores de desempate.
4. Gracias a lo que me aclaraste (**todos juegan los mismos juegos oficiales y la liga ordena por partidos ganados**), el motor trabaja **solo con victorias (PG)**: no hace falta manejar porcentajes ni juegos distintos por equipo. Es la simplificación más grande del diseño.
5. El «oráculo» de quién clasifica es siempre `ONEFA_PRED.calcularStandingsNacional`. **Nunca se reimplementa la tabla.**
6. «Eliminado» y «clasificado» solo se declaran con **prueba exacta** (enumeración), nunca con la simulación.
7. La interfaz y el Worker se **reutilizan**, parametrizados por conferencia.

**Hallazgo que cambia el plan y conviene decidir antes de programar:** `prediccion.js` y `nacional.html` **no ordenan igual** un empate de 3 o más equipos dentro de un grupo (sección 1.3, H3). El motor usaría la regla de `prediccion.js`, y la página que ve el usuario usa otra. Propongo alinear `prediccion.js` con la página en la Fase 0 (un cambio chico).

**Evaluación honesta de la dificultad:** proyecto mediano. Cerca del 70 % del código se copia tal cual. El riesgo real está en el desempate (secciones 4.3 y 4.8), no en el tamaño del problema: con tus datos el espacio es pequeño (sección 1.3, H1 y H4).

---

## 1. Lo que entendí del sistema actual

### 1.1 Cómo funciona el motor de 14G

| Etapa | Qué hace | Dónde |
|---|---|---|
| Preparar | Separa juegos jugados/pendientes (`esPendiente`), calcula victorias y PC base, y la probabilidad de victoria de cada pendiente `p = Φ(margen/σ)` acotada a 3–97 % | `prepararProblema` |
| Cotas exactas | Enumera **todas** las combinaciones de ganadores (código Gray) y etiqueta cada una `SEGURO` / `EN EL FILO` / `FUERA` usando solo victorias | `enumerarExacto`, `clasificarVictorias` |
| Probabilidad | 20,000 simulaciones: cada juego con su probabilidad, marcadores plausibles, posición con la tabla real | `crearSimulador`, `monteCarloCompleto` |
| Victorias propias | P(clasificar \| ganas exactamente k de tus juegos) | `tablaVictoriasPropias` |
| Escenarios | Búsqueda best-first por «costo de sorpresa», condición mínima por juegos pivote, probabilidad de cada familia | `buscarVectores`, `construirFamilia` |
| Desempate | Busca marcadores plausibles que ganen el desempate por PC y los **verifica con la tabla real** | `resolverDesempate`, `optimizarMarcadores` |
| Situación | `clasificado` / `eliminado` / `solo_desempate` (exacto); `favorito` / `burbuja` / `casi_eliminado` (probabilidad) | `situacionEquipo` |

### 1.2 Qué ya está listo para Nacional

- `prediccion.js` ya trae el modelo de Nacional (`modeloNac`), `SIGMA_MARGEN.nacional = 11.4`, `probabilidadVictoria` con `conferencia:'nacional'` y Liebres como resultado forzado.
- `calcularStandingsNacional(grupos, juegos)` ya devuelve `{ allRows, seeds }` (top 2 por grupo + 2 mejores terceros). Es el oráculo.
- `cargarDatos` ya trae `dnac_2026`. El protocolo del Worker no cambia. Las clases `.esc-*` de `onefa.css` ya están pensadas para reutilizarse.
- Tu `plan.md` de 14G ya anticipaba Nacional (§4.7 y §12, Fase 5) con una «estrategia de conferencia». Aquí tomo el camino que pediste («fácil y repetitivo», archivo nuevo); sus puntos de diseño (3 grupos + comodines, cruces que cuentan, Liebres forzado) se respetan tal cual.

### 1.3 Hallazgos al leer tus archivos y datos

**H1 — Hoy ya es «la última semana».** `jornadas_jugadas = 8`; solo falta la J9, con 6 juegos: Águilas–ITSON, Indios–Lobos UA de C, Cimarrones–Liebres (forzado), Toros–Potros Salvajes, Halcones–Pumas Acatlán y Búhos–Frailes. Son **5 variables = 32 combinaciones**. Bajío ya terminó sus 8 juegos. El módulo, apenas exista, se estrena justo en el caso que más te importa.

**H2 — Todos los equipos juegan 8 juegos oficiales** *(medido: los 19 equipos)*, y en 2026 **ningún juego usa `cuentaSoloPara`**. Confirma tu explicación: al final, PG ordena igual que % de victorias. El motor usa PG.

**H3 — Dos reglas distintas para el empate dentro de un grupo.**
- `nacional.html` (`calcGroupStandings`): si un equipo venció directamente a **todos** los demás empatados, va primero; el resto, por menor PC (igual que 14G).
- `prediccion.js` (`calcularStandingsNacional`): ordena los empatados **por pares** (`ordenarEmpateDirecto`).
- Con 2 empatados dan lo mismo. Con 3 o más pueden diferir: en una prueba sintética con 3 equipos en ciclo (A vence a B, B a C, C a A) los dos códigos dieron **orden distinto en el 82 % de 20,000 casos**. En las 12,800 temporadas simuladas del estado real de hoy **no apareció ninguna diferencia** (con tan pocos juegos libres casi no se forman esos ciclos), así que el riesgo hoy es bajo, pero es real y crece con más jornadas pendientes.
- Además, `CLAUDE.md` dice que las tres implementaciones «deben mantenerse equivalentes»; en este punto no lo son.
- **Propuesta (Fase 0):** cambiar el empate de grupo de `calcularStandingsNacional` al método de la página. El sembrado general 1–8 ya usa por pares en ambos sitios, así que ahí no hay diferencia.

**H4 — Tamaño del problema.** Tu `plan.md` (§4.7) ya midió Nacional con J6: 22 pendientes, 2 de Liebres forzados → **n = 20 variables (≈ 1 millón de combinaciones)**. Hoy son 5. Mi primer borrador estimaba ~25 variables; estaba equivocado (J8 y J9 tienen solo 6 juegos cada una). Consecuencia: **la enumeración exacta siempre es posible**, sin topes especiales.

**H5 — El desempate no es un detalle, y la etiqueta «por victorias» es conservadora.** Es la limitación que pediste explicar; el detalle y los números reales están en la sección 4.6.

### 1.4 Puntos del código de 14G que asumen 14 Grandes (los que hay que tocar)

| Archivo | Función | Asume |
|---|---|---|
| `escenarios.js` | `prepararProblema` | lanza error si `conferencia !== '14g'`; usa `d14_2026` y `modelo14` |
| `escenarios.js` | `analizar` | lee `datos.d14_2026.jornadas_jugadas` |
| `escenarios.js` | `clasificarVictorias` y el bucle de `enumerarExacto` | posición por victorias en tabla única |
| `escenarios.js` | `califica(pos, obj)` | el objetivo es un rango de posición (1–8) |
| `escenarios.js` | `tablaFinal` / `posicionDe` | `calcularStandings14G` |
| `escenarios.js` | `resolverDesempate` | desempate de 14G |
| `escenarios-worker.js` | `importScripts` y `ONEFA_ESC.analizar` | un solo motor |
| `escenarios-ui.js` | `prepararControles`, `htmlResumen`, `htmlTablaFinal`, textos | `d14_2026`, `calcularStandings14G`, «de 9», «Top 8», `conferencia:'14g'` |
| `escenarios-ui.js` | `iniciar` | ignora botones que no sean `data-esc-conf="14g"` |
| `sw.js` | `PRECACHE`, `VERSION` | no conoce el archivo nuevo |
| `nacional.html` | — | no tiene botón ni `<script src="escenarios-ui.js">` (hoy solo `btnPrediccion`, línea ~85) |

---

## 2. Qué hace distinta a Nacional

### 2.1 Reglas de clasificación (según `calcularStandingsNacional` y `nacional.html`)

- 3 grupos (en 2026: Norte 6, Centro 7, Bajío 6; los grupos cambian entre años, así que **se leen del JSON**, nunca a mano).
- Cada grupo se ordena por victorias. Desempate: resultado directo (barrido) y luego menor PC.
- Clasifican: **1.º y 2.º de cada grupo (6)** + los **2 mejores terceros**. Los 3 terceros se comparan por victorias y, si empatan, por menor PC (sin resultado directo).
- Cuentan **todos** los juegos oficiales con marcador, dentro y entre grupos (2026: 18 cruces en J3, J7 y J8).
- El sembrado 1–8 por PG solo sirve para el bracket; **no afecta quién clasifica**.

### 2.2 Consecuencias para el motor

| # | Diferencia | Consecuencia |
|---|---|---|
| a | Hay **dos** caminos a playoffs: top 2 del grupo, o comodín como mejor tercero | La clasificación rápida debe mirar el grupo del equipo **y** los terceros de los otros dos grupos |
| b | Un juego entre dos equipos de otro grupo puede decidir si el equipo clasifica (la carrera por el comodín) | Los «juegos clave» deben decir si el juego es de su grupo o de la carrera por el comodín |
| c | El objetivo es **pertenecer** a un conjunto de 8 | `califica` cambia a «T ∈ seeds» |
| d | El desempate de grupo es por barrido de resultado directo → PC; el de terceros es solo PC | `resolverDesempate` de 14G no sirve tal cual (sección 4.8) |
| e | Liebres CD Juárez está en Norte pero es resultado **forzado** (1-0 para el rival) | Se queda en las tablas, pero no es variable ni elegible en el selector |
| f | El módulo hoy se abriría con pocos juegos pendientes y muchos equipos ya decididos | Detección exacta y mensajes claros (sección 4.6) |

---

## 3. Decisiones de diseño

| ID | Decisión | Razón |
|---|---|---|
| N1 | Archivo nuevo `escenarios-nacional.js` (copia adaptada), global `ONEFA_ESC_NAC` | Lo pediste. No arriesga el motor de 14G, que ya funciona. |
| N2 | Oráculo = `PRED.calcularStandingsNacional`; objetivo = `T ∈ seeds` | Misma filosofía que 14G: la regla de la app no se reimplementa. |
| N3 | El motor ordena por **victorias (PG)** | Todos terminan con 8 juegos y la liga ordena por PG. Se agrega una **aserción**: si los PJ finales difieren, el motor avisa en `advertencias` (ver 4.2). |
| N4 | Clasificación rápida por victorias a medida (`evaluarVictoriasNac`), **con resultado directo incluido** (4.3) | Sustituye a `clasificarVictorias`; mismo contrato SEGURO / FILO / FUERA, pero mucho menos conservadora. |
| N5 | «Clasificado» y «eliminado» **solo** con prueba exacta | La simulación acota cada juego a 3–97 %, así que casi nunca da 0 % exacto. |
| N6 | Enumeración exacta **siempre** (n ≤ 20), sin tope especial | Medido en tu plan de 14G: 1 M de combinaciones es barato. Se mide de nuevo en la Fase 1. |
| N7 | Desempate genérico: rivales empatados → subconjuntos → optimizador de marcadores → **verificación con el oráculo** | Repetitivo, no depende de razonar cada caso, y no puede dar falsos positivos. |
| N8 | UI única y compartida con una tabla `CONF` por conferencia | El esqueleto (overlay, progreso, cancelar, pestañas) es idéntico. |
| N9 | El Worker elige el motor por `opciones.conferencia` | Cambio de 2 líneas. |
| N10 | Compuertas de jornada derivadas de los datos: mínima 6 (como 14G); máxima = última jornada regular − 1 | Hoy la última es J9, así que el módulo vive en J6–J8. No se escribe «9» a mano. |
| N11 | Mismo contrato de salida que 14G, con campos de posición reemplazados por equivalentes de grupo | Minimiza cambios en la UI. |
| N12 | Heredadas sin cambio: escenario que depende de PC cuenta como «clasifica»; ventaja local 3; probabilidad por juego 3–97 %; aplazados = pendientes; hasta ~1 minuto de espera | Son decisiones tuyas ya tomadas. |
| N13 | **Pruebas diferidas** al siguiente sprint | Tu indicación. Mientras tanto, cada fase tiene una verificación manual mínima (sección 6). |

**Alternativa descartada: generalizar `escenarios.js` con un objeto `reglas`.** Quedaría un solo archivo, pero habría que tocar código que ya funciona y volver a probar todo. Si la duplicación estorba más adelante, se extrae un núcleo común; no hace falta ahora.

**Costo aceptado de copiar:** el código común (RNG, heap, búsqueda, familias) queda duplicado. Regla de mantenimiento para anotar en `CLAUDE.md` junto a la «duplicación intencional» que ya existe: *un arreglo en una función marcada «copiada» del motor debe aplicarse en los dos archivos.*

---

## 4. Diseño técnico

### 4.1 Archivo, API y entrada

```js
// escenarios-nacional.js  (UMD, igual que escenarios.js: window.ONEFA_ESC_NAC / module.exports)
const r = ONEFA_ESC_NAC.analizar(datos, { equipo: 'Búhos IPN' }, { progreso, cancelado });
// datos = { d14_2025, d14_2026, dnac_2025, dnac_2026 }   ← los mismos 4 JSON
```

Opciones distintas a 14G: `conferencia: 'nacional'`; `jornadaMin: 6`; `jornadaMax` derivada de los datos (última jornada regular − 1); `sigmaTotal`, `sigmaPuntos` y `maxPuntos` **recalibrados con datos de Nacional** (en 14G salieron de los datos de 14G; hoy `sigmaTotal = 14` ya está marcado «por calibrar»).

### 4.2 `prepararProblema` de Nacional

Parte de `datos.dnac_2026` y `construirModelosPorConferencia(datos).modeloNac`. Además de lo que ya calcula 14G, el problema trae:

```
equipos[]        todos los equipos de los grupos (incluye Liebres)
grupoDe[t]       índice de grupo 0..2          miembros[g]  equipos de cada grupo
nombresGrupo[g]  'Norte' | 'Centro' | 'Bajío'  (del JSON)
base[t]          victorias ya logradas          pcBase[t]    PC ya acumulado
pendientesDe[t]  cuántos juegos le faltan (para saber si su PC ya es fijo, ver 4.3)
G[i]             juego pendiente: todo lo de 14G (iL, iV, pHome, mu, forzado, costo, a, b, aplazado...)
cruce[i]         true si local y visita son de grupos distintos (solo para etiquetar)
h2hBase          matriz de resultado directo de los juegos ya jugados (mismo criterio que getDirecto)
```

**Aserción de juegos iguales (N3):** al preparar, se calcula cuántos juegos tendrá cada equipo al terminar. Si no son todos iguales, o si algún juego pendiente trae `cuentaSoloPara`, se agrega una **advertencia** («orden por PG; la tabla de la app ordena por %, el resultado puede diferir») y se sigue trabajando con victorias. Hoy no se dispara: es solo un seguro por si la liga cambia el calendario.

### 4.3 Clasificación rápida por victorias: `evaluarVictoriasNac`

Sustituye a `clasificarVictorias`. Dado el vector de victorias finales `W`, los ganadores `hw` y el equipo `T`, responde **sin generar marcadores**:

- `SEGURO`: clasifica pase lo que pase con los marcadores.
- `FUERA`: no clasifica pase lo que pase con los marcadores.
- `FILO`: depende de un desempate **por PC** (que sí requiere marcadores).

```js
function evaluarVictoriasNac(P, W, hw, T) {
  const g = P.grupoDe[T], wT = W[T];

  // 1) Lugar en el grupo: A equipos arriba, 'emp' empatados con T en victorias
  let A = 0; const emp = [];
  for (const u of P.miembros[g]) {
    if (u === T) continue;
    if (W[u] > wT) A++; else if (W[u] === wT) emp.push(u);
  }
  let mejor = A + 1, peor = A + emp.length + 1;       // lugar posible: [mejor, peor]

  // 1b) Regla de la página con los empatados: barrido de resultado directo → luego PC.
  //     El resultado directo ya se conoce con los ganadores fijos (mismo criterio que getDirecto).
  if (emp.length > 0) {
    const todos = [T].concat(emp);
    const barredor = todos.find(a => todos.every(b => a === b || h2h(P, hw, a, b) === 1));
    if (barredor === T)          mejor = peor = A + 1;   // va primero, sin depender de PC
    else if (barredor !== undefined) mejor = A + 2;      // otro va primero; T pelea el resto por PC
    // sin barredor: todos por PC → queda [A+1, A+emp+1]
    // 1c) (opcional) si T y todos los empatados ya no tienen juegos pendientes, su PC es fijo:
    //     se ordena con el PC real y mejor = peor.
  }
  if (mejor > 3)  return FUERA;                       // ni con todos los desempates a favor
  if (peor <= 2)  return SEGURO;                      // top 2 pase lo que pase

  // 2) Carrera por el comodín: el 3.er lugar de cada OTRO grupo (el 3.er mayor número de
  //    victorias del grupo; no depende de cómo se desempaten sus empates internos)
  const terceros = [];
  for (let h = 0; h < 3; h++) if (h !== g) terceros.push(tercerMayor(P, W, h));
  const leGanaAlguno   = terceros.some(x => x <  wT);  // le gana a uno sin importar el desempate
  const leEmpataAlguno = terceros.some(x => x <= wT);  // podría ganarle a uno si gana el PC

  // 3) Mejor y peor caso del desempate por PC
  const optimista = (mejor <= 2) || (mejor === 3 && leEmpataAlguno);
  const pesimista = (peor   <= 2) || (peor   === 3 && leGanaAlguno);
  if (pesimista) return SEGURO;
  return optimista ? FILO : FUERA;
}
```

**Por qué es correcto:**

- El lugar en el grupo está siempre en `[mejor, peor]`. El paso 1b aprovecha que el resultado directo **ya es conocido** con los ganadores fijos (todos los pares de un grupo juegan entre sí), así que no hay que dejarlo en el aire.
- Un 3.º clasifica si **no** es el peor de los tres terceros. Como pasan 2 de 3, le basta ganarle a **uno** de los otros dos (`some`).
- El valor del tercer lugar de otro grupo (su 3.er mayor número de victorias) no depende de cómo se desempaten sus empates. Lo único que queda en el aire es el desempate **entre terceros con las mismas victorias**, que es solo por PC. Eso es justo lo que marca `FILO`.
- Diferencia clave con el borrador anterior: ahora `FILO` significa **«depende de PC»**, no «depende de algún desempate». Con eso desaparecen las falsas alarmas por resultado directo (sección 4.6).

### 4.4 Enumeración exacta

Mismo esqueleto con código Gray que 14G. Cambia solo el cuerpo del bucle: se llama a `evaluarVictoriasNac` en vez de contar `A`/`B`. Devuelve el mismo `{ seguro, filo, fuera }` con conteos y probabilidad.

**Costo:** con J6 hay n = 20 variables (≈ 1 M de combinaciones); hoy son 5 (32 combinaciones). 14G mide 43 ns por combinación con un bucle muy corto; este será más pesado (hay que recorrer el grupo y buscar los terceros de otros dos grupos), pero 1 M de combinaciones debería quedar en **menos de 1 s en escritorio** *(estimado, se mide en la Fase 1)*. El resultado se decide por prueba exacta, sin topes especiales.

### 4.5 Monte Carlo

Casi idéntico al de 14G. Cambios:

- `posicion()` llama a `calcularStandingsNacional(grupos, juegosSim)` y devuelve un **estado del equipo**: `{ clasifica, posGrupo, via }`, con `via` = `'top2'` | `'comodin'` | `'fuera'`.
- El histograma deja de ser «posición 1–14» y pasa a ser **posición dentro del grupo** + la distribución de `via`.
- `sigma` = `PRED.SIGMA_MARGEN['nacional']` (11.4). `sigmaTotal`, `sigmaPuntos` y `maxPuntos` se calibran con Nacional 2025 y 2026.
- **Juegos clave:** misma fórmula de impacto `P(clasifica | gana local) − P(clasifica | gana visita)`, con una **etiqueta de relación**: `propio` · `de_mi_grupo` · `cruce` · `carrera_comodin`. La pantalla puede decir *«te conviene que Toros Salvajes le gane a Potros Salvajes (carrera por el comodín)»*.
- Tabla «según tus victorias propias»: sin cambios de lógica.
- **Optimización opcional (solo si la medición lo pide):** en cada simulación, usar primero `evaluarVictoriasNac` con los ganadores sorteados; solo si da `FILO` generar marcadores y llamar al oráculo. Es un atajo puro y debe dar exactamente el mismo resultado.

### 4.6 Situación del equipo y fin de temporada (tu punto de la última y penúltima semana) — y la limitación explicada

**Reglas del motor**

1. `situacion` se decide **primero** por la enumeración exacta: todas las combinaciones `SEGURO` → `clasificado`; todas `FUERA` → `eliminado`; ninguna `SEGURO` pero alguna `FILO` → `solo_desempate`. Como la enumeración siempre es posible, **«eliminado» y «clasificado» siempre se demuestran**; la simulación nunca los declara.
2. Para `clasificado` y `eliminado` el análisis termina ahí: respuesta instantánea, sin Monte Carlo pesado ni búsqueda de escenarios.
3. Se agrega `explicacion` con números concretos, generada sin simular. Ejemplo para eliminado: *«Aun ganando tu juego de la J9 llegarías a 3 victorias; el 3.º de Norte ya tiene asegurado 5 y el de Bajío 4»*.
4. Los equipos **excluidos** (Liebres) no son elegibles: el selector los omite y el motor devuelve un error claro si se pide uno.

**La limitación: la etiqueta «por victorias» no ve el resultado directo ni los marcadores**

La clasificación rápida (4.3) trabaja solo con victorias. Pero en Nacional el lugar de un equipo se decide muchas veces por desempate, y el desempate tiene dos pasos con naturaleza distinta:

| Paso del desempate | ¿Se conoce con solo los ganadores? | Qué hace el motor |
|---|---|---|
| **Resultado directo** (quién venció a quién entre los empatados) | **Sí.** Es un hecho: ya se jugó, o se define con el ganador del juego pendiente | Se resuelve exacto en `evaluarVictoriasNac` (paso 1b) |
| **Menor PC** (puntos en contra acumulados) | **No.** Depende de los marcadores | Queda como `FILO`; la capa 2 busca marcadores y **verifica con el oráculo** |

El borrador anterior de este plan trataba ambos pasos como «en el aire». Con tus datos reales de hoy (J9 pendiente, 32 combinaciones) la diferencia se ve así *(medido)*:

| Equipo | Etiqueta solo por victorias (SEGURO / FILO / FUERA) | Qué pasa en realidad en los casos `FILO` |
|---|---|---|
| Halcones UV | 8 / 16 / 8 | **Nunca clasifica en ninguno de los 16.** Si empata a 5 con Frailes, pierde el resultado directo (Frailes 21–6 en J5); si entra a un empate de 3 a 4 victorias, Búhos lo barre |
| Frailes UT | 8 / 16 / 8 | En 8 **siempre** clasifica (gana el resultado directo) y en 8 **nunca** |
| Búhos IPN | 0 / 8 / 24 | **Genuinos:** en los 8 el lugar se decide por PC contra Lobos ULM |
| Lobos ULM | 0 / 8 / 24 | **Genuinos:** en los 8 se decide por PC contra el 3.º de Centro |

Es decir, **dos de cada tres etiquetas `FILO` eran falsas alarmas** (32 de 48 casos). Qué estropeaba eso y qué no:

- **Estropeaba:** (a) `situacion`: un equipo cuyos únicos casos viables fueran falsa alarma saldría como «solo por desempate» cuando en realidad está eliminado (hoy no hay un equipo así, pero Halcones UV quedaría a un resultado de estarlo); (b) las **cotas exactas** `min–max` saldrían más anchas que la verdad; (c) la búsqueda perdería tiempo verificando casos imposibles.
- **No estropeaba:** la **probabilidad** (Monte Carlo usa la tabla real) ni los **escenarios** mostrados (se verifican con el oráculo antes de aparecer). La limitación afecta a las etiquetas y las cotas, no a lo que se le dice al usuario como resultado.

Con el paso 1b, los `FILO` que quedan son los que **sí** dependen de marcadores (Búhos y Lobos ULM en el ejemplo). Ejemplos de lo que el motor producirá para ellos, con datos reales de hoy:

- **Lobos ULM** (4-4, ya terminó, PC 109): clasifica solo si Frailes **y** Halcones pierden (el 3.º de Centro queda con 4 victorias: Búhos) **y** Búhos le gana a Frailes concediendo **15 puntos o más** (para que el PC de Búhos supere 109).
- **Búhos IPN** (3-4, PC 95): necesita lo mismo, pero concediendo **13 puntos o menos** a Frailes (PC < 109).

**Lo que sigue sin ser prueba matemática:** cuando la capa 2 no logra encontrar marcadores para un `FILO`, el optimizador es heurístico (no demuestra imposibilidad, solo no la encuentra). Por eso, si **ningún** caso `FILO` se resuelve, el mensaje dice «depende de un desempate que el modelo no pudo confirmar» y **no** «eliminado». La mejora 1c de 4.3 (si T y sus empatados ya terminaron, su PC es fijo y se compara exacto) elimina otra clase de falsas alarmas en la última semana.

### 4.7 Búsqueda de escenarios

Se **copia tal cual** de 14G: `Heap`, `ordenCostos`, `buscarVectores`, `pivotes`, `probCondicion`, `construirFamilia`. Solo cambian los predicados que reciben (`cumple`, `califica`) y que `escenarioDesdeFamilia` arme la tabla final de Nacional.

### 4.8 Desempate y marcadores (`resolverDesempate` genérico)

La regla de desempate de Nacional es distinta a la de 14G (barrido de resultado directo en el grupo; solo PC entre terceros), así que no se reutiliza `resolverDesempate`. En su lugar, un método genérico que **no necesita razonar cada caso**:

```
resolverDesempateNac(P, hw, T):
  1) Con los marcadores esperados (marcadoresBase): ¿T ∈ seeds según el oráculo?  → cumple (exigencia 'facil')
  2) R = equipos con las mismas victorias que T que compiten con él:
       los empatados de su grupo (si pelea el lugar 2/3) y los terceros de otros grupos con sus mismas victorias
  3) Para k = 1 .. min(|R|, 3):
       para cada subconjunto S de R de tamaño k (tope ~80):
         opt = optimizarMarcadores(P, hw, T, S)    // pide PC_x − PC_T ≥ 1 para todo x ∈ S, sin cambiar ganadores
         si el oráculo con esos marcadores da T ∈ seeds → candidato (se queda el de menor costo de plausibilidad J)
       si hubo candidato en este k: terminar con el mejor
  4) Sin candidato → este vector de ganadores no cumple
```

`optimizarMarcadores` se copia de 14G; el costo de plausibilidad usa `sigmaPuntos` y `maxPuntos` de Nacional. Como la verificación final siempre la hace el oráculo, **no puede haber falsos positivos**; el costo de no razonar caso por caso es probar más subconjuntos, y por eso el tope.

### 4.9 Contrato de salida

Mismo formato que 14G, para que la UI cambie poco:

```js
{
  meta: { equipo, grupo: 'Centro', jornadasJugadas, nPendientes, nVariables, advertencias: [] },
  estado: 'ok' | 'fuera_de_rango',
  situacion: 'clasificado' | 'eliminado' | 'solo_desempate' | 'favorito' | 'burbuja' | 'casi_eliminado',
  explicacion: [ 'texto con números concretos' ],              // NUEVO (sobre todo para eliminado/clasificado)
  probabilidad: { p, ic95, cotasExactas: { min, max } },
  distribucionGrupo: [p1 … pN],                                // reemplaza a distribucionPosicion
  viaClasificacion: { top2, comodin, fuera },                  // NUEVO
  porVictoriasPropias: [...],                                  // igual que 14G
  juegosClave: [{ ..., relacion: 'propio'|'de_mi_grupo'|'cruce'|'carrera_comodin' }],
  juegosClaveOtros: [...],
  escenarios: [{
    id, probabilidad, necesarios, marcadores, exigencia,       // igual que 14G
    via: 'ganadores' | 'resultado_directo' | 'desempate_pc',   // ahora también comodín: 'comodin_pc'
    tablaFinal: { grupos: { Norte: [{ pos, equipo, pg, pc, estado }], ... }, seeds: [...] }
  }],
  busqueda: { ... }
}
```

---

## 5. Integración con lo que ya existe

| Archivo | Cambio |
|---|---|
| `escenarios-nacional.js` | **Nuevo** (copia adaptada de `escenarios.js`, secciones 3 y 4) |
| `prediccion.js` | **Fase 0:** el empate de grupo en `calcularStandingsNacional` pasa al método de la página (barrido de resultado directo → PC). Nada más (ya exporta `EQUIPOS_EXCLUIDOS`, `esPendiente`, `probabilidadVictoria`, `cargarDatos`) |
| `escenarios-worker.js` | `importScripts('prediccion.js','escenarios.js','escenarios-nacional.js')` y elegir motor: `opciones.conferencia === 'nacional' ? self.ONEFA_ESC_NAC : self.ONEFA_ESC` |
| `escenarios-ui.js` | Tabla `CONF` por conferencia (clave del JSON, motor, textos, constructor del selector, tabla final). `iniciar` acepta `data-esc-conf="nacional"` y abre con esa conferencia. El enlace «brand» del overlay apunta a la página de la conferencia. Detalle en 5.1 |
| `nacional.html` | Botón `<button id="btnEscenarios" class="btn-clr-all" type="button" data-esc-conf="nacional">Escenarios de playoffs</button>` junto a `btnPrediccion` (línea ~85) y `<script src="escenarios-ui.js"></script>` después del script de predicción (antes del bloque del Service Worker). El módulo se oculta solo con `?temporada=2025` |
| `sw.js` | Agregar `'./escenarios-nacional.js'` a `PRECACHE` y subir `VERSION` a `'v3'` |
| `onefa.css` | Probablemente nada (las `.esc-*` ya sirven). Si la UI de Nacional pide una clase nueva (p. ej. insignia de grupo en la tabla final), se agrega ahí |
| `CLAUDE.md` | Documentar el módulo y la regla de duplicación (sección 3) |

### 5.1 Qué cambia en `escenarios-ui.js` (detalle)

- **Selector de equipo:** agrupado por grupo (`<optgroup>` Norte / Centro / Bajío), ordenado como la tabla actual, con el récord de cada uno. Los equipos excluidos (Liebres) **no aparecen**. Si ya hay panorama calculado (Fase 3), cada equipo ya decidido lleva ✓ o ✕.
- **Compuertas:** `jornadaMin = 6`; `jornadaMax` = última jornada regular − 1 (se lee de los datos). Mensajes igual que 14G.
- **Resumen:** en vez de «posición final más probable» muestra **grupo, lugar en el grupo más probable y la vía** (top 2 / comodín); en vez de «victorias esperadas de 9», las de 8.
- **Textos:** «Top 8» → «playoffs (top 2 de cada grupo + 2 mejores terceros)»; ayudas de situación adaptadas.
- **Tabla final proyectada:** las 3 tablas de grupo con marca de clasificado (top 2 / comodín) y, debajo, la comparación de los 3 terceros.
- **Juegos clave:** etiqueta de relación (`mi grupo`, `cruce`, `carrera por el comodín`).
- **Eliminado / clasificado:** muestra la `explicacion` y no pinta secciones vacías.

Todo lo demás (overlay, barra de progreso por fases, Cancelar con `terminate()`, respaldo sin Worker, pestañas, solo lectura) se reutiliza sin cambios.

---

## 6. Fases

Orden recomendado: **0 → 1 → 4 → 2 → 3**. Razón: la temporada regular termina con la J9 y, cuando se juegue, el módulo se desactiva solo hasta el próximo año (`jornadas_jugadas > jornadaMax`). Una versión mínima (probabilidad, victorias propias, juegos clave y situación) ya es útil con los 5 juegos que quedan, y conviene tenerla publicada antes de que se juegue la J9. Los escenarios con marcadores llegan después.

| Fase | Contenido | Tamaño | Hecho cuando | Verificación mínima (sin suite de pruebas) |
|---|---|---|---|---|
| **0** | Alinear el empate de grupo de `prediccion.js` con la página (H3). Calibrar `sigmaTotal`, `sigmaPuntos` y `maxPuntos` con Nacional 2025+2026 (un script de una vez) | S | `calcularStandingsNacional` y `nacional.html` ordenan igual en el caso del ciclo de 3 | Repetir la prueba de 20,000 casos del ciclo (hoy 82 % de diferencias): debe dar 0 |
| **1** | Motor núcleo: `prepararProblema`, `evaluarVictoriasNac` (con resultado directo), enumeración exacta, Monte Carlo, `situacionEquipo`, victorias propias, juegos clave con relación, `explicacion` para eliminado/clasificado. **Sin** búsqueda de escenarios | M | `analizar()` corre para los 19 equipos con `jj = 8` (y con `jj` recortado a 6 y 7) y devuelve situación y probabilidad coherentes | (a) Monte Carlo cae dentro de las cotas exactas; (b) `FILO` coincide con el muestreo de marcadores (el mismo chequeo que usé para el plan); (c) con `jj = 7`, el resultado real de la J8 y la J9 tiene probabilidad > 0 para cada equipo; (d) tiempo por análisis anotado |
| **4** | Integración: Worker, `escenarios-ui.js` con `CONF`, botón en `nacional.html`, `sw.js` | M | Se elige un equipo de Nacional en la página y se ve el resumen; funciona sin señal tras la primera carga | Abrir en navegador de escritorio y en teléfono; revisar a mano el aspecto |
| **2** | Escenarios: búsqueda best-first (copiada), familias, `resolverDesempateNac` (4.8), marcadores por jornada, `completaciones` | M | Equipos en burbuja muestran escenarios con marcadores que **cumplen al reevaluarlos con el oráculo** | Reevaluar cada escenario devuelto con `calcularStandingsNacional` y ver que el equipo queda dentro |
| **3** | Panorama de todos los equipos en una sola pasada (✓/✕ en el selector) y pulido del último tramo (mensajes, `explicacion`) | S–M | El selector muestra el estado de cada equipo antes de analizarlo | Contraste con las tablas de la sección 1.3 (hoy: Águilas, ITSON, Pumas Acatlán, Potros Salvajes, Tecos y Leones UAQ ya clasificados; Indios y Lobos UA de C clasifican si ganan su juego entre sí) |
| **5** | **Pruebas** (siguiente sprint, sección 7) | M | — | — |
| **6** *(opcional)* | Posición específica en Nacional: ganar el grupo, evitar el comodín, sembrado general | M | — | — |

---

## 7. Pruebas — diferidas al siguiente sprint

No se hacen ahora. Anoto lo que convendría cubrir para que no se pierda:

- Paridad de la tabla del oráculo contra `calcGroupStandings` de `nacional.html` (incluye empates de 3 o más).
- Etiquetas rápidas (`SEGURO`/`FILO`/`FUERA`) contra fuerza bruta con marcadores muestreados (generalizando el chequeo de la sección 4.6).
- Enumeración exacta contra fuerza bruta; Monte Carlo dentro de las cotas exactas.
- Escenarios que se cumplen al reevaluarlos; marcadores válidos (ganador respetado, margen ≥ 1, tope de puntos).
- Equipos eliminados y clasificados con prueba exacta (hoy hay casos reales: la J9 deja a varios ya decididos).
- Juegos de Liebres forzados; aserción de juegos iguales; determinismo con semilla.
- Arnés de interfaz: `harness.js` hoy abre siempre `index.html`; habrá que parametrizar la página (`nacional.html`) y el JSON que recorta `jornadas_jugadas`.

---

## 8. Riesgos y límites (honestos)

| # | Riesgo | Mitigación |
|---|---|---|
| R1 | **Dos reglas de desempate de grupo** (H3): el motor podría contradecir la página en empates de 3 o más equipos | Fase 0: alinear `prediccion.js` con la página. Si prefieres otra cosa, hay que decidir cuál es la regla «oficial» |
| R2 | **Etiqueta `FILO` aún conservadora en PC** (sección 4.6): puede marcar «depende de PC» casos donde el PC ya es fijo | Mejora 1c de 4.3; y la capa 2 verifica con el oráculo. Nunca se presenta «solo por desempate» como prueba de nada si el modelo no confirmó marcadores |
| R3 | **Constantes de plausibilidad sin calibrar** para Nacional (`sigmaTotal` ya es «por calibrar» en 14G; `sigmaPuntos` y `maxPuntos` salieron de 14G) | Fase 0, con datos de Nacional |
| R4 | **Ventana de utilidad corta esta temporada:** con la J9 jugada, el módulo se desactiva hasta 2027 | Orden de fases 0 → 1 → 4 (versión mínima antes) |
| R5 | **Código duplicado** entre `escenarios.js` y `escenarios-nacional.js` | Regla de mantenimiento en `CLAUDE.md`; extraer núcleo común más adelante si estorba |
| R6 | **Reglas oficiales vs. reglas de la app:** `nota_desempate` del JSON advierte que el criterio mostrado es referencial | El motor hereda lo que haga la app, igual que 14G; se avisa en la pantalla |
| R7 | **Tiempos en teléfono sin medir** (la estimación ×4 es una suposición) | Medir en la Fase 4 |
| R8 | **Un empate exacto en PC** no está resuelto por la regla actual (queda al orden estable de la ordenación) | Igual que 14G: se exige diferencia estricta de ≥ 1 punto de PC |
| R9 | **Grupos y calendario cambian entre años** | Todo se lee del JSON; la aserción de juegos iguales avisa si la liga cambia el esquema |

Límites que se comunican en la pantalla (igual que 14G): probabilidades según el modelo Massey (ratings fijos, juegos independientes, 3–97 % por juego); los marcadores son sugerencias plausibles que cumplen el desempate, no pronósticos; no se listan todos los escenarios, sino los más probables y sus condiciones mínimas.

---

## 9. Qué necesito de ti

**Archivos:** con lo que ya me diste puedo diseñar todo. Para **programar y medir** (Fase 1) me falta uno: **`onefa_data_2025.json`**, porque `construirModelosPorConferencia` necesita los 4 JSON para correr el modelo de Nacional en Node. No necesito `onefa.css` salvo que en la Fase 4 haga falta una clase nueva, ni `tests/escenarios.test.js` hasta el sprint de pruebas.

**Decisiones:**

1. **H3:** ¿alineamos `calcularStandingsNacional` con el desempate de `nacional.html` (barrido de resultado directo → PC)? Mi recomendación: sí.
2. **J9:** ¿sabes cuándo se juega? Define si conviene publicar primero la versión mínima (orden 0 → 1 → 4).
3. **Panorama ✓/✕ en el selector** (Fase 3): recomiendo sí; es barato porque el espacio es chico y responde directo a tu punto de equipos sin posibilidad.
4. **Comodín:** confirmo que los terceros se comparan por victorias y, si empatan, por menor PC (como hoy en `nacional.html`). Si la liga usa otra regla, dímelo ahora.
