// Service worker: يخلي التطبيق يفتح بدون إنترنت ويحفظ صفحات المصحف على الجهاز
const SHELL = "mushaf-shell-v57";
const PAGES = "mushaf-pages-v2";   // غيّر الرقم لو صور الصفحات اتغيرت
const FONTS = "mushaf-fonts-v1";
const SHELL_FILES = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png", "./favicon.png", "./qrcode.js", "./quran-text.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  const keep = [SHELL, PAGES, FONTS];
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith("mushaf-") && !keep.includes(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // صور الصفحات: من الجهاز الأول، ولو مش موجودة تتحمل وتتحفظ
  if (url.origin === location.origin && /\/(b|hq)\/\d+\.webp$/.test(url.pathname)) {
    e.respondWith(caches.open(PAGES).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }

  // الخطوط: من الجهاز وتتحدث في الخلفية
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open(FONTS).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(res => { if (res.ok || res.type === "opaque") c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }

  // صفحة التطبيق: من النت الأول عشان التحديثات، ولو مفيش نت من الجهاز
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) caches.open(SHELL).then(c => c.put(req.mode === "navigate" ? "./index.html" : req, res.clone()));
      return res;
    }).catch(async () => (await caches.match(req, { ignoreSearch: true })) ||
                         (req.mode === "navigate" ? caches.match("./index.html") : Response.error())));
  }
});
