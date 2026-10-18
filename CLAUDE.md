# ONEFA Pronósticos — Contexto del Proyecto

> Última actualización de este documento: 2026-10-13.
> **La fuente de verdad es el código.** Si algo de aquí contradice a un archivo, gana el archivo
> (y conviene corregir este documento). Las secciones marcadas con ⚠ son diferencias o
> limitaciones detectadas al leer el código vigente.

---

## 1. Qué es y qué hace

Aplicación web **estática** (sin servidor, sin framework, sin bundler) para seguir y simular la
**Liga Mayor ONEFA** (Organización Nacional Estudiantil de Fútbol Americano, México).

Una persona puede:

1. **Ver el calendario completo** de una conferencia, jornada por jornada, con los resultados
   oficiales ya cargados (bloqueados) y las jornadas pendientes editables.
2. **Capturar marcadores propios** ("pronósticos") en las jornadas pendientes. Al escribir, la
   tabla de posiciones se recalcula al instante. Los pronósticos se guardan en el navegador
   (`localStorage`), no en ningún servidor.
3. **Ver la tabla de posiciones** con reglas de desempate (resultado directo → menor puntos en contra).
   En 14 Grandes: tabla única con zona de playoffs (Top 8). En Nacional: 3 tablas por grupo +
   tabla de 8 clasificados + bracket.
4. **Ver el calendario de un equipo** (`calendario_equipo.html`), incluyendo sus scrimmages.
5. **Consultar una predicción matemática** de los marcadores pendientes (modelo Massey) y de
   **cómo quedarían los playoffs** si esos marcadores se cumplieran (sembrado + bracket completo
   hasta el campeón proyectado). Es solo de consulta: no usa ni modifica los pronósticos del usuario.
6. Usar la app **con señal baja o sin señal**, gracias a un Service Worker (`sw.js`) que guarda
   todo en el teléfono y se actualiza en segundo plano.

Conferencias:

- **14 Grandes** = nivel 1 (14 equipos, una sola tabla). Clasifican los **8 mejores** a playoffs.
- **Conferencia Nacional** = nivel 2 (equipos repartidos en 3 grupos: Norte, Centro, Bajío; **un solo campeón**).
- Cada año **sube 1 equipo** (el campeón de Nacional) y **baja 1** (el peor de 14 Grandes).
  Ejemplo 2025→2026: Leones UAC (campeón Nacional 2025) sube a 14 Grandes; Pumas Acatlán baja a Nacional (grupo Centro).

**URL pública:** https://brunoravelo.github.io/onefa/ (GitHub Pages, subcarpeta `/onefa/`).

---

## 2. Stack técnico

| Aspecto | Decisión |
|---|---|
| Lenguajes | HTML + CSS + JavaScript puro (ES2018+, `async/await`, template strings) |
| Estilos | Un solo archivo compartido: `onefa.css` |
| Tipografía | Bebas Neue (títulos, números) + Barlow Condensed (texto), Google Fonts **cargadas sin bloquear** |
| Datos | 4 archivos JSON estáticos en la raíz del repo (se editan a mano) |
| Persistencia del usuario | `localStorage` (claves por conferencia y temporada, ver §7) |
| Offline / velocidad | Service Worker `sw.js` (estrategia *stale-while-revalidate*, ver §9) |
| Deploy | GitHub Pages: `git push` y en ~1 min está publicado |
| Herramienta offline | `maximizar_onefa.py` (Python + OR-Tools CP-SAT), solo 14 Grandes |
| Pruebas | No hay suite. `prediccion.js` se puede ejecutar en Node (ver §13) |

---

## 3. Mapa de archivos (todos viven en la **misma carpeta raíz**, estructura plana)

```
📁 repo/  (= https://brunoravelo.github.io/onefa/)
├── index.html                  ← Página principal: 14 Grandes (+ overlay de predicción 14G)
├── nacional.html               ← Conferencia Nacional (+ overlay de predicción Nacional)
├── calendario_equipo.html      ← Calendario/resultados de UN equipo (ambas conferencias)
├── prediccion.html             ← Predicción como página independiente (?conf=14g|nacional)
├── prediccion.js               ← MOTOR del modelo de predicción y de la proyección de playoffs
├── onefa.css                   ← Hoja de estilos compartida por TODAS las páginas
├── sw.js                       ← Service Worker (caché + actualización automática)
├── onefa_data_2025.json        ← 14 Grandes 2025 (histórico, completo + liguilla)
├── onefa_data_2026.json        ← 14 Grandes 2026 (temporada en curso)
├── onefa_nacional_2025.json    ← Nacional 2025 (histórico, completo + liguilla)
├── onefa_nacional_2026.json    ← Nacional 2026 (temporada en curso + scrimmages)
├── maximizar_onefa.py          ← Optimizador CLI offline (solo 14 Grandes)
└── CLAUDE.md                   ← Este documento
```

**Regla crítica de ubicación:** todas las rutas del código son relativas (`./onefa_data_2026.json`,
`onefa.css`, `prediccion.js`, `./sw.js`). Por eso **todos los archivos deben estar en la misma
carpeta**; `sw.js` en particular debe estar junto a los HTML (su *scope* es la carpeta donde vive).

Nota: `simulador_onefa_colley.html` fue el nombre original de `index.html` (archivo legacy; puede
eliminarse si aún existe).

---

## 4. Relación entre archivos

```
                         ┌───────────────────────── sw.js ─────────────────────────┐
                         │  intercepta TODOS los fetch del sitio (HTML, CSS, JS,    │
                         │  JSON y Google Fonts) y los sirve desde caché             │
                         └───────────────▲──────────────────────────────────────────┘
                                         │ (registrado por un <script> al final de las 4 páginas)
 ┌─────────────┐   <link>    ┌───────────┴─┐  fetch   ┌──────────────────────────┐
 │ onefa.css   │◄────────────┤ index.html  ├─────────►│ onefa_data_YYYY.json      │
 └─────▲───────┘             │ (14G)       │          └──────────────────────────┘
       │ <link>              └──────┬──────┘
       │                            │ <script src>
       │             ┌──────────────▼─────────────┐   fetch (los 4 JSON)   ┌──────────────────────────────┐
       ├─────────────┤ prediccion.js              ├───────────────────────►│ onefa_data_2025/2026.json      │
       │             │ (expone window.ONEFA_PRED) │                        │ onefa_nacional_2025/2026.json  │
       │             └──────────────▲─────────────┘                        └──────────────────────────────┘
       │                            │ <script src>
 ┌─────┴───────┐             ┌──────┴────────┐        ┌──────────────────────┐   ┌───────────────────────┐
 │nacional.html├─fetch─────► │prediccion.html│        │ calendario_equipo    │   │ maximizar_onefa.py    │
 │ (Nacional)  │ onefa_nacional_YYYY.json    │        │ .html                │   │ (lee onefa_data_YYYY) │
 └─────────────┘             └───────────────┘        └──────────────────────┘   └───────────────────────┘
```

Resumen de dependencias:

| Archivo | Usa (carga/lee) | Lo usan |
|---|---|---|
| `index.html` | `onefa.css`, `prediccion.js`, `onefa_data_YYYY.json` (el de la temporada de la URL), `sw.js` | `nacional.html` y `calendario_equipo.html` (enlaces) |
| `nacional.html` | `onefa.css`, `prediccion.js`, `onefa_nacional_YYYY.json`, `sw.js` | `index.html` y `calendario_equipo.html` (enlaces) |
| `calendario_equipo.html` | `onefa.css`, `sw.js`, el JSON de su conferencia/temporada; para equipos de 14G también `onefa_nacional_YYYY.json` (solo para leer `scrimmages`) | Menús "Equipos" de `index.html` y `nacional.html` |
| `prediccion.html` | `onefa.css`, `prediccion.js`, `sw.js` | **Nadie la enlaza**: se entra por URL directa (está en la precaché) |
| `prediccion.js` | Los 4 JSON (vía `fetch`) | `index.html`, `nacional.html`, `prediccion.html` |
| `onefa.css` | Google Fonts (por nombre de familia) | Todas las páginas HTML |
| `sw.js` | Lista `PRECACHE` (HTML, CSS, JS, 4 JSON) + Google Fonts | Registrado por las 4 páginas |
| `maximizar_onefa.py` | `onefa_data_YYYY.json` (misma carpeta que el script) | Ejecución manual (CLI) |

**Duplicación de código intencional (importante al editar):** `index.html`, `nacional.html` y
`prediccion.html` tienen **cada uno su propia copia** del JavaScript que dibuja el ranking, el
sembrado, el bracket y la tabla de predicciones (`renderRanking`, `renderBracket`,
`renderPredicciones`, `abrirPrediccion`…). No comparten ese código de interfaz. Por eso, si se
renombra o cambia la forma de lo que devuelve `prediccion.js`, **hay que actualizar las 3 copias**
(ya pasó al renombrar `rankingUnificado` → `rankingConferencia`). Lo mismo aplica a la lógica de
tabla/desempate: existe en `index.html` (`calcStandings`), en `nacional.html`
(`calcGroupStandings`/`renderPlayoffs`) y replicada en `prediccion.js`
(`calcularStandings14G`/`calcularStandingsNacional`); las tres deben mantenerse equivalentes.

---

## 5. Flujo de datos, de punta a punta

### 5.1 Carga de una página (ej. `index.html?temporada=2026`)

1. El navegador pide el HTML. Si ya hay Service Worker activo, **`sw.js` responde al instante
   con la copia guardada** y en segundo plano revisa si hay versión nueva (ver §9).
2. En el `<head>`, **antes que el CSS y las fuentes**, un `<script>` inline arranca la descarga del JSON:
   `window.__DATOS = fetch('./onefa_data_2026.json', {cache:'no-cache'}).then(r => r.json())`.
   (`nacional.html` hace lo mismo con `onefa_nacional_YYYY.json`.) Así el JSON viaja en paralelo con el CSS.
3. Las fuentes de Google se cargan **sin bloquear el pintado** (`media="print" onload="this.media='all'"`):
   si Google tarda o no responde, la página se pinta con la fuente de respaldo.
4. Al final del `<body>`, el script principal ejecuta `cargarDatos()`:
   - `await window.__DATOS` (o hace su propio `fetch` si no existiera). Rellena `equipos`/`grupos`,
     `juegos` y `JORNADAS_JUGADAS` desde el JSON.
   - Si el fetch falla: `window.__ERR = true` y el encabezado muestra
     "⚠ Sin conexión: no se pudieron cargar los datos. Reintentar" (la página **no se bloquea**).
   - **Mezcla con `localStorage`** (ver regla de merge abajo).
   - Pinta el texto del hero, el menú de equipos, el calendario y calcula la tabla.
5. Se registra el Service Worker (`window.load`) y se instalan los listeners de recarga automática.

**Regla de merge `localStorage` ↔ JSON** (idéntica en las 4 páginas que la usan):
`localStorage` **solo rellena juegos cuyo marcador en el JSON base sea 0-0** (`scoreLocal + scoreVisita === 0`).
Un resultado oficial del JSON **nunca** se sobrescribe. Consecuencia útil: cuando se publica el
resultado oficial de un juego que el usuario había pronosticado, el oficial reemplaza al pronóstico
automáticamente. La clave de cada juego es `"jornada#local#visita"`.

### 5.2 Cuando el usuario escribe un marcador

```
<input.score-inp data-idx data-team>  ──input──►  juegos[idx].scoreLocal|scoreVisita
        └─► recalcular tablas (calcStandings [+ calcColley]  |  calcGroupStandings)
        └─► save()  →  localStorage[STORAGE_KEY] = JSON.stringify(juegos)   // el arreglo COMPLETO
```

- Un **único** listener de `click` y uno de `input` en `document` (delegación). No duplicar listeners
  (causa doble *toggle* en los acordeones).
- Jornadas `j <= JORNADAS_JUGADAS` → inputs `readonly` y ✓ junto al nombre de la jornada.
- Botones: "Borrar jornada" (`clearJornada`) y "Borrar todos los pronósticos" (solo toca jornadas no jugadas).

### 5.3 Cuando el usuario abre "Predicción de marcadores"

```
click #btnPrediccion → abrirPrediccion()
  └─ overlay.classList.add('open'); body{overflow:hidden}
  └─ (solo la primera vez) ONEFA_PRED.calcularPredicciones(CONF, './')
        ├─ fetch en paralelo de los 4 JSON (onefa_data_2025/2026, onefa_nacional_2025/2026)
        ├─ construirModelosPorConferencia(datos) → modelo14 + modeloNac (separados)
        ├─ generarPredicciones → marcador predicho de cada juego con jornada > jornadas_jugadas
        └─ proyectarPlayoffsConModelos → sembrado 1-8 + bracket completo + campeón
  └─ renderRanking(modelo) · renderBracket(playoffs) · renderPredicciones(predicciones)
```

- La predicción usa **solo los JSON oficiales**. **No** lee los pronósticos del usuario para calcular
  nada; los pronósticos solo se muestran en la columna informativa "Tu pronóstico" (leída de `localStorage`).
- Se calcula **una sola vez por carga de página** (`calculado = true`): reabrir el overlay no recalcula.
  ⚠ Si el usuario cambia pronósticos y reabre sin recargar, la columna "Tu pronóstico" puede quedar desactualizada.
- ⚠ El overlay (`index.html`/`nacional.html`) **siempre usa los JSON de 2026**, aun cuando la página se
  vea con `?temporada=2025` (el botón sigue visible en el histórico), y su clave de `localStorage` está
  fija en la de 2026.

### 5.4 Actualización de datos (flujo operativo)

1. Editar el JSON de la conferencia: llenar `scoreLocal`/`scoreVisita` de la jornada recién jugada.
2. Subir `jornadas_jugadas` al número de la última jornada **cerrada**.
3. `git add . && git commit -m "..." && git push` → GitHub Pages publica en ~1 min.
4. La próxima vez que alguien abra la app, el Service Worker detecta que un `.json` cambió, lo guarda y
   avisa a la página, que **se recarga sola** (ver §9). No hace falta tocar HTML ni `sw.js`.

---

## 6. Formato de los datos JSON

### 6.1 Campos comunes de los juegos

```json
{ "jornada": 3, "local": "Equipo A", "visita": "Equipo B", "scoreLocal": 0, "scoreVisita": 0 }
```

- **Marcador 0-0 = "no jugado / sin dato"** en toda la app (se ignora en tablas, ratings y comparador).
- Los **nombres de equipo deben ser idénticos** entre archivos (2025 vs 2026 y entre calendario/grupos);
  `prediccion.js` usa el nombre como llave para arrastrar el prior de 2025 a 2026.
- Campo opcional `cuentaSoloPara: ["Equipo"]` (solo Nacional): el juego suma a la tabla **únicamente**
  de los equipos listados. Se usa para juegos de relleno por grupos de tamaño desigual
  (ej. 2025: Correcaminos UAT vs Lobos UA de C en J0 y vs Tecos UAG en J9).

### 6.2 `onefa_data_YYYY.json` — 14 Grandes

```json
{
  "temporada": 2026,
  "jornadas_jugadas": 6,
  "equipos": ["Auténticos Tigres", "Borregos CCM", "..."],
  "juegos": [ { "jornada": 1, "local": "...", "visita": "...", "scoreLocal": 49, "scoreVisita": 7 } ],
  "liguilla": [ { "ronda": "Final", "jornada": 13, "local": "...", "visita": "...", "scoreLocal": 33, "scoreVisita": 30 } ]
}
```

- `liguilla` (playoffs reales) **solo existe en 2025**. Lo lee únicamente `prediccion.js`
  (para calificar mejor a los equipos en 2025). Las páginas no lo muestran.
- 2025: 10 jornadas, 63 juegos regulares + 7 de liguilla. 2026: 10 jornadas, 63 juegos.

### 6.3 `onefa_nacional_YYYY.json` — Conferencia Nacional

```json
{
  "temporada": 2026,
  "conferencia": "Nacional",
  "jornadas_jugadas": 6,
  "nota_desempate": "texto libre que nacional.html muestra tal cual",
  "grupos": { "Norte": ["..."], "Centro": ["..."], "Bajío": ["..."] },
  "juegos": [ { "jornada": 0, "local": "...", "visita": "...", "scoreLocal": 6, "scoreVisita": 7 } ],
  "scrimmages": [ { "local": "...", "visita": "...", "scoreLocal": 17, "scoreVisita": 0, "nota": "2Q" } ],
  "liguilla": [ ... ]
}
```

- **Jornada 0** existe en Nacional (partido de pre-temporada, Panteras vs Halcones en 2026; 5 juegos en 2025).
- `scrimmages` (solo 2026): juegos de preparación. Pueden incluir equipos de 14 Grandes y equipos
  externos ("Tepeyac"). **No cuentan para tablas ni para el modelo.** Solo se muestran informativos
  (acordeón en `nacional.html`, sección ámbar en `calendario_equipo.html`). `nota: "2Q"` = jugado a 2 cuartos.
- `liguilla`, `temporada_regular_finalizada`, `liguilla_finalizada` existen solo en 2025
  (los flags no los consume ninguna página).
- `nota_desempate` es lo único que `nacional.html` lee de los metadatos de texto.

### 6.4 Significado de `jornadas_jugadas`

Es la **última jornada oficial cerrada**. Gobierna: qué jornadas se bloquean (`j <= jornadas_jugadas`),
qué jornada se abre por defecto (`jornadas_jugadas + 1`), el texto "Resultados oficiales hasta Jornada N",
qué juegos considera "pendientes" el modelo (`jornada > jornadas_jugadas`) y los badges Victoria/Derrota/Pendiente
del calendario de equipo.

- Estado al escribir este documento: **14G 2026 = 6**, **Nacional 2026 = 6**, 2025 = 10 (14G) y 9 (Nacional).
- Nacional empezó 2026 con `-1` para que la Jornada 0 no quedara bloqueada; al jugarse, pasó a 0, luego 1, etc.
  La condición `j <= JORNADAS_JUGADAS` funciona sin casos especiales.
- ⚠ **Juegos aplazados:** hoy hay un juego 0-0 dentro de una jornada ya cerrada en cada conferencia
  (14G J5: Auténticos Tigres vs Borregos MTY; Nacional J5: Cimarrones UABC vs Potros ITSON). Consecuencias:
  los inputs de esa jornada están bloqueados (el usuario no puede simularlos), el modelo **no los predice**
  (solo predice `jornada > jornadas_jugadas`) y por tanto **no entran** en la tabla ni en el bracket proyectado.
  Ver §12.

### 6.5 Equipos 2026 (según los JSON vigentes)

**14 Grandes (14):** Auténticos Tigres, Borregos CCM, Borregos GDL, Linces UVM, Leones UAC,
Leones UAMN, Zorros CETYS, Águilas Blancas, Borregos MTY, Borregos PUE, Burros Blancos,
Borregos CEM, Pumas CU, Aztecas UDLAP.

**Nacional (19):**
- Norte (6): Águilas UACH, Potros ITSON, Indios UACJ, Lobos UA de C, Cimarrones UABC, Liebres CD Juárez
- Centro (7): Panteras Siglo XXI, Halcones UV, Búhos IPN, Frailes UT, Potros Salvajes, Toros Salvajes, Pumas Acatlán
- Bajío (6): ASUCQ / RED WOLVES, Lobos ULM, Cardinals UIW, Tecos UAG, Correcaminos UAT, Leones UAQ
  (⚠ una versión anterior de este documento decía "Arkansas ST QRO"; el JSON usa "ASUCQ / RED WOLVES").

Casos especiales:
- **Leones UAC** (14G 2026) venía de Nacional Centro (campeón 2025). **Pumas Acatlán** (Nacional Centro 2026) venía de 14G (último lugar 2025).
- **Borregos TEC QRO** desapareció tras 2025: está en los JSON de 2025 pero no en los de 2026. No requiere
  código especial (al no estar en el roster 2026 nunca recibe prior), pero sus juegos 2025 sí ayudan a calificar a sus rivales de ese año.
- **Liebres CD Juárez** perdió/forfeitó sus juegos por default 1-0 (`EXCLUIDO` del modelo; ver §8.6).
- Los grupos de Nacional **cambian entre años** (en 2025 Norte tenía 5 equipos y Lobos UA de C estaba en Bajío; en 2026 Lobos UA de C está en Norte y Correcaminos UAT en Bajío).

---

## 7. `localStorage` / `sessionStorage`

| Contenido | Clave |
|---|---|
| Pronósticos 14G 2025 | `onefa_juegos_v1` |
| Pronósticos 14G 2026 | `onefa_juegos_2026_v1` |
| Pronósticos Nacional 2025 | `onefa_nacional_2025_v1` |
| Pronósticos Nacional 2026 | `onefa_nacional_2026_v1` |
| `sessionStorage` (anti-bucle de recarga del SW) | `swReload` (marca de tiempo) |

- El valor guardado es el **arreglo `juegos` completo** de esa página (con oficiales y pronósticos).
- `calendario_equipo.html` y `prediccion.html` **leen** estas mismas claves (para mostrar el pronóstico
  del usuario) pero **no escriben** en ellas.
- Toda lectura/escritura está en `try/catch`: si el navegador bloquea el almacenamiento, la app sigue funcionando.

---

## 8. Descripción detallada de cada archivo

### 8.1 `index.html` — 14 Grandes

Parámetro de URL: `?temporada=2025|2026` (default 2026). Elementos (en orden):

- **Barra superior** (`.topbar`): marca "ONEFA Pronósticos", pestañas de conferencia (14 Grandes / Nacional),
  selector de temporada (flecha SVG explícita; `appearance:none`), menú desplegable **Equipos** (`#eqPanel`,
  un enlace por equipo → `calendario_equipo.html?equipo=…&temporada=…`).
- **Hero**: título, año (`#heroYear`) y `#textoCorte` ("Resultados oficiales hasta Jornada N…" / "ingresa marcadores…").
- **Banner histórico** (solo 2025): "Resultados oficiales hasta J10 cargados".
- **Calendario y Pronósticos**: acordeón con una tarjeta por jornada (`generarCalendario`). Cada fila: local, input, VS, input, visita.
  Se abre por defecto la jornada `jornadas_jugadas + 1`.
  Botones: **Predicción de marcadores** (abre el overlay), **Borrar todos los pronósticos**.
- **Tabla de Posiciones** (`calcStandings`): columnas `#`, Equipo, PJ, PG, PP, % Vict (= PG ÷ PJ, con `<abbr>`), PF, PC.
  Algunas columnas se ocultan en pantallas chicas (`hide-sm`, `hide-md`).
  - Un juego cuenta solo si `sl + sv > 0` y `sl !== sv` (los empates y 0-0 se ignoran).
  - Orden: % Vict descendente. **Desempate** dentro de un grupo con igual %: si algún equipo venció directamente a
    **todos** los demás empatados, va primero; el resto (y si nadie cumple) por **menor PC**.
  - Filas 1–8 con borde verde medio (`r-playoff`); fila 8 con línea punteada (`r-cutoff`). Leyenda "Zona playoffs (Top 8)".
- **Ranking Colley** (`calcColley`): método matricial estándar (Colley 2001), resuelto con eliminación gaussiana.
  Se calcula en cada cambio pero **la sección está oculta** (`display:none`). Solo informativo, no oficial.
- **Overlay de predicción** (`#prediccionOverlay`): capa `position:fixed; inset:0` que se muestra/oculta con la
  clase `.open` (no navega ni abre ventana). Contiene su propia `.topbar` + `.hero` (mismo diseño que el resto del sitio),
  botón "← Regresar", nota del modelo, **sembrado + bracket proyectado**, ranking colapsable (`<details>`) y predicciones por jornada.
  Sus scripts están envueltos en un IIFE y dependen de `window.ONEFA_PRED` (`<script src="prediccion.js">` justo antes).

Funciones clave: `cargarDatos`, `generarMenu`, `generarCalendario`, `leerScores`, `getDirecto`, `calcStandings`,
`calcColley`, `solveGauss`, `recalcular`, `clearJornada`, `save`, y dentro del IIFE: `leerPronosticoUsuario`,
`renderRanking`, `renderBracket`, `renderPredicciones`, `abrirPrediccion`, `cerrarPrediccion`.

### 8.2 `nacional.html` — Conferencia Nacional

Parámetro de URL: `?temporada=2025|2026` (default 2026). Estructura similar a `index.html`, más:

- **Hero con "pills"** de grupo (Norte/Centro/Bajío) que saltan a cada tabla.
- **Calendario Completo**: acordeón por jornada (la J0 incluida). Cada juego lleva una **insignia de grupo**
  (`N`/`C`/`B` con color, o `✕` si los equipos son de grupos distintos) vía `gameGroup`/`badgeHtml`.
  Al final, un acordeón de **Scrimmages** (`renderScrimmages`), informativo, con insignias `14G` / `EXT` para equipos ajenos al grupo.
- **Tablas por grupo** (`calcGroupStandings`): una por grupo, con PG, PP, % Vict, PC.
  - Orden por % Vict y mismo desempate que 14G (resultado directo contra todos los empatados → menor PC).
  - ⚠ **Cuentan TODOS los juegos con marcador** (intra-grupo y entre grupos), salvo que el juego traiga `cuentaSoloPara`
    (entonces solo suma a los equipos listados). El documento anterior afirmaba que los cruzados no sumaban; el código
    **no filtra por grupo**. En 2026 hay 18 juegos entre grupos distintos (J3 Norte–Bajío, J7 Centro–Norte, J8 Bajío–Centro).
    La insignia `✕` es solo visual.
  - Zona de clasificación marcada con `r-playoff`; la línea punteada (`r-cutoff`) va tras el 2.º lugar de cada grupo.
- **Playoffs (8 equipos)** (`renderPlayoffs`): clasifican el **1.º y 2.º de cada grupo** (6) + los **2 mejores terceros**
  (comodines; se compara solo el 3.er lugar de cada grupo por % Vict y luego menor PC). **Sembrado general 1–8 por
  juegos ganados (PG)**; empates por resultado directo → menor PC. Bracket clásico **1v8 · 4v5 · 2v7 · 3v6**
  (CF1–CF4 → SF1/SF2 → Final), localía para el mejor sembrado. En esta sección en vivo **solo se llenan los Cuartos**;
  Semifinal y Final dicen "Ganador CFx / Por definir" hasta que haya resultados reales. (El overlay de predicción sí proyecta el bracket completo.)
- **Comparador de equipos** (`buildGraph`, `bfsPath`, `renderCompare`): grafo de rivales (juegos con marcador + scrimmages) y camino más
  corto (BFS) entre dos equipos. **La sección está oculta** (`display:none`) pero el código se ejecuta en cada recálculo.
- **Overlay de predicción** igual que en `index.html` (con `CONF = 'nacional'`), con columna de grupo en el sembrado (`badgeHtml`).

### 8.3 `calendario_equipo.html` — calendario de un equipo

URL: `calendario_equipo.html?equipo=Nombre&temporada=2026[&conferencia=nacional]`
(`conferencia` ausente = `14g`; `temporada` distinta de 2025 = 2026).

- Carga `onefa_data_YYYY.json` o `onefa_nacional_YYYY.json` según conferencia. Si el equipo no está en ese roster
  muestra "Equipo no encontrado".
- Lista los juegos del equipo por jornada con tarjetas: **Victoria / Derrota / Pendiente**
  (`jugado = jornada <= jornadas_jugadas`; el color depende del marcador). Aplica el mismo merge con `localStorage`.
- **Scrimmages** del equipo en una sección aparte de color ámbar. Se leen **siempre** de `onefa_nacional_YYYY.json`
  (aunque el equipo sea de 14 Grandes, porque varios 14G jugaron scrimmages). Un scrimmage 0-0 no muestra badge; un empate muestra "Empate".
- La barra superior conserva pestañas y selector de temporada; "← Tabla" regresa a `index.html`/`nacional.html` con la temporada.
- Hereda `onefa.css`; solo define localmente el estilo de `.btn-back`.

### 8.4 `prediccion.html` — predicción como página independiente

URL: `prediccion.html?conf=14g|nacional`. Pestañas entre conferencias. Muestra, de arriba abajo: nota del modelo,
sembrado y bracket proyectado, y las predicciones por jornada con la columna "Tu pronóstico".
Es de solo lectura (nunca escribe en `localStorage`). Usa el mismo `prediccion.js`. Misma lógica de render que los overlays (copia).
No está enlazada desde otras páginas.

### 8.5 `prediccion.js` — motor del modelo (autónomo, sin DOM)

Patrón UMD: en el navegador expone `window.ONEFA_PRED`; en Node, `module.exports`. No guarda resultados:
cada llamada vuelve a leer los 4 JSON (`fetch` con `cache:'no-cache'`) y recalcula todo.

**API pública (`ONEFA_PRED`):** `K_PESO_TEMPORADA_ANTERIOR`, `JORNADAS_TRANSICION`, `VENTAJA_LOCAL`, `EQUIPOS_EXCLUIDOS`,
`masseyRatings`, `construirModelosPorConferencia`, `rankingConferencia`, `predecirPartido`, `generarPredicciones`,
`calcularPredicciones` (async, hace el `fetch`), `proyectarPlayoffs`, `calcularStandings14G`, `calcularStandingsNacional`.

**Parámetros ajustables (arriba del archivo):**

| Constante | Valor | Qué controla |
|---|---|---|
| `K_PESO_TEMPORADA_ANTERIOR` | 3.5 | Cuánto pesa el rating 2025 al arrancar 2026 (≈ "3.5 juegos virtuales") |
| `JORNADAS_TRANSICION` | 4 | Rapidez con que ese peso se apaga |
| `VENTAJA_LOCAL` | 3 | Puntos extra al margen esperado del local |
| `RIDGE_ESTABILIDAD` | 0.05 | Regularización numérica mínima (evita sistemas singulares) |
| `EQUIPOS_EXCLUIDOS` | `['Liebres CD Juárez']` | Equipos fuera del modelo |
| `MARCADOR_FORZADO_VS_EXCLUIDO` | `{ganador:1, excluido:0}` | Marcador fijo contra un excluido |

**Qué calcula, paso a paso (`construirModelosPorConferencia`):**

1. **Ratings Massey 2025, por conferencia y por separado.** Para cada juego jugado (incluida la `liguilla` de 2025) se arma el
   sistema lineal de mínimos cuadrados con el margen de puntos; se resuelve por eliminación gaussiana y se **centra a media 0**.
   Un rating alto = el equipo tiende a ganar por más puntos contra un rival promedio.
2. **Detección de equipos puente:** *ascendido* = equipo del roster 14G 2026 que estaba en Nacional 2025; *descendido* = equipo del roster
   Nacional 2026 que estaba en 14G 2025.
3. **Intercambio de prior (decisión de diseño):** el ascendido entra a 14G con el rating 2025 que tenía **el descendido dentro de 14G**; el descendido
   entra a Nacional con el rating 2025 que tenía **el ascendido dentro de Nacional**. Se asume que ambos son de nivel equivalente (son
   el punto donde se tocan las dos ligas). **No se suma ni resta nada al resto de equipos**, porque las conferencias ya no se comparan en una sola escala.
4. **Modelo 2026 de cada conferencia, por separado** (`construirModeloConferencia`): solo con los juegos oficiales de **esa** conferencia
   (jornada ≤ `jornadas_jugadas`, marcador ≠ 0-0). El prior 2025 entra como ancla con peso
   `peso = K / (1 + juegosJugadosPorEseEquipo / N)`; así 2025 pesa mucho en la jornada 1 y se apaga conforme el equipo suma juegos.
   (El peso depende de los juegos jugados por **cada equipo**, no de la jornada global.)
5. Las **scrimmages y cualquier cruce entre conferencias NO entran** al cálculo.
6. Se guardan estadísticas de ofensiva/defensiva 2026 (PF/PC por juego) y el promedio de liga para estimar el total de puntos.

**Predicción de un partido (`predecirPartido`):**
```
margen       = (ratingLocal − ratingVisita) + VENTAJA_LOCAL
totalEsperado = promedio de [ PF_local + PC_visita ] y [ PF_visita + PC_local ]   (promedios por juego 2026; si no hay datos, promedio de liga; respaldo 24)
scoreLocal   = round((totalEsperado + margen) / 2)    scoreVisita = round((totalEsperado − margen) / 2)    (mínimo 0)
```
Si participa un equipo excluido, devuelve el marcador forzado (1-0 contra él) con `forzado: true` (la UI muestra la etiqueta "fijo").

**Proyección de playoffs ("si se cumplen las predicciones"):**

1. `proyectarJuegos`: rellena con el marcador predicho **todo juego con `jornada > jornadas_jugadas`**; los demás quedan intactos.
2. Se recalcula la tabla con **la misma lógica de desempate de las páginas** (récord, nunca el rating):
   - 14G: `calcularStandings14G` → top 8 de la tabla única (orden % Vict, desempate directo → menor PC).
   - Nacional: `calcularStandingsNacional` → tablas por grupo, 2 primeros + 2 mejores terceros, sembrado 1-8 por PG.
3. `construirBracketPrediccion`: CF1 = 1v8, CF2 = 4v5, CF3 = 2v7, CF4 = 3v6; SF1 = ganador CF1 vs ganador CF2; SF2 = ganador CF3 vs ganador CF4;
   la **final** enfrenta a los ganadores de SF. En cada ronda el **mejor sembrado es local**. Cada partido se predice con `predecirPartido`
   usando el modelo de esa conferencia; gana quien tenga mayor marcador (si empatan, el local/mejor sembrado).
4. Devuelve `{ standings|allRows, seeds, bracket:{cuartos, semifinal, final, campeon} }`. `generarPredicciones` lo incluye como `playoffs`.

Este formato (8 equipos, 1v8·2v7·3v6·4v5, mejor sembrado local) coincide con los brackets reales de 2025 de ambas conferencias.

### 8.6 `onefa.css` — estilos compartidos

Secciones (en orden): Variables · Reset · NAVBAR (marca, pestañas de conferencia, selector de año, dropdown de equipos) · HERO · banner histórico ·
contenedor principal · etiquetas de sección · ACCORDION/CALENDARIO (incluye sección Scrimmages) · tabla de partidos · inputs de marcador estilo LED ·
botones de borrar · TABLA DE POSICIONES (`.s-tbl`, `.pos-n`, `.s-eq`, `.s-num`, `.s-pct`) · badges de grupo Nacional · tarjetas de grupo ·
pills del hero · PLAYOFFS/bracket (`.bracket-*`, incluidos `.bracket-score`, `.bracket-winner`, `.bracket-champion` usados por la predicción) ·
comparador · match-cards del calendario de equipo · RESPONSIVE · UTILIDADES (`.d-none`, etc.).

Paleta (variables `:root`):

```css
--onefa-dark: #061810  /* navbar / hero (verde casi negro) */   --onefa-green: #0A6B25  /* verde primario */
--onefa-mid:  #128F35  /* hover / zona playoffs */             --onefa-light: #16A34A  /* acentos */
--onefa-red:  #C41230  /* rojo ONEFA */                         --bg: #F3F4F6  --surface: #FFFFFF  --text: #111827  --muted: #6B7280
--hi-bg: #F0FDF4  --hi-border: #BBF7D0  /* highlights verdes */
Grupos Nacional: Norte #1D4ED8 (azul) · Centro #B45309 (ámbar) · Bajío #166534 (verde)
```

Responsive: `>768px` escritorio · `≤768px` tablet · `≤540px` móvil (la marca se oculta, pestañas compactas, inputs más chicos) · `≤380px` extra chico.

⚠ **Gotcha de maquetación:** `.pos-n` es una **insignia** (25×25 px, `display:inline-flex`). Debe ir **dentro de un `<span>`** dentro del `<td>`:
`<td><span class="pos-n">1</span></td>`. Si se pone la clase directamente en el `<td>`, se rompe el layout de tabla y el número queda pegado al borde izquierdo.

### 8.7 `sw.js` — Service Worker

Ver §9 completo.

### 8.8 `maximizar_onefa.py` — optimizador offline (solo 14 Grandes)

```bash
pip install ortools
python maximizar_onefa.py --year 2026                      # equipo objetivo por defecto: Leones UAMN
python maximizar_onefa.py --year 2025
python maximizar_onefa.py --year 2026 --team "Leones UAMN"
```

Lee `onefa_data_{year}.json` **de la misma carpeta del script**. Con OR-Tools CP-SAT:
- **Modelo 1:** elige ganadores de los juegos pendientes (`jornada > jornadas_jugadas`) para **minimizar cuántos equipos quedan por delante** del equipo
  objetivo y, a igualdad, maximizar sus victorias. Enumera hasta 3 escenarios distintos.
- **Modelo 2:** para cada escenario elige marcadores **realistas de fútbol americano** (TD, XP, 2 pts, FG, safety) que minimizan los puntos totales y los del rival del objetivo.
- Calcula la tabla proyectada con la misma regla de la web (% Vict, desempate directo → menor PC) e imprime la posición final.
- No soporta Nacional; ignora la `liguilla`.

---

## 9. Service Worker y carga rápida / baja señal

**Objetivo:** que la app abra al instante y no se bloquee con poca señal.

### 9.1 Qué hace `sw.js` (estrategia *stale-while-revalidate*)

1. **Responde al instante** con lo guardado en el teléfono (sin esperar la red).
2. **En segundo plano** pide la versión nueva (`fetch` con `cache:'no-cache'`: pregunta al servidor si cambió; si no, recibe un 304 diminuto) y la guarda para la próxima vez.
3. Si cambió un **`.json`**, avisa a las páginas abiertas con `postMessage({type:'DATA_UPDATED'})` **después** de guardarlo.
4. Si es la primera visita (nada guardado) espera a la red. Sin red y sin caché: intenta mostrar `nacional.html` guardada; si no, falla normal.

Detalles de implementación:
- `VERSION = 'v1'`, caché `onefa-v1`.
- **Instalación:** descarga y guarda todo `PRECACHE` (`./`, los 4 HTML, `onefa.css`, `prediccion.js`, los 4 JSON) con `cache:'reload'` (salta la caché HTTP);
  si un archivo no existe se omite sin romper nada. Luego `skipWaiting()`.
- **Activación:** borra cachés `onefa-*` de otras versiones y hace `clients.claim()`.
- **Alcance de la interceptación:** solo peticiones `GET`, del mismo origen **o** de `fonts.googleapis.com` / `fonts.gstatic.com`.
- **Clave de caché del propio sitio:** `origin + pathname` (**ignora** `?temporada=…`, `?equipo=…`), por eso `index.html?temporada=2025` y `index.html` comparten entrada (la página lee el parámetro en el cliente).

### 9.2 Recarga automática en las páginas (script al final de las 4 páginas)

- Registra `./sw.js` en `window.load`.
- Marca `tocado = true` en el primer `pointerdown`/`keydown`/`touchstart`/`wheel`.
- Al recibir `DATA_UPDATED`: si la persona **no ha tocado nada**, recarga de inmediato (sale de caché, es instantáneo); si **ya estaba usando la app**
  (escribiendo marcadores) **no la interrumpe**: marca `pendiente` y recarga cuando vuelva a la pestaña (`visibilitychange`) o en su próxima visita.
- Freno anti-bucle: no recarga si ya lo hizo hace menos de 30 s (`sessionStorage.swReload`).

### 9.3 Otras optimizaciones de carga (ya implementadas)

- `window.__DATOS`: descarga del JSON de la página **desde el `<head>`**, en paralelo con CSS y fuentes (solo `index.html` y `nacional.html`; el calendario y la predicción no lo hacen).
- Fuentes de Google **no bloqueantes** (`media="print" onload`) + `preconnect`.
- Error de red controlado: mensaje con enlace "Reintentar" en lugar de página en blanco.

### 9.4 Reglas para no romper el caché al desplegar

- **Archivo nuevo en el sitio** (otra página, otro JSON, otro script) → **agregarlo a `PRECACHE`** en `sw.js`.
- **Forzar que todos descarguen todo de nuevo** → cambiar `VERSION` (p. ej. `'v2'`). Cualquier cambio de bytes en `sw.js` también reinstala el SW y refresca la precaché.
- ⚠ Los cambios en **HTML/CSS/JS** llegan **una visita después** (se sirve la copia vieja y la nueva se guarda en segundo plano; solo los `.json` disparan recarga automática).
  Para que un cambio de código se vea de inmediato en todos, subir `VERSION`.
- Probar el SW requiere servir por `http://localhost` o HTTPS (no funciona abriendo el archivo con `file://`).

---

## 10. Reglas de negocio (resumen)

- **Playoffs 14 Grandes:** top 8 de la tabla. Cuartos 1v8, 2v7, 3v6, 4v5; mejor sembrado de local; semis y final con localía del mejor sembrado.
- **Playoffs Nacional:** 1.º y 2.º de cada grupo + 2 mejores terceros (tope de 3 por grupo, que se cumple al elegir comodines solo entre terceros); sembrado 1-8 por PG; mismo bracket.
- **Desempate (todas las tablas):** (1) un equipo que haya vencido directamente a todos los demás empatados queda primero; (2) menor puntos en contra (PC).
  Es una versión simplificada; el reglamento oficial puede diferir (`nota_desempate` lo advierte en Nacional).
- **Ascenso/descenso:** campeón de Nacional sube; último de 14G baja (1 y 1 por año).
- **Liebres CD Juárez:** fuera del modelo; sus partidos futuros se muestran fijos 1-0 en contra.
- **Scrimmages:** informativos; no cuentan para tablas ni para el modelo.

---

## 11. URL params

```
index.html                                   → 14G 2026 (default)
index.html?temporada=2025                    → 14G histórico 2025
nacional.html                                → Nacional 2026
nacional.html?temporada=2025                 → Nacional histórico 2025
calendario_equipo.html?equipo=Nombre&temporada=2026
calendario_equipo.html?equipo=Nombre&temporada=2026&conferencia=nacional
prediccion.html?conf=14g | ?conf=nacional    → predicción independiente (sin enlace desde otras páginas)
```

---

## 12. Limitaciones y problemas conocidos (detectados al documentar)

1. **Juegos aplazados dentro de jornadas ya cerradas (0-0):** quedan bloqueados en la UI, no los predice el modelo y no entran en la tabla/bracket proyectados
   (hoy: Tigres–MTY en 14G J5 y Cimarrones–ITSON en Nacional J5 — justo contendientes). Posible arreglo: tratar como pendiente todo juego 0-0 sin importar su jornada.
2. **Overlay de predicción siempre en 2026**, incluso viendo `?temporada=2025`; y clave de `localStorage` fija en 2026.
3. **Columna "Tu pronóstico" puede desactualizarse** dentro de una misma sesión (el overlay se calcula una sola vez).
4. **Cambios de HTML/CSS/JS llegan una visita tarde** por el Service Worker (solo los JSON recargan solos).
5. **Código duplicado** entre `index.html`, `nacional.html` y `prediccion.html` (render del overlay) y triple implementación de la lógica de tabla/desempate (ver §4).
6. **Bracket en vivo de `nacional.html`** solo llena Cuartos; Semifinal/Final quedan "Por definir". `index.html` no tiene bracket en vivo (solo el proyectado en el overlay).
7. **Secciones ocultas con código activo:** Ranking Colley (`index.html`) y Comparador de equipos (`nacional.html`) están en `display:none` pero se recalculan en cada cambio.
8. **Sembrado Nacional por PG (no por % Vict)**: comparar juegos ganados entre grupos de distinto tamaño puede favorecer a equipos con más juegos. Es consistente entre `nacional.html` y `prediccion.js`; si se cambia, cambiar ambos.
9. `calcularPredicciones` no revisa `res.ok`; un JSON faltante cae al `catch` y muestra el mensaje de error del overlay.
10. **Documentación previa desactualizada** (corregida aquí): decía que los cruces entre grupos no suman a la tabla de Nacional (sí suman); listaba "Arkansas ST QRO" (es "ASUCQ / RED WOLVES"); omitía la clave de Nacional 2025 y el Service Worker.

---

## 13. Guía rápida de tareas comunes

**Cargar resultados de una jornada:** editar el JSON → subir `jornadas_jugadas` → `git push`. (Recarga automática en los dispositivos.)

**Agregar un archivo nuevo al sitio:** crearlo en la raíz → añadirlo a `PRECACHE` en `sw.js` → (opcional) subir `VERSION`.

**Cambiar el comportamiento del modelo:** editar las constantes al inicio de `prediccion.js`. Si se cambia el nombre/forma de lo que devuelve `ONEFA_PRED`, actualizar las 3 copias de render (§4).

**Agregar una temporada nueva:** crear `onefa_data_YYYY.json` y `onefa_nacional_YYYY.json`, ampliar los selectores de temporada y las condiciones `=== 2025 ? 2025 : 2026` de las páginas, definir sus claves de `localStorage`, añadir los JSON a `PRECACHE`, y revisar que los equipos puente se detecten (comparar rosters entre años).

**Probar el modelo sin navegador (Node):**
```js
const fs = require('fs'), P = require('./prediccion.js');
const leer = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const datos = { d14_2025: leer('onefa_data_2025.json'), d14_2026: leer('onefa_data_2026.json'),
                dnac_2025: leer('onefa_nacional_2025.json'), dnac_2026: leer('onefa_nacional_2026.json') };
const r = P.generarPredicciones(datos, 'nacional');   // también '14g'
console.log(r.playoffs.seeds.map(s => `${s.seed}. ${s.equipo}`), r.playoffs.bracket.campeon.equipo);
```

**Servir en local con Service Worker:** `python3 -m http.server 8000` y abrir `http://localhost:8000/`.

---

## 14. Decisiones de diseño ya tomadas

1. Tema claro (fondo gris/blanco) con barra superior verde oscuro ONEFA.
2. Sin menú hamburguesa en móvil.
3. Selector de año con flecha SVG explícita (`appearance:none`).
4. Inputs de marcador con look LED (fondo verde oscuro, texto verde neón).
5. Sin iconos en los encabezados de grupo de Nacional (solo texto: "Grupo Norte", etc.).
6. Columna "PCT" renombrada a "% Vict" con tooltip `<abbr>`.
7. Tabla de partidos: encabezados `.75rem`, nombres de equipo `1.1rem` (escritorio) / `1rem` (móvil), separador VS `.82rem`.
8. **Predicción:** 14G y Nacional se calculan y muestran **por separado** (nunca un ranking conjunto); el único vínculo es el intercambio de prior entre ascendido y descendido; las scrimmages no influyen.
9. **Playoffs proyectados** se deciden por récord (misma regla de desempate que las páginas); el rating solo pone los marcadores futuros.
10. **Carga:** JSON pedido desde el `<head>`, fuentes no bloqueantes y Service Worker *stale-while-revalidate* con recarga automática solo si el usuario no ha interactuado.

---

## 15. Roadmap

Pendientes del proyecto:
- [ ] Actualizar `jornadas_jugadas` conforme avancen las jornadas oficiales.
- [ ] Confirmar nombres exactos de equipos de Centro (especialmente Toros Salvajes / Chapingo).
- [ ] `maximizar_onefa.py` no soporta Nacional (solo 14G).
- [x] Temporada 2025 de Conferencia Nacional (ya existe `onefa_nacional_2025.json`, con liguilla).
- [x] Jornada 8 de Nacional: contiene 6 cruces Bajío–Centro de temporada regular (no son de otra conferencia).

Mejoras sugeridas al documentar (no solicitadas aún):
- [ ] Resolver juegos aplazados 0-0 en jornadas cerradas (UI + modelo, ver §12.1).
- [ ] Hacer que el overlay de predicción respete `?temporada` u ocultar el botón en el histórico.
- [ ] Extraer el render del overlay/bracket a un solo lugar para eliminar la triple copia.
- [ ] Bracket en vivo con resultados reales de Semifinal/Final en `nacional.html` (y uno equivalente en `index.html`).

---

## 16. Git workflow

```bash
git add .
git commit -m "descripción del cambio"
git push
# GitHub Pages se actualiza automáticamente en ~1 min
```
