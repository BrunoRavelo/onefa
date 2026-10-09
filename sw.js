/* sw.js — Service Worker de ONEFA Pronósticos
 *
 * Súbelo a la misma carpeta que nacional.html e index.html (/onefa/sw.js).
 *
 * Estrategia "stale-while-revalidate":
 *   1) Responde AL INSTANTE con lo guardado en el celular (sin esperar la red).
 *   2) En segundo plano pide la versión nueva y la guarda para la próxima vez.
 *   3) Si un .json cambió, avisa a la página con { type: 'DATA_UPDATED' } y ella se recarga sola.
 *
 * Para forzar que todos descarguen una versión nueva de todo, cambia VERSION.
 */
const VERSION = 'v1';
const CACHE = 'onefa-' + VERSION;

// Archivos que se guardan al instalar. Si alguno no existe se omite sin romper nada.
// Si agregas un archivo nuevo al sitio (otra página, otro JSON), añádelo aquí.
const PRECACHE = [
  './',
  './index.html',
  './nacional.html',
  './calendario_equipo.html',
  './prediccion.html',
  './onefa.css',
  './prediccion.js',
  './onefa_data_2025.json',
  './onefa_data_2026.json',
  './onefa_nacional_2025.json',
  './onefa_nacional_2026.json',
];

// Google Fonts también se guarda (hoja de estilos + archivos .woff2).
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

// Para archivos del propio sitio se ignora el query string (?temporada=2026, ?t=123...)
// y se usa siempre la misma entrada de caché.
function cacheKey(url) {
  return url.origin + url.pathname;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) =>
        Promise.all(
          PRECACHE.map((path) => {
            const url = new URL(path, self.location);
            // cache: 'reload' salta la caché HTTP para guardar la versión realmente actual
            return fetch(url.href, { cache: 'reload' })
              .then((res) => (res.ok ? cache.put(cacheKey(url), res) : null))
              .catch(() => null);
          })
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('onefa-') && k !== CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !FONT_HOSTS.includes(url.hostname)) return;

  event.respondWith(staleWhileRevalidate(event, req, url, sameOrigin));
});

async function staleWhileRevalidate(event, req, url, sameOrigin) {
  const cache = await caches.open(CACHE);
  const key = sameOrigin ? cacheKey(url) : req;
  const cached = await cache.match(key);
  // Copia hecha ANTES de devolver `cached`, porque su cuerpo solo se puede leer una vez.
  const cachedCopy = cached ? cached.clone() : null;

  // Pide la versión nueva (no-cache = pregunta al servidor si cambió; si no, solo recibe un 304 diminuto)
  const update = fetch(sameOrigin ? url.href : req, sameOrigin ? { cache: 'no-cache' } : undefined)
    .then(async (res) => {
      if (res.ok || res.type === 'opaque') {
        const changed = cachedCopy && url.pathname.endsWith('.json')
          ? await hasChanged(cachedCopy, res.clone())
          : false;
        await cache.put(key, res.clone());   // primero guarda...
        if (changed) notifyClients(url.href); // ...y luego avisa, para que la página ya encuentre lo nuevo
      }
      return res;
    })
    .catch(() => null); // sin señal: no pasa nada, ya respondimos con lo guardado

  event.waitUntil(update);

  if (cached) return cached;

  // Primera vez (nada guardado): toca esperar la red
  const res = await update;
  if (res) return res;

  // Sin red y sin caché: al menos intenta mostrar la página principal guardada
  if (req.mode === 'navigate') {
    const fallback = await cache.match(cacheKey(new URL('./nacional.html', self.location)));
    if (fallback) return fallback;
  }
  return Response.error();
}

async function hasChanged(oldRes, newRes) {
  try {
    const [before, after] = await Promise.all([oldRes.text(), newRes.text()]);
    return before !== after;
  } catch (_) {
    return false;
  }
}

async function notifyClients(href) {
  try {
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((c) => c.postMessage({ type: 'DATA_UPDATED', url: href }));
  } catch (_) {
    /* no es crítico */
  }
}
