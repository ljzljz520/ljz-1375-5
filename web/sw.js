/* 离线回归：网络优先，失败时回退已发布快照（详情页含版本号，重连后更新）。
   编辑台与 /api/admin 永不缓存。 */
const CACHE = "bcc-v1";
const SHELL = ["./", "./styles.css", "./app.js",
               "./assets/cuff-detail.svg", "./assets/cuff-overview.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) =>
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.pathname.includes("/api/admin")) return;          // 编辑接口不缓存
  const isApi = url.pathname.startsWith("/api/");

  e.respondWith((async () => {
    try {
      const fresh = await fetch(e.request);
      if (fresh.ok && (isApi || url.origin === location.origin)) {
        const copy = fresh.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return fresh;
    } catch (_) {
      const cached = await caches.match(e.request, { ignoreSearch: isApi });
      if (cached) return cached;
      if (!isApi) return caches.match("./");
      return new Response(JSON.stringify({ error: "offline", offline: true }),
        { status: 503, headers: { "Content-Type": "application/json" } });
    }
  })());
});
