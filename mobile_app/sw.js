// sw.js - Lưu sẵn giao diện để ứng dụng mở nhanh và mở được khi sóng yếu. Dữ liệu (Google Drive) KHÔNG lưu ở đây.
// Đổi CACHE mỗi khi phát hành bản mới để điện thoại tải giao diện mới.
const CACHE = "tbd-2026.10.27";
const SHELL = ["./", "index.html", "css/app.css", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png",
  "js/app.js", "js/base.js", "js/crypto.js", "js/drive.js", "js/image.js", "js/pt.js", "js/receipts.js", "js/scrypt.js", "js/session.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;     // Google Drive: luôn đi thẳng lên mạng
  // Mạng trước (luôn lấy bản mới nhất), mất mạng thì dùng bản đã lưu
  e.respondWith(fetch(e.request).then((res) => {
    const copy = res.clone();
    if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match("index.html"))));
});
