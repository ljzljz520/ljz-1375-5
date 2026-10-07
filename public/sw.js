// Service Worker：离线优先（已收藏页面/文字）。受限图片不缓存（由页面逻辑决定是否 cache.add）。
const CACHE = 'bc-shell-v1';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/ui.js', '/exhibit.js', '/keyboard.js', '/exhibit.html'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (!url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request).then(r => r || caches.match('/exhibit.html'))));
    return;
  }
  // API：GET 离线时读缓存（offline bundle / 已许可图像）；写操作离线直接失败。
  if (e.request.method === 'GET') {
    e.respondWith(
      fetch(e.request).then(r => {
        // 图像：仅在成功（200 且已通过许可接口）时由页面显式缓存，这里不自动缓存
        return r;
      }).catch(() => caches.match(e.request).then(r => r || caches.match('/offline/' + url.pathname.split('/')[2])))
    );
  }
});
