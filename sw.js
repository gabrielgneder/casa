// Service worker: deixa o app abrir sem internet (com os últimos valores guardados).
// VERSION e o carimbo de versão (v=) dos arquivos são trocados pelo hash do commit na publicação (.github/workflows/deploy.yml).
// O index.html pede app.js?v=<versão>: um HTML novo nunca roda com JS/CSS velho guardado no cache.
const VERSION = "casa-v7";
const SHELL = [
  "./", "index.html", "styles.css?v=dev", "app.js?v=dev", "config.js?v=dev", "manifest.webmanifest",
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
  // dados de teste nunca vão para o cache
  if (/\/demo-[^/]*\.json$/.test(url.pathname)) return;

  // Página: tenta a rede primeiro (pega atualizações), cai no cache se estiver offline.
  // cache "no-cache": sempre confere com o servidor; nunca usa um HTML velho do cache HTTP do navegador.
  if (req.mode === "navigate") {
    e.respondWith(fetch(req, { cache: "no-cache" }).then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put("./", copy)); return res; })
      .catch(() => caches.match("./").then(r => r || caches.match("index.html"))));
    return;
  }

  // Demais arquivos do app: cache primeiro, pelo endereço exato (com o ?v= da versão)
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return res;
  })));
});
