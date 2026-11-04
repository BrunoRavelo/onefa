# Plan — Objetivos de «lugar final» y «desclasificado» (14 Grandes y Nacional)

> Propuesta (implementada el 2026-11-01, ver «Estado de implementación») · Complementa `plan-nacional.md` (sección «Funciones a continuar»).
> **Leído:** `escenarios.js`, `escenarios-nacional.js`, `escenarios-ui.js`, `prediccion.js` (sembrado de Nacional), `nacional.html` (`ordenarEmpate`), `plan-nacional.md`.
> **Medido:** un prototipo (no se entrega) de las cotas de lugar de Nacional, validado contra la tabla real con marcadores aleatorios (sección 3).
> **Alcance:** solo diseño. No se programó nada. Pruebas automáticas: siguiente sprint.

---

## Estado de implementación (2026-11-01)

**Decisiones del usuario:** (1) alinear el sembrado de Nacional con la regla de desempate; (2) «lugar» en Nacional = sembrado 1–8 por PG; (3) camino **A1**; (4) texto «fuera de playoffs»; (5) habilitar también 9.º–14.º en 14 Grandes.

**Hecho (fases 0 a 4):**
- `prediccion.js` y `nacional.html`: el sembrado usa `ordenarEmpatados` (barrido de resultado directo → menor PC). Sembrado antiguo vs nuevo: 537 diferencias en 4,000 temporadas aleatorias; nuevo vs lógica de la página: 0.
- `escenarios.js`: `objetivoDe`, `esObjetivoLegado`, `optimizarMarcadores` con signo (compatible hacia atrás), `resolverPorPatrones`, `resolverDesempateObj`, `evaluarVector` (riesgo completo solo para objetivos nuevos, A1), `situacionEquipo` y `analizar` con objetivo.
- `escenarios-nacional.js`: `lugar` en `estadoDe`, `califica`, `clasificarObjetivoNac`, objetivo en enumeración/simulación/MC (`distribucionLugar`), desempate genérico, situaciones y explicaciones por objetivo.
- `escenarios-ui.js`: selector «Lugar final» activo y por conferencia (14G: 1.º–14.º; Nacional: 1.º–8.º), frase de aclaración, textos y estados por objetivo, desempate con sentido del PC («más» / «menos»).

**Medido:**

| Comprobación | Resultado |
|---|---|
| 14G, objetivo omitido o `'clasificado'` vs motor anterior (J6, J7, J8 × 14 equipos) | 0 diferencias de 84 análisis |
| 14G, Σ P(lugar 1..14) y Σ P(1..8) vs P(clasificado); P(clasif) + P(desclasif) | 1.000000 · igual · 1.000000 |
| 14G, escenarios de objetivos nuevos reevaluados con la tabla real | 73 de 73 se cumplen |
| Nacional, cotas por objetivo vs tabla real (J6/J7/J8 × 10 objetivos × 18 equipos) | 0 violaciones en 64,800 |
| Nacional, objetivo omitido vs motor anterior | idéntico, salvo un equipo en modo riesgo (Lobos ULM con J7), por el modo riesgo completo |
| Nacional, coherencias de probabilidad | exactas |
| Nacional, escenarios de todos los objetivos reevaluados con la tabla real | 102 de 102 se cumplen |
| Interfaz (jsdom, con y sin Worker, ambas páginas) | sin errores |

**Desviaciones respecto al diseño:**
- En 14 Grandes el modo riesgo del objetivo «clasificado» **no** se completó (A1: se conserva el comportamiento anterior); en Nacional sí se completó para todos los objetivos (no había comportamiento previo que proteger).
- Las cotas de lugar de Nacional **no** incluyen todavía el afinamiento con resultado directo entre empatados (mejora opcional de la sección 3).
- La opción «Desclasificado» vale `[9, 14]` en 14 Grandes y `[9, 9]` en Nacional.

**Pendiente:** correr `tests/escenarios.test.js` de 14 Grandes con estos cambios; pruebas automáticas (sección 10); revisar tiempos y aspecto en teléfono; marcas ✅/✖️ del calendario (ver `plan-nacional.md`).

---

## 0. Resumen

**Qué se quiere.** El selector «Lugar final» hoy tiene solo «Clasificado (cualquier lugar)». Se quiere habilitar: **«1.º … 8.º lugar»** (qué tiene que pasar para quedar exactamente en ese lugar) y **«Desclasificado (cualquier lugar)»** (qué tiene que pasar para quedar fuera de playoffs), en las dos conferencias.

**La idea que lo simplifica todo: un «rango final».** Cada resultado final del torneo le da al equipo un número `r`:

| Conferencia | `r` | Clasificado | Lugar `k` | Desclasificado |
|---|---|---|---|---|
| 14 Grandes | posición en la tabla (1–14) | `[1, 8]` | `[k, k]` | `[9, 14]` |
| Nacional | sembrado 1–8 por PG si clasifica; **9** si no clasifica | `[1, 8]` | `[k, k]` | `[9, 9]` |

Un objetivo es siempre un rango `[min, max]` sobre `r`. Así el motor no necesita «tipos» de objetivo: solo recibe un rango.

**Lo que recomiendo.** Opción **A**: modificar los dos motores que ya existen (no crear un tercero), en 5 fases. Primero la parte común del desempate (la más delicada), después 14 Grandes, después Nacional, y al final la interfaz. Detalle de opciones en la sección 5.

**Hallazgos que condicionan el diseño** (detalle en la sección 1):

1. 14 Grandes **ya recibe un rango `obj` en toda su tubería**, pero el desempate de marcadores solo sabe «subir» al equipo. Con un rango cuyo mínimo no sea 1, hoy daría **falsos positivos** (tiene un atajo que no verifica con la tabla real).
2. «Quedar peor» en un desempate exige **empujar los puntos en contra en sentido contrario**; el optimizador actual solo sabe un sentido. Es la pieza que hay que añadir para «lugar exacto» y «desclasificado».
3. El modo «riesgo» de 14 Grandes, cuando el resultado depende de un desempate, **solo mira los marcadores esperados**; no busca marcadores que hagan perder el desempate. Por eso «desclasificado» saldría incompleto.
4. En Nacional el sembrado 1–8 empata **por pares** (`ordenarEmpateDirecto`, y `ordenarEmpate` en `nacional.html`), no con la regla que me diste (venció a todos → primero; si no, menor PC). Para «lugar exacto» ese detalle importa más que para «clasificado»: hay que decidirlo antes.

---

## 1. Análisis del código actual

### 1.1 14 Grandes (`escenarios.js`)

| Pieza | Estado | Para otros objetivos |
|---|---|---|
| `obj = { min, max }` en `enumerarExacto`, `crearSimulador`, `monteCarloCompleto`, `tablaVictoriasPropias`, `construirFamilia`, `analizar` (`o.objetivo`) | Ya generalizado | Listo |
| `clasificarVictorias(P, W, T, obj)`: la posición está en `[A+1, A+B+1]` y se compara con `[min, max]` | Funciona con cualquier rango | Listo |
| `califica(pos, obj)` | Funciona con cualquier rango | Listo |
| `resolverDesempate(P, hw, T, obj)` | Calcula `plazas = obj.max − A` y cuántos rivales deben quedar **debajo** de T. Nunca considera que T deba quedar **debajo** de alguien. Además, cuando `necesita <= 0` devuelve «ok» **sin verificar** con la tabla real | **Falla** para `min > 1` (falsos positivos y casos no encontrados) |
| `optimizarMarcadores(P, hw, T, S)`: pide `PC_x − PC_T ≥ 1` para todo `x ∈ S` | Un solo sentido (T mejor que los de `S`) | Hay que generalizarlo con signo |
| `evaluarVector(…, modo 'riesgo')`, caso `FILO` | Solo revisa los marcadores esperados | Incompleto para buscar «cómo fallar» por desempate |
| `situacionEquipo` | Solo habla de `clasificado` / `eliminado` | Hay que generalizar los nombres y los textos |

### 1.2 Nacional (`escenarios-nacional.js` y `prediccion.js`)

| Pieza | Estado |
|---|---|
| `estadoDe` | Devuelve `{ clasifica, grupo, posGrupo, via }`; **no calcula el sembrado** |
| `evaluarVictoriasNac` | Contesta solo «¿clasifica?». No da el rango del sembrado |
| Sembrado (`prediccion.js`) | Ordena los 8 por PG; empates por pares con `ordenarEmpateDirecto` (no transitivo con 3 o más) |
| `nacional.html` (`ordenarEmpate`, línea 508) | Misma lógica por pares |
| Desempate de marcadores | Solo para «clasificar» (rivales con las mismas victorias que compiten por el comodín o por el grupo) |

### 1.3 Interfaz (`escenarios-ui.js`)

El selector «Lugar final» existe pero no se envía al motor. Los textos (`SITUACION`, títulos, «Escenarios más probables para clasificar») y la tabla final asumen «clasificado».

---

## 2. Cómo cambia cada objetivo

| Objetivo | Rango | Modo de búsqueda | «Decidido» significa |
|---|---|---|---|
| Clasificado | `[1, 8]` | `clasificar` (o `riesgo` si ya es favorito) | Clasificado en todas las combinaciones / eliminado en todas |
| Lugar `k` | `[k, k]` | `clasificar`; si el equipo ya es favorito para ese lugar, `riesgo` | Lugar asegurado / lugar imposible |
| Desclasificado | `[9, 14]` (14G) · `[9, 9]` (Nacional) | `clasificar` sobre el rango de abajo | Ya estás fuera / ya estás dentro (imposible quedar fuera) |

Observaciones:

- **«Desclasificado» no es un modo nuevo:** es el rango de abajo con la misma búsqueda. Lo que sí hace falta es que el desempate sepa **perder**.
- Las probabilidades se **reparten** entre lugares, así que casi todos los escenarios de «lugar `k`» serán de probabilidad baja. El umbral «casi imposible» (0.5 %) y el botón «Ver escenarios poco probables» ya existen y servirán tal cual.
- Coherencias que se pueden comprobar sin simular: `P(clasificado) + P(desclasificado) = 1` y `Σ P(lugar k, k=1..8) = P(clasificado)`.
- Las marcas ✅/✖️ del calendario de las páginas principales siguen usando solo «clasificado» (no cambian).

---

## 3. Prototipo y medición (cotas del lugar en Nacional)

Para ver si se puede dar un **rango de lugar por victorias** en Nacional (lo que hace `clasificarVictorias` en 14 Grandes), escribí un prototipo (no se entrega):

```
Para un vector de ganadores W y el equipo T:
  qT  = evaluarVictoriasNac(T)                   // SEGURO / FILO / FUERA de clasificar
  cierto  = nº de equipos u con W[u] > W[T] que clasifican SEGURO    → seguro quedan arriba de T
  posible = nº de equipos u con W[u] ≥ W[T] que PUEDEN clasificar     → podrían quedar arriba (incluye empates)
  lo = 1 + cierto,   hi = min(8, 1 + posible)
  Lugares posibles de T = [lo, hi]  (si qT = FILO, también 9)   ·   (si qT = FUERA, solo 9)
```

Validación contra la tabla real (`calcularStandingsNacional`) con ganadores y marcadores aleatorios:

| Jornada concluida | Casos | Violaciones de las cotas |
|---|---|---|
| J6 (21 pendientes) | 4,500 | **0** |
| J7 (12 pendientes) | 4,500 | **0** |
| J8 (6 pendientes) | 4,500 | **0** |

Cuántos de los 4,500 casos quedan «EN EL FILO» (dependen de un desempate) por objetivo:

| Objetivo | J6 | J7 | J8 |
|---|---|---|---|
| Clasificado | 399 (9 %) | 311 (7 %) | 120 (3 %) |
| Lugar 1 | 344 (8 %) | 354 (8 %) | 266 (6 %) |
| Lugares 2 a 8 | 574–841 (13–19 %) | 634–766 (14–17 %) | 360–788 (8–18 %) |

**Costo:** 29 ns por vector para «clasificado» y **418 ns** para las cotas de lugar → un millón de combinaciones (J6) ≈ **0.4 s** en Node. Aceptable (un teléfono lento sería unas 4 veces más).

**Conclusiones:**

1. Las cotas por victorias **son válidas** (nunca se equivocan hacia «seguro» o «fuera»).
2. Para «lugar exacto» hay **mucho más FILO** que para «clasificado», y es inherente: los empates de PG entre equipos de **grupos distintos** casi nunca tienen resultado directo (los cruces son solo 3 jornadas) y se resuelven por PC, es decir, por marcadores. Por eso la capa de marcadores es la pieza central, no un detalle.
3. Consecuencia para los mensajes: «ya aseguraste el lugar `k`» o «ya no puedes quedar en el lugar `k`» solo se afirman cuando **todas** las combinaciones son «seguro» o «fuera». Cuando quedan combinaciones en el filo, se dice «depende de un desempate» y no se promete una prueba.
4. Mejora opcional (más adelante): afinar las cotas con el resultado directo entre empatados del mismo grupo, igual que ya se hace en `evaluarVictoriasNac`.

---

## 4. Diseño por piezas (con las alternativas que descarté)

### 4.1 El objetivo como rango: `objetivoDe`

```js
objetivoDe(valor, rMax)   // valor de la interfaz: 'clasificado' | '1'..'8' | 'descalificado'
  'clasificado'   → { tipo:'clasificado',   min:1, max:8 }
  '3'             → { tipo:'lugar', k:3,    min:3, max:3 }
  'descalificado' → { tipo:'descalificado', min:9, max:rMax }   // 14G: rMax = 14 · Nacional: rMax = 9
```

Vive en `escenarios.js` (ya exporta `OBJETIVO_PLAYOFFS`) y Nacional la reutiliza. `analizar` acepta `opciones.objetivo` como texto o como rango; sin `objetivo` se comporta exactamente como hoy.

### 4.2 Cotas por victorias para cada objetivo

- **14 Grandes:** no cambia. `clasificarVictorias` ya compara `[A+1, A+B+1]` con cualquier `[min, max]`.
- **Nacional:** función nueva `cotasLugarNac(P, W, hw, T)` con el cálculo de la sección 3 (validado). `clasificarObjetivoNac(…, obj)` compara los lugares posibles con `[min, max]` y devuelve `SEGURO` / `FILO` / `FUERA`. Para el objetivo «clasificado» se sigue usando el camino rápido actual (`evaluarVictoriasNac`, 29 ns). Optimización: solo se evalúan los equipos con `W[u] ≥ W[T]`.

**Alternativas para Nacional que evalué:**

| Iteración | Idea | Veredicto |
|---|---|---|
| 1 | Solo Monte Carlo + tabla real, sin cotas | Más rápida de escribir, pero no hay pruebas de «seguro/imposible» y la búsqueda necesita un `cumple` barato; cada vector costaría una tabla completa. **Plan B** |
| 2 | Ramificar sobre todos los órdenes posibles de PC (exacto) | Complejidad alta y una regla de desempate distinta en cada paso. **Descartada** |
| 3 | **Cotas por victorias (válidas y baratas) + marcadores con signo + verificación con la tabla real** | **Elegida** |
| 4 | Afinar las cotas con el resultado directo entre empatados del mismo grupo | Mejora opcional posterior |

### 4.3 Desempate con signo (la pieza central)

**a) `optimizarMarcadores(P, hw, T, restricciones)`** (se modifica en `escenarios.js`; Nacional ya lo reutiliza, así que se arregla una sola vez):

- `restricciones` puede ser un arreglo (como hoy: «T mejor que esos») o `{ arriba: [...], abajo: [...] }`.
- `arriba`: rivales que deben tener **más** PC que T (T queda mejor). `abajo`: rivales con **menos** PC que T (T queda peor).
- La ganancia de mover un punto pasa de `Σ([v==x] − [v==T])` a sumar también `Σ([v==T] − [v==x])` para los de `abajo`. Es el mismo voraz de hoy.

**b) `resolverPorPatrones(P, hw, T, rivales, verificar)`** (nuevo, exportado):

```
1. Atajo: con los marcadores esperados, ¿verificar(base)? → listo
2. R = rivales relevantes (tope 5)
3. Para cada patrón de signos (arriba/abajo por rival), de menos a más cambios (≤ 32 patrones):
     opt = optimizarMarcadores(P, hw, T, { arriba, abajo })
     si opt existe y verificar(opt) → candidato; se queda con el de menor costo de plausibilidad J
4. Devuelve el mejor candidato o { ok:false }
```

`verificar` es la tabla real con el predicado del objetivo (`califica`, o su negación en modo riesgo). **Cero falsos positivos**, igual que hoy.

**Por qué patrones y no razonar la regla:** la regla de desempate cambia por conferencia y por etapa (barrido en el grupo, PC entre terceros, sembrado). Probar los patrones con la tabla real no exige entenderla, es repetitivo (lo que pediste) y el costo está acotado. Rivales relevantes: en 14G, los empatados en victorias con T; en Nacional, los empatados en PG con T de cualquier grupo.

**c) `resolverDesempate` de 14G, dos caminos:**

- **A1 (recomendado):** se conserva el actual cuando `obj.min === 1` (cero riesgo para el objetivo «clasificado») y se usa `resolverPorPatrones` en los demás casos. Se protege además el atajo `necesita <= 0` para que nunca devuelva «ok» sin verificar cuando `min > 1`.
- **A2:** reemplazarlo por `resolverPorPatrones` para todos. Menos código, pero cambia el comportamiento actual y requiere correr las pruebas de 14G.

### 4.4 Modo riesgo y «desclasificado»

- «Desclasificado» no es un modo nuevo: se busca el rango de abajo con el modo `clasificar` de siempre.
- El modo `riesgo` (para un equipo que ya es favorito) deja de mirar solo los marcadores esperados cuando el vector está en el filo: usa `resolverPorPatrones` con `verificar = !califica(...)`. Esto completa también el caso «clasificado» que hoy queda corto.

### 4.5 Simulación y salida

- **Nacional:** `estadoDe` agrega `lugar` (el sembrado, o 9 si no clasifica). **14G:** `posicion()` ya es el lugar.
- `califica(estado, obj)` compara `estado.lugar` con `[min, max]`.
- Salida nueva: `objetivo { tipo, min, max, k }` y `distribucionLugar` (en Nacional, lugares 1–8 y «fuera»; en 14G ya existe `distribucionPosicion`).

### 4.6 Situación por objetivo

| Resultado de la enumeración exacta | Clasificado | Lugar `k` | Desclasificado |
|---|---|---|---|
| Todas `SEGURO` | clasificado | lugar asegurado | ya estás fuera |
| Todas `FUERA` | eliminado | lugar imposible | imposible quedar fuera |
| Ninguna `SEGURO`, alguna `FILO` | solo por desempate | solo por desempate | solo por desempate |
| Sin prueba exacta | favorito / burbuja / casi imposible, por probabilidad | igual | igual |

Internamente se usan nombres neutros (`cumple_siempre`, `cumple_nunca`, `solo_desempate`) más el `objetivo`; con «clasificado» se siguen devolviendo `clasificado` / `eliminado` para no romper la interfaz ni las pruebas de 14G. La regla vigente se mantiene: un equipo **decidido** muestra solo su estado.

### 4.7 Escenarios con lugar

- Títulos: «Escenarios más probables para quedar `k`.º», «… para quedar fuera de playoffs»; en modo riesgo: «Qué podría sacarte del `k`.º lugar».
- La tabla final resalta la fila del equipo y su lugar.
- El texto de desempate debe poder decir «necesitas **más** puntos en contra que X» (cuando T debe **perder** el desempate); hoy solo dice «menos».

### 4.8 Interfaz

- Activar las 10 opciones de «Lugar final» y enviar `opciones.objetivo`.
- `SITUACION` y los textos pasan a depender del objetivo (tabla de 4.6).
- Una frase bajo el selector aclara qué significa «lugar»: en 14 Grandes, posición en la tabla; en Nacional, **sembrado 1–8 por partidos ganados** (como el bracket).
- Un equipo eliminado que elige «lugar 3» ve solo el estado «lugar imposible».

---

## 5. Opciones de arquitectura

| Opción | Qué es | A favor | En contra | Tamaño |
|---|---|---|---|---|
| **A. Modificar los dos motores** | Se extienden `escenarios.js` y `escenarios-nacional.js`; el optimizador y los patrones viven una vez en `escenarios.js` y Nacional los reutiliza | Sin archivos nuevos; una sola copia de lo nuevo; se apoya en lo que ya funciona | Se toca `escenarios.js` (hay pruebas que correr); Nacional depende de él | M |
| B. Núcleo común nuevo (`escenarios-comun.js`) | Optimizador, patrones, `objetivoDe` y textos en un tercer archivo | Orden conceptual | Igual hay que editar `escenarios.js` para que lo use; una dependencia más (Worker, SW, UI); no ahorra trabajo hoy | M–L |
| C. Motores nuevos por objetivo | `escenarios-lugar.js` y `escenarios-lugar-nacional.js` sin tocar los actuales | Cero riesgo para lo existente | Duplica ~70 % (búsqueda, familias, simulador); todo arreglo ×2 | L |
| D. Un solo archivo para las dos conferencias | Objeto de estrategia por conferencia | Lo más limpio a largo plazo | Refactor grande sin pruebas a la mano; contradice «fácil y repetitivo» | XL |

**Recomendación: A con el camino A1.** Se revisa D cuando existan las pruebas.

Sub-opciones para el lugar en Nacional: **N-A** (cotas por victorias + marcadores con signo; recomendada), N-B (solo la tabla real; más rápida de escribir, sin pruebas exactas y más lenta) y N-C (ramificación exacta de PC; descartada).

---

## 6. Funciones a añadir o modificar

| Archivo | Cambio |
|---|---|
| `escenarios.js` | **Modificar** `optimizarMarcadores` (restricciones con signo, compatible hacia atrás) · **Añadir** `resolverPorPatrones` y `objetivoDe` (exportados) · **Modificar** `resolverDesempate` (A1: patrones para `min > 1`; proteger el atajo sin verificar) · **Modificar** `evaluarVector` (modo riesgo completo en el filo) · **Modificar** `situacionEquipo` y `analizar` (objetivo en texto, situaciones neutras con alias) · **Modificar** el texto de `desempate` («más/menos» PC) |
| `escenarios-nacional.js` | **Añadir** `cotasLugarNac` y `clasificarObjetivoNac` · **Modificar** `estadoDe` (+`lugar`) y `califica` · **Modificar** `enumerarExacto`, `probabilidadQ`, `monteCarloCompleto` (+`distribucionLugar`), `tablaVictoriasPropias`, `construirFamilia`, `escenarioDesdeFamilia` y `analizar` para recibir el objetivo · **Modificar** `resolverDesempate` (rivales con el mismo PG; usa `ESC.resolverPorPatrones`) · `panorama`: sin cambio |
| `prediccion.js` y `nacional.html` | **Decisión:** el sembrado usa `ordenarEmpatados` (barrido → PC) en vez de por pares (`ordenarEmpateDirecto` y `ordenarEmpate`) |
| `escenarios-ui.js` | Habilitar opciones, enviar `objetivo`, textos y tablas por objetivo, frase de aclaración |
| `escenarios-worker.js` | Sin cambios (el objetivo viaja en `opciones`) |
| `CLAUDE.md`, `plan-nacional.md` | Documentación |

---

## 7. Fases

| Fase | Contenido | Tamaño | Hecho cuando | Verificación mínima |
|---|---|---|---|---|
| **0** | Decisiones (sección 9); `objetivoDe`; alinear el sembrado de Nacional si se aprueba | S | `prediccion.js` y `nacional.html` ordenan igual un empate de 3 en el sembrado | Repetir la prueba de ciclos de 3 equipos aplicada al sembrado |
| **1** | Infraestructura de desempate con signo: `optimizarMarcadores`, `resolverPorPatrones`, atajo protegido | M | Con objetivo `[3,3]` en 14G los escenarios **se cumplen al reevaluarlos con la tabla real**; con `[1,8]` el resultado es idéntico al actual | Comparar antes y después, como se hizo con el ajuste de ruido |
| **2** | 14 Grandes: lugar `k` y desclasificado; situaciones por objetivo; modo riesgo completo | M | Los 3 objetivos corren en los 14 equipos | `P(clasificado) + P(desclasificado) = 1`; `Σ P(lugar k) = P(clasificado)` |
| **3** | Nacional: cotas de lugar, `lugar` en el estado, resolver, objetivo en el análisis | L | Los 3 objetivos corren en los 18 equipos | Script del prototipo (0 violaciones); mismas coherencias de la fase 2 |
| **4** | Interfaz: habilitar opciones, textos, tablas | M | Se elige un lugar y se ven escenarios; el estado «decidido» sale solo | jsdom en las dos páginas y revisión en teléfono |
| **5** | Pruebas automáticas (siguiente sprint) | M | — | Sección 10 |

---

## 8. Riesgos y límites

| # | Riesgo | Mitigación |
|---|---|---|
| R1 | Regresión en 14 Grandes (sus pruebas no están a la mano) | Camino A1 (el objetivo «clasificado» conserva el código actual) y comparación antes/después en J6, J7 y J8 |
| R2 | En «lugar exacto» hay mucho más «filo» que en «clasificado» (6–19 % de los vectores) | Es inherente (empates entre grupos se resuelven por PC). Mensajes honestos: solo se promete «asegurado/imposible» con prueba exacta |
| R3 | El sembrado de Nacional empata por pares (puede contradecir tu regla) | Decisión 1 (sección 9) |
| R4 | Costo en teléfono: ~0.4 s por millón de combinaciones en Node, quizá 4× en teléfono | Medir en la fase 4; el presupuesto total sigue siendo ≈ 1 minuto |
| R5 | Muchos escenarios de lugar con probabilidad muy baja | Ya existe el umbral «casi imposible» (0.5 %) con el botón para verlos |
| R6 | El optimizador de marcadores es heurístico: si no encuentra marcadores no prueba que sea imposible | Igual que hoy: se dice «depende de un desempate que el modelo no pudo confirmar» |
| R7 | Qué significa «lugar» en Nacional (sembrado por PG; los campeones de grupo no tienen prioridad) | Decisión 2 y frase de aclaración en pantalla |
| R8 | Código duplicado entre motores | Lo nuevo (optimizador, patrones, `objetivoDe`) vive una sola vez en `escenarios.js`; el resto sigue la regla de «copiada» de `CLAUDE.md` |

---

## 9. Decisiones que necesito

1. **Sembrado de Nacional:** ¿alineamos `prediccion.js` y `nacional.html` con tu regla (venció a todos los demás empatados → primero; si no, menor PC)? Recomiendo **sí**: afecta quién queda 1.º, 2.º… y hoy el bracket usa la regla por pares.
2. **Significado de «lugar» en Nacional:** ¿es el **sembrado 1–8 por partidos ganados** (como el bracket)? Recomiendo sí.
3. **Camino para 14 Grandes:** A1 (conservar el desempate actual para «clasificado») o A2 (reemplazarlo). Recomiendo A1.
4. **Texto de «Desclasificado»:** ¿«Quedar fuera de playoffs» en los títulos de los escenarios?
5. **¿Habilitar también 9.º–14.º en 14 Grandes?** Una vez hecha la infraestructura cuesta casi nada; hoy la lista solo llega al 8.º.

---

## 10. Pruebas — diferidas al siguiente sprint

- Cotas de lugar de Nacional contra la tabla real con marcadores aleatorios (el prototipo, convertido en prueba).
- Coherencias de probabilidad: `P(clasificado) + P(desclasificado) = 1` y `Σ P(lugar k) = P(clasificado)`.
- Escenarios de lugar y desclasificado **se cumplen al reevaluarlos con la tabla real**.
- Optimizador con signo: restricciones `arriba` y `abajo` satisfechas, ganadores sin cambiar, marcadores dentro de los topes.
- Regresión: con el objetivo «clasificado» los resultados de 14 Grandes y Nacional son idénticos a los de hoy.
- Estados decididos por objetivo (asegurado, imposible, ya estás fuera) con prueba exacta.
- Interfaz: las 10 opciones, el texto por objetivo y el estado decidido (jsdom).
