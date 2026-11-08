# Despliegue (AWS y alternativas) y monetización de la página

> Análisis · 2026-11-02 · Solo documentación: no se cambió código por este documento.
> **Cómo leer las cifras:** las marcadas **[fuente]** las leí en esta sesión en la página citada (sección 6). Las marcadas **[medido]** salen de tus archivos reales. Las marcadas **[estimación]** son supuestos míos para razonar, **no** datos verificados; confírmalas antes de decidir.

---

## 1. La idea que lo cambia todo: el motor corre en el teléfono de cada visitante

Los escenarios, el panorama y las marcas ✅/✖️ se calculan en un Web Worker **dentro del navegador de quien visita**. Tu servidor nunca ejecuta el motor de playoffs. Por eso:

- **No se paga cada vez que alguien corre el motor.** Costo por cálculo en tu infraestructura: cero. El «gasto» lo asume el teléfono del visitante (batería y entre 1 y 20 segundos).
- Lo que sí se paga (o se consume de un cupo gratis) es **entregar archivos estáticos**: bytes transferidos y número de peticiones HTTP.
- Tampoco necesitas servidor, base de datos ni cuentas. Es un sitio estático: HTML + JS + JSON.

**Cuánto pesa tu sitio [medido, comprimido con gzip]:** `nacional.html` 13 KB, `index.html` 8.5 KB, `prediccion.js` 10.7 KB, `escenarios.js` 15 KB, `escenarios-nacional.js` 14.4 KB, `escenarios-ui.js` 12 KB, `estado-equipos.js` 3.5 KB, los 4 JSON de datos ≈ 5 KB en total. Una primera visita a `nacional.html` descarga ≈ **42 KB** y, si se abre el módulo de escenarios, ≈ **76 KB** (sin contar `onefa.css` ni las fuentes de Google, que no están en tu servidor). Con la precarga del Service Worker, un visitante nuevo baja en total del orden de **0.1–0.2 MB [estimación]**; los que regresan casi no descargan (revalidaciones de unos pocos bytes).

---

## 2. Qué cobra Amazon (y qué no)

**CloudFront (la red de distribución de Amazon) [fuente: página de precios de AWS, actualizada 2026-11-05]:**

| Concepto | Condición |
|---|---|
| Transferencia de salida a internet | **Primer 1 TB al mes gratis** (siempre, no solo el primer año); después, para Estados Unidos, México y Canadá: **$0.085 por GB** (hasta 10 TB más) |
| Peticiones HTTP/HTTPS | **Primeras 10 millones al mes gratis**; después, HTTPS **$0.01 por cada 10,000** (Estados Unidos, México y Canadá) |
| Datos entre S3/EC2 y CloudFront | Gratis |
| Certificado SSL | Gratis |
| Invalidaciones de caché | Primeras 1,000 rutas al mes gratis; luego $0.005 por ruta |
| Lambda@Edge | Sin capa gratuita (no se necesita para tu sitio) |
| Ejemplo oficial de AWS (sitio estático, 100 GB y 1 M de peticiones) | **$0** de transferencia y peticiones |

AWS menciona además un esquema de **precio fijo («flat-rate pricing»)** para CloudFront; no leí sus condiciones, así que no lo recomiendo ni descarto.

**Cuentas nuevas [fuente: anuncio de AWS del 16 de julio de 2025]:** el plan gratuito da hasta **$200 en créditos** ($100 al registrarse y $100 más por usar servicios como EC2) y **expira a los 6 meses o cuando se agotan los créditos**; además hay más de 30 servicios con capa «siempre gratis». Ojo: ya no es el esquema antiguo de «12 meses gratis de EC2».

**Lo que NO está en esa lista y también cuesta (orden de magnitud [estimación], verifica en la calculadora de AWS):** almacenamiento en S3 (tus archivos pesan menos de 1 MB: centavos), una zona DNS en Route 53 (≈ $0.50 al mes) y el dominio (≈ $10–15 al año).

### ¿Cuánto costaría con más visitas? [estimación con los datos de arriba]

Supuestos: visitante nuevo ≈ 0.2 MB y ≈ 25 peticiones; cada vista de página de un visitante que regresa ≈ 12 peticiones condicionales.

| Escala | Transferencia | Peticiones | CloudFront al mes |
|---|---|---|---|
| 10,000 visitas | ≈ 2 GB | ≈ 0.2 M | **$0** |
| 100,000 visitas | ≈ 20 GB | ≈ 2–4 M | **$0** |
| 1,000,000 visitas | ≈ 200 GB (dentro del 1 TB gratis) | ≈ 20–40 M | **≈ $10–$30** (solo por peticiones) |

Conclusión: **a mediana escala el costo de hosting es prácticamente cero o de pocas decenas de dólares al mes**, y el factor que primero se cobra son las *peticiones*, no los GB.

### ¿Qué sí se volvería caro?

1. Agregar un **backend por petición** (funciones, API, base de datos) que calcule algo en el servidor.
2. **Cuentas de usuario / suscripciones** (las descartaste; implicarían base de datos y seguridad).
3. Imágenes o video pesados (por ejemplo, tarjetas para compartir generadas en servidor).
4. Pasar de **1 TB al mes** (equivale a unos 5 millones de visitantes nuevos).
5. Un **ataque o bot** que pida tus archivos en masa (mitigación: alarma de presupuesto y límites).
6. Servicios opcionales: WAF, registros en tiempo real ($0.01 por millón de líneas), Lambda@Edge.

---

## 3. Opciones de despliegue

| # | Opción | Qué es | Costo típico | Mantenimiento | Veredicto |
|---|---|---|---|---|---|
| 1 | **S3 + CloudFront** | Los archivos en un «bucket» privado y CloudFront delante | **$0–2 al mes** (+ dominio) mientras uses el cupo gratuito | Casi nulo | **La mejor opción dentro de AWS** |
| 2 | AWS Amplify Hosting | Hosting estático con despliegue automático desde GitHub | No verifiqué su tarifa (se cobra por minutos de compilación y GB) | Bajo | Cómodo; revisa precios antes |
| 3 | **EC2** (servidor virtual) | Una máquina encendida 24/7 con nginx | Se paga **por hora encendida aunque nadie visite**; la instancia más pequeña cuesta algunos dólares al mes [estimación] | **Alto**: sistema operativo, parches, certificado, copias | **No la necesitas.** Solo tendría sentido con un backend |
| 4 | Lightsail | Servidor virtual de precio fijo mensual | No verifiqué tarifas | Medio | Solo si añades backend |
| 5 | Cloudflare Pages | Hosting estático gratuito con CDN | Gratis para sitios estáticos (según las comparativas que leí) | Casi nulo | **Alternativa muy buena y sin factura sorpresa**; verifica sus límites vigentes |
| 6 | GitHub Pages (lo que usas hoy) | Hosting gratuito desde el repositorio | Gratis | Nulo | Funciona, pero sus condiciones de uso restringen sitios comerciales; **con anuncios conviene verificar sus términos** |
| 7 | Netlify / Vercel | Hosting estático con planes gratuitos | Gratis con límites | Bajo | Los planes gratuitos de Vercel suelen restringir uso comercial; **verifica los términos** |

**Recomendación:** mientras no haya anuncios, tu GitHub Pages actual sirve. Al monetizar, pasar a **Cloudflare Pages** o a **S3 + CloudFront** y poner **alarma de presupuesto** en la cuenta de AWS. EC2 solo si algún día agregas un backend.

### Cómo desplegar en S3 + CloudFront (resumen)

1. Bucket de S3 **privado** con los archivos de la raíz del proyecto.
2. Distribución de CloudFront con acceso al bucket por «Origin Access Control» y **compresión activada** (gzip/brotli).
3. Certificado gratuito (ACM) y tu dominio en Route 53 (o en tu registrador).
4. Políticas de caché: `*.json` con vida corta (por ejemplo 60 segundos, con revalidación) para que los resultados nuevos se vean pronto; `*.js` y `*.css` con vida más larga; **no** cachear `sw.js` más de unos minutos.
5. Actualizar datos = subir el JSON a S3 (con vida corta no hace falta invalidar).
6. **AWS Budgets:** alarma a $5 y a $20 al mes.

---

## 4. Qué conviene cambiar en la página para que siga siendo barata

Ya está bien encaminada: es estática, comprime y usa Service Worker. Mejoras concretas:

1. **Reducir peticiones por vista.** El Service Worker (`stale-while-revalidate`) pregunta al servidor por cada archivo en cada vista (respuestas 304). Es barato en bytes pero cuenta como petición. Opción: darle a los `.js`/`.css` una vida de caché de CDN de unas horas, o nombres con versión (`prediccion.js?v=…`), y dejar la revalidación inmediata solo para los `.json`.
2. **Cargar los motores solo cuando hacen falta.** Hoy `estado-equipos.js` baja el Worker y los motores al abrir la página para calcular las marcas (una vez por cada cambio de resultados, luego se guarda en `localStorage`). Es correcto; si algún día preocupa el consumo en datos móviles, se puede pedir confirmación o retrasar el cálculo.
3. **Mantener las fuentes de Google fuera de tu cuenta** (ya lo están: no cuentan en tu transferencia).
4. **Evitar rutas dinámicas** que obliguen a un servidor (por ejemplo `?conferencia=` se resuelve en el navegador; sigue así).
5. **Alarma de presupuesto** (sección 3, paso 6) y revisar el panel de uso una vez al mes.
6. **No registrar de más:** no habilites registros en tiempo real de CloudFront salvo para investigar un problema.

---

## 5. Monetización

### 5.1 Realidad de partida

- Es un **nicho** (futbol americano universitario de México) y **estacional**: temporada regular de agosto a noviembre con picos en fines de semana de juego y liguilla.
- La mayor parte del tráfico será de México, un país que los anunciantes pagan menos que Estados Unidos. Por eso no uses cifras de blogs estadounidenses como expectativa.
- Ingreso = **vistas de página × RPM ÷ 1,000**, donde RPM es lo que ganas por cada mil vistas de página. No tengo una cifra verificada de RPM para México; para razonar uso un rango **[estimación]** de $0.5 a $3:

| Vistas de página al mes | RPM $0.5 | RPM $1.5 | RPM $3 |
|---|---|---|---|
| 50,000 | $25 | $75 | $150 |
| 200,000 | $100 | $300 | $600 |
| 1,000,000 | $500 | $1,500 | $3,000 |

Con tráfico estacional, los meses sin juegos valen casi cero. **La publicidad automática por sí sola, en este nicho, difícilmente será un negocio; los patrocinios directos suelen pagar más por visita.**

### 5.2 ¿Los anuncios pagan por mostrarse o por clic?

- **[fuente: Publisher Collective, octubre de 2025]** Google AdSense cambió su modelo de pago de clic (CPC) a **impresiones (CPM) en marzo de 2024**, con una participación de ingresos para el editor de aproximadamente **68 %**. Es decir, hoy se gana principalmente por **mostrar** el anuncio (y cuenta que se vea: «visibilidad»), no por el clic. Es una fuente comercial que cita a Google: confírmalo en tu cuenta de AdSense.
- Los anunciantes siguen pagando por clic o por acción en otros canales (afiliados, patrocinios con enlace).
- Más impresiones **vistas** = más ingreso; pero llenar la pantalla de anuncios baja la calidad y puede hacer que Google limite la cuenta.

### 5.3 Métricas que importan

| Métrica | Qué es | Para qué sirve |
|---|---|---|
| Sesiones y usuarios | Visitas y personas distintas | Tamaño de la audiencia |
| Vistas por sesión | Páginas que ve cada visita | Más vistas = más anuncios mostrados |
| RPM de página y RPM por sesión | Ingreso por mil vistas / por visita | La métrica central |
| Visibilidad (viewability) | % de anuncios que realmente se ven | Define cuánto paga cada impresión |
| País y dispositivo | Dónde y con qué entran | México y móvil bajan el RPM |
| Tasa de retorno | % que vuelve | Valor para patrocinadores |
| Picos por jornada | Tráfico en días de juego | Para vender patrocinios por jornada |
| Core Web Vitals (LCP, CLS, INP) | Velocidad y estabilidad de la página | Los anuncios mal puestos empeoran CLS y el posicionamiento |

### 5.4 Redes de anuncios: requisitos

| Opción | Qué pide | Realismo para ti |
|---|---|---|
| **Google AdSense** | Contenido propio, política de privacidad, navegación clara, cumplir las políticas del programa. No encontré en esta sesión un mínimo oficial de visitas; la aprobación es manual [verifica] | **La puerta de entrada realista** |
| Mediavine (red principal) | **[fuente: guía de 2026 que cita a Mediavine]** unos **$5,000 al año** en ingresos publicitarios; prioriza tráfico de Estados Unidos, Reino Unido, Canadá y Australia | No realista con tráfico de México |
| **Journey by Mediavine** | **[misma fuente]** desde **1,000 sesiones al mes**, 70 % de participación, pasa a la red principal al llegar a $5,000 en 12 meses | Posible, pero sigue pesando el tráfico de países «Tier 1» |
| Raptive, Ezoic, Media.net, Carbon Ads, etc. | Umbrales de tráfico propios y cambiantes (vi reportes de que Ezoic subió su umbral; no los verifiqué) | Revisar cuando el tráfico crezca |
| Pujas de encabezado (header bidding) | **[fuente: Publisher Collective]** suelen requerir de **500,000 a 2 millones** de vistas al mes | Muy lejos de la escala actual |

### 5.5 Reglas de Google que afectan **a tu página en particular** [fuente: política «Google-served ads on screens without publisher-content»]

Google **no permite** anuncios en pantallas:
- sin contenido del editor o con contenido de poco valor,
- «en construcción»,
- usadas para **alertas, navegación u otros fines de comportamiento**,

y tampoco en pantallas de «callejón sin salida» (gracias, salida, error), ni sobre **contenido generado automáticamente sin revisión o curaduría manual**.

Consecuencias:

1. **No pongas anuncios de Google en la pantalla de «calculando…»** del módulo de escenarios (es una pantalla de espera sin contenido). Mostrar anuncios mientras se calculan los playoffs es justo lo que más se parece a la infracción.
2. **Tampoco dentro del panel de resultados de escenarios**: es contenido generado automáticamente por el motor. El riesgo es que Google limite o cierre la cuenta, y eso sí perjudica todo el sitio.
3. Los anuncios van en las **páginas con contenido curado**: tablas, calendario, posiciones.
4. Lejos de los **campos de marcadores** y botones (evita clics accidentales; es una regla general de colocación que conviene verificar al abrir la cuenta).
5. Si quieres algo visible durante el cálculo, usa un **patrocinador propio** (imagen y enlace tuyos, no servido por Google) o un mensaje de tu marca.

### 5.6 Dónde poner los anuncios (menos molestia, más ingreso)

**Teléfono:**

| Ubicación | Ingreso | Molestia | Comentario |
|---|---|---|---|
| Bloque en medio del calendario (por ejemplo cada 3 jornadas) | Medio-alto | Baja si el hueco tiene altura fija | **Mi primera opción** |
| Banner fijo al fondo de la pantalla (anchor) | Alto | Media: tapa contenido y puede dar clics accidentales | Con botón de cerrar y margen seguro |
| Debajo de la tabla de posiciones | Medio | Baja | Buena opción complementaria |
| Arriba de todo, antes de la tabla | Alto | **Alta**: empuja el contenido | Evitar |
| Pantalla completa entre páginas (interstitial) | Alto | **Muy alta** | Evitar |
| En la pantalla de «calculando…» o en los resultados de escenarios | — | — | **No** (sección 5.5) |

**Computadora:** columna lateral derecha fija (300×250 o 300×600) junto al calendario; un bloque horizontal bajo el encabezado; otro entre tablas. Máximo **tres** anuncios por página.

**Buenas prácticas técnicas:** reservar una altura fija para cada hueco (evita el salto de diseño y protege el CLS), cargar los de abajo de forma diferida, no precargar scripts de anuncios en el Service Worker y no cargarlos en el módulo de escenarios.

### 5.7 Alternativas a los anuncios (sin cuentas ni suscripciones)

| Opción | Cómo funciona | Potencial | Esfuerzo |
|---|---|---|---|
| **Patrocinio directo** | Marca o negocio (tienda deportiva, nutrición, universidad, bar de partidos) paga una cuota fija por un bloque «Presentado por…» con enlace, o por patrocinar una jornada | **El más alto para un nicho**; funciona con poco tráfico si muestras estadísticas y picos por jornada | Medio (vender y armar un *media kit*) |
| **Afiliados** | Enlaces a jerseys, equipo deportivo, boletos o transmisiones; ganas comisión por compra (por ejemplo programas de afiliados de grandes tiendas en línea de México) | Bajo-medio | Bajo |
| **Apuestas deportivas (afiliados)** | Pagan bien, pero hay regulación en México, restricciones de las redes de anuncios y riesgo reputacional; **no lo recomiendo sin revisar la ley y las políticas** | Alto, con riesgo | Alto |
| **Donaciones** | Un enlace tipo «invítame un café» (Ko-fi, Buy Me a Coffee o una liga de pago local); sin cuentas en tu sitio | Bajo, pero casi sin costo | Muy bajo |
| **Licencia del motor / widgets** | Vender o licenciar a la liga, medios, canales de YouTube o podcasts un widget de «qué necesita tu equipo» con su marca | Potencialmente el mayor ingreso por acuerdo | Alto |
| **Tarjetas para compartir** | Imagen del escenario («Mis Borregos necesitan esto») con tu dirección y, si hay, el logo de un patrocinador | Crece el tráfico y da valor al patrocinador | Medio |
| **Canal de WhatsApp/Telegram o boletín gratis** | Resumen semanal «combinaciones de la jornada», con patrocinador | Medio | Medio |
| **Contenido en redes** | Clips cortos de «qué necesita tu equipo» que llevan tráfico al sitio | Indirecto | Medio |
| Premium / pago por uso | Descartado: implica cuentas o cobros | — | — |

### 5.8 Ruta recomendada

1. **Base (sin costo):** página de privacidad y de contacto, estadísticas de uso (con aviso de privacidad), sitemap y etiquetas para compartir en redes. Medir 1–2 temporadas de tráfico real.
2. **Ingreso sin depender de una red:** enlace de donaciones + **un espacio de patrocinador directo** (bloque fijo) + afiliados discretos.
3. **AdSense en páginas curadas**, con 1–2 bloques en el teléfono y 2–3 en computadora, alturas fijas, sin anuncios en el módulo de escenarios. Medir RPM y CLS antes de agregar más.
4. Si las sesiones crecen y hay tráfico significativo de fuera de México, evaluar Journey/Raptive/Ezoic.
5. Probar el camino **B2B** (widget o licencia) con la liga o medios deportivos: puede valer más que todos los anuncios juntos.

---

## 6. Fuentes consultadas

- Precios de CloudFront (pago por uso), AWS, actualizada 2026-11-05: https://aws.amazon.com/cloudfront/pricing/pay-as-you-go
- Plan gratuito de AWS con $200 en créditos (16 de julio de 2025): https://aws.amazon.com/about-aws/whats-new/2025/07/aws-free-tier-credits-month-free-plan/
- Política de Google «anuncios en pantallas sin contenido del editor»: https://support.google.com/publisherpolicies/answer/11112688
- «CPM vs CPC: la nueva estructura de pago de AdSense», Publisher Collective (2025): https://www.publisher-collective.com/blog/cpm-vs-cpc
- Requisitos de Mediavine en 2026 (guía de terceros que cita a Mediavine): https://www.jupiter.co/blog/mediavine-requirements-2026-how-to-qualify
- Pesos de archivos: medidos con los archivos del proyecto el 2026-11-02.

Lo que **no** verifiqué y debes confirmar antes de decidir: tarifas de EC2, Lightsail, Amplify, S3 y Route 53; condiciones de uso de GitHub Pages, Vercel, Netlify y Cloudflare Pages; mínimo de tráfico y umbral de pago de AdSense; RPM real de México; regulación de afiliados de apuestas.
