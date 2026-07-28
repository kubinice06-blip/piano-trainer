/* 從 When-in-Rome 的功能和聲分析語料庫萃取和聲進行統計。
 *
 * 語料庫：https://github.com/MarkGotham/When-in-Rome （分析部分 CC BY-SA 4.0）
 * 內含 Bach / Mozart / Schubert / Fanny Mendelssohn / Clara Schumann / Monteverdi
 * 以及 Reger、Rimsky-Korsakov、Tchaikovsky、Kostka 的和聲學教科書習題。
 *
 * 這支工具只下載、只計數、只輸出「統計表」——原始分析檔不落地、不進版控，
 * 產出的是不受著作權保護的頻率數據。執行方式：
 *   node tools/build-harmony-stats.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "MarkGotham/When-in-Rome";
const BRANCH = "master";
const CONCURRENCY = 24;

/* ---------- 1. 取得檔案清單 ---------- */

async function listAnalyses(){
  const r = await fetch(`https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`);
  const j = await r.json();
  if (!j.tree) throw new Error("無法取得檔案樹：" + JSON.stringify(j).slice(0, 200));
  return j.tree.filter(t => /\.rntxt$/.test(t.path)).map(t => t.path);
}

async function fetchAll(paths, onProgress){
  const out = [];
  let i = 0, done = 0;
  async function worker(){
    while (i < paths.length){
      const p = paths[i++];
      try {
        const r = await fetch(`https://raw.githubusercontent.com/${REPO}/${BRANCH}/${p.split("/").map(encodeURIComponent).join("/")}`);
        if (r.ok) out.push({path:p, text: await r.text()});
      } catch (e) { /* 單檔失敗就跳過，統計不差這一首 */ }
      if (++done % 100 === 0) onProgress(done, paths.length);
    }
  }
  await Promise.all(Array.from({length: CONCURRENCY}, worker));
  return out;
}

/* ---------- 2. 解析 RomanText ---------- */

const ROMAN = {i:1, ii:2, iii:3, iv:4, v:5, vi:6, vii:7};

/* 把一個羅馬數字符號拆成結構。
   例：V65/V → {degree:5, quality:"maj", seventh:true, inv:1, applied:5}
       bII6  → {degree:2, alter:-1, quality:"maj", inv:1} */
function parseNumeral(sym){
  let s = sym.trim();
  if (!s || s === "|" || /^\d+$/.test(s)) return null;

  // 應用和弦：取斜線左邊當主體，右邊當目標
  let applied = null;
  const slash = s.split("/");
  if (slash.length > 1){
    const tgt = parseNumeral(slash.slice(1).join("/"));
    if (!tgt) return null;
    applied = tgt.degree * (tgt.alter === -1 ? -1 : 1);
    s = slash[0];
  }

  // 特殊和弦：拿破崙六、增六、終止四六
  if (/^N/.test(s))            return {degree:2, alter:-1, quality:"maj", seventh:false, inv:1, applied, special:"N"};
  if (/^(Ger|It|Fr)/.test(s))  return {degree:6, alter:-1, quality:"aug6", seventh:true, inv:0, applied, special:s.slice(0,3)};
  if (/^Cad/.test(s))          return {degree:1, alter:0, quality:"maj", seventh:false, inv:2, applied, special:"Cad64"};

  let alter = 0;
  const m0 = s.match(/^([b#]+)/);
  if (m0){ alter = m0[1][0] === "b" ? -m0[1].length : m0[1].length; s = s.slice(m0[1].length); }

  const m = s.match(/^(vii|iii|ii|iv|vi|v|i|VII|III|II|IV|VI|V|I)/);
  if (!m) return null;
  const rn = m[1];
  const degree = ROMAN[rn.toLowerCase()];
  const upper = rn === rn.toUpperCase();
  let rest = s.slice(rn.length);

  let quality = upper ? "maj" : "min";
  if (/^o/.test(rest)){ quality = "dim"; rest = rest.slice(1); }
  else if (/^ø/.test(rest) || /^%/.test(rest)){ quality = "halfdim"; rest = rest.slice(1); }
  else if (/^\+/.test(rest)){ quality = "aug"; rest = rest.slice(1); }

  const fig = (rest.match(/^\d+/) || [""])[0];
  const INV = {"":0, "6":1, "64":2, "7":0, "65":1, "43":2, "42":3, "2":3, "9":0, "53":0};
  const inv = INV[fig] !== undefined ? INV[fig] : 0;
  const seventh = /7|65|43|42|^2$|9/.test(fig);

  return {degree, alter, quality, seventh, inv, applied, special:null};
}

/* 統計用的代號。刻意壓掉細節（轉位、七音）以外的雜訊，
   讓不同曲子的同一種進行能夠合併計數。 */
function token(c){
  if (!c) return null;
  if (c.special === "N") return "N6";
  if (c.special && /Ger|It|Fr/.test(c.special)) return "Aug6";
  if (c.special === "Cad64") return "Cad64";
  const acc = c.alter < 0 ? "b".repeat(-c.alter) : c.alter > 0 ? "#".repeat(c.alter) : "";
  const R = ["", "I","II","III","IV","V","VI","VII"][c.degree];
  let base = acc + (c.quality === "min" || c.quality === "dim" || c.quality === "halfdim" ? R.toLowerCase() : R);
  if (c.quality === "dim") base += "o";
  if (c.quality === "halfdim") base += "ø";
  if (c.quality === "aug") base += "+";
  // 標準數字低音：三和弦 ""/6/64，七和弦 7/65/43/42
  base += c.seventh ? ["7", "65", "43", "42"][c.inv] : ["", "6", "64", ""][c.inv];
  if (c.applied) base += "/" + ["", "I","II","III","IV","V","VI","VII"][Math.abs(c.applied)];
  return base;
}

/* 一個檔案 → 依「調」切段的和弦序列 */
function parseFile(text){
  const runs = [];
  let cur = null;                 // {mode, chords:[]}
  const lines = text.split(/\r?\n/);

  for (const line of lines){
    if (!/^m\d+/.test(line)) continue;
    if (/^m\d+\s*=/.test(line)) continue;              // m8 = m4 這種重複標記

    // 去掉小節號與拍點標記，留下調號與和弦
    const body = line.replace(/^m\d+[a-z]?\s*/, "").replace(/\bb\d+(\.\d+)?\b/g, " ");
    for (const tokRaw of body.split(/\s+/)){
      if (!tokRaw) continue;

      // 轉調記號："G:" 或 "d:"
      const km = tokRaw.match(/^([A-Ga-g][b#]*):$/);
      if (km){
        const mode = km[1][0] === km[1][0].toLowerCase() ? "minor" : "major";
        if (cur && cur.chords.length > 2) runs.push(cur);
        cur = {mode, chords: []};
        continue;
      }
      if (/:$/.test(tokRaw)) continue;

      const c = parseNumeral(tokRaw);
      const t = token(c);
      if (!t || !cur) continue;
      if (cur.chords[cur.chords.length - 1] === t) continue;   // 同一個和弦連續出現只算一次
      cur.chords.push(t);
    }
  }
  if (cur && cur.chords.length > 2) runs.push(cur);
  return runs;
}

/* ---------- 3. 累計統計 ---------- */

function tally(runs){
  const stat = {
    major: {uni:{}, bi:{}, tri:{}, start:{}, cadence:{}},
    minor: {uni:{}, bi:{}, tri:{}, start:{}, cadence:{}}
  };
  const inc = (o, k) => { o[k] = (o[k] || 0) + 1; };

  for (const run of runs){
    const s = stat[run.mode];
    const ch = run.chords;
    inc(s.start, ch[0]);
    for (let i = 0; i < ch.length; i++){
      inc(s.uni, ch[i]);
      if (i + 1 < ch.length) inc(s.bi, ch[i] + ">" + ch[i+1]);
      if (i + 2 < ch.length) inc(s.tri, ch[i] + ">" + ch[i+1] + ">" + ch[i+2]);
    }
    // 收尾兩個和弦 = 終止式
    if (ch.length >= 2) inc(s.cadence, ch[ch.length-2] + ">" + ch[ch.length-1]);
  }
  return stat;
}

/* 砍掉長尾：只留出現次數夠多的，檔案才不會肥 */
function prune(map, min){
  const out = {};
  for (const k of Object.keys(map)) if (map[k] >= min) out[k] = map[k];
  return out;
}

/* ---------- 4. 執行 ---------- */

console.log("取得檔案清單…");
const paths = await listAnalyses();
console.log(`找到 ${paths.length} 個分析檔，開始下載（只在記憶體中處理，不落地）`);

const files = await fetchAll(paths, (d, t) => console.log(`  ${d}/${t}`));
console.log(`下載完成 ${files.length} 檔`);

let runs = [];
let composers = {};
for (const f of files){
  const r = parseFile(f.text);
  runs = runs.concat(r);
  const who = f.path.split("/").slice(1, 3).join(" / ");
  composers[who] = (composers[who] || 0) + r.length;
}

const stat = tally(runs);
for (const mode of ["major", "minor"]){
  stat[mode].uni = prune(stat[mode].uni, 12);
  stat[mode].bi = prune(stat[mode].bi, 8);
  stat[mode].tri = prune(stat[mode].tri, 6);
  stat[mode].start = prune(stat[mode].start, 4);
  stat[mode].cadence = prune(stat[mode].cadence, 4);
}

const meta = {
  source: "When-in-Rome (github.com/MarkGotham/When-in-Rome), 分析部分 CC BY-SA 4.0",
  builtAt: new Date().toISOString().slice(0, 10),
  files: files.length,
  runs: runs.length,
  chords: runs.reduce((a, r) => a + r.chords.length, 0)
};

fs.mkdirSync(path.join(ROOT, "js/data"), {recursive:true});
fs.writeFileSync(path.join(ROOT, "js/data/harmony-stats.js"),
`/* 自動產生，請勿手改。重新產生：node tools/build-harmony-stats.mjs
   來源：${meta.source}
   建立於 ${meta.builtAt}｜${meta.files} 個分析檔、${meta.runs} 個調性段落、${meta.chords} 個和弦
   本檔只含出現頻率統計，不含任何原始分析內容。 */

export const HARMONY_META = ${JSON.stringify(meta)};

export const HARMONY_STATS = ${JSON.stringify(stat)};
`);

console.log("\n=== 統計摘要 ===");
console.log(`調性段落 ${meta.runs}｜和弦 ${meta.chords}`);
for (const mode of ["major", "minor"]){
  const s = stat[mode];
  console.log(`\n[${mode}] 保留 ${Object.keys(s.uni).length} 種和弦 / ${Object.keys(s.bi).length} 種接續 / ${Object.keys(s.tri).length} 種三連`);
  const top = (m, n) => Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,n).map(([k,v])=>`${k}(${v})`).join("  ");
  console.log("  最常見和弦:", top(s.uni, 12));
  console.log("  最常見接續:", top(s.bi, 10));
  console.log("  最常見終止:", top(s.cadence, 6));
}
console.log("\n輸出 → js/data/harmony-stats.js",
            Math.round(fs.statSync(path.join(ROOT, "js/data/harmony-stats.js")).size / 1024) + " KB");
