/* UI 綁定與應用狀態。 */

import { loadVexFlow } from "./render/vexloader.js";
import { drawExercise, drawChordDrill } from "./render/score.js";
import { Audio } from "./audio/sound.js";
import { Metro } from "./audio/metro.js";
import { LEVELS, KEY_POOLS, HAND_MODES, availablePatterns, LH_PATTERNS } from "./gen/exercise.js";
import { PROGRESSIONS, generateChordDrill, progressionCategories,
         VOICINGS, COMP_PATTERNS, compPatterns } from "./gen/chordprog.js";
import { MAJOR_KEYS, MINOR_KEYS, ALL_KEYS, cycleOfFourths } from "./core/key.js";
import { Stream } from "./stream.js";
import { Library } from "./library.js";
import { generateExercise } from "./gen/exercise.js";

const $ = (id) => document.getElementById(id);

const state = {
  mode: "read",
  drill: null,
  plan: {events:[], total:0, layout:[]},   // 目前這一段的播放計畫
  revealed: false,
  hlEl: null,
  stream: null,
  /* 兩個實體列，用 CSS order 對調上下，換段時不重畫「已經畫好的那一段」 */
  rows: [],
  nowRow: 0,
  plans: [null, null],
  layouts: [null, null],
  cursorRaf: null,
  reviewIdx: -1,       // -1 = 正在練習；>=0 = 正在調閱第幾段存檔
  libId: null,         // 目前這一段在長期紀錄裡的 id
  practiceStart: 0     // 這一輪節拍器開始的時間，用來累計練習時數
};

/* ---------- 選單填充 ---------- */

function fillLevels(){
  const sel = $("lv");
  LEVELS.forEach((L, i) => {
    const o = document.createElement("option");
    o.value = String(i + 1);
    o.textContent = "第 " + L.n;
    sel.appendChild(o);
  });
  sel.value = "3";
}

function fillHands(){
  const sel = $("hands");
  HAND_MODES.forEach(h => {
    const o = document.createElement("option");
    o.value = h.id; o.textContent = h.label;
    sel.appendChild(o);
  });
  sel.value = "both";
}

/* 左手寫法要跟著難度與拍號變 —— 阿爾貝提在 3/4 沒有意義，
   平行齊奏在只有一隻手的時候也不成立 */
function refreshLhPatterns(){
  const sel = $("lhpat"), prev = sel.value;
  const level = parseInt($("lv").value, 10);
  const ts = $("ts").value;
  const hands = $("hands").value;
  sel.innerHTML = "";

  const auto = document.createElement("option");
  auto.value = ""; auto.textContent = "隨機（依難度）";
  sel.appendChild(auto);

  availablePatterns(level, ts).forEach(id => {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = LH_PATTERNS[id].label;
    sel.appendChild(o);
  });

  sel.disabled = (hands !== "both");
  sel.value = Array.from(sel.options).some(o => o.value === prev) ? prev : "";
}

function fillKeySelect(){
  const sel = $("keysel");
  sel.innerHTML = "";

  const gPool = document.createElement("optgroup");
  gPool.label = "出題範圍";
  KEY_POOLS.forEach(p => {
    const o = document.createElement("option");
    o.value = p.id; o.textContent = p.label;
    gPool.appendChild(o);
  });
  sel.appendChild(gPool);

  [["大調（15）", MAJOR_KEYS], ["小調（15）", MINOR_KEYS]].forEach(([label, keys]) => {
    const g = document.createElement("optgroup");
    g.label = label;
    keys.forEach(k => {
      const o = document.createElement("option");
      o.value = k.id;
      o.textContent = k.displayName + "（" + k.signatureLabel + "）";
      g.appendChild(o);
    });
    sel.appendChild(g);
  });

  sel.value = "level";
}

function fillProgressions(){
  const sel = $("prog");
  const cats = progressionCategories();
  Object.keys(cats).forEach(cat => {
    const g = document.createElement("optgroup");
    g.label = cat + "（" + cats[cat].length + "）";
    cats[cat].forEach(id => {
      const o = document.createElement("option");
      o.value = id; o.textContent = PROGRESSIONS[id].label;
      g.appendChild(o);
    });
    sel.appendChild(g);
  });

  const voi = $("voi");
  Object.keys(VOICINGS).forEach(id => {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = VOICINGS[id].label + (VOICINGS[id].hands === 2 ? " ✋✋" : "");
    voi.appendChild(o);
  });
  voi.value = "shell";

  refreshComping();
}

/* Comping 節奏只有 4/4 有完整的型；走路低音是獨立選項，會蓋掉 voicing 的右手 */
function refreshComping(){
  const sel = $("comp"), prev = sel.value;
  sel.innerHTML = "";
  compPatterns("4/4").forEach(id => {
    const o = document.createElement("option");
    o.value = id; o.textContent = COMP_PATTERNS[id].label;
    sel.appendChild(o);
  });
  const w = document.createElement("option");
  w.value = "walking"; w.textContent = "走路低音（雙手）✋✋";
  sel.appendChild(w);
  sel.value = Array.from(sel.options).some(o => o.value === prev) ? prev : "whole";
}

function refreshChordKeys(){
  const minor = !!PROGRESSIONS[$("prog").value].minor;
  const sel = $("kfixed"), prev = sel.value;
  sel.innerHTML = "";
  cycleOfFourths(minor ? "minor" : "major").forEach(k => {
    const o = document.createElement("option");
    o.value = k.id; o.textContent = k.displayName;
    sel.appendChild(o);
  });
  if (Array.from(sel.options).some(o => o.value === prev)) sel.value = prev;
}

/* ---------- 繪製 ---------- */

function highlight(gid){
  if (state.hlEl){ state.hlEl.classList.remove("vf-hl"); state.hlEl = null; }
  if (!gid) return;
  const el = document.getElementById(gid);
  if (el){ el.classList.add("vf-hl"); state.hlEl = el; }
}

function currentBpm(){
  return Math.max(30, Math.min(220, parseInt($("bpm").value, 10) || 60));
}

function drawOpts(){
  return {
    showNames: $("shownames").checked,
    showHarmony: $("showharm").checked,
    showChords: $("showchords").checked,
    zoom: parseInt($("zoom").value, 10) / 100
  };
}

function describe(ex){
  const parts = [
    LEVELS[ex.cfg.level - 1].n,
    ex.key.displayName + "（" + ex.key.signatureLabel + "）",
    ex.ts,
    (HAND_MODES.find(h => h.id === ex.hands) || {}).label
  ];
  if (ex.lhLabel) parts.push(ex.lhLabel);
  parts.push(ex.roman.join(" │ "), CADENCE_ZH[ex.cadence] || ex.cadence, "#" + ex.seed.toString(36));
  return parts.join(" · ");
}

const CADENCE_ZH = {authentic:"正格終止", half:"半終止", deceptive:"假終止", plagal:"變格終止"};

/* 把某一段畫到某一列，並記住它自己的播放計畫。
   換段時直接沿用，就不必重畫已經在螢幕上的譜。 */
function paintRow(rowIdx, ex, tag){
  const row = state.rows[rowIdx];
  row.querySelector(".rowtag").textContent = tag;
  const plan = drawExercise(row.querySelector(".score"), ex, drawOpts());
  state.plans[rowIdx] = plan;
  state.layouts[rowIdx] = plan.layout;
  return plan;
}

/* 依 nowRow 更新兩列的位置與明暗；連續流以外的模式只留一列 */
function syncRows(){
  const flow = $("flow").value;
  state.rows.forEach((row, i) => {
    const isNow = (i === state.nowRow);
    row.classList.toggle("is-now", isNow);
    row.classList.toggle("is-next", !isNow);
    row.classList.toggle("is-hidden", !isNow && flow !== "flow");
    if (!isNow) row.querySelector(".cursor").hidden = true;
  });
}

function renderRead(){
  const st = state.stream;
  const cur = st.current();
  state.plan = paintRow(state.nowRow, cur, "現在");
  if ($("flow").value === "flow" && st.next()){
    paintRow(1 - state.nowRow, st.next(), "下一段 · 眼睛先跑到這裡");
  }
  syncRows();
  $("sheetTitle").textContent = "視譜練習";
  $("sheetSub").textContent = describe(cur);
  $("answer").hidden = true;
  buildBeatStrip(cur.beats);
  renderReview();
}

/* 段落結束：下一列升上來（它已經畫好了），舊的那一列拿去畫新的下一段。
   不清空、不重畫正在看的譜，所以換段時畫面不會閃。 */
function advanceSegment(barsDone){
  const st = state.stream;
  st.advance(barsDone);
  if ($("flow").value === "flow"){
    state.nowRow = 1 - state.nowRow;
    state.rows[state.nowRow].querySelector(".rowtag").textContent = "現在";
    state.plan = state.plans[state.nowRow];          // 它畫好的時候就存起來了
    paintRow(1 - state.nowRow, st.next(), "下一段 · 眼睛先跑到這裡");
    syncRows();
    $("sheetSub").textContent = describe(st.current());
    renderReview();
  } else {
    renderRead();
  }
  logCurrent();
}

function renderChord(){
  const d = state.drill;
  // 和弦模式只用第一列，第二列收起來（同樣要先收版面再畫）
  state.nowRow = 0;
  state.rows[1].classList.add("is-hidden");
  state.rows[0].classList.add("is-now");
  state.rows[0].classList.remove("is-next");
  state.rows[0].querySelector(".cursor").hidden = true;
  state.rows[0].querySelector(".rowtag").textContent = "";
  $("review").hidden = true;
  state.plan = drawChordDrill(state.rows[0].querySelector(".score"), d, {
    revealed: state.revealed,
    showNoteNames: $("shownotes").checked,
    zoom: parseInt($("zoom").value, 10) / 100
  });
  state.plans[0] = state.plan;
  $("sheetTitle").textContent = "爵士和弦練習";
  $("sheetSub").textContent = [
    d.label,
    VOICINGS[d.cfg.style] ? VOICINGS[d.cfg.style].label : d.cfg.style,
    d.cfg.comp === "walking" ? "走路低音" : (COMP_PATTERNS[d.cfg.comp] || {}).label,
    d.grand ? "雙手" : "左手",
    d.systems.map(s => s.tonic.shortName).join(" → "),
    "#" + d.seed.toString(36)
  ].filter(Boolean).join(" · ");
  renderAnswerBox();
  buildBeatStrip(4);
}

/* ---------- 本次練習的段落存檔 ---------- */

const CAD_SHORT = {authentic:"正格", half:"半終止", deceptive:"假終止", plagal:"變格"};

function renderReview(){
  const box = $("review");
  if (state.mode !== "read" || !state.stream){ box.hidden = true; return; }
  const hist = state.stream.history;
  box.hidden = hist.length === 0;
  $("revcount").textContent = String(hist.length);
  // -1 才是「正在練習」；-2 是從長期複習清單調閱來的，一樣要能回去
  $("revback").hidden = (state.reviewIdx === -1);

  const list = $("revlist");
  list.innerHTML = "";
  hist.forEach((h, i) => {
    const b = document.createElement("button");
    b.className = "revchip" + (i === hist.length - 1 && state.reviewIdx < 0 ? " is-live" : "");
    b.setAttribute("aria-pressed", state.reviewIdx === i ? "true" : "false");
    b.innerHTML = '<span class="n">' + (i + 1) + '</span><span class="k">' + h.key + "</span><br>" +
                  h.roman + " · " + (CAD_SHORT[h.cadence] || h.cadence);
    b.addEventListener("click", () => openReview(i));
    list.appendChild(b);
  });
}

/* 調閱一段存檔。這是回顧不是練習，所以節拍器停下來 ——
   讓它繼續跑的話，游標會指在一段你已經不在彈的譜上。 */
function openReview(i){
  const ex = state.stream.recall(i);
  if (!ex) return;
  if (Metro.on) toggleMetro();
  Audio.stop(); highlight(null); setPlayLabel(false);
  state.reviewIdx = i;
  // 版面先收好再畫譜 —— 反過來的話，第一次是在「兩列都在」的寬度下排版，
  // 第二次是在「已收起一列」的寬度下排版，同一段會排出不同的音符間距
  state.rows[1 - state.nowRow].classList.add("is-hidden");
  state.rows[state.nowRow].classList.add("is-now");
  state.rows[state.nowRow].classList.remove("is-next");
  state.rows[state.nowRow].querySelector(".cursor").hidden = true;
  $("stage").classList.add("reviewing");
  state.plan = paintRow(state.nowRow, ex, "回顧 · 第 " + (i + 1) + " 段");
  $("sheetSub").textContent = describe(ex);
  renderReview();
}

function exitReview(){
  state.reviewIdx = -1;
  $("stage").classList.remove("reviewing");
  const ex = state.stream.current();
  state.libId = ex ? Library.idOf(ex.usedCfg) : null;   // 認回原本那段，但不算又練一次
  renderRead();
  syncMarkButton();
}

/* ---------- 長期練習紀錄 ---------- */

/* 把目前這一段記進長期紀錄。只在「換了一段新的」時候呼叫，
   重畫（縮放、開關抽屜）不算又練了一次。 */
function logCurrent(){
  const ex = state.stream && state.stream.current();
  if (!ex) return;
  const e = Library.log(ex);
  state.libId = e ? e.id : null;
  syncMarkButton();
  renderLibrary();
}

function syncMarkButton(){
  const e = state.libId ? Library.get(state.libId) : null;
  const btn = $("markbad");
  const on = !!(e && e.marked);
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.textContent = on ? "✓ 已標記" : "✗ 這段沒彈好";
}

function toggleMark(){
  if (!state.libId) return;
  Library.toggleMark(state.libId);
  syncMarkButton();
  renderLibrary();
}

function renderLibrary(){
  const s = Library.stats();
  const untouched = Library.untouched(ALL_KEYS);

  let html = '<div class="big">' +
    '<div><b>' + s.segments + '</b><span>練過段數</span></div>' +
    '<div><b>' + s.minutes + '</b><span>累計分鐘</span></div>' +
    '<div><b>' + s.marked + '</b><span>待複習</span></div>' +
    '<div><b>' + (30 - untouched.length) + '/30</b><span>碰過的調</span></div>' +
    "</div>";

  if (s.weak.length){
    html += '<div class="line">最常卡住：' +
      s.weak.map(w => '<span class="tag">' + w.name + "</span>（" +
                      Math.round(w.rate * 100) + "%）").join("、") + "</div>";
  }
  if (untouched.length){
    const show = untouched.slice(0, 6).map(k => k.shortName).join(" ");
    html += '<div class="line">還沒碰過：<span class="ok">' + show +
            (untouched.length > 6 ? " …共 " + untouched.length + " 個" : "") + "</span></div>";
  } else if (s.unique){
    html += '<div class="line"><span class="ok">30 個調都練過了。</span></div>';
  }
  if (!Library.available){
    html += '<div class="line">這個瀏覽器不給用 localStorage，紀錄只會留在這次開啟期間。</div>';
  }
  $("stats").innerHTML = html;

  const list = Library.marked();
  $("markcount").textContent = String(list.length);
  const box = $("marklist");
  box.innerHTML = "";
  list.forEach(e => {
    const b = document.createElement("button");
    b.className = "revchip";
    b.innerHTML = '<span class="k">' + e.keyName + "</span> " +
                  '<span class="n">lv' + e.level + "</span><br>" + e.roman;
    b.addEventListener("click", () => openLibraryEntry(e));
    box.appendChild(b);
  });
}

/* 從複習清單調閱一段。跟本次存檔的調閱走同一條路。 */
function openLibraryEntry(entry){
  const ex = generateExercise(Object.assign({}, entry.cfg));
  ex.usedCfg = entry.cfg;
  if (Metro.on) toggleMetro();
  Audio.stop(); highlight(null); setPlayLabel(false);
  state.reviewIdx = -2;                       // -2 = 從長期紀錄調閱
  state.libId = entry.id;
  state.rows[1 - state.nowRow].classList.add("is-hidden");
  state.rows[state.nowRow].classList.add("is-now");
  state.rows[state.nowRow].classList.remove("is-next");
  state.rows[state.nowRow].querySelector(".cursor").hidden = true;
  $("stage").classList.add("reviewing");
  state.plan = paintRow(state.nowRow, ex, "複習清單 · " + entry.keyName);
  $("sheetSub").textContent = describe(ex);
  $("revback").hidden = false;
  $("review").hidden = false;
  syncMarkButton();
  setDrawer(false);
}

/* ---------- 拼頁列印 ---------- */

function printSheet(){
  const list = Library.marked();
  const items = list.length ? list : Library.recent(8);
  if (!items.length) return;

  const out = $("sheetout");
  out.hidden = false;
  out.innerHTML = '<h2>譜台 · 練習單</h2><div class="meta">' +
    new Date().toLocaleDateString("zh-TW") + " · " +
    (list.length ? "複習清單 " + items.length + " 段" : "最近 " + items.length + " 段") +
    "</div>";

  items.slice(0, 12).forEach((e, i) => {
    const ex = generateExercise(Object.assign({}, e.cfg));
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = '<div class="cap">' + (i + 1) + ". " + e.keyName +
                    " · lv" + e.level + " · " + e.ts + " · " + e.roman + "</div>" +
                    '<div class="sc"></div>';
    out.appendChild(div);
    // 列印用固定寬度，不受目前視窗大小影響
    const host = div.querySelector(".sc");
    host.style.width = "700px";
    drawExercise(host, ex, {showNames:false, showHarmony:true, zoom:1, perLine: ex.cfg.bars >= 8 ? 4 : 2});
  });

  document.body.classList.add("printing");
  const done = () => {
    document.body.classList.remove("printing");
    out.hidden = true;
    out.innerHTML = "";
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
  // Safari 不一定會發 afterprint，補一個保險
  setTimeout(() => { if (document.body.classList.contains("printing")) done(); }, 3000);
}

/* ---------- 進行中游標 ---------- */

/* 游標吃的是 AudioContext 的硬體時鐘（Metro.position()），不是 setTimeout。
   requestAnimationFrame 只負責把畫面補平順 —— 分頁不可見時 rAF 會被停掉，
   所以節拍器每一拍也主動推一次，游標不會整個凍住。 */
function updateCursor(posOverride){
  const row = state.rows[state.nowRow];
  if (!row) return;
  const el = row.querySelector(".cursor");
  const ex = state.stream && state.stream.current();
  const live = (posOverride !== undefined) || Metro.on;

  if (!live || state.mode !== "read" || !ex){ el.hidden = true; return; }

  const pos = (posOverride !== undefined) ? posOverride : Metro.position();
  if (pos < 0){ el.hidden = true; return; }        // 預備拍期間不顯示

  const bar = state.stream.barInSegment(pos, ex.beats);
  const layout = state.layouts[state.nowRow];
  if (!layout || bar < 0 || bar >= layout.length){ el.hidden = true; return; }

  const L = layout[bar];
  const svg = row.querySelector(".score svg");
  if (!svg){ el.hidden = true; return; }
  // 版面座標是「邏輯單位」（譜面縮放前），還要再乘上 SVG 被 CSS 壓縮的比例
  const lw = (state.plans[state.nowRow] && state.plans[state.nowRow].lw) || svg.width.baseVal.value || 1;
  const scale = svg.getBoundingClientRect().width / lw;
  const top = row.querySelector(".score").offsetTop;

  el.hidden = false;
  el.style.left   = (L.x * scale) + "px";
  el.style.width  = (L.w * scale) + "px";
  el.style.top    = (top + L.y * scale) + "px";
  el.style.height = (Math.max(40, L.h) * scale) + "px";
}

function cursorLoop(){
  state.cursorRaf = requestAnimationFrame(cursorLoop);
  updateCursor();
}

function startCursor(){ if (!state.cursorRaf) cursorLoop(); }
function stopCursor(){
  if (state.cursorRaf) cancelAnimationFrame(state.cursorRaf);
  state.cursorRaf = null;
  state.rows.forEach(r => { r.querySelector(".cursor").hidden = true; });
}

function renderAnswerBox(){
  const box = $("answer");
  if (state.mode !== "chord" || !state.revealed){ box.hidden = true; return; }
  box.innerHTML = state.drill.systems.map(s =>
    '<div><span class="dim">' + s.tonic.shortName + '&nbsp;&nbsp;</span>' +
    s.measures.map(m => "<b>" + m.label + "</b> " + m.names)
              .join('<span class="dim">&nbsp; │ &nbsp;</span>') +
    "</div>"
  ).join("");
  box.hidden = false;
}

function redraw(){
  if (state.mode === "read" && state.stream && state.stream.current()) renderRead();
  else if (state.mode === "chord" && state.drill) renderChord();
}

/* ---------- 出題 ---------- */

function readCfg(){
  return {
    level: parseInt($("lv").value, 10),
    keyPool: $("keysel").value,
    ts: $("ts").value,
    hands: $("hands").value,
    lhPattern: $("lhpat").value || null,
    bars: parseInt($("bars").value, 10),
    step: state.step
  };
}

function generate(opts){
  const o = opts || {};
  Audio.stop();
  highlight(null);
  setPlayLabel(false);
  state.revealed = $("revealed").checked;
  state.reviewIdx = -1;
  $("stage").classList.remove("reviewing");

  if (state.mode === "read"){
    if (o.sameSeed) state.stream.replay();
    else if (o.fresh) state.stream.reset();
    else state.stream.regenerate();
    // 手動換題等於把節拍器的段落起點對到現在
    state.stream.segStartBar = Metro.on ? Metro.barsDone : 0;
    renderRead();
    logCurrent();
  } else {
    const drill = {
      prog: $("prog").value,
      order: $("korder").value,
      fixed: $("kfixed").value,
      count: parseInt($("ncyc").value, 10),
      style: $("voi").value,
      comp: $("comp").value,
      ts: "4/4",
      seed: (o.sameSeed && state.drill) ? state.drill.seed : undefined
    };
    state.drill = generateChordDrill(drill);
    renderChord();
  }
  updateRevealButton();
}

function updateRevealButton(){
  const btn = $("reveal");
  if (state.mode === "read"){
    const on = $("showchords").checked;
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.textContent = on ? "藏和弦代號" : "看和弦代號";
  } else {
    btn.setAttribute("aria-pressed", state.revealed ? "true" : "false");
    btn.textContent = state.revealed ? "藏答案" : "看答案";
  }
}

function toggleReveal(){
  if (state.mode === "read"){
    $("showchords").checked = !$("showchords").checked;
    redraw();
  } else {
    state.revealed = !state.revealed;
    $("revealed").checked = state.revealed;
    renderChord();
  }
  updateRevealButton();
}

function setMode(m){
  state.mode = m;
  $("mode-read").setAttribute("aria-pressed", m === "read" ? "true" : "false");
  $("mode-chord").setAttribute("aria-pressed", m === "chord" ? "true" : "false");
  $("panel-read").hidden = (m !== "read");
  $("panel-chord").hidden = (m !== "chord");
  generate();
}

/* ---------- 播放 ---------- */

function setPlayLabel(on){
  $("play").textContent = on ? "停止播放" : "播放解答音";
  $("play").setAttribute("aria-pressed", on ? "true" : "false");
}

function togglePlay(){
  if (Audio.playing){
    Audio.stop(); highlight(null); setPlayLabel(false);
    return;
  }
  const ok = Audio.play(state.plan, currentBpm(), highlight, () => setPlayLabel(false));
  if (!ok){ $("clipmeta").textContent = "沒有可播放的內容"; return; }
  setPlayLabel(true);
}

/* ---------- 節拍器 ---------- */

function buildBeatStrip(n){
  const s = $("beatstrip");
  if (s.children.length === n) return;
  s.innerHTML = "";
  for (let i = 0; i < n; i++){
    const d = document.createElement("div");
    d.className = "beatcell" + (i === 0 ? " accent" : "");
    d.setAttribute("data-n", String(i + 1));
    s.appendChild(d);
  }
}

Metro.onBeat = (i, counting) => {
  const cells = $("beatstrip").children;
  for (let k = 0; k < cells.length; k++) cells[k].classList.remove("on");
  if (cells[i]) cells[i].classList.add("on");
  $("clipmeta").textContent = counting ? "預備" : "進行中";
  updateCursor();          // rAF 被節流時，靠這裡把游標推下去
};

Metro.onBar = (barsDone) => {
  $("barcount").textContent = String(barsDone);
  if (state.mode !== "read" || !state.stream) return;
  if ($("flow").value === "manual" || state.reviewIdx !== -1) return;
  const cur = state.stream.current();
  if (!cur) return;
  // 彈滿一整段才換 —— 舊版在最後一小節的第一拍就換，等於少給一小節
  if (barsDone - state.stream.segStartBar >= cur.cfg.bars){
    Audio.stop(); highlight(null); setPlayLabel(false);
    advanceSegment(barsDone);
  }
};

function toggleMetro(){
  if (Metro.on){
    Metro.stop();
    stopCursor();
    Wake.release();
    if (state.practiceStart){
      Library.addSeconds((Date.now() - state.practiceStart) / 1000);
      state.practiceStart = 0;
      renderLibrary();
    }
    $("metro").setAttribute("aria-pressed", "false");
    $("metro").textContent = "開始";
    $("clipmeta").textContent = "停止";
    const cells = $("beatstrip").children;
    for (let k = 0; k < cells.length; k++) cells[k].classList.remove("on");
    return;
  }
  const cur = state.mode === "read" && state.stream ? state.stream.current() : null;
  const beats = cur ? cur.beats : 4;
  buildBeatStrip(beats);
  $("barcount").textContent = "0";
  if (state.stream) state.stream.segStartBar = 0;
  if (!Metro.start(currentBpm(), beats, $("countin").checked ? 1 : 0)){
    $("clipmeta").textContent = "此瀏覽器不支援音訊";
    return;
  }
  startCursor();
  $("metro").setAttribute("aria-pressed", "true");
  $("metro").textContent = "停止";
  $("clipmeta").textContent = "預備";
  Wake.request();
  state.practiceStart = Date.now();
}

/* ---------- iPad：抽屜、手勢、螢幕常亮、音訊解鎖 ---------- */

function setDrawer(open){
  document.body.classList.toggle("drawer-open", open);
  $("menu").setAttribute("aria-expanded", open ? "true" : "false");
  // 抽屜開合會改變譜面容器寬度，重畫才不會排版錯位
  clearTimeout(setDrawer._t);
  setDrawer._t = setTimeout(redraw, 260);
}
function toggleDrawer(){ setDrawer(!document.body.classList.contains("drawer-open")); }

/* iOS 的 WebAudio 只能在使用者手勢裡建立。這裡在第一次觸碰/點擊時
   把 AudioContext 叫起來，之後按開始才不會第一拍是啞的。 */
function installAudioUnlock(){
  const once = () => {
    Audio.ctx();
    window.removeEventListener("pointerdown", once);
    window.removeEventListener("keydown", once);
  };
  window.addEventListener("pointerdown", once, {passive:true});
  window.addEventListener("keydown", once);
}

/* 練習時不要讓螢幕自己暗掉。iOS 16.4+ 支援 Wake Lock；
   分頁切回來時要重新取得，因為系統會在背景時自動釋放。 */
const Wake = {
  lock: null,
  async request(){
    if (!navigator.wakeLock || !$("keepawake").checked) return;
    try { this.lock = await navigator.wakeLock.request("screen"); }
    catch (e) { this.lock = null; }
  },
  async release(){
    try { if (this.lock) await this.lock.release(); } catch (e) {}
    this.lock = null;
  }
};
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && Metro.on) Wake.request();
});

/* 手勢：左滑換下一題、右滑開設定抽屜、點譜面播放。
   只認水平且夠長的滑動，免得跟上下捲動打架。 */
function installGestures(){
  let x0 = 0, y0 = 0, t0 = 0, tracking = false;
  const desk = $("desk");

  desk.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) { tracking = false; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
    t0 = Date.now(); tracking = true;
  }, {passive:true});

  desk.addEventListener("touchend", (e) => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - x0, dy = t.clientY - y0, dt = Date.now() - t0;
    if (dt > 700) return;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.8) return;
    if (dx < 0) generate();
    else setDrawer(true);
  }, {passive:true});

  // 點譜面播放／停止（但別把點存檔籤也算進去）
  $("stage").addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    togglePlay();
  });
}

/* ---------- 事件 ---------- */

function bind(){
  $("menu").addEventListener("click", toggleDrawer);
  $("scrim").addEventListener("click", () => setDrawer(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setDrawer(false); });

  $("zoom").addEventListener("input", function(){
    $("zoomread").textContent = this.value + "%";
    redraw();
  });
  $("keepawake").addEventListener("change", function(){
    if (this.checked && Metro.on) Wake.request(); else Wake.release();
  });
  $("mode-read").addEventListener("click", () => setMode("read"));
  $("mode-chord").addEventListener("click", () => setMode("chord"));
  $("gen").addEventListener("click", () => generate());
  $("reveal").addEventListener("click", toggleReveal);
  $("print").addEventListener("click", () => window.print());
  $("play").addEventListener("click", togglePlay);
  $("metro").addEventListener("click", toggleMetro);

  // 出題設定變了，整條佇列都要重來（下一段是用舊設定生的）
  ["lv", "ts", "hands"].forEach(id =>
    $(id).addEventListener("change", () => { refreshLhPatterns(); generate({fresh:true}); }));
  ["keysel", "bars", "lhpat"].forEach(id =>
    $(id).addEventListener("change", () => generate({fresh:true})));
  $("flow").addEventListener("change", () => { generate({fresh:true}); });
  ["shownames", "showharm", "showchords"].forEach(id =>
    $(id).addEventListener("change", () => { redraw(); updateRevealButton(); }));

  $("prog").addEventListener("change", () => { refreshChordKeys(); generate(); });
  ["korder", "kfixed", "ncyc", "voi", "comp"].forEach(id =>
    $(id).addEventListener("change", () => generate()));
  $("swing").addEventListener("input", function(){
    const v = parseInt(this.value, 10) / 100;
    Audio.swing = v;
    $("swingread").textContent = v <= 0.5 ? "平均八分"
      : (v >= 0.66 ? "重 swing" : "swing " + Math.round(v * 100) + ":" + Math.round((1 - v) * 100));
  });
  $("shownotes").addEventListener("change", redraw);
  $("revealed").addEventListener("change", () => { state.revealed = $("revealed").checked; redraw(); updateRevealButton(); });

  $("bpm").addEventListener("input", function(){
    const v = Math.max(30, Math.min(220, parseInt(this.value, 10) || 60));
    $("bpmread").textContent = String(v);
    if (Metro.on) Metro.bpm = v;
  });

  $("vol").addEventListener("input", function(){
    const v = Math.max(0, Math.min(100, parseInt(this.value, 10) || 0));
    $("volread").textContent = String(v);
    Metro.volume = v / 100;
    if (v > 0 && $("mute").checked){ $("mute").checked = false; Metro.muted = false; }
  });
  $("mute").addEventListener("change", function(){ Metro.muted = this.checked; });

  $("revback").addEventListener("click", exitReview);
  $("markbad").addEventListener("click", toggleMark);
  $("printsheet").addEventListener("click", printSheet);
  $("clearlib").addEventListener("click", () => {
    if (!confirm("清除全部長期練習紀錄？包含複習清單與累計時數。")) return;
    Library.clear();
    state.libId = null;
    renderLibrary();
    syncMarkButton();
  });

  // 練到一半關掉分頁，時數也要算進去
  window.addEventListener("pagehide", () => {
    if (state.practiceStart){
      Library.addSeconds((Date.now() - state.practiceStart) / 1000);
      state.practiceStart = 0;
    }
  });

  document.addEventListener("keydown", (e) => {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === "n"){ e.preventDefault(); generate(); }
    else if (k === "r"){ e.preventDefault(); generate({sameSeed:true}); }
    else if (k === "x"){ e.preventDefault(); toggleMark(); }
    else if (k === "s"){ e.preventDefault(); toggleReveal(); }
    else if (k === "m"){ e.preventDefault(); toggleMetro(); }
    else if (k === "p"){ e.preventDefault(); togglePlay(); }
    else if (e.key === "ArrowUp" || e.key === "ArrowDown"){
      e.preventDefault();
      const d = e.key === "ArrowUp" ? 1 : -1;
      const v = Math.max(30, Math.min(220, (parseInt($("bpm").value, 10) || 60) + d * (e.shiftKey ? 5 : 1)));
      $("bpm").value = v;
      $("bpmread").textContent = String(v);
      if (Metro.on) Metro.bpm = v;
    }
  });

  let rz = null;
  window.addEventListener("resize", () => {
    clearTimeout(rz);
    rz = setTimeout(redraw, 180);
  });
}

/* ---------- 起手 ---------- */

/* 註冊 Service Worker：加到主畫面之後就算完全沒網路也開得起來。
   file:// 開啟時沒有 SW，靜靜跳過即可。 */
function registerServiceWorker(){
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

async function boot(){
  state.rows = [$("rowA"), $("rowB")];
  state.stream = new Stream(readCfg);
  Library.load();
  fillLevels();
  fillHands();
  fillKeySelect();
  refreshLhPatterns();
  fillProgressions();
  refreshChordKeys();
  $("bpmread").textContent = $("bpm").value;
  $("volread").textContent = $("vol").value;
  $("zoomread").textContent = $("zoom").value + "%";
  Metro.volume = parseInt($("vol").value, 10) / 100;
  Metro.muted = $("mute").checked;
  bind();
  installAudioUnlock();
  installGestures();
  registerServiceWorker();
  renderLibrary();

  try {
    await loadVexFlow();
  } catch (e){
    $("errbox").innerHTML =
      '<div class="err">樂譜繪圖函式庫 VexFlow 沒有載入。這個檔案需要連上網路才能畫五線譜。' +
      '確認網路後重新整理；若你的環境擋掉 <code>cdnjs.cloudflare.com</code>，請把該網域加入白名單。</div>';
    return;
  }

  try {
    generate({fresh:true});
  } catch (e){
    console.error(e);
    $("errbox").innerHTML = '<div class="err">出題失敗：<code>' + (e && e.message ? e.message : e) + '</code></div>';
  }
}

boot();
