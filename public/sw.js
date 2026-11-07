// =============================================================================
// sw.js — « Service worker » : garde l'appli et les données sur le téléphone pour
// qu'elle s'ouvre vite et fonctionne SANS RÉSEAU sur le terrain.
//   - l'appli (page, scripts, styles, icônes, carte) : copie locale, mise à jour en arrière-plan ;
//   - les données (permis, ventes, DPE) : copie locale affichée tout de suite, puis mise à jour
//     en arrière-plan (l'appli propose de recharger quand une nouvelle version est arrivée) ;
//   - le suivi (/api/suivi) : réseau d'abord, copie locale si pas de réseau ;
//   - les fonds de carte déjà consultés : gardés (2 000 tuiles maximum).
// La version ci-dessous est remplacée automatiquement à chaque déploiement.
// =============================================================================
const VERSION = "__VERSION__";
const CACHE_APP = `ho-app-${VERSION}`;
const CACHE_DONNEES = "ho-donnees";
const CACHE_TUILES = "ho-tuiles";
const MAX_TUILES = 2000;

const APP = [
  "/", "/style.css", "/journal.js", "/ho.js", "/app.js", "/manifest.webmanifest",
  "/icones/icone-180.png", "/icones/icone-192.png",
  // Bibliothèque de la carte, hébergée dans l'appli (public/lib/leaflet)
  "/lib/leaflet/leaflet.css", "/lib/leaflet/leaflet.js", "/lib/leaflet/MarkerCluster.css",
  "/lib/leaflet/MarkerCluster.Default.css", "/lib/leaflet/leaflet.markercluster.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE_APP);
    // Un fichier qui échoue n'empêche pas l'installation
    await Promise.all(APP.map((u) => cache.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const nom of await caches.keys()) {
      if (nom.startsWith("ho-app-") && nom !== CACHE_APP) await caches.delete(nom);
    }
    await self.clients.claim();
  })());
});

// Réponse « bonne à garder » : pas d'erreur, pas la page de connexion (renvoyée en 401)
const gardable = (r) => r && (r.ok || r.type === "opaque");

async function reseauPuisCache(req, nomCache) {
  try {
    const r = await fetch(req);
    if (gardable(r)) (await caches.open(nomCache)).put(req, r.clone());
    return r;
  } catch (err) {
    const c = await caches.match(req);
    if (c) return c;
    throw err;
  }
}

async function cacheEtMiseAJour(e, req, nomCache, prevenir) {
  const cache = await caches.open(nomCache);
  const enCache = await cache.match(req);
  const maj = fetch(req).then(async (r) => {
    if (gardable(r)) {
      const ancien = enCache && (enCache.headers.get("etag") || enCache.headers.get("last-modified"));
      const nouveau = r.headers.get("etag") || r.headers.get("last-modified");
      await cache.put(req, r.clone());
      if (prevenir && enCache && ancien !== nouveau) {
        for (const c of await self.clients.matchAll()) c.postMessage({ type: "donnees-maj" });
      }
    }
    return r;
  }).catch(() => null);
  if (enCache) { e.waitUntil(maj); return enCache; }
  return (await maj) || new Response("Hors ligne", { status: 503 });
}

async function tuile(req) {
  const cache = await caches.open(CACHE_TUILES);
  const c = await cache.match(req);
  if (c) return c;
  const r = await fetch(req);
  if (gardable(r)) {
    await cache.put(req, r.clone());
    const cles = await cache.keys();
    for (const k of cles.slice(0, Math.max(0, cles.length - MAX_TUILES))) await cache.delete(k);
  }
  return r;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return; // les envois (suivi) passent directement par le réseau
  const url = new URL(req.url);

  if (url.hostname.endsWith("tile.openstreetmap.org")) return e.respondWith(tuile(req));
  if (url.hostname === "cdnjs.cloudflare.com") return e.respondWith(cacheEtMiseAJour(e, req, CACHE_APP, false));
  if (url.origin !== location.origin) return;

  if (url.pathname === "/api/suivi") return e.respondWith(reseauPuisCache(req, CACHE_DONNEES));
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname === "/data/permis.json") return e.respondWith(cacheEtMiseAJour(e, req, CACHE_DONNEES, true));
  if (req.mode === "navigate") {
    // Page : réseau d'abord (gère la connexion), sinon la copie locale de l'appli
    return e.respondWith(fetch(req).then((r) => {
      if (r.ok) { const copie = r.clone(); caches.open(CACHE_APP).then((c) => c.put("/", copie)); }
      return r;
    }).catch(async () => (await caches.match("/")) || new Response("Hors ligne", { status: 503 })));
  }
  e.respondWith(cacheEtMiseAJour(e, req, CACHE_APP, false));
});
