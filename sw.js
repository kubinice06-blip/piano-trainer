/* Service Worker：加到 iPad 主畫面之後，完全沒網路也要開得起來。
 *
 * 分兩種策略，因為兩種東西的需求相反：
 *   程式碼（html / js / css）→ 先走網路，失敗才吃快取。
 *     否則你在電腦上改完 push 上去，iPad 會一直開到舊版本。
 *   大型靜態檔（vendor / icons）→ 先吃快取。
 *     VexFlow 有 0.95 MB，而且幾乎不會變，沒必要每次都上網要。
 */

const VERSION = "putai-v14";
const ASSETS = [
  "./",
  "./index.html",
  "./samples.html",
  "./manifest.webmanifest",
  "./css/app.css",
  "./vendor/vexflow.js",
  "./js/main.js",
  "./js/stream.js",
  "./js/library.js",
  "./js/adaptive.js",
  "./js/fingerprint.js",
  "./js/fingering.js",
  "./js/input/midi.js",
  "./js/input/onset.js",
  "./js/input/performance.js",
  "./js/drills/tap-piano.js",
  "./js/core/rng.js",
  "./js/core/pitch.js",
  "./js/core/key.js",
  "./js/core/chords.js",
  "./js/core/roman.js",
  "./js/data/harmony-stats.js",
  "./js/gen/rhythm.js",
  "./js/gen/harmony.js",
  "./js/gen/melody.js",
  "./js/gen/bass.js",
  "./js/gen/exercise.js",
  "./js/gen/chordprog.js",
  "./js/gen/voicing.js",
  "./js/gen/comping.js",
  "./js/render/vexloader.js",
  "./js/render/score.js",
  "./js/audio/sound.js",
  "./js/audio/metro.js",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION)
      // 個別抓，單一檔案失敗不會讓整包安裝失敗；一律跟伺服器要最新的
      .then(c => Promise.all(ASSETS.map(u =>
        fetch(u, {cache:"no-cache"}).then(r => r.ok ? c.put(u, r) : null).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const CACHE_FIRST = /\/(vendor|icons)\//;

function put(req, res){
  if (res && res.ok && new URL(req.url).origin === location.origin){
    const copy = res.clone();
    caches.open(VERSION).then(c => c.put(req, copy));
  }
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== location.origin) return;

  if (CACHE_FIRST.test(new URL(req.url).pathname)){
    e.respondWith(
      caches.match(req, {ignoreSearch:true})
        .then(hit => hit || fetch(req).then(r => put(req, r)))
    );
    return;
  }

  // 程式碼：網路優先，離線時退回快取；連首頁都拿不到就給快取的 index。
  //
  // cache:"no-cache" 是必要的，不是保險。GitHub Pages 送 Cache-Control: max-age=600，
  // 普通的 fetch() 會先撞上瀏覽器自己的 HTTP 快取直接回舊檔，
  // 「網路優先」就變成空話 —— 推了新版，iPad 十分鐘內還是開到舊的。
  // no-cache 會強制帶 If-None-Match 回伺服器問，沒變就收 304，很便宜。
  e.respondWith(
    fetch(req, {cache: "no-cache"})
      .then(r => put(req, r))
      .catch(() => caches.match(req, {ignoreSearch:true})
        .then(hit => hit || caches.match("./index.html")))
  );
});
