// Minimal service worker: makes the app installable and gives an offline shell,
// without ever caching dynamic/authenticated traffic.
const CACHE = "rivuletsend-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

const SHARE_CACHE = "owlsend-shared";

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Web Share Target: another app shared file(s) to OwlSend. Stash them in a
  // cache and redirect into the app, which reads them and stages a send.
  if (req.method === "POST" && url.pathname === "/share") {
    event.respondWith(
      (async () => {
        try {
          const form = await req.formData();
          const files = form.getAll("files").filter((f) => f instanceof File);
          const cache = await caches.open(SHARE_CACHE);
          const old = await cache.keys();
          await Promise.all(old.map((k) => cache.delete(k)));
          let i = 0;
          for (const f of files) {
            await cache.put(
              new Request(`/__shared?name=${encodeURIComponent(f.name)}&i=${i++}`),
              new Response(f, { headers: { "content-type": f.type || "application/octet-stream" } }),
            );
          }
        } catch {
          /* ignore — land in the app either way */
        }
        return Response.redirect("/?share-target", 303);
      })(),
    );
    return;
  }

  // Only own-origin GETs. Never touch the API or the signaling upgrade — they're
  // dynamic and carry the session; caching them would break auth/transfers.
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/ws")) return;

  // Navigations: network-first so a new deploy is picked up, cached shell offline.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          (await caches.open(CACHE)).put("/", res.clone());
          return res;
        } catch {
          return (await caches.match("/")) || Response.error();
        }
      })(),
    );
    return;
  }

  // Hashed, immutable build assets: cache-first.
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok && (url.pathname.startsWith("/assets/") || /\.(png|svg|webmanifest|woff2?)$/.test(url.pathname))) {
        (await caches.open(CACHE)).put(req, res.clone());
      }
      return res;
    })(),
  );
});
