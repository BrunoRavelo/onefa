# Plan: Escenarios de clasificación a playoffs (14 Grandes → después Nacional)

> Estado: **Fases 1 (motor) y 2 (interfaz) COMPLETADAS — ver §18 y §19.** Decisiones confirmadas en §16. Siguiente: revisión visual en dispositivos reales y Fase 3.
> Antes de redactarlo se hizo un análisis previo con **pruebas de viabilidad sobre tus datos reales**
> (scripts temporales fuera del repositorio). Los números de este documento salen de esas pruebas y se
> marcan como *medido* o *estimado*. Fecha del análisis: 2026-10-14, con `jornadas_jugadas = 6` en ambos JSON de 2026.

---

## 0. Resumen ejecutivo

**Qué se quiere:** que una persona elija un equipo de 14 Grandes y la app le diga **qué tiene que pasar para que
clasifique a playoffs** (Top 8), mostrando los escenarios en una pantalla con marcadores parecida a la de
"Predicción de marcadores", empezando por el **escenario más probable** según el modelo Massey que ya existe.

**Decisiones de diseño (todas justificadas en las secciones siguientes):**

1. **No se pueden listar "todos" los escenarios**: con la Jornada 6 concluida (mínimo del módulo) quedan 25 juegos
   pendientes (2²⁵ ≈ 33.5 millones de combinaciones). Se presentan: (a) la **probabilidad total** de clasificar,
   (b) una **tabla por victorias propias** ("con 3 de 4 victorias clasificas el 78 %"), (c) los **juegos clave**
   (los que más mueven la probabilidad) y (d) los **K escenarios más probables**, cada uno reducido a sus
   **condiciones mínimas** (qué resultados son necesarios y cuáles son indiferentes).
2. **El motor tiene dos capas, no una.** Capa 1: *quién gana* cada juego. Capa 2: *con qué marcador*.
   La capa 2 es indispensable: en una prueba con un equipo en la burbuja, **el 35 % de las combinaciones de ganadores
   se deciden por desempate (PC)**, o sea por marcadores y no solo por victorias.
3. **Probabilidades:** cada juego recibe una probabilidad de victoria a partir de la predicción Massey
   (`p = Φ(margen / σ)`, con σ ≈ 12.4 puntos, calibrado con 2025). Un escenario es "más probable" cuanto
   menos **sorpresas** (victorias del no favorito) necesite. Las simulaciones **no son aleatorias puras**: cada juego se
   sortea con **su** probabilidad (Tigres y MTY ≈ 96–100 % contra todos menos entre sí; CETYS ≈ 0–1 %); ver §4.6.
4. **Búsqueda:** *best-first* (cola de prioridad) sobre "cuántas sorpresas hacen falta". Es la forma iterativa del
   análisis recursivo que propones: decide juego por juego "favorito o sorpresa", pero explorando primero lo más
   probable. En la prueba encontró 5 escenarios distintos en **menos de 100 ms** para equipos que necesitan ayuda.
5. **Simulación Monte Carlo** (≈ 25 µs por simulación, *medido*) para la probabilidad total, la tabla por victorias
   propias y los juegos clave. Es barata y no necesita atajos.
6. **Todo corre en el navegador dentro de un Web Worker** (la app es estática; no hay servidor). Archivos nuevos:
   `escenarios.js` (motor), `escenarios-worker.js`, `escenarios-ui.js` (interfaz **compartida** para no repetir el
   problema de la triple copia de código que ya tiene el proyecto).
7. **El motor es parametrizable** (objetivo y "estrategia de conferencia"), de modo que "posición específica" (Fase 4)
   y Nacional (Fase 5) se agregan **sin reescribirlo**.

**Decisiones ya confirmadas por el usuario:**

- **D1:** un escenario "en el filo" (depende de un desempate por PC) **cuenta como clasifica**, etiquetado con su exigencia de marcador.
- **D2:** la ventaja local **se queda en 3 puntos** (no se recalibra).
- **D3:** los juegos aplazados **sí se van a jugar** → son pendientes y entran a escenarios y predicciones.
- **Mínimo: Jornada 6 concluida** (antes se había propuesto la 5). Consecuencia: *n* ≤ 25 en todo el alcance, así que la
  enumeración exacta (1.4 s) **siempre** es posible y desaparecen el caso difícil de n = 32 y la Fase 6.

**Prerrequisito detectado:** hoy los juegos aplazados (0-0 dentro de una jornada ya cerrada, p. ej. Tigres–MTY de J5)
no cuentan como pendientes para el modelo. Para este módulo **deben contar** (se corrige en la Fase 1).

---

## 1. Requisitos (y cómo los cubre el plan)

| # | Requisito del usuario | Cómo se cubre |
|---|---|---|
| R0 | Disponible con **al menos la Jornada 6 concluida** (cambio confirmado; antes se había propuesto la 5); sirve también con 7, 8 y 9 | Compuerta `ESC_JORNADA_MIN = 6`, habilitado hasta la 9. Con J6 quedan 25 juegos pendientes como máximo, así que la **enumeración exacta** (1.4 s) siempre es posible y permite **demostrar** "clasificado / eliminado". Con J10 concluida solo se muestra el resultado final. Solo temporada 2026 (no el histórico). |
| R1 | El usuario **selecciona el equipo** que necesita clasificar | Selector de equipo (14 opciones) + botón "Analizar". |
| R2 | Presentar **todos los escenarios probables** | Imposible listarlos todos (ver §4.1). Se entrega: probabilidad total, tabla por victorias propias, juegos clave y los K escenarios más probables (K=5 por defecto, "ver más" hasta 10), cada uno como **familia** (condición mínima). Se declara explícitamente que no es la lista exhaustiva. |
| R3 | Pantalla **parecida a la de pronósticos**, con los **marcadores necesarios** | Pantalla por jornada (misma estética de tablas y overlay que "Predicción de marcadores") con el marcador del escenario; cada fila marcada como **necesario / sorpresa / libre**. Ver §9. |
| R4a | **Escenario más probable** usando la lógica de **predicción de marcadores** | Escenario #1 = partir de los ganadores que predice el modelo (los favoritos) e invertir lo mínimo necesario. Si el equipo ya clasifica con la predicción, el #1 es exactamente la proyección de playoffs que ya existe. |
| R4b | Análisis **recursivo** de los escenarios más factibles | Búsqueda best-first sobre "costo de sorpresa" (§6, Etapa 6). |
| Futuro-1 | Escenarios para quedar en una **posición específica** | Fase 4: el objetivo deja de ser fijo ("Top 8") y pasa a ser un rango de posiciones. El motor ya nace parametrizado. |
| Futuro-2 | Trasladar a **Conferencia Nacional** | Fase 5: se agrega una "estrategia de conferencia" para Nacional (§12). |

---

## 2. Qué ya existe y se reutiliza

| Pieza existente | Archivo | Uso en este módulo |
|---|---|---|
| Ratings Massey por conferencia, prior 2025 con intercambio ascendido/descendido | `prediccion.js` → `construirModelosPorConferencia` | Probabilidades por juego (`modelo14.ratings`) |
| Predicción de un marcador | `prediccion.js` → `predecirPartido` | Marcador base ("esperado") de cada juego pendiente |
| Tabla 14G con desempate | `prediccion.js` → `calcularStandings14G` | **Única** función que decide posiciones finales (no se escribe una cuarta copia de la regla de desempate) |
| Proyección de playoffs | `prediccion.js` → `proyectarPlayoffs` | Coherencia: el escenario #1 debe coincidir con ella cuando el equipo ya clasifica |
| Overlay con topbar + hero, tablas `.s-tbl`, bracket | `index.html`, `onefa.css` | Misma estética para la pantalla nueva |
| Service Worker con precaché | `sw.js` | Hay que registrar los archivos nuevos (§7) |
| Optimizador CP-SAT | `maximizar_onefa.py` | **Oráculo de pruebas**: responde exacto si un equipo *puede* clasificar |

Reglas de la liga que el motor respeta (ya implementadas en la app):

- 14 equipos, **cada uno juega exactamente 9 juegos** (63 juegos, 1 descanso por equipo; *verificado en los datos*).
  Al terminar la temporada todos tienen PJ = 9, así que % Vict ordena igual que victorias (PG).
- Clasifican los **8 primeros**.
- Desempate (idéntico a `calcStandings`): un equipo que venció directamente a **todos** los demás empatados va primero;
  el resto, por **menor PC** (puntos en contra acumulados de toda la temporada). Un empate exacto en PC no está
  resuelto por la regla actual (queda al orden estable de la ordenación) y se trata como **desfavorable** (§6, Etapa 7).

---

## 3. Hallazgos del análisis previo (pruebas de viabilidad)

Todo con datos reales y el modelo actual. "Equipo de desarrollo" = la máquina donde se midió; los tiempos en teléfono
son **estimaciones** (se supuso un teléfono ~4× más lento; **hay que medirlo en un teléfono real en la Fase 1**).

### 3.1 Tamaño del problema

| Jornadas concluidas | Juegos pendientes *n* | Combinaciones de ganadores 2ⁿ |
|---|---|---|
| 5 | 32 | 4,294,967,296 |
| 6 *(estado actual)* | 25 | 33,554,432 |
| 7 | 19 | 524,288 |
| 8 | 13 | 8,192 |
| 9 | 7 | 128 |

(*n* incluye el juego aplazado de J5; si se juega antes, baja en uno. **La fila de J5 queda fuera del alcance** porque el mínimo del módulo es J6; se conserva solo como referencia de por qué se descartó.)

### 3.2 Qué estrategias son viables

| Estrategia | Resultado medido | Veredicto |
|---|---|---|
| **Monte Carlo** (con tabla completa y desempate por PC en cada simulación) | 29 µs/sim con n=32; 23 µs con n=25 → 20,000 sims en 0.45–0.59 s | **Viable y barato** |
| **Enumeración exhaustiva** solo de ganadores (código Gray, clasifica cada vector en SEGURO / EN EL FILO / FUERA) | 43 ns por vector → **1.4 s con n=25**; ~186 s con n=32 (extrapolado) | **Viable en todo el alcance (J6 en adelante)**; inviable con J5, por eso J5 quedó fuera |
| **Reducción de variables** ("equipos que siempre quedan arriba/abajo de T no importan") | Con J5: no reduce **nada** (n sigue en 32 para los 14 equipos); con J6 casi nada | **Descartada como estrategia principal** (los rangos de victorias aún se traslapan) |
| **Best-first** por costo de sorpresa | Equipos que necesitan ayuda: 5 escenarios distintos en **12–95 ms** (109–2,980 expansiones) | **Viable y es el núcleo** |
| Best-first *sin presupuesto* en un equipo que ya clasifica en la predicción | Se atoró hasta el tope de 300,000 expansiones (**57–70 s**) | **Problema real**: exige presupuesto de tiempo y "modos" por situación del equipo (§6, Etapa 4) |

### 3.3 El desempate no es un detalle

Para Burros Blancos con J6 concluida, de las 33.5 millones de combinaciones de ganadores:

- 16,547,916 (49.3 %) lo dejan **seguro** dentro del Top 8 sin importar desempates,
- 5,301,568 (15.8 %) lo dejan **fuera**,
- **11,704,948 (34.9 %) "en el filo"**: su lugar depende del desempate, es decir, de **marcadores**.

Ejemplo real (J6 concluida, Linces UVM, modelo actual): con solo **2 sorpresas** (gana Linces en J7 ante Borregos CEM
—el modelo daba 73 % a CEM— y en J8 ante Leones UAMN —70 % a UAMN—) se forma un **empate a 4 victorias entre
Linces, CEM, GDL y Burros Blancos** para los lugares 7 y 8; con los marcadores predichos queda Linces 7.º (PC 178),
CEM 8.º (200), GDL (214), Burros (228). Si los marcadores fueran otros, el resultado cambiaría: **el escenario
tiene que incluir marcadores**, no solo ganadores.

### 3.4 Calibración medida

| Parámetro | Valor | Origen |
|---|---|---|
| σ del margen de un partido | **≈ 12.4 pts** | RMS del residuo de Massey 14G 2025 (70 juegos con liguilla) = 11.17 con ventaja local 3; × 1.108 por corrección de sobreajuste |
| Ventaja local observada 2025 | 4.68 pts (el modelo usa 3) | Media del residuo; **decidido: se mantiene 3** (§16, D2) |
| Puntos de un equipo por juego | media 24.4, **SD 13.6**, p5 = 6, p95 = 49, p99 = 63, máx. 73 | 108 juegos (14G 2025 + liguilla + 2026 jugados) |
| Puntos totales por juego | media 48.7, SD 17.6 (mín. 17, máx. 93) | ídem |
| Juegos terminados con diferencia ≤ 1 | 7 de 108 | ídem; la liga no produce empates en la práctica |

### 3.5 Quiénes tienen algo en juego (estado actual, J6 concluida, 20,000 simulaciones)

Prob. de Top 8: Tigres, UAMN, MTY, Pumas CU ≈ 100 % · PUE 99.9 % · CCM 90.8 % · CEM 80.6 % · GDL 66.7 % ·
**Burros Blancos 49.7 %** · **Linces UVM 11.0 %** · Águilas Blancas 0.7 % · Aztecas UDLAP 0.7 % · Leones UAC y Zorros CETYS 0 %.
Hay **entre 6 y 8 equipos para los que el módulo tiene sentido**; para los demás debe decir "ya clasificado" o "eliminado"
(demostrado por enumeración exacta, §6 Etapa 2).

---

## 4. Modelo formal del problema

### 4.1 Por qué no hay lista exhaustiva
El número de combinaciones que cumplen el objetivo es de **millones** (p. ej. 16.5 M "seguras" para Burros). Una lista
completa es inútil para una persona. Lo útil es comprimirla en: probabilidad, umbrales, juegos clave y
**familias de escenarios** definidas por condiciones mínimas.

### 4.2 Variables
- Conjunto **P** de juegos pendientes (n). Incluye aplazados (juegos sin marcador, sin importar su jornada).
- Para cada juego `g`: ganador `o_g ∈ {local, visita}` y marcador `(sL, sV)` con `sL ≠ sV`.
- Estado actual por equipo: PG, PJ, PF, PC de los juegos ya jugados.

### 4.3 Objetivo (predicado) Q
`Q_T(o, s) ≡ posición final de T ≤ 8`, calculada por `calcularStandings14G` sobre la temporada completa.
(Fase 4: `Q_T ≡ min ≤ posición ≤ max`.)

### 4.4 Clasificación rápida en tres estados (solo con victorias)
Dado el vector de victorias finales `W`, sea
`A = #{t ≠ T : W_t > W_T}` (seguro por encima) y `B = #{t ≠ T : W_t = W_T}` (empatados con T).
La posición final de T está en el rango **[A+1, A+B+1]**. Entonces:

| Estado | Condición (objetivo Top 8) | Significado |
|---|---|---|
| **SEGURO** | `A + B + 1 ≤ 8` | Clasifica aunque pierda todos los desempates |
| **FUERA** | `A + 1 > 8` | No clasifica ni ganando todos los desempates |
| **EN EL FILO** | cualquier otro | Depende del desempate → **capa 2 (marcadores)** |

Generalización (Fase 4) con objetivo `[a, b]`: SEGURO si `A+1 ≥ a` y `A+B+1 ≤ b`; FUERA si `A+B+1 < a` o `A+1 > b`; si no, EN EL FILO.
Esta clasificación cuesta ~14 comparaciones por vector (43 ns *medido*).

### 4.5 Modelo de probabilidad (independiente por juego)
```
μ_g  = rating(local) − rating(visita) + VENTAJA_LOCAL          (el mismo margen que usa predecirPartido)
p_g  = P(local gana) = Φ(μ_g / σ)         σ = 12.4 (configurable)
costo de sorpresa c_g = |ln( p_g / (1 − p_g) )|   ≥ 0           (0 = parejo; grande = muy favorito)
P(escenario de ganadores) = Π P(resultado elegido en cada juego) = Π p_fav,g · exp(−Σ_{g sorpresa} c_g)
```
Supuestos (se declaran en la UI): juegos independientes; ratings **congelados** a la jornada actual (no se reajustan
dentro del escenario); σ y ventaja local constantes.

### 4.6 Las simulaciones respetan las probabilidades (y cómo se verifica)

**Monte Carlo no es "aleatorio puro".** Cada juego se sortea con **su propia** probabilidad `p_g` (§4.5), que sale de los
ratings Massey: estos ya incorporan el rendimiento 2026 y la fuerza del calendario rival de cada equipo, además del prior de
2025. Un equipo muy superior casi siempre gana en la simulación; uno muy inferior casi nunca. La búsqueda de escenarios (E5)
usa **las mismas** `p_g`, así que simulación y escenarios son coherentes entre sí.

Probabilidades que el modelo da **hoy** (J6 concluida) a los juegos pendientes:

| Equipo (rating) | Juegos pendientes y P(gana) | P(gana todos) |
|---|---|---|
| Auténticos Tigres (22.4) | vs MTY 43 % *(aplazado, Tigres local)* · vs UAMN 98 % · @CETYS 100 % · vs GDL 100 % · @Linces 96 % | 40.4 % |
| Borregos MTY (27.6) | @Tigres 57 % *(aplazado)* · @Burros 99 % · vs UAC 100 % · vs Aztecas 100 % · @Águilas Blancas 99 % | 56.1 % |
| Zorros CETYS (−28.0) | vs CCM 0 % · vs Tigres 0 % · @CEM 0 % · @UAMN 1 % | 0.0 % |

(Un "0 %" o "100 %" son valores redondeados; por eso existe la propuesta D9.)

**Qué dicen los datos sobre "casi no pierden":** en los datos disponibles (2025 temporada + liguilla y 2026 jugados), Tigres y MTY
tienen cada uno 15 victorias y 1 derrota, y **sus únicas derrotas fueron entre ellos** (MTY 27-24 Tigres en J5 2025; Tigres 33-30 MTY
en la final 2025). El modelo ya los trata así: casi seguros contra todos menos entre sí. El aplazado Tigres–MTY (43 % / 57 %) es el
juego más decisivo de lo que queda de temporada; muchos escenarios girarán alrededor de él. CETYS lleva 2 victorias y 12 derrotas
en esos mismos datos. **Límite honesto:** los ratings solo "recuerdan" 2025 y 2026 (los JSON no traen años anteriores); si hay
dominio de más años, el modelo no lo conoce.

**Calibración medida** (backtest: se predice cada jornada usando solo datos anteriores a ella):

| Muestra | Juegos | Favorito ganó | Brier | Log-loss |
|---|---|---|---|---|
| 2026, J2–J6 (con prior 2025) | 31 | 25 (81 %) | 0.186 | 0.595 |
| 2025, J4–J10 (sin prior) | 44 | 34 (77 %) | 0.156 | 0.458 |
| Referencia: lanzar una moneda | — | 50 % | 0.250 | 0.693 |

Las probabilidades aportan **mucha más información que el azar** (Brier y log-loss claramente mejores). Pero hay señales de
**sobreconfianza** en los favoritos fuertes: en 2026 perdieron tres favoritos con 91 %, 88 % y 97 % (Aztecas 26-28 Águilas Blancas
en J2; PUE 25-39 Pumas CU en J3; CCM 13-16 Burros Blancos en J6), y en 2025 los favoritos del rango 80–90 % ganaron 7 de 11 (64 %)
cuando se esperaba 86 %. Son muestras pequeñas (no concluyentes), pero coherentes con que la curva normal subestima las sorpresas.

**Propuesta (D9, pendiente):** acotar la probabilidad de cualquier resultado a **[0.03, 0.97]** (`pMin`/`pMax`), de modo que ningún
juego sea "seguro". Sin tope, Tigres vs CETYS vale 100 % y su "costo de sorpresa" tiende a infinito, dejando fuera escenarios que en
la práctica ocurren. En la Fase 1 se recalibrarán σ y el tope con el backtest conjunto (≈ 75 juegos) y se reportará el Brier
antes/después; no se cambia nada sin mostrar el resultado. No se agrega un "ajuste manual de fuerza" por equipo por defecto: el
modelo ya los trata como dominantes y el riesgo medido es el contrario (exceso de confianza).

### 4.7 Escalabilidad a Nacional (verificada con datos reales)

Pregunta: ¿el diseño escala a Conferencia Nacional, donde hay más equipos y juegos entre grupos? **Sí; medido con J6 concluida:**

| Medida | 14 Grandes | Nacional |
|---|---|---|
| Equipos / juegos por equipo | 14 / 9 | 19 / 8 |
| Pendientes con J6 (incluye aplazado) | 25 | 22 (2 son de Liebres CD Juárez: resultado **forzado**) |
| **Variables reales *n*** | **25** (2²⁵ = 33.5 M) | **20** (2²⁰ = 1.05 M) |
| σ del margen (calibrada con 2025) | 12.4 | **11.4** → debe ser **configurable por conferencia** |
| Monte Carlo (con tabla completa y desempate) | 25–29 µs/sim → 20,000 sims ≈ 0.5 s | 46 µs/sim → 20,000 sims ≈ 0.9 s |
| Evaluar UNA combinación con el evaluador completo | ~25 µs | 28 µs |
| Búsqueda best-first (equipos en la burbuja) | 12–95 ms | 8–500 ms (incluso Halcones UV, 0.4 %, con 13,226 expansiones) |
| Enumeración exacta con evaluador completo | 1.4 s (vía rápida por victorias) | ~30 s en escritorio, ~2 min en teléfono (**estimado**) → solo con una "vía rápida" propia de Nacional (Fase 5) |

Conclusiones de diseño: (1) el motor es genérico y recibe una **estrategia de conferencia** (equipos, evaluador completo,
clasificación rápida opcional, σ propia); (2) en Nacional la enumeración exacta **no hace falta** para el MVP: Monte Carlo + best-first
bastan y caben holgadamente en el presupuesto de 1 minuto; (3) los juegos de **Liebres CD Juárez** no son variables.

---

## 5. Visión general del flujo

```
 Usuario elige equipo ──► [E0 Preparar] ──► [E1 Probabilidades] ──► [E2 Cotas rápidas]
                                                                         │
                         ┌───────────────────────────────────────────────┘
                         ▼
                   [E3 Monte Carlo] ─► P(clasificar), distribución de posición,
                         │               tabla por victorias propias, juegos clave
                         ▼
                   [E4 Situación]  ─► clasificado / eliminado / favorito / burbuja
                         │
                         ▼
                   [E5 Búsqueda best-first de escenarios]  ◄─ presupuesto (tiempo/expansiones)
                         │         │
                         │         └─ para cada vector EN EL FILO ─► [E7 Marcadores de desempate]
                         ▼
                   [E6 Condición mínima + probabilidad de la familia]
                         ▼
                   [E8 Presentación: resumen + escenarios + pantalla de marcadores]
```
(La numeración de etapas del §6 sigue este diagrama; E4 decide qué modo ejecuta E5.)

---

## 6. Lógica de programación, etapa por etapa

### Etapa 0 — Preparación del problema
Entrada: los 4 JSON ya cargados (misma carga que usa la predicción) y el nombre del equipo.

1. `jj = jornadas_jugadas`. Si `jj < 6` → mensaje "Disponible a partir de la Jornada 6 concluida". Si `jj ≥ 10` → "Temporada regular concluida" + posición final.
2. **Juegos jugados** = marcador distinto de 0-0. **Pendientes = juegos sin marcador, sin importar su jornada**
   (corrige la limitación de los aplazados; ver §13, cambio 1). Etiqueta `aplazado` si `jornada ≤ jj`.
3. Para cada equipo: `base[t]` (PG ya conseguidas), `PJ`, `PC`, juegos restantes.
4. Ratings: `construirModelosPorConferencia(datos).modelo14` (ya incluye prior 2025 y shrinkage).
5. Índices numéricos para velocidad: equipos 0..13, juegos 0..n−1 con `iL[g]`, `iV[g]`, arreglos tipados (`Int8Array`).

### Etapa 1 — Probabilidades y costos por juego
Para cada pendiente: `μ_g`, `p_g = Φ(μ_g/σ)`, favorito, `c_g`, y el **marcador base** `(ŝL, ŝV)` de `predecirPartido`
(si coincide el empate, se asigna +1 al favorito: sin empates).
Se ordena el arreglo de juegos por `c_g` ascendente (lo usa la Etapa 5).
`Φ` se implementa con la aproximación de Abramowitz–Stegun (error < 1e-7); sin dependencias.

### Etapa 2 — Cotas rápidas (descartes demostrables)
Con `minW[t] = base[t]` y `maxW[t] = base[t] + restantes[t]`:
- **Eliminado matemáticamente** si `#{t : minW[t] > maxW[T]} ≥ 8`.
- **Clasificado matemáticamente** si `#{t ≠ T : maxW[t] ≥ minW[T]} ≤ 7`.

Solo se afirma algo cuando está **demostrado**. Estas cotas son débiles (§3.2) y solo atrapan casos obvios; como el mínimo
del módulo es J6 (n ≤ 25), la **enumeración exhaustiva** (1.4 s, en Worker) decide siempre, sin "prácticamente":
- **Clasificado matemáticamente:** *todas* las combinaciones de ganadores dejan a T en SEGURO (no depende de nadie ni de desempates).
- **Eliminado matemáticamente:** *ninguna* combinación lo deja en SEGURO ni EN EL FILO (ni ganando todos los desempates).
- Si no hay ninguna combinación SEGURO pero sí EN EL FILO: **"solo por desempate"** (se muestra qué marcador exigiría).

### Etapa 3 — Monte Carlo (probabilidad, umbrales, juegos clave)
Parámetros: `SIMS = 20,000` (±0.7 pts de error al 95 % en el peor caso), generador **con semilla** (xorshift32) para que dos
corridas den lo mismo.

Cada simulación, por juego:
```
margen ~ Normal(μ_g, σ);  ganador = margen > 0
total  ~ Normal(totalEsperado_g, σ_total)        // σ_total a calibrar en Fase 1 (referencia: SD de totales 17.6)
sL = round((total + margen)/2), sV = round((total − margen)/2), acotados a [0, 73], y |sL − sV| ≥ 1
```
Con los 14 equipos: tabla completa con `calcularStandings14G` (misma regla de desempate) → posición de T.

Salidas (todas del mismo bucle, costo ≈ 0.5 s):
1. **P(clasificar)** con intervalo de confianza `±1.96·√(p(1−p)/N)`.
2. **Distribución de posición final** (histograma 1..14; sirve a la Fase 4 sin recalcular).
3. **Tabla por victorias propias**: se agrupan las simulaciones según cuántos de sus juegos restantes gana T
   (k = 0..m) → `P(clasificar | T gana k de m)`. Si algún grupo tiene < 300 simulaciones, se completa con una
   corrida extra forzando esos resultados de T.
4. **Juegos clave**: por cada juego g, `impacto_g = P(Q | gana el local) − P(Q | gana la visita)` (contadores por
   resultado dentro del mismo bucle). Se muestran los 5 con mayor |impacto|, indicando qué resultado ayuda a T.
5. **Victorias esperadas** de T y posición modal.

### Etapa 4 — Situación del equipo (decide el modo de la búsqueda)
| Situación | Criterio | Qué muestra |
|---|---|---|
| `clasificado` | demostrado (E2 o enumeración exacta) | "Clasificado matemáticamente" + mejor posición alcanzable |
| `eliminado` | demostrado | "Eliminado matemáticamente" + mejor posición alcanzable |
| `favorito` | P ≥ 0.85 | **Modo riesgo**: tabla por victorias propias + los escenarios más probables en que **falla** (objetivo ¬Q) |
| `burbuja` | 0.02 < P < 0.85 | **Modo clasificación**: escenarios más probables en que **clasifica** (objetivo Q) |
| `casi_eliminado` | P ≤ 0.02 sin demostración | Aviso + intenta el modo clasificación con presupuesto corto |

Umbrales (`0.85`, `0.02`) en constantes. El motor de búsqueda es **el mismo** para Q y ¬Q (solo cambia el predicado);
esto resuelve el problema medido de §3.2 (equipo favorito que atoraba la búsqueda).

### Etapa 5 — Búsqueda best-first de escenarios (el "análisis recursivo")

**Idea:** el espacio es "para cada juego, ¿gana el favorito o hay sorpresa?". Cada escenario = conjunto de sorpresas.
Su probabilidad baja con el **costo total** `Σ c_g` de las sorpresas. Se exploran los conjuntos en **orden de costo
creciente**, o sea de **más a menos probable**. Se implementa de forma **iterativa con cola de prioridad** (equivale a la
recursión sobre el árbol de decisiones, pero entrega los resultados ya ordenados y sin riesgo de pila).

Algoritmo (enumeración de subconjuntos por suma creciente, con los juegos ordenados por `c` ascendente):
```
estado = { costo, indices[], ultimo }                 // indices dentro del orden por costo
heap.push({costo:0, indices:[], ultimo:-1})
mientras heap no vacío y escenarios < K·3 y expansiones < MAX_EXP y tiempo < MAX_MS:
    s = heap.pop()
    ganadores = favoritos con las sorpresas de s invertidas
    r = evaluar(ganadores)                            // Etapa 5a
    si r.cumple: guardar (s, r)
    sucesores:
        si s.ultimo == -1:   push { costo: c[0], [0], 0 }
        si no, si ultimo+1 < n:
            push { costo + c[ultimo+1], [...indices, ultimo+1], ultimo+1 }          // agregar el siguiente juego
            push { costo − c[ultimo] + c[ultimo+1], [... sin el último, ultimo+1], ultimo+1 }   // reemplazar el último por el siguiente
```
Este esquema genera **todos** los subconjuntos exactamente una vez y en costo no decreciente (*k-smallest subset sums*).
El primero evaluado (costo 0) son los **favoritos puros**: es literalmente la lógica de predicción de marcadores que pides
como "caso 1".

**5a. `evaluar(ganadores)`** (camino rápido primero):
1. Calcular `W` con arreglos tipados; clasificar SEGURO / FUERA / EN EL FILO (§4.4).
2. SEGURO → cumple. FUERA → no cumple.
3. EN EL FILO → **Etapa 7** (marcadores de desempate); cumple solo si existe un marcador realista que lo logre.

**Presupuestos (obligatorios):** `MAX_EXP = 200,000` expansiones y `MAX_MS = 4,000` ms en el Worker. Al agotarse se devuelve
lo encontrado con la advertencia "búsqueda parcial". *Medido:* los equipos que necesitan ayuda terminan con 109–2,980
expansiones; sin presupuesto, un favorito llegó a 300,000 expansiones.

**Problema de las variantes triviales (detectado en la prueba):** si un conjunto de sorpresas cumple, también cumplen
los conjuntos que le añaden juegos **irrelevantes**; el top-K se llenaría de copias casi idénticas. Se resuelve en la
Etapa 6 agrupando por **condición mínima**.

### Etapa 6 — Condición mínima y probabilidad de cada familia
Para cada vector `v` que cumple:

1. **Juegos pivote:** se invierte cada juego solo y se vuelve a evaluar; si deja de cumplir, ese juego es *necesario*.
2. **Verificación de suficiencia:** `C₀` = pivotes con su resultado. Se comprueba que **todas** las completaciones de los
   juegos liberados cumplen: enumeración exhaustiva con código Gray si los juegos libres `f ≤ 24` (43 ns por vector →
   `f = 22` cuesta 0.18 s); si `f > 24`, se verifica por Monte Carlo (20,000 completaciones al azar) y se marca como
   "indicativa". Si falla, se agregan de vuelta los juegos no pivote que más influyen (los de rivales cerca del corte)
   hasta que sea suficiente.
3. **Subsunción:** un vector nuevo que coincide con la condición de un escenario ya guardado en todos sus juegos
   necesarios **no es un escenario nuevo** y se descarta.
4. **Probabilidad de la familia:** `P(C ∧ Q) = P(C) · P(Q | C)`, con `P(C) = Π p` de los resultados necesarios y
   `P(Q | C)` por Monte Carlo condicionado (5,000 simulaciones con la condición forzada). Si `C` es suficiente, `P(Q|C) = 1`
   salvo desempate por marcador.
5. Se **reordena** por esta probabilidad real (y por la exigencia de marcador de la Etapa 7) y se devuelven los K mejores.

Caso límite (aprendido en la prueba): si el equipo ya cumple con los favoritos y no hay juego pivote, la condición
mínima es vacía ("clasifica pase lo que pase en los juegos que quedan, con la predicción actual como mínimo"); ahí el
valor está en la **tabla por victorias propias** y en el **modo riesgo**.

### Etapa 7 — Marcadores que resuelven el desempate (capa 2)
Se ejecuta solo para vectores "EN EL FILO". Entrada: ganadores fijos. Sea `G` el grupo empatado en victorias que cruza el
corte, `A` los equipos seguros por encima de T y `plazas = 8 − A` los lugares que quedan dentro de `G`.

1. **Resultado directo (no requiere marcadores):** con los ganadores fijos se conoce quién venció a quién dentro de `G`.
   Si existe un equipo que venció a **todos** los demás de `G`, va primero (regla de la liga). Si con eso T ya queda
   dentro de `plazas` → **cumple vía resultado directo** (sin exigir marcador).
2. **Requisito por PC:** para los demás lugares gana quien tenga **menor PC**. T necesita que el número de equipos de
   `G` con `PC ≤ PC_T` sea menor que `plazas` (restando el equipo que barrió, si lo hay). Como el comparador actual no
   desempata un empate exacto de PC, se exige **PC_T estrictamente menor** (diferencia ≥ 1).
3. **Elegir marcadores:** se modifican solo los marcadores de los juegos pendientes (los ganadores no cambian; margen ≥ 1;
   cada marcador en [0, 73], el máximo observado). Se parte de los marcadores predichos y se minimiza el costo de
   plausibilidad `J = Σ [(sL − ŝL)² + (sV − ŝV)²] / (2·σ_s²)` con `σ_s = 13.6` (SD *medida* de puntos por equipo).
   - Efecto de cada punto: bajar los puntos que **permite** T (puntos de sus rivales en sus juegos pendientes) baja `PC_T`;
     subir los puntos que **permiten** los rivales del desempate (los de *sus* rivales) sube su PC. Un juego entre T y un
     rival de `G` ayuda por ambos lados (T anota mucho / el rival poco).
   - Algoritmo: **voraz por costo marginal** (mover de a 1 punto el marcador con mejor relación ganancia-de-PC / costo).
     Con costo convexo es óptimo para una restricción y es una heurística muy buena para varias. Se prueban los
     subconjuntos de rivales a superar (|G| ≤ ~5 → ≤ 16 combinaciones) y se queda el de menor `J`.
4. **Salida:** `cumple`, marcadores propuestos, `PC` requerido ("T debe permitir ≤ N puntos entre sus 3 juegos
   restantes"), y **exigencia**: *fácil* (ningún marcador se mueve > 0.5 σ_s), *exigente* (≤ 1.5 σ_s) o *muy exigente*.
   Si no existe asignación dentro de los límites → el vector se trata como **FUERA**.

La probabilidad de que la capa 2 efectivamente se dé se incorpora en la Etapa 6 con el Monte Carlo condicionado, así
no se promete una certeza que dependa de un marcador exacto.

### Etapa 8 — Presentación
Resumen + tabla por victorias propias + juegos clave + escenarios + pantalla de marcadores (§9). Cada escenario muestra
su **tabla final proyectada** (8 de clasificación resaltados) para que se vea contra quién empata y por qué.

---

## 7. Arquitectura de archivos

```
📁 repo/
├── escenarios.js          ← NUEVO. Motor puro (sin DOM), patrón UMD igual que prediccion.js. Expone window.ONEFA_ESC / module.exports
├── escenarios-worker.js   ← NUEVO. importScripts('prediccion.js','escenarios.js'); recibe {datos, equipo, opciones}; envía progreso y resultado
├── escenarios-ui.js       ← NUEVO. Overlay + render ÚNICO y compartido (14G ahora; Nacional después). Evita la triple copia
├── prediccion.js          ← CAMBIOS PEQUEÑOS (ver §13)
├── index.html             ← botón "Escenarios de playoffs" + contenedor + <script> (pocas líneas)
├── onefa.css              ← estilos .esc-* (misma paleta/clases base)
├── sw.js                  ← agregar los 3 archivos a PRECACHE y subir VERSION
├── tests/escenarios.test.js ← NUEVO. Se ejecuta con `node tests/escenarios.test.js` (sin dependencias)
├── plan.md                ← este documento
└── CLAUDE.md              ← actualizar al terminar cada fase
```

**Fallback sin Worker:** si `new Worker()` falla (p. ej. abriendo con `file://`), `escenarios-ui.js` ejecuta el motor en el hilo
principal por tandas (`setTimeout`/`requestIdleCallback`) para no congelar la pantalla.
**Regla de caché (de `CLAUDE.md` §9.4):** archivo nuevo ⇒ añadirlo a `PRECACHE`; para que todos lo reciban al instante,
subir `VERSION`.

---

## 8. API y estructuras de datos

```js
ONEFA_ESC.analizar(datos, {
  conferencia: '14g',                       // Fase 5: 'nacional'
  equipo: 'Linces UVM',
  objetivo: { tipo: 'playoffs' },           // Fase 4: { tipo: 'posicion', min: 1, max: 4 }
  opciones: { sims: 20000, K: 5, maxMs: 4000, maxExp: 200000,
              sigma: 12.4, sigmaTotal: 14, sigmaPuntos: 13.6, semilla: 1234,
              pMin: 0.03, pMax: 0.97 /* techo de confianza por juego, pendiente D9 */ },
  onProgreso: ({ fase, pct, parcial }) => {}
}) → Promise<Resultado>
```

```js
Resultado = {
  meta: { equipo, jornadasJugadas, nPendientes, aplazados: n, parametros, advertencias: [] },
  situacion: 'clasificado' | 'eliminado' | 'favorito' | 'burbuja' | 'casi_eliminado',
  probabilidad: { p, ic95: [lo, hi], metodo: 'montecarlo' | 'exacta' },
  distribucionPosicion: [p1 … p14],
  porVictoriasPropias: [{ victorias, de, p, sims }],
  juegosClave: [{ juegoId, jornada, local, visita, impacto, resultadoQueAyuda }],
  escenarios: [{
    id, probabilidad, probabilidadCondicion, sorpresas: n, via: 'ganadores' | 'resultado_directo' | 'desempate_pc',
    necesarios: [{ juegoId, ganador }],      // condición mínima
    libres: [juegoId …],
    marcadores: [{ juegoId, jornada, local, visita, scoreLocal, scoreVisita,
                   rol: 'necesario' | 'sorpresa' | 'libre' | 'esperado', aplazado: bool }],
    desempate: { grupo: [equipos], pcRequerido: n, exigencia: 'facil'|'exigente'|'muy_exigente' } | null,
    tablaFinal: [{ pos, equipo, pg, pc }]
  }],
  busqueda: { expansiones, ms, parcial: bool }
}
```

Funciones internas (todas puras y testeables): `prepararProblema`, `probabilidadJuego`, `cotas`, `monteCarlo`,
`situacionEquipo`, `buscarEscenarios` (heap), `evaluarVector`, `resolverDesempate`, `condicionMinima`,
`probabilidadFamilia`, `ordenarYAgrupar`.

---

## 9. Interfaz

Botón nuevo junto a "Predicción de marcadores": **"Escenarios de playoffs"** (deshabilitado con mensaje si `jj < 6` o 2025).
Overlay con el mismo topbar + hero que el de predicción.

```
┌ ESCENARIOS DE PLAYOFFS — 14 GRANDES ─────────────────────────── ← Regresar ┐
│ Equipo: [ Linces UVM ▾ ]   [ Analizar ]            Jornada 6 concluida      │
├─────────────────────────────────────────────────────────────────────────────┤
│ RESUMEN                                                                     │
│  Probabilidad de clasificar: 11.0 %  (±0.4)    Situación: EN LA BURBUJA     │
│  Hoy: 4.º–5.º lugar de victorias... (tabla actual) · Quedan 3 juegos        │
│                                                                             │
│ SEGÚN TUS VICTORIAS PROPIAS (3 juegos restantes)                            │
│   3 de 3 → 62 %   │   2 de 3 → 9 %   │   1 de 3 → 0 %   │   0 de 3 → 0 %    │
│                                                                             │
│ JUEGOS CLAVE (los que más mueven tu probabilidad)                           │
│   J7 Borregos CEM vs Linces UVM        gana Linces  +24 pts                  │
│   J8 Leones UAMN vs Linces UVM         gana Linces  +21 pts                  │
│   J9 Borregos GDL vs Burros Blancos    gana Burros  −9 pts … (ayuda/perjudica)│
├─────────────────────────────────────────────────────────────────────────────┤
│ ESCENARIOS MÁS PROBABLES  [1: 3.1 %] [2: 2.4 %] [3: 1.8 %] [4] [5]  ver más │
│  Escenario 1 · 2 sorpresas · se decide por desempate de PC (exigencia: fácil)│
│  ─ J7 ──────────────────────────────────────────────────────────────────    │
│  │ Borregos CEM     21 – 24   Linces UVM     ◆ NECESARIO (sorpresa)         │
│  ─ J8 ──────────────────────────────────────────────────────────────────    │
│  │ Leones UAMN      20 – 23   Linces UVM     ◆ NECESARIO (sorpresa)         │
│  │ Pumas CU         27 – 17   Burros Blancos   ○ libre (esperado)           │
│  Desempate: 4 equipos a 4 victorias → Linces necesita PC ≤ 178               │
│  [Tabla final proyectada ▸]                                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```
(Cifras del wireframe ilustrativas, no resultados reales.)

Reglas de la pantalla de marcadores:
- Misma estructura por jornada que "Predicción de marcadores" (`.s-wrap`/`.s-tbl`), con los juegos de T resaltados.
- Tres roles visuales: **necesario** (negrita + insignia), **sorpresa** (gana el no favorito; insignia), **libre** (gris: "cualquier resultado"; se muestra el esperado).
- Los juegos **aplazados** llevan insignia propia ("aplazado").
- Es de **solo lectura**. No toca `localStorage` ni los pronósticos del usuario. Un botón "Copiar este escenario a mis
  pronósticos" queda como **opcional de Fase 3**, con confirmación, porque rompería el principio de solo lectura.
- Aviso permanente: "Probabilidades según el modelo (ratings fijos, juegos independientes). Los marcadores son sugerencias plausibles que cumplen el desempate, no predicciones."
- Mientras corre: barra de progreso por etapas ("Simulando… Buscando escenarios…") y botón **Cancelar**; el resumen (E3, < 1 s) aparece **antes** que los escenarios.

---

## 10. Rendimiento

| Operación | Medido (equipo de desarrollo) | Estimado en teléfono (×4, **por confirmar**) | Presupuesto |
|---|---|---|---|
| Monte Carlo 20,000 sims | 0.45–0.59 s | ≈ 2–2.5 s | siempre se ejecuta |
| Probabilidad de familia (5,000 sims × K=5) | ≈ 0.15 s | ≈ 0.6 s | siempre |
| Best-first (equipo que necesita ayuda) | 12–95 ms | < 0.5 s | `MAX_MS = 4000` |
| Verificar condición mínima, `f ≤ 22` | ≤ 0.18 s por escenario | ≈ 0.7 s | `f ≤ 24` |
| Enumeración exacta completa n = 25 (para "matemáticamente clasificado/eliminado") | 1.4 s | ≈ 6 s | siempre (n ≤ 25 en todo el alcance), en Worker |
| Enumeración exacta n = 32 (J5) | ~186 s | ~12 min | **fuera de alcance** (mínimo J6) |

Total esperado por análisis: **1–3 s** en escritorio, **~3–8 s** en teléfono, siempre en Worker y con progreso.

---

## 11. Casos borde

| Caso | Tratamiento |
|---|---|
| Juego aplazado en jornada cerrada (0-0) | Es **pendiente**; etiqueta "aplazado"; entra al modelo y a los escenarios (Tigres–MTY y, en Nacional, Cimarrones–ITSON) |
| Equipo con todos sus juegos jugados | `m = 0`: no hay tabla por victorias propias; los escenarios dependen solo de terceros |
| Empate exacto en PC | Se exige diferencia estricta de ≥ 1 punto de PC |
| Empate en marcador del escenario | Prohibido: margen ≥ 1 siempre (la regla de la app ignora los empates) |
| Descanso (bye) / PJ distinto durante la temporada | Se evalúa solo la **tabla final** (todos PJ = 9) |
| `jj ≥ 10` | Mensaje de temporada concluida, sin cálculo |
| Equipo seleccionado ya sin posibilidades pero con P > 0 por Monte Carlo | Se rige por la enumeración exacta (siempre disponible con J6+), no solo por Monte Carlo |
| Probabilidades extremas (p ≈ 0 o 1) | `c_g` se acota (`p` en [0.001, 0.999]) para evitar costos infinitos |
| Búsqueda agotada por presupuesto | Se devuelven los escenarios encontrados + advertencia "búsqueda parcial" |
| JSON de 2025/2026 no disponibles | Mismo mensaje de error que la predicción |
| Cambio de datos con el overlay abierto (recarga automática del SW) | Se recalcula al reabrir; los resultados no se guardan |

---

## 12. Fases siguientes: posición específica y Nacional

### Fase 4 — Posición específica (diseño ya contemplado)
Objetivos como `{ tipo:'posicion', min, max }`: Top 4 (localía en cuartos), 1.er sembrado, evitar el 8.º–9.º, "exactamente 8.º",
etc. El cambio es pequeño porque el motor **ya** trabaja con `[a, b]`:
- Clasificación en 3 estados con el rango `[A+1, A+B+1]` (§4.4).
- El histograma de posición final (E3) ya contiene la respuesta de probabilidad para cualquier rango.
- La búsqueda cambia solo el predicado; el desempate (E7) generaliza `plazas` a "lugares disponibles dentro del grupo empatado para el rango".
- UI: selector adicional "Objetivo": *Clasificar (Top 8)*, *Top 4*, *Ser 1.º*, *Posición exacta…*.

### Fase 5 — Conferencia Nacional (estrategia de conferencia)
El motor no cambia; se escribe un objeto **estrategia** con la misma interfaz, y la 14G pasa a ser la primera implementación:
```js
estrategia = {
  equipos, jugados, pendientes,             // desde el JSON de la conferencia
  clasificarRapido(W, T, objetivo),          // SEGURO | FUERA | FILO usando solo victorias (si existe una cota útil)
  evaluarCompleto(ganadores, marcadores),    // tabla final y posición/clasificación de T (reutiliza calcularStandingsNacional)
  restantesPorEquipo, juegosFijos            // p. ej. Liebres CD Juárez: resultado forzado, NO es variable
}
```
Diferencias que la estrategia debe absorber (ya conocidas del código vigente):
1. **3 grupos + comodines:** clasifican el 1.º y 2.º de cada grupo + los 2 mejores terceros. La condición de T depende de **otros grupos** (compara su 3.er lugar con los terceros de los demás), así que la clasificación rápida por `[A+1, A+B+1]` solo sirve **dentro del grupo**; para los comodines hay que evaluar completo. La zona "EN EL FILO" será **mayor** y el peso recae en Monte Carlo + best-first con presupuesto.
2. **Juegos entre grupos cuentan** para ambas tablas (excepto `cuentaSoloPara`): los grupos no son independientes.
3. **Sembrado por PG** (no por % Vict) y comparación de terceros por % Vict y luego PC. Posibles PJ distintos entre grupos → no se puede asumir PJ igual a 9.
4. **Tamaño:** 19 equipos, 76 juegos; con J6 concluida hay ~23 pendientes (incluido el aplazado Cimarrones–ITSON) → exhaustivo y Monte Carlo siguen siendo viables.
5. **Liebres CD Juárez:** sus juegos son resultados **forzados**; se sacan de las variables (probabilidad 1) y reducen *n*.
6. **Posición específica en Nacional:** además del lugar dentro del grupo, el **sembrado general 1–8** por PG; se resuelve con el histograma de sembrado de E3.
7. UI: la misma `escenarios-ui.js` con la insignia de grupo (`badgeHtml`) y, si conviene, filtros por grupo.

---

## 13. Cambios necesarios en archivos existentes

1. **`prediccion.js` — juegos aplazados (corrige la limitación §12.1 de `CLAUDE.md`):** definir un helper `esPendiente(g)` = "sin marcador" (sin depender de la jornada) y usarlo en `generarPredicciones`, `proyectarJuegos` y `construirModeloConferencia` (este último ya ignora 0-0). Efecto colateral **deseable**: la predicción y la proyección de playoffs también empiezan a incluir esos juegos.
2. **`prediccion.js` — exportar piezas:** `cargarDatos(baseUrl)` (los 4 JSON, con caché en memoria para no repetir `fetch`), `getDirecto`, `modelo.ratings` ya accesibles; una función `probabilidadVictoria(local, visita, modelo, sigma)`.
3. **`index.html`:** botón, contenedor y 2–3 `<script src>` (sin lógica nueva dentro del HTML).
4. **`onefa.css`:** clases `.esc-*` (reutilizando variables y `.s-tbl`/`.pos-n`; recordar que `.pos-n` va en un `<span>` dentro del `<td>`).
5. **`sw.js`:** `PRECACHE` + `VERSION`.
6. **UI de calendario (opcional, aparte):** los inputs de juegos aplazados siguen bloqueados por `j <= JORNADAS_JUGADAS`; se puede desbloquear solo si el marcador es 0-0.
7. **`CLAUDE.md`:** documentar el módulo al cerrar cada fase.

---

## 14. Pruebas y validación

| # | Prueba | Cómo | Criterio |
|---|---|---|---|
| T1 | Paridad de la tabla | Comparar `calcularStandings14G` con `calcStandings` de `index.html` sobre los datos reales | Mismo orden en todas las posiciones |
| T2 | Oráculo exacto por fuerza bruta | Con n ≤ 19 (cortes J7–J9 *simulados* borrando marcadores) enumerar todo y comparar P exacta vs Monte Carlo | El valor exacto cae dentro del IC95 en ≥ 95 % de los equipos |
| T3 | Oráculo CP-SAT | Adaptar `maximizar_onefa.py` para "¿puede T quedar ≤ 8?" y comparar con `situacion` (eliminado/clasificado) para los 14 equipos con J6 (y cortes simulados J7–J9) | Sin discrepancias |
| T4 | Invariantes | Σ P(posición) = 1; P(Top 8) = Σ P(pos ≤ 8); cada escenario devuelto, **reevaluado con la tabla completa**, cumple el objetivo | 100 % |
| T5 | Suficiencia de la condición mínima | Para `f ≤ 22`, enumerar todas las completaciones | Todas cumplen (o se marca "indicativa") |
| T6 | Coherencia con la proyección | Si T clasifica en `proyectarPlayoffs`, el escenario #1 tiene 0 sorpresas y mismos ganadores | Igualdad |
| T7 | Monotonía | Con otros resultados fijos, que T gane un juego más nunca empeora su posición (salvo empates por desempate) | Sin violaciones |
| T8 | Determinismo | Misma semilla ⇒ mismos resultados | Idénticos |
| T9 | Rendimiento | Registrar tiempos del §10 (escritorio y **un teléfono real**) | Dentro de presupuesto; si el teléfono excede ~10 s, reducir `sims` o subir cortes |
| T10 | Marcadores de desempate | Para escenarios `via='desempate_pc'`, reevaluar con los marcadores propuestos | T queda dentro del Top 8 y todos los marcadores respetan ganador, margen ≥ 1 y rango |

Las pruebas viven en `tests/escenarios.test.js` y se ejecutan con `node` (el motor es puro y funciona en Node, igual que `prediccion.js`).

---

## 15. Hoja de ruta con criterios de aceptación

| Fase | Contenido | Hecho cuando |
|---|---|---|
| **0** | Análisis y pruebas de viabilidad *(hecho; ver §3)* | Este documento |
| **1** | Motor 14G (E0–E7) + corrección de aplazados + pruebas T1–T8, T10 | **HECHA** (47 pruebas en verde, ver §18). Pendiente de la Fase 1: medir tiempos en un teléfono real |
| **2** | **HECHA (§19).** Interfaz: botón, overlay, Worker, fallback, SW, estilos; pantalla de marcadores | Se puede elegir un equipo y ver resumen + K escenarios en 14G con J6–J9; funciona sin señal tras la primera carga |
| **3** | Pulido: "ver más", tabla final por escenario, "copiar a mis pronósticos" (opcional), fijar resultados propios como restricciones ("suponiendo que X gana…") | Probado con equipos de cada situación (clasificado, favorito, burbuja, casi eliminado) |
| **4** | Objetivo "posición específica" | Selector de objetivo funcionando con Top 4, 1.º y posición exacta |
| **5** | Nacional (estrategia + UI) | Paridad con 14G de pruebas T1–T10 adaptadas |
| **6** *(descartada)* | Exactitud con n = 32 (J5) | Ya no hace falta: el mínimo J6 deja n ≤ 25 y la enumeración exacta alcanza |

---

## 16. Riesgos, límites y decisiones abiertas

**Límites que hay que comunicar al usuario (van en un aviso dentro de la pantalla):**
1. Las probabilidades dependen del modelo Massey: ratings fijos dentro del escenario, juegos independientes, σ constante. Son **orientativas**.
2. Los marcadores propuestos son sugerencias plausibles que satisfacen el desempate, no pronósticos.
3. No se listan "todos" los escenarios (hay millones); se listan los más probables y sus condiciones mínimas.
4. Con J6 en adelante (n ≤ 25) "matemáticamente clasificado/eliminado" se **demuestra** por enumeración exacta; no hace falta decir "prácticamente".

**Riesgos técnicos:** rendimiento en teléfonos de gama baja (mitigado con Worker, progreso y presupuestos); búsqueda que se atora
en casos degenerados (mitigado con modos Q/¬Q y presupuestos); divergencia entre las reglas de desempate si alguien edita una de
las copias (mitigado: el motor **solo** usa `calcularStandings14G`).

**Decisiones:**

| # | Tema | Estado |
|---|---|---|
| D1 | Un escenario "en el filo" (se decide por desempate de PC) ¿cuenta como "clasifica"? | **Confirmado: sí**, etiquetado con su exigencia de marcador |
| D2 | Ventaja local | **Confirmado: se queda en 3 puntos** (sin recalibrar) |
| D3 | Juegos aplazados (Tigres–MTY; en Nacional, Cimarrones–ITSON) | **Confirmado: se van a jugar** → tratarlos como pendientes |
| D7 | Rango de jornadas habilitado | **Confirmado: mínimo J6 concluida**; habilitado de J6 a J9 |
| D4 | Escenarios a mostrar | Propuesto: K = 5 y "ver más" hasta 10 *(se asume salvo objeción)* |
| D5 | Dónde correr el cálculo | Propuesto: navegador (Web Worker). Plan B si los teléfonos sufren: precálculo offline con CP-SAT publicado como JSON *(se asume salvo objeción)* |
| D6 | Fijar los pronósticos propios del usuario como restricciones | Propuesto: sí, en Fase 3 (solo lectura de `localStorage`) *(se asume salvo objeción)* |
| D8 | Dónde vive el módulo | Propuesto: overlay en `index.html`, como la predicción *(se asume salvo objeción)* |
| D9 | **Techo de confianza por juego** (probabilidad mínima/máxima de cualquier resultado) | **Confirmado: [0.03, 0.97]**; ver §4.6 |
| D10 | **Tiempo de espera aceptable** | **Confirmado: hasta ~1 minuto**, con mensaje "Simulando opciones…" y botón Cancelar. Presupuestos del motor: búsqueda hasta 20 s, total ≤ 45 s |

---

## 17. Siguientes pasos propuestos

1. *(Hecho)* D9 y D10 confirmados; D4–D6 y D8 se toman como propuestos.
2. *(Hecho — ver §18)* **Fase 1:** corregir los juegos aplazados en `prediccion.js`, crear `escenarios.js` con E0–E7 y `tests/escenarios.test.js`.
3. Medir en un teléfono real los tiempos del §10 antes de empezar la interfaz.
4. Pasar a la **Fase 2** (interfaz) solo cuando las pruebas del motor estén en verde.

---

## 18. Resultado de la Fase 1 (motor 14 Grandes)

**Entregables:** `escenarios.js` (motor), `tests/escenarios.test.js` (47 pruebas), cambios en `prediccion.js`
(`esPendiente`, `probabilidadVictoria`, `cargarDatos`, exports) y documentación. **No se tocó ninguna página** (sin interfaz todavía).

### 18.1 Cambios en `prediccion.js`
- `esPendiente(g, jj)`: pendiente = jornada posterior a `jj` **o** sin marcador. Los aplazados entran a la predicción, a la proyección de playoffs y a los escenarios.
  **Efecto visible:** el campeón proyectado de 14G cambió de Auténticos Tigres a **Borregos MTY** (el aplazado Tigres–MTY lo gana MTY con 57 %).
  La predicción de 14G pasó a 25 juegos y la de Nacional a 22.
- `probabilidadVictoria` (σ por conferencia: 14G 12.4, Nacional 11.4; tope 3 %–97 %), `cargarDatos` (caché en memoria), y export de `getDirecto`, `Phi`, constantes.
- `calcularPredicciones` ahora reutiliza `cargarDatos`.

### 18.2 Resultados con tus datos (J6 concluida; Monte Carlo con semilla fija)
| Equipo | Situación | P(Top 8) | Cotas exactas | Lectura |
|---|---|---|---|---|
| Burros Blancos | burbuja | 60.5 % | 47.0 %–97.1 % | Con 2 de sus 3 juegos ganados clasifica ≈ 99 %; con 1, ≈ 27 % |
| Borregos GDL | burbuja | 57.9 % | 34.9 %–81.2 % | Depende sobre todo del aplazado y de su juego de J8 |
| Borregos CEM | burbuja (modo riesgo automático) | 79.0 % | 53.0 %–85.1 % | Con los resultados esperados ya clasifica; se muestra qué podría fallar |
| Linces UVM | burbuja | 10.1 % | 1.2 %–12.2 % | Necesita 2 sorpresas (gana en J7 a CEM y en J8 a UAMN); con 4 victorias totales clasifica 75 % porque tiene el PC más bajo |
| Zorros CETYS | casi eliminado | 0.0 % | 0.0 %–0.0 % | Necesitaría ganar sus 4 juegos como no favorito |
| Auténticos Tigres | favorito | ≈ 100 % | 100 %–100 % | Búsqueda de riesgos omitida (P ≥ 99.5 %) |

### 18.3 Ajustes respecto al plan (surgidos al probar con datos reales)
1. **Modo riesgo automático:** si el escenario #1 de "cómo clasificar" sale vacío (el equipo ya clasifica con lo esperado, p. ej. CEM), se cambia a "qué podría hacerlo fallar".
2. **Búsqueda omitida** cuando el favorito tiene P ≥ 99.5 % (antes gastaba ~60 s en escenarios de 0.00 %); presupuesto corto (5 s) para los casi eliminados.
3. **Ayuda externa:** `juegosClaveOtros` separa los juegos de *otros* equipos, porque los juegos clave estaban dominados por los propios.
4. **Condición mínima:** pivotes + refuerzo voraz. La "suficiencia" se reporta como **cotas exactas condicionadas** (`completaciones`) en lugar de exigir que toda completación cumpla.
5. **Familias candidatas:** K+3 (no K×2) para acotar el tiempo.

### 18.4 Verificación
- **47 pruebas pasan.** Las más exigentes: enumeración exacta idéntica a la fuerza bruta en los 14 equipos (incl. distribución condicionada); la probabilidad de Monte Carlo cae **siempre** dentro de las cotas exactas;
  la búsqueda halla **exactamente** el vector más probable que halla la fuerza bruta (corte J8; también detecta los imposibles); 506 vectores "en el filo" resueltos con marcadores válidos y ganadores respetados;
  886 vectores muestreados sin falsos negativos evidentes del optimizador (2,500 intentos aleatorios por caso).
- **Rendimiento medido (escritorio):** 3.2 s (Tigres, búsqueda omitida) a 8.5 s (GDL, Zorros) por análisis; todos < 45 s.

### 18.5 Pendiente de la Fase 1 y deuda conocida
- **T3 (oráculo CP-SAT con `maximizar_onefa.py`) no se hizo**; se sustituyó por fuerza bruta (T2, T12). Sigue siendo deseable como contraste independiente.
- **Medir tiempos en un teléfono real** (el factor ×4 es una suposición).
- `σ_total = 14` (dispersión de los totales) es **provisional**; falta calibrarlo con el backtest.
- **Recalibración de σ y del tope** (D9) con el backtest conjunto 2025+2026: pendiente (el tope 3 %–97 % ya está aplicado).
- La prueba T5 verifica la condición mínima contra las **cotas exactas** de sus completaciones, no que *toda* completación cumpla (que no siempre es cierto ni es lo que se promete).
- Los inputs de juegos aplazados siguen bloqueados en los calendarios (cambio de UI, aparte).

### 18.6 Siguiente paso
**Fase 2 (interfaz):** botón en `index.html`, overlay con el mismo estilo, Web Worker + fallback, mensaje "Simulando opciones…" con progreso por fases y botón Cancelar,
`escenarios-ui.js` compartido, estilos `.esc-*`, y registrar los archivos nuevos en `PRECACHE` de `sw.js` subiendo `VERSION`.

---

## 19. Resultado de la Fase 2 (interfaz)

**Entregables nuevos:** `escenarios-worker.js`, `escenarios-ui.js`, estilos `.esc-*` en `onefa.css`, botón + `<script>` en `index.html`, `sw.js` (PRECACHE + `VERSION = 'v2'`),
`tests/ui/` (36 pruebas) y el protocolo del Worker en `tests/escenarios.test.js` (ahora 54 pruebas).

### 19.1 Qué hace la pantalla
Botón "Escenarios de playoffs" (junto a "Predicción de marcadores") → overlay con el mismo `.topbar` + `.hero` del sitio → selector de equipo (ordenado como la tabla actual, con su récord) →
"Simulando opciones…" con barra por fases y botón **Cancelar** → resumen (probabilidad ± margen, situación, cotas exactas), tabla por victorias propias, juegos clave (propios y ayuda de otros),
pestañas de escenarios (resultados necesarios, marcadores por jornada con roles, desempate, tabla final proyectada) y aviso de límites.

### 19.2 Decisiones de implementación
- **Una sola copia de la interfaz** (`escenarios-ui.js`), que crea su propio overlay: `index.html` solo gana un botón y un `<script>`. Nacional (Fase 5) reutilizará el mismo archivo.
- **Worker con respaldo:** `new Worker('escenarios-worker.js')`; si falla (p. ej. `file://`) corre en el hilo principal con aviso "Modo compatible". **Cancelar = `terminate()`** (el motor es síncrono dentro del Worker).
- **Autonomía de estilos:** la verificación estática de clases detectó que la interfaz usaba `pred-jornada-label` y `col-pred`, que solo existían en el `<style>` interno de `index.html`; se sustituyeron por `.esc-jl` y `.esc-verde` (en `onefa.css`).
- **`VERSION` de `sw.js` pasa a `'v2'`** y se registran los tres archivos nuevos en `PRECACHE`.

### 19.3 Verificación
- **54 pruebas del motor/Worker** y **36 pruebas de interfaz** en verde. Las de interfaz cargan el `index.html` real en jsdom con sus scripts y JSON, emulan el Worker, y cubren: apertura, selector, progreso por etapas,
  resultados, pestañas, cancelación (sin resultados tardíos), respaldo sin Worker, favorito con búsqueda omitida, solo lectura y compuertas (2025, J5, J10).
- **Límite de esas pruebas:** jsdom no calcula estilos ni layout, así que **no verifican el aspecto visual** (colores, espaciados, desbordes en móvil). Eso queda **pendiente de revisión manual**.

### 19.4 Pendiente
- **Revisión visual** en un navegador de escritorio y en un teléfono real (y medir ahí el tiempo de cálculo; hoy son estimaciones).
- Despliegue: los cambios de HTML/CSS/JS llegan **una visita después** (Service Worker). La primera visita tras desplegar sigue mostrando la versión vieja; la segunda ya trae el botón.
- Fase 3 (pulido), 4 (posición específica) y 5 (Nacional).
