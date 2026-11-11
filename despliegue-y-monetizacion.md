# Despliegue, costos y monetización de la página

> Versión 2 · 2026-11-02. Solo documentación: no se cambió código por este documento.
> **Cómo leer las cifras:** **[AWS]** = la leí en una página oficial de AWS en esta sesión. **[fuente]** = la leí en la página citada (sección 9; muchas son guías de terceros, no oficiales). **[medido]** = sale de tus archivos reales. **[estimación]** = supuesto mío para razonar; **no** es un dato verificado. **[conflicto]** = las fuentes se contradicen y debes confirmarlo en la página oficial.

---

## 0. Resumen y recomendación (corregida)

1. **El motor corre en el teléfono del visitante.** Tu servidor nunca calcula playoffs, así que **no pagas por cada vez que alguien corre el motor**. Lo único que se factura es entregar archivos estáticos (bytes y peticiones).
2. **Mejor opción para este proyecto: Cloudflare Pages** (sitio estático, ancho de banda sin factura, uso comercial permitido según las guías consultadas). **Segunda: S3 + CloudFront** si prefieres quedarte en AWS. **EC2 no la necesitas.**
3. **Por qué antes no puse Cloudflare como la mejor:** en la versión 1 solo había verificado precios de AWS (que fue lo que preguntaste) y no los términos de Cloudflare, así que lo dejé como «alternativa, verifica». Con las fuentes de esta versión, Cloudflare Pages gana para tu caso: costo cero a cualquier escala, sin riesgo de factura sorpresa y sin restricción comercial conocida. El único motivo para preferir AWS es tener todo en una sola cuenta o planear un backend.
4. **Costo vs ingreso:** el hosting cuesta $0–$70 al mes incluso con millones de visitas; el ingreso por anuncios depende de la audiencia, no del costo. **El cuello de botella no es la factura, es el tráfico** (sección 7).

---

## 1. Qué consume tu página (y una persona promedio)

- **Tu sitio [medido, gzip]:** una primera visita a `nacional.html` baja ≈ **42 KB**; con el módulo de escenarios ≈ **76 KB** (sin `onefa.css` ni fuentes de Google, que no salen de tu servidor). Con la precarga del Service Worker, un visitante nuevo baja del orden de **0.1–0.2 MB [estimación]**. Quien regresa descarga casi nada.
- **La página web promedio [fuente: HTTP Archive 2025, vía SQ Magazine]:** una página de inicio móvil pesa **2,362 KB** (mediana), 8.4 % más que el año anterior, con 632 KB solo de JavaScript. Tu sitio es del orden de **30 a 55 veces más ligero** que la mediana.
- **Anuncios:** los scripts y creatividades de los anuncios los sirve la red de anuncios, no tu servidor: **no aumentan tu factura**, pero sí el peso y el tiempo de carga que sufre el visitante (y por eso afectan Core Web Vitals; solo el 48 % de los sitios móviles pasa [fuente: CrUX 2025]).
- **Visitas por sesión y duración:** no encontré cifras verificadas para un sitio deportivo mexicano. En las proyecciones uso **1.5 a 3 páginas por visita [estimación]**; con tus estadísticas reales conviene reemplazarlas.

---

## 2. Qué cobra Amazon

**CloudFront [AWS, página de precios actualizada 2026-11-05]:**

| Concepto | Condición |
|---|---|
| Transferencia a internet | **Primer 1 TB al mes gratis (siempre)**; después, para Estados Unidos, México y Canadá, **$0.085 por GB** |
| Peticiones HTTP/HTTPS | **Primeras 10 millones al mes gratis**; después HTTPS **$0.01 por cada 10,000** |
| Origen (S3/EC2) → CloudFront | Gratis |
| Certificado SSL | Gratis |
| Invalidaciones | 1,000 rutas al mes gratis |
| Lambda@Edge | Sin capa gratuita (no la necesitas) |

**[conflicto]** Algunas comparativas de 2026 listan para las cuentas nuevas con «plan gratuito» solo **100 GB y 1 millón de peticiones** al mes en CloudFront. La página oficial dice 1 TB y 10 millones como «siempre gratis». **Confírmalo en tu cuenta (Billing → Free Tier)** antes de depender de ese cupo.

**Otras partidas de AWS que sí aparecen en la factura:**

| Partida | Dato |
|---|---|
| **IP pública IPv4** [AWS, anuncio de 2023/2024] | **$0.005 por IP por hora** (≈ $3.65 al mes) desde febrero de 2024, también en EC2. Antes se regalaba con la instancia |
| **Transferencia de salida de EC2/S3/otros servicios** [AWS, página de precios de EC2] | **100 GB al mes gratis, sumando todos los servicios y regiones**; CloudFront tiene su propio 1 TB aparte |
| S3 (almacenamiento) y Route 53 (zona DNS) | No leí sus tarifas en esta sesión. Para ~1 MB de archivos es del orden de centavos; una zona DNS ≈ $0.50 al mes [estimación] |

---

## 3. EC2: qué es «gratis» hoy

**[AWS, anuncio del 16 de julio de 2025]** AWS cambió el programa gratuito:

- **Cuentas creadas a partir del 15 de julio de 2025:** ya no hay «12 meses de EC2 gratis». Reciben hasta **$200 en créditos** ($100 al registrarse y $100 más por usar servicios como EC2) y un **plan gratuito que termina a los 6 meses o cuando se agotan los créditos**. Al terminar hay que pasar al plan de pago o la cuenta se cierra. Los créditos cubren EC2 de tipos pequeños, pero no existe un «EC2 gratis para siempre».
- **Cuentas creadas antes del 15 de julio de 2025:** conservan el esquema anterior de 12 meses (750 horas al mes de una instancia pequeña y 750 horas de IPv4) hasta que se les acabe el año. **[fuente: guías de 2026; confirma la fecha de tu cuenta]**
- Siguen existiendo más de 30 servicios con capa «siempre gratis» (por ejemplo Lambda y DynamoDB, además de CloudFront en sus límites).

**Costo de una EC2 después de los créditos [estimación, verifica en la calculadora de AWS]:** una instancia pequeña (por ejemplo la clase t3.micro) ronda de **$7 a $10 al mes** encendida las 24 horas, **más** $3.65 de IPv4 **más** el disco (EBS). Se cobra aunque nadie visite.

### ¿Puedo tener una EC2 para otros proyectos y a la vez mi S3 + CloudFront con la página, sin costos adicionales?

**Sí se puede en la misma cuenta, y la EC2 no encarece la página, pero la EC2 sí cuesta por sí misma.** Los detalles:

| Tema | Qué pasa |
|---|---|
| ¿La EC2 sube el costo de S3/CloudFront? | **No.** Cada servicio se factura por su propio uso. El tráfico de la página no depende de tu EC2 |
| ¿La EC2 es gratis? | Solo mientras duren los créditos / el año de la cuenta antigua. Después se paga por hora (+ IPv4 + disco) |
| Créditos compartidos | Los créditos de una cuenta nueva son **de toda la cuenta**: una EC2 los gasta más rápido y puede acortar el plan gratuito de 6 meses. Para mantener la página después hay que pasar al plan de pago |
| Los 100 GB gratis de salida | Se **reparten** entre EC2, S3 y demás servicios (CloudFront tiene su 1 TB aparte) |
| Riesgo de una sola cuenta | Una EC2 mal configurada o vulnerada (minería, ataques) puede generar una factura grande **en la misma cuenta que tu página** |
| Cómo aislarlo | **AWS Organizations** (sin costo) permite una cuenta para la página y otra para experimentos; así las facturas, los créditos y los permisos no se mezclan. Si no, usa etiquetas por proyecto, alarmas de presupuesto y permisos mínimos |

**Alternativas para «proyectos personales» sin pagar EC2:** una máquina virtual gratuita de Oracle Cloud o la `e2-micro` de Google Cloud (sección 4), o simplemente detener las instancias cuando no se usen.

---

## 4. Capas gratuitas de otros proveedores y si permiten monetizar

**[fuente]** Guías de 2026 (freetier.co, agentdeals.dev, flaviocopes.com, dev.to y otras); los términos pueden cambiar: **confirma en la página oficial antes de decidir**.

| Proveedor | Qué da gratis | Límite relevante | ¿Permite anuncios / uso comercial? |
|---|---|---|---|
| **Cloudflare Pages** | Hosting estático; ancho de banda **ilimitado** | 500 compilaciones al mes, 20,000 archivos, 25 MiB por archivo, ~100 dominios propios | **Sí** según las guías consultadas |
| **AWS (CloudFront + S3)** | Ver sección 2 | Cupo gratis de CloudFront; luego por uso | Sí (no encontré restricción; revisa la política de uso aceptable) |
| **Google Cloud** | Crédito de $300 por 90 días; VM `e2-micro` «siempre gratis» | Solo regiones de Estados Unidos, 30 GB de disco y **~1 GB de salida al mes**: no sirve para servir una página | Sí (sin restricción reportada) |
| **Firebase Hosting** (Google) | Plan gratuito con dominio y SSL | ~10 GB de almacenamiento y ~360 MB de transferencia **por día** (≈ 10.8 GB al mes); tope duro | Sí (sin restricción reportada) |
| **Microsoft Azure** | 12 meses de una VM B1s (750 h) y $200 por 30 días | Después se paga | Sí (sin restricción reportada) |
| **Oracle Cloud** | VM «siempre gratis» (Ampere ARM) y 10 TB de salida al mes | La mayoría de guías dice 4 vCPU/24 GB; **[conflicto]** una fuente reporta que desde junio de 2026 se redujo a 2 vCPU/12 GB. Pueden recuperar instancias ociosas | Sin restricción reportada; confirma sus términos |
| **Netlify** | Plan gratuito por créditos (~300 al mes, aprox. 30 GB de ancho de banda) | Al agotar los créditos el sitio se **pausa** (no cobra extra) | **[conflicto]** casi todas las fuentes dicen que sí; una dice que el plan Hobby es no comercial |
| **Vercel (Hobby)** | Hosting estático con CDN | Plan de uso personal | **No**: es no comercial y los anuncios o enlaces de afiliado cuentan como comercial |
| **GitHub Pages** | Hosting gratis desde el repositorio | ~1 GB de sitio y ~100 GB al mes (límites «blandos») | **[conflicto]** los términos prohíben usarlo como negocio o comercio electrónico; las fuentes se contradicen sobre los anuncios. **Con anuncios, evítalo** |
| **Render (sitios estáticos)** | Hosting estático gratis | ~100 GB de ancho de banda | Sí según las guías |

---

## 5. Alternativas de despliegue, ordenadas para tu caso

| # | Opción | Costo al mes | Riesgo de factura sorpresa | Mantenimiento | Comentario |
|---|---|---|---|---|---|
| **1** | **Cloudflare Pages** | **$0** (más dominio) | **Casi nulo**: no cobra por ancho de banda estático | Mínimo | **La mejor para este proyecto.** Despliegue desde el repositorio o subiendo la carpeta |
| 2 | S3 + CloudFront | $0 hasta ~500,000 visitas; ≈ $6 con 1 M; ≈ $70 con 5 M (sin optimizar) | Bajo si pones alarma de presupuesto | Bajo | La mejor dentro de AWS; conviene si quieres todo en tu cuenta o agregar servicios después |
| 3 | Netlify (plan gratuito) | $0 con límite de créditos | Nulo (se pausa) | Bajo | Si se pausa en un partido importante, la página cae: riesgo de disponibilidad |
| 4 | Firebase Hosting | $0 con tope de ≈ 10 GB al mes | Bajo (tope duro) | Bajo | Se queda corto si crece el tráfico |
| 5 | EC2 / VM propia (AWS, Oracle, Google) | $0 solo mientras duren créditos o la capa gratuita; luego ≈ $10–15 | Medio | **Alto** (sistema operativo, parches, certificado, copias) | Innecesaria para un sitio estático |
| ✘ | Vercel Hobby, GitHub Pages | $0 | — | — | **No** para una página con anuncios (términos) |

**Recomendación:** pasar de GitHub Pages a **Cloudflare Pages** antes de poner anuncios. Si prefieres AWS, S3 + CloudFront con alarma de presupuesto.

---

## 6. Cómo bajar el costo a fondo

Con tus archivos [medidos], el sitio ya es muy ligero. Estas son las palancas, de mayor a menor efecto. «Ahorro» está en términos de lo que mide cada proveedor: **bytes** (CloudFront, tras el 1 TB gratis) y **peticiones** (CloudFront, tras 10 millones gratis; en tu caso es lo que primero se factura).

### 6.1 Elegir un anfitrión que no cobre por ancho de banda
Cloudflare Pages: el costo de entrega es **$0 a cualquier escala** (con las limitaciones de la sección 4). Es el mayor ahorro posible y no requiere tocar el código.

### 6.2 Reducir peticiones por visita (la palanca más importante en AWS)
Hoy cada vista de página dispara unas **12 peticiones de revalidación** (el Service Worker pregunta por cada archivo) y una visita nueva descarga ≈ 25 archivos. Con la estimación de 30 % de visitantes nuevos, son ≈ **16 peticiones por visita**.

| Cambio | Efecto | Esfuerzo |
|---|---|---|
| **Juntar los scripts en uno o dos archivos** (`prediccion.js`, `escenarios*.js`, `temporadas.js`, `estado-equipos.js`…) con una herramienta de empaquetado | De ~10 archivos de código a 1–2 | Medio |
| **Nombres con versión** (`prediccion.3f9a.js`) y caché de un año sin revalidar | Las vistas de quien regresa dejan de preguntar por el código | Medio |
| **Service Worker: caché primero para archivos versionados** y revalidar solo los `.json` | De ~12 a ~3 peticiones por vista | Medio |
| **Vida corta (60–300 s) para los `.json` en la CDN** | Muchas visitas simultáneas se resuelven con una sola consulta al origen | Bajo |

**Efecto [estimación]:** de ≈ 16 a ≈ 5 peticiones por visita. Con 1 millón de visitas al mes, eso baja la factura de CloudFront de ≈ $6 a **$0**; con 5 millones, de ≈ $70 a ≈ $15.

### 6.3 Reducir bytes
| Cambio | Efecto | Esfuerzo |
|---|---|---|
| **Minificar** los JavaScript (hoy están sin minificar) | ≈ 25–35 % menos de código [estimación] | Bajo (una herramienta) |
| Brotli en lugar de gzip (lo activan Cloudflare y CloudFront) | ≈ 10–15 % menos [estimación] | Nulo |
| **Cargar el panorama (marcas (c)/(e)) solo cuando la tabla esté cerca de la pantalla** (hoy se calcula al abrir la página) | Quien no baja a la tabla no descarga ni ejecuta los motores | Bajo |
| Quitar los JSON de la temporada anterior de la precarga del Service Worker | ≈ 5 KB menos por visitante nuevo | Bajo |
| Reutilizar las fuentes de Google ya instaladas en el teléfono o usar fuentes del sistema | Menos bytes y mejor velocidad; no cuenta en tu factura | Bajo |

### 6.4 Evitar lo que sí encarece
No agregar un backend por petición (funciones, API, base de datos), cuentas de usuario, imágenes o video pesados, ni servicios opcionales como WAF o registros en tiempo real. Si algún día se agrega un servicio de pago, ponerlo en otra cuenta o proyecto.

### 6.5 Protección contra sorpresas
- **AWS:** presupuesto mensual con alarmas a $5 y $20 y detección de anomalías de costo. Revisa la sección 3 si compartes cuenta con una EC2.
- **Cloudflare:** al no cobrar ancho de banda, el riesgo es mínimo; vigila los límites de compilaciones (500 al mes) y de archivos.
- Un ataque de bots no te cuesta con Cloudflare Pages; con AWS sí podría (por eso la alarma).

### 6.6 DNS y dominio
El dominio cuesta ≈ $10–15 al año [estimación]. El DNS de Cloudflare es gratuito; una zona en Route 53 ≈ $0.50 al mes.

### 6.7 Costo por escala después de optimizar
Con cambios 6.2 y 6.3 una visita pesa del orden de **0.05 MB y ≈ 5 peticiones** [estimación]. Con 1 millón de visitas son ≈ 50 GB y ≈ 5 millones de peticiones: **$0 en CloudFront y en Cloudflare**.

---

## 7. Balance costo vs ingreso

### 7.1 Costo de entrega por escala

Modelo [estimación]: 30 % de las visitas son de visitantes nuevos (0.2 MB, 25 peticiones) y 70 % de personas que regresan (≈ 0.01 MB, 12 peticiones). Resultado: ≈ 0.067 MB y ≈ 16 peticiones por visita (≈ 5 con las mejoras de la sección 6.2). Precios de CloudFront de la sección 2.

| Visitas al mes | GB | Peticiones (millones) | Cloudflare Pages | S3 + CloudFront actual | S3 + CloudFront optimizado |
|---|---|---|---|---|---|
| 10,000 | 0.7 | 0.2 | $0 | $0 | $0 |
| 50,000 | 3.3 | 0.8 | $0 | $0 | $0 |
| 100,000 | 6.5 | 1.6 | $0 | $0 | $0 |
| 500,000 | 33 | 7.9 | $0 | $0 | $0 |
| 1,000,000 | 65 | 16 | $0 | ≈ $6 | $0 |
| 5,000,000 | 327 | 80 | $0 | ≈ $70 | ≈ $15 |
| 10,000,000 | 654 | 159 | $0 | ≈ $149 | ≈ $41 |

Costos fijos: dominio ≈ $1 al mes. Una **EC2 pequeña** sumaría ≈ **$10–15 al mes fijos** (instancia + IPv4 + disco) sin importar las visitas.

### 7.2 Ingreso por anuncios por escala

**Fórmula:** ingreso = visitas × páginas por visita × RPM ÷ 1,000, donde RPM es el ingreso por cada mil vistas de página.

**Qué sé de RPM para México [fuente, con salvedades]:** casi todas las cifras públicas son de **YouTube**, no de sitios web. Esas guías ubican a México como mercado de nivel medio-bajo: CPM de $0.80 a $2.50 y RPM de creador de $0.70 a $2, con variaciones grandes según el tipo de contenido (un reporte de canales de música llegó a $3.17). Para publicidad gráfica en sitios, una guía lista a México en el nivel con CPM de $0.30 a $2.00 y otra estima el CPC de AdSense en $0.10 a $0.50. **No tengo una medición de sitios deportivos mexicanos**, por eso uso tres casos:

| Caso | Páginas por visita | RPM | Ingreso por cada 1,000 visitas |
|---|---|---|---|
| Bajo | 1.5 | $0.50 | $0.75 |
| Medio | 2 | $1.50 | $3 |
| Alto | 3 | $3 | $9 |

| Visitas al mes | Bajo | Medio | Alto |
|---|---|---|---|
| 10,000 | $8 | $30 | $90 |
| 50,000 | $38 | $150 | $450 |
| 100,000 | $75 | $300 | $900 |
| 500,000 | $375 | $1,500 | $4,500 |
| 1,000,000 | $750 | $3,000 | $9,000 |

Con las cifras de México, el caso **bajo** es el más prudente y el **alto** es optimista.

### 7.3 La balanza

| Pregunta | Resultado |
|---|---|
| ¿Cuántas visitas al mes para ganar $100? | ≈ **133,000** (bajo), **33,000** (medio), **11,000** (alto) |
| ¿Cuántas para cubrir una EC2 pequeña (≈ $12 al mes)? | ≈ 16,000 (bajo), 4,000 (medio), 1,300 (alto) |
| ¿Y para cubrir el hosting en Cloudflare Pages? | Ninguna: cuesta $0 |
| ¿Dónde se acaba la ganancia por costo de entrega? | En ningún escenario de esta tabla: aun sin optimizar, con 1 M de visitas el costo ($6) es menos del 1 % del ingreso bajo ($750) |

**Conclusiones:**

1. **Los costos de infraestructura son despreciables frente al ingreso posible; el límite es la audiencia.** Con 1 millón de visitas al mes, el hosting cuesta $0–$6 y el ingreso estimado es de $750 a $9,000.
2. **Con poco tráfico (menos de 10,000 visitas al mes) la publicidad deja decenas de dólares como mucho.** Ahí conviene priorizar patrocinios directos y donaciones (sección 8).
3. **La estacionalidad pesa:** la temporada regular dura de agosto a noviembre más la liguilla; el ingreso se concentra en 4–5 meses y los demás casi no producen. Calcula el año con esos meses, no con 12.
4. **Los costos «ocultos» no son del hosting:** impuestos sobre el ingreso (consulta a un contador), tiempo de mantenimiento y, si no lo cuidas, **perder la cuenta de anuncios** por infringir políticas (sección 8.2).
5. Una EC2 **no se justifica** por costo: añade $10–15 fijos para algo que una página estática no necesita.

---

## 8. Monetización

### 8.1 ¿Pagan por mostrar o por clic?
**[fuente: Publisher Collective, 2025]** AdSense pasó de pago por clic a pago por **impresiones (CPM)** en marzo de 2024, con una participación del editor de ≈ **68 %**; hoy se gana principalmente por **mostrar** el anuncio y cuenta que se vea (visibilidad). Es una fuente comercial que cita a Google: confírmalo en tu cuenta. Los patrocinios con enlace y los afiliados sí pagan por clic o compra.

### 8.2 Reglas de Google que afectan a tu página [fuente: política «Google-served ads on screens without publisher-content»]
Google **no permite** anuncios en pantallas sin contenido del editor, «en construcción», usadas para alertas, navegación u otros fines de comportamiento, ni sobre **contenido generado automáticamente sin revisión o curaduría**. Por eso:
- **No pongas anuncios de Google en la pantalla de «calculando…»** del módulo de escenarios.
- **Tampoco dentro del panel de resultados de escenarios** (es contenido generado por el motor).
- Sí en las páginas con contenido curado: tablas y calendario, **lejos de los campos de marcadores** (evita clics accidentales; regla general de colocación que conviene verificar al abrir la cuenta).
- Para algo visible durante el cálculo, un **patrocinador propio** (imagen y enlace tuyos, no servido por Google).

### 8.3 Redes de anuncios y sus requisitos
| Opción | Requisito | Realismo |
|---|---|---|
| **Google AdSense** | Contenido propio, política de privacidad, navegación clara. No encontré un mínimo oficial de visitas [verifica]; la aprobación es manual | **Puerta de entrada realista** |
| Mediavine (red principal) | **[fuente: guía de 2026 que cita a Mediavine]** ≈ **$5,000 al año** en ingresos publicitarios; prioriza tráfico de Estados Unidos, Reino Unido, Canadá y Australia | No realista con tráfico de México |
| Journey by Mediavine | **[misma fuente]** desde **1,000 sesiones al mes**; 70 % de participación; pasa a la red principal con $5,000 en 12 meses | Posible, pero sigue pesando el tráfico de nivel 1 |
| Raptive, Ezoic, Media.net, Carbon Ads | Umbrales propios y cambiantes (hay reportes de que Ezoic subió el suyo; sin verificar) | Revisar cuando crezca el tráfico |
| Pujas de encabezado | **[fuente]** suelen requerir de 500,000 a 2 millones de vistas al mes | Muy lejos de la escala actual |

### 8.4 Dónde poner los anuncios
**Teléfono:**
| Ubicación | Ingreso | Molestia | Comentario |
|---|---|---|---|
| Bloque en medio del calendario (cada ~3 jornadas) | Medio-alto | Baja si la altura es fija | **Primera opción** |
| Debajo de la tabla de posiciones | Medio | Baja | Buena complementaria |
| Banner fijo al fondo (anchor) | Alto | Media: tapa contenido, posibles clics accidentales | Con botón de cerrar |
| Arriba de todo | Alto | **Alta** | Evitar |
| Pantalla completa entre páginas | Alto | **Muy alta** | Evitar |
| En «calculando…» o en los resultados de escenarios | — | — | **No** (8.2) |

**Computadora:** columna derecha fija (300×250 o 300×600) junto al calendario, un bloque bajo el encabezado y otro entre tablas. Máximo tres por página. Reserva altura fija para cada hueco (protege el CLS) y carga los de abajo de forma diferida.

### 8.5 Alternativas a los anuncios (sin cuentas ni suscripciones)
| Opción | Cómo funciona | Potencial | Esfuerzo |
|---|---|---|---|
| **Patrocinio directo** | Una marca (tienda deportiva, nutrición, universidad, bar) paga cuota fija por «Presentado por…» con enlace o por patrocinar una jornada | **El más alto para un nicho**; funciona con poco tráfico si muestras estadísticas y picos por jornada | Medio |
| **Afiliados** | Enlaces a jerseys, equipo, boletos o transmisiones; comisión por compra | Bajo-medio | Bajo |
| Apuestas deportivas (afiliados) | Pagan bien, pero hay regulación en México y restricciones de las redes de anuncios; **no lo recomiendo sin revisar la ley y las políticas** | Alto, con riesgo | Alto |
| **Donaciones** | Enlace «invítame un café» (Ko-fi, Buy Me a Coffee o liga de pago local) | Bajo, casi sin costo | Muy bajo |
| **Licencia del motor / widgets** | Vender o licenciar a la liga, medios, canales o podcasts un widget «qué necesita tu equipo» | Potencialmente el mayor ingreso por acuerdo | Alto |
| Tarjetas para compartir | Imagen del escenario con tu dirección y, si hay, el logo de un patrocinador | Crece el tráfico | Medio |
| Canal de WhatsApp / boletín gratis | Resumen semanal con patrocinador | Medio | Medio |

### 8.6 Ruta recomendada
1. **Base sin costo:** pasar a Cloudflare Pages, página de privacidad y contacto, estadísticas de uso con aviso de privacidad, sitemap y etiquetas para compartir. Medir 1–2 temporadas de tráfico real (visitas, páginas por visita, país, dispositivo).
2. **Ingreso sin red de anuncios:** donaciones + un espacio de patrocinador directo + afiliados discretos.
3. **AdSense en páginas curadas** con 1–2 bloques en teléfono, alturas fijas, sin anuncios en el módulo de escenarios. Medir RPM y CLS antes de agregar más.
4. Si las sesiones crecen y hay tráfico significativo de fuera de México, evaluar Journey, Raptive o Ezoic.
5. Probar el camino B2B (widget o licencia) con la liga o medios deportivos.

---

## 9. Fuentes consultadas

- Precios de CloudFront (AWS, actualizada 2026-11-05): https://aws.amazon.com/cloudfront/pricing/pay-as-you-go
- Plan gratuito de AWS con $200 en créditos (16 de julio de 2025): https://aws.amazon.com/about-aws/whats-new/2025/07/aws-free-tier-credits-month-free-plan/
- Cargo por IPv4 públicas (AWS, 2023/2024): https://aws.amazon.com/blogs/aws/new-aws-public-ipv4-address-charge-public-ip-insights
- Precios de EC2 bajo demanda (AWS): https://aws.amazon.com/en/ec2/pricing/on-demand/
- Capas gratuitas comparadas 2026: https://freetier.co/articles/cloud-provider-free-tiers-2026 · https://agentdeals.dev/hosting-free-tier-comparison-2026 · https://flaviocopes.com/hosting-free-tiers/
- Oracle Cloud (recursos «Always Free»): https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm y guías de terceros
- Política de Google sobre anuncios en pantallas sin contenido: https://support.google.com/publisherpolicies/answer/11112688
- «CPM vs CPC: la nueva estructura de pago de AdSense» (Publisher Collective): https://www.publisher-collective.com/blog/cpm-vs-cpc
- Requisitos de Mediavine 2026 (guía de terceros): https://www.jupiter.co/blog/mediavine-requirements-2026-how-to-qualify
- RPM/CPM de México (YouTube y guías de AdSense): https://dynamoi.com/nl/data/youtube-adsense-rpm/mx · https://fluxnote.io/guides/youtube-earnings-by-country-comparison · https://weforads.com/blog/what-is-ecpm/ · https://khrisdigital.com/?p=526259
- Peso medio de las páginas (HTTP Archive 2025): https://sqmagazine.co.uk/web-design-statistics/
- Pesos de tus archivos: medidos con los archivos del proyecto el 2026-11-02.

**No verifiqué y debes confirmar antes de decidir:** tarifas de EC2, S3 y Route 53; términos vigentes de Cloudflare, Netlify, GitHub Pages y Oracle; mínimo de tráfico y umbral de pago de AdSense; RPM real de tu sitio; páginas por visita; regulación de afiliados de apuestas.
