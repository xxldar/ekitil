// Нужен, чтобы страницу можно было установить на телефон как приложение. Оболочка страницы кэшируется,
// перевод всегда идёт через сеть.
// app.js и style.css страница подключает с версией (app.js?v=…, её ставят скрипты выкладки), поэтому старые
// и новые файлы не смешиваются; сама страница при наличии сети каждый раз сверяется с сервером.
const CACHE = "ekitil-v23";
const SHELL = ["./", "index.html", "icon.svg", "manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // чужие адреса (Hugging Face, CDN) и перевод не трогаем
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.includes("/api/")) return;
  // страницу — всегда сверяя с сервером (не изменилась — короткий ответ «304», ничего не качается),
  // остальное — как обычно; без сети — из кэша
  const request = e.request.mode === "navigate" ? fetch(e.request.url, { cache: "no-cache" }) : fetch(e.request);
  e.respondWith(
    request
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("index.html")))
  );
});
