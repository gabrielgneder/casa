// Service worker: deixa o app abrir sem internet (com os últimos valores guardados).
// Ao publicar uma versão nova, aumente o número em VERSION para o celular baixar os arquivos novos.
const VERSION = "casa-v3";
const SHELL = [
  "./", "index.html", "styles.css", "app.js", "config.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png",
];

self.addEventListener("install", e => {
  // cache: "reload" ignora o cache HTTP do navegador, senão a versão nova pode guardar arquivos antigos
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Google (login, planilha) nunca passa pelo cache
  if (url.origin !== self.location.origin) return;
  // dados de teste locais nunca vão para o cache
  if (url.pathname.endsWith("demo-grid.json")) return;

  // Página: tenta a rede primeiro (pega atualizações), cai no cache se estiver offline
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put("./", copy)); return res; })
      .catch(() => caches.match("./").then(r => r || caches.match("index.html"))));
    return;
  }

  // Demais arquivos do app: cache primeiro
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return res;
  })));
});
