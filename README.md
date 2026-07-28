# 譜台 — 視譜與爵士和弦練習器

隨機出題的鋼琴練習器。全 30 個調、雙手、四小節連續流預讀、和聲取自真實語料庫統計。
純前端，沒有建置步驟，離線可用。

**https://kubinice06-blip.github.io/piano-trainer/**

## 在 iPad 上使用

1. iPad Safari 開啟上面那個網址
2. 分享鈕 → **加入主畫面**

之後就是一個全螢幕 App，沒有網路也能開（Service Worker 會把整包快取起來，
含 `vendor/vexflow.js`，所以連 CDN 全掛都不影響）。

> 更新方式：改完 push 即可。程式碼走 network-first，所以連得上網時開啟就是最新版；
> 大型靜態檔（VexFlow、圖示）走 cache-first，不會每次重抓。

**iPad 上的兩個實體限制**

- **側邊的實體靜音鍵**：iOS 的 WebAudio 預設走鈴聲通道。Safari 16.4 以上會用
  `navigator.audioSession` 宣告成播放用途來繞過；更舊的版本退回無聲迴圈的做法，
  不保證有效 —— 沒聲音時先檢查靜音鍵。
- **螢幕變暗**：勾了「練習時螢幕保持常亮」會用 Wake Lock（iOS 16.4+）。

## 操作

| 鍵盤 | | 觸控 | |
|---|---|---|---|
| `N` | 換一題 | 左滑 | 換下一題 |
| `R` | 重來同一題 | 右滑 | 開設定抽屜 |
| `P` | 播放解答音 | 點譜面 | 播放／停止 |
| `S` | 看和弦代號（視譜）／看答案（和弦） | | |
| `M` | 節拍器 | | |
| `X` | 標記「這段沒彈好」 | | |
| `↑` `↓` | 調速度（按住 Shift 一次 5） | | |

勾「開始時同步播放解答音」，按開始後解答音會在預備拍結束的正拍上進來，
跟節拍器排在同一個音訊時鐘上，不會漂。連續流換段接著播，和弦模式播完自動下一輪。

## 和弦模式

進行 28 條（基礎／代理／藍調／曲式／調式）× voicing 9 種（含兩種雙手）
× 節奏 7 種 comping + 分解和弦上行／下行／上下行 + 走路低音。
節拍器跑起來時，游標會沿著整條進行走，走到底自動繞回第一小節。

## 兩種「回顧」

- **本次練習存檔**（譜面下方）：連續流每推進一段就建檔，可即時調閱。
  **按「換一題」或改任何出題設定就清空** —— 那代表換了一個新題目。
- **長期練習紀錄**（設定抽屜內）：跨場次保存，關掉瀏覽器再開還在。
  按 `X` 標記卡住的段落進複習清單，可隨時調閱重練，或整批列印成 A4 練習單。
  統計裡的「最常卡住」看的是標記率而不是次數，而且要練過 3 次以上才納入排名。

## 結構

```
index.html          主程式        samples.html    樣張
css/app.css         樣式          sw.js           離線快取
manifest.webmanifest              vendor/         VexFlow 本機副本
js/core/    rng · pitch · key · chords · roman        樂理核心
js/gen/     rhythm · harmony · melody · bass · exercise · chordprog   出題
js/render/  vexloader · score                          繪譜
js/audio/   sound · metro                              音訊
js/data/    harmony-stats.js                           語料庫統計（自動產生）
js/stream.js                                           段落串流
js/library.js                                          長期練習紀錄
tools/      build-harmony-stats.mjs · make-icons.mjs · audit-sw.mjs
```

新增 js 模組之後記得跑 `node tools/audit-sw.mjs` —— 漏加進 `sw.js` 的快取清單，
只有真的斷網時才會發現。

`piano-trainer.html` 是改版前的單檔版本，保留當備份。

## 和聲資料來源

`js/data/harmony-stats.js` 由 `tools/build-harmony-stats.mjs` 從
[When-in-Rome](https://github.com/MarkGotham/When-in-Rome) 功能和聲語料庫萃取
（分析部分採 CC BY-SA 4.0）：921 份分析、3,597 個調性段落、49,785 個和弦。
含 Bach、Mozart、Schubert、Fanny Mendelssohn、Clara Schumann、Monteverdi，
以及 Reger、Rimsky-Korsakov、Tchaikovsky、Kostka 的和聲學教科書習題。

該工具只下載、只計數、只輸出出現頻率，原始分析檔不落地也不進版控。

重新產生：

```bash
node tools/build-harmony-stats.mjs
node tools/make-icons.mjs
```

## 本機開發

```bash
npx http-server . -p 8123 -c-1
```

必須用 http 開，不能直接雙擊 `index.html` —— ES module 在 `file://` 下會被 CORS 擋掉。
