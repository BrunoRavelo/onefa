# ONEFA Pronósticos — Contexto del Proyecto

## Visión general
Simulador de posiciones para la **Liga Mayor ONEFA** (Organización Nacional Estudiantil de Fútbol Americano), México.
Permite ingresar o simular marcadores y ver la tabla de posiciones en tiempo real, incluyendo ranking Colley (no oficial).

**URL pública:** https://brunoravelo.github.io/onefa/

---

## Stack técnico
- **HTML/CSS/JS puro** — sin frameworks, sin bundler
- **CSS compartido:** `onefa.css` (un solo archivo para los 3 HTML)
- **Tipografía:** Bebas Neue + Barlow Condensed (Google Fonts)
- **Almacenamiento:** `localStorage` (claves separadas por temporada)
- **Deploy:** GitHub Pages (estático, sin servidor)
- **Optimizador offline:** `maximizar_onefa.py` (Python + OR-Tools)

---

## Estructura de archivos

```
📁 repo/
├── index.html                   ← 14 Grandes (conferencia principal)
├── nacional.html                ← Conferencia Nacional (3 grupos)
├── calendario_equipo.html       ← Calendario por equipo (ambas confs)
├── onefa.css                    ← Hoja de estilos compartida (TODOS los HTML usan este)
├── onefa_data_2025.json         ← 14 Grandes histórico 2025 (jornadas_jugadas: 10)
├── onefa_data_2026.json         ← 14 Grandes temporada 2026 (jornadas_jugadas: 0)
├── onefa_nacional_2026.json     ← Conferencia Nacional 2026 (grupos + 76 juegos)
└── maximizar_onefa.py           ← Optimizador CLI (--year, --team)
```

---

## Paleta de colores ONEFA

```css
/* Variables en onefa.css */
--onefa-dark:   #061810   /* navbar fondo (verde casi negro) */
--onefa-green:  #0A6B25   /* verde primario ONEFA */
--onefa-mid:    #128F35   /* verde medio (hover/active) */
--onefa-light:  #16A34A   /* verde claro (acentos, texto activo) */
--onefa-red:    #C41230   /* rojo ONEFA */
--bg:           #F3F4F6   /* fondo página */
--surface:      #FFFFFF   /* fondo cards */
--text:         #111827   /* texto principal */
```

Grupos Conferencia Nacional:
- Norte → azul (#1D4ED8)
- Centro → ámbar (#B45309)
- Bajío → verde (#166534)

---

## Formato de datos JSON

### 14 Grandes (`onefa_data_YYYY.json`)
```json
{
  "temporada": 2026,
  "jornadas_jugadas": 0,
  "equipos": ["Auténticos Tigres", "Borregos CCM", ...],
  "juegos": [
    { "jornada": 1, "local": "Equipo A", "visita": "Equipo B",
      "scoreLocal": 0, "scoreVisita": 0 }
  ]
}
```

### Conferencia Nacional (`onefa_nacional_2026.json`)
```json
{
  "temporada": 2026,
  "conferencia": "Nacional",
  "jornadas_jugadas": -1,
  "nota_desempate": "...",
  "grupos": {
    "Norte":  ["Águilas UACH", "Potros ITSON", "Indios UACJ",
               "Lobos UA de C", "Cimarrones UABC", "Liebres CD Juárez"],
    "Centro": ["Panteras Siglo XXI", "Halcones UV", "Búhos IPN",
               "Frailes UT", "Potros Salvajes", "Toros Salvajes", "Pumas Acatlán"],
    "Bajío":  ["Arkansas ST QRO", "Lobos ULM", "Cardinals UIW",
               "Tecos UAG", "Correcaminos UAT", "Leones UAQ"]
  },
  "juegos": [
    { "jornada": 0, "local": "...", "visita": "...",
      "scoreLocal": 0, "scoreVisita": 0 }
  ]
}
```

---

## localStorage keys

| Temporada         | Clave                      |
|-------------------|---------------------------|
| 14G 2025          | `onefa_juegos_v1`          |
| 14G 2026          | `onefa_juegos_2026_v1`     |
| Nacional 2026     | `onefa_nacional_2026_v1`   |

Regla de merge: localStorage solo sobreescribe juegos con `scoreLocal + scoreVisita === 0` en el JSON base. Los resultados oficiales en el JSON no se modifican.

---

## Comportamiento clave del frontend

### Accordion (calendario)
- Usa `data-target="jbN"` en el botón, con `id="jbN"` en el body
- **UN solo event listener** en `document` (no duplicar en `generarCalendario`)
- Jornadas ≤ `jornadas_jugadas` → inputs `readonly` + checkmark ✓ en label
- **Nacional arranca con `jornadas_jugadas: -1`** para que Jornada 0 (partido único Panteras vs Halcones, pre-temporada) no quede bloqueada. Cuando se juegue J0 se actualiza a `0`; cuando se juegue J1 a `1`, etc. La condición `j <= JORNADAS_JUGADAS` funciona sin casos especiales.

### Tabla de posiciones
- Columna "% Vict" = victorias / jugados (antes llamada PCT)
- `<abbr title="...">` para tooltip explicativo
- Desempate: resultado directo entre equipos empatados → menor PC
- Fila 1 = fondo verde claro + borde izquierdo verde
- Filas 2–8 = borde izquierdo verde medio (zona playoffs)
- Línea punteada en cutoff posición 8

### Ranking Colley
- Método matricial estándar (Colley 2001)
- Solo informativo, no oficial

### Conferencia Nacional — tablas por grupo
- Solo cuentan juegos **intra-grupo** (mismo grupo en `teamGroup`)
- Juegos cruzados (Norte vs Bajío, etc.) aparecen en calendario con badge `✕` pero **no** suman a la tabla

### URL params
```
index.html?temporada=2025             → histórico 2025
index.html?temporada=2026             → default (2026)
nacional.html                         → Nacional 2026
calendario_equipo.html?equipo=Nombre&temporada=2026
calendario_equipo.html?equipo=Nombre&temporada=2026&conferencia=nacional
```

---

## Responsive (breakpoints en onefa.css)
- `>540px` Desktop: navbar completa con marca "ONEFA Pronósticos"
- `≤540px` Móvil: `.brand` oculto, tabs compactos, inputs score más pequeños
- `≤380px` Extra pequeño: navbar mínima

---

## Equipos 14 Grandes 2026 (14 equipos)
Auténticos Tigres, Borregos CCM, Borregos GDL, Linces UVM, Leones UAC,
Leones UAMN, Zorros CETYS, Águilas Blancas, Borregos MTY, Borregos PUE,
Burros Blancos, Borregos CEM, Pumas CU, Aztecas UDLAP

> Nota: Leones UAC reemplaza a Pumas Acatlán en 14G 2026 (Pumas Acatlán pasa a Conf. Nacional Centro)

---

## Optimizador Python
```bash
python maximizar_onefa.py --year 2026
python maximizar_onefa.py --year 2025
python maximizar_onefa.py --year 2026 --team "Leones UAMN"
```
Lee `onefa_data_{year}.json`. Usa OR-Tools CP-SAT. Equipo objetivo default: **Leones UAMN**.

---

## Decisiones de diseño ya tomadas
1. Tema claro (fondo blanco/gris), navbar verde oscuro ONEFA
2. Sin hamburguesa en móvil — elemento inútil eliminado
3. Selector de año con flecha SVG explícita (appearance:none en select)
4. Score inputs mantienen look LED (fondo verde oscuro, texto verde neón)
5. Sin iconos en headers de grupos Nacional (solo texto: "Grupo Norte", etc.)
6. La columna PCT renombrada a "% Vict" con tooltip `<abbr>`
7. Tabla de partidos: headers `.75rem`, nombres de equipo `1.1rem` (desktop) / `1rem` (móvil), separador VS `.82rem`

---

## Tareas pendientes / roadmap
- [ ] Actualizar `jornadas_jugadas` conforme avancen jornadas oficiales
- [ ] Confirmar nombres exactos de equipos Centro (especialmente Toros Salvajes / Chapingo)
- [ ] Completar jornada 8 de Nacional (aparecen equipos de otras conferencias — posible playoff cruzado)
- [ ] Agregar temporada 2025 a Conferencia Nacional si se consigue el histórico
- [ ] `maximizar_onefa.py` no soporta Nacional aún (solo 14G)

---

## Git workflow
```bash
git add .
git commit -m "descripción del cambio"
git push
# GitHub Pages se actualiza automáticamente en ~1 min
```

## Nota sobre `simulador_onefa_colley.html`
Archivo legacy — fue el nombre original de `index.html`. Redirige o puede eliminarse.
