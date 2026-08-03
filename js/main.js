/* UI 綁定與應用狀態。 */

import { loadVexFlow } from "./render/vexloader.js";
import { drawExercise, drawChordDrill } from "./render/score.js";
import { Audio } from "./audio/sound.js";
import { Metro } from "./audio/metro.js";
import { LEVELS, KEY_POOLS, HAND_MODES, HAND_SWAP, NOTE_DENSITY, FOCUS, INVERSIONS,
         availablePatterns, LH_PATTERNS } from "./gen/exercise.js";
import { PROGRESSIONS, generateChordDrill, progressionCategories,
         VOICINGS, compPatterns, compLabel } from "./gen/chordprog.js";
import { MAJOR_KEYS, MINOR_KEYS, ALL_KEYS, cycleOfFourths } from "./core/key.js";
import { Stream } from "./stream.js";
import { Library } from "./library.js";
import { generateExercise } from "./gen/exercise.js";
import { analyzeVerticalIntervals } from "./interval-coach.js";

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
  practiceStart: 0,    // 這一輪節拍器開始的時間，用來累計練習時數
  playAlongCycle: 0,   // 和弦模式跟播到第幾輪
  loopCount: 0,        // 重複同一段時已經彈完第幾遍
  training: {
    mode: "free",
    skeletonStep: 0,
    manualBeat: 0,
    intervalReveal: false,
    intervalAnswered: false,
    savedFlow: null,
    run: {stops:0, leftDrops:0, omissions:0}
  }
};

const TRAINING = {
  free: {
    title:"自由視奏",
    mini:"保留目前設定，正常產生視譜題。"
  },
  slice: {
    title:"垂直切片",
    mini:"橘色框一次只圈一拍；不要讀完整右手才回頭找左手。",
    cue:"每一拍先確認左手地標，再把右手形狀一起收入。"
  },
  interval: {
    title:"垂直音程",
    mini:"每拍一音；先說出左右手各自的方向與音程，再判斷同向或反向。",
    cue:"先看形狀作答，不要逐顆翻譯音名；按揭曉才核對。"
  },
  skeleton: {
    title:"骨架三層",
    mini:"先保留完整左手、淡化右手資訊，再逐層恢復原譜。",
    cue:"左手先維持時間軸；右手從每小節一音，逐步加回。"
  },
  ahead: {
    title:"一拍超前",
    mini:"橘框是手正在彈的拍，藍框是眼睛應該看的下一拍。",
    cue:"手留在橘框，眼睛移到藍框；只練領先一拍。"
  },
  flow: {
    title:"不中斷挑戰",
    mini:"手動完成一段後自評停頓、左手掉拍與省略音。",
    cue:"錯音不回頭；左手失聯時守住低音，或在下一個強拍再加入。"
  },
  leftmap: {
    title:"左手定位",
    mini:"產生低密度低音譜表題，眼睛留在譜上、左手直接找鍵。",
    cue:"從地標音與黑鍵群定位，不要每顆音都先翻成音名。"
  }
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

function fillDensity(){
  const sel = $("dens");
  NOTE_DENSITY.forEach(d => {
    const o = document.createElement("option");
    o.value = d.id; o.textContent = d.label;
    sel.appendChild(o);
  });
  sel.value = "auto";
}

function fillFocus(){
  const sel = $("focus");
  FOCUS.forEach(f => {
    const o = document.createElement("option");
    o.value = f.id; o.textContent = f.label;
    sel.appendChild(o);
  });
  sel.value = "none";
}

function fillInversions(){
  const sel = $("inv");
  INVERSIONS.forEach(v => {
    const o = document.createElement("option");
    o.value = v.id; o.textContent = v.label;
    sel.appendChild(o);
  });
  sel.value = "auto";
}

/* 伴奏寫法要跟著難度與拍號變 —— 阿爾貝提在 3/4 沒有意義，
   跟旋律齊奏在只有一隻手的時候也不成立。
   雙手的兩個方向都有伴奏那一隻手，所以 both 與 swap 都開放。 */
function refreshLhPatterns(){
  const sel = $("lhpat"), prev = sel.value;
  const level = parseInt($("lv").value, 10);
  const ts = $("ts").value;
  const hands = $("hands").value;
  sel.innerHTML = "";

  const auto = document.createElement("option");
  auto.value = ""; auto.textContent = "隨機（依難度）";
  sel.appendChild(auto);

  const ids = availablePatterns(level, ts);
  // 垂直音程是刻意的教練題：即使目前級數較低，也要能指定同向／反向聲部。
  if (state.training.mode === "interval"){
    ["parallel", "contrary"].forEach(id => { if (!ids.includes(id)) ids.push(id); });
  }
  ids.forEach(id => {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = LH_PATTERNS[id].label;
    sel.appendChild(o);
  });

  // 只有一隻手的時候根本沒有伴奏聲部，這兩欄就沒有意義
  const noAccomp = (hands !== "both" && hands !== "swap");
  sel.disabled = noAccomp;
  $("inv").disabled = noAccomp;
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
    o.value = id; o.textContent = compLabel(id);
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

/* 速度有三個顯示的地方（抽屜的滑桿、抽屜的數字、頂欄），但只能有一個真值。
   全部走這裡，拖滑桿、打數字、按上下鍵才不會各說各話。 */
function setBpm(v){
  const b = Math.max(30, Math.min(220, Math.round(v) || 60));
  $("bpm").value = String(b);
  $("tempo").value = String(b);
  $("temporead").textContent = String(b);
  $("bpmread").textContent = String(b);
  if (Metro.on) Metro.bpm = b;
  return b;
}

function isLoop(){ return state.mode === "read" && $("flow").value === "loop"; }

/* ---------- 讀譜教練 ---------- */

function trainingMode(){ return state.training.mode; }

function usesBeatSlices(){
  return state.mode === "read" && ["slice", "interval", "ahead", "flow"].includes(trainingMode());
}

function skeletonEventVisible(e){
  if (trainingMode() !== "skeleton" || !e || e.hand !== "right") return true;
  if (state.training.skeletonStep >= 2) return true;
  if (state.training.skeletonStep === 0) return Math.abs(e.beat) < 0.001;
  return Math.abs(e.beat - Math.round(e.beat)) < 0.001;
}

function applyTrainingPresentation(row, plan){
  if (!row || !plan || !plan.events) return;
  plan.events.forEach(e => {
    if (!e.gid) return;
    const el = document.getElementById(e.gid);
    if (!el) return;
    el.classList.remove("coach-muted", "coach-left-focus");
    if (trainingMode() === "skeleton"){
      if (e.hand === "left") el.classList.add("coach-left-focus");
      if (!skeletonEventVisible(e)) el.classList.add("coach-muted");
    } else if (trainingMode() === "leftmap" && e.hand === "left"){
      el.classList.add("coach-left-focus");
    }
  });
}

function currentPlaybackPlan(){
  const p = state.plan || {events:[], total:0, layout:[]};
  if (state.mode !== "read" || trainingMode() !== "skeleton") return p;
  return Object.assign({}, p, {events:p.events.filter(skeletonEventVisible)});
}

function coachButton(label, fn, opts){
  const b = document.createElement("button");
  b.type = "button";
  b.className = "coach-btn" + (opts && opts.primary ? " primary" : "") +
                (opts && opts.danger ? " danger" : "");
  b.textContent = label;
  if (opts && opts.pressed !== undefined) b.setAttribute("aria-pressed", opts.pressed ? "true" : "false");
  b.addEventListener("click", fn);
  $("coachactions").appendChild(b);
  return b;
}

function currentTrainingBeatCount(){
  const ex = state.stream && state.stream.current();
  return ex ? ex.cfg.bars * ex.beats : 0;
}

function manualTrainingPosition(){
  const ex = state.stream && state.stream.current();
  if (!ex) return 0;
  return state.stream.segStartBar * ex.beats + state.training.manualBeat + 0.001;
}

function moveTrainingBeat(delta){
  const total = currentTrainingBeatCount();
  if (!total) return;
  state.training.manualBeat = Math.max(0, Math.min(total - 1, state.training.manualBeat + delta));
  state.training.intervalReveal = false;
  state.training.intervalAnswered = false;
  renderCoach();
  if (!Metro.on) updateCursor(manualTrainingPosition());
}

function resetTrainingRun(){
  state.training.run = {stops:0, leftDrops:0, omissions:0};
}

function addTrainingIssue(name){
  if (state.training.run[name] === undefined) return;
  state.training.run[name]++;
  renderCoach();
}

function completeFlowRun(){
  if (Metro.on) toggleMetro();
  Library.recordCoach("flow", state.training.run);
  resetTrainingRun();
  generate();
}

function applyLeftMapPreset(){
  if (Metro.on) toggleMetro();
  $("lv").value = String(Math.min(2, parseInt($("lv").value, 10) || 2));
  $("hands").value = "lh";
  $("dens").value = "long";
  $("bars").value = "4";
  $("flow").value = "manual";
  $("shownames").checked = false;
  refreshLhPatterns();
  syncFlow();
  generate({fresh:true});
}

function applyIntervalPreset(kind){
  if (Metro.on) toggleMetro();
  const pattern = kind === "contrary" ? "contrary" : "parallel";
  $("lv").value = pattern === "parallel" ? "2" : "3";
  $("ts").value = "4/4";
  $("hands").value = "both";
  $("dens").value = "pulse";
  $("bars").value = "4";
  $("flow").value = "manual";
  $("focus").value = pattern === "contrary" ? "leap" : "none";
  $("shownames").checked = false;
  refreshLhPatterns();
  $("lhpat").value = pattern;
  syncFlow();
  state.training.manualBeat = 0;
  state.training.intervalReveal = false;
  state.training.intervalAnswered = false;
  generate({fresh:true});
}

function currentIntervalItem(){
  const ex = state.stream && state.stream.current();
  if (!ex || !state.plan) return null;
  return analyzeVerticalIntervals(state.plan, ex.beats, ex.cfg.bars)[state.training.manualBeat] || null;
}

function recordIntervalAnswer(correct){
  const item = currentIntervalItem();
  if (!item) return;
  Library.recordInterval(correct, item.relation);
  state.training.intervalAnswered = true;
  state.training.intervalReveal = false;
  if (correct) moveTrainingBeat(1);
  else renderCoach();
}

function renderCoach(){
  const mode = trainingMode();
  const spec = TRAINING[mode] || TRAINING.free;
  if ($("coachmini")) $("coachmini").textContent = spec.mini;

  // 模式切換會重用同一個列容器；上一模式留下的框必須主動清掉。
  state.rows.forEach(r => {
    const cur = r.querySelector(".cursor");
    const ahead = r.querySelector(".lookahead");
    if (ahead && mode !== "ahead") ahead.hidden = true;
    if (cur && !Metro.on && mode !== "slice" && mode !== "interval" && mode !== "ahead") cur.hidden = true;
  });

  const bar = $("coachbar");
  if (!bar) return;
  if (state.mode !== "read" || mode === "free" || state.reviewIdx !== -1){
    bar.hidden = true;
    state.rows.forEach(r => {
      const a = r.querySelector(".lookahead");
      if (a) a.hidden = true;
    });
    return;
  }

  bar.hidden = false;
  $("coachtitle").textContent = spec.title;
  $("coachcue").textContent = spec.cue;
  $("coachactions").innerHTML = "";
  const stat = $("coachstat");
  stat.textContent = "";
  stat.classList.remove("interval-answer", "is-revealed");

  if (mode === "slice" || mode === "ahead"){
    const total = currentTrainingBeatCount();
    stat.textContent = "第 " + (state.training.manualBeat + 1) + " / " + total + " 拍";
    coachButton("← 上一拍", () => moveTrainingBeat(-1));
    coachButton("下一拍 →", () => moveTrainingBeat(1), {primary:true});
    coachButton("回第一拍", () => {
      state.training.manualBeat = 0; renderCoach();
      if (!Metro.on) updateCursor(manualTrainingPosition());
    });
  } else if (mode === "interval"){
    const total = currentTrainingBeatCount();
    const item = currentIntervalItem();
    const past = Library.intervalStats();
    const accuracy = past.attempts ? Math.round(past.correct / past.attempts * 100) : 0;
    const pattern = $("lhpat").value;
    $("coachcue").textContent = "第 " + (state.training.manualBeat + 1) + " / " + total + " 拍・" +
      (pattern === "contrary" ? "反向題" : "同向三／六度題") +
      (past.attempts ? "・命中率 " + accuracy + "%（" + past.attempts + " 拍）" : "");
    stat.classList.add("interval-answer");
    if (state.training.intervalReveal && item){
      stat.textContent = item.answer;
      stat.classList.add("is-revealed");
    } else {
      stat.textContent = "先說：右手往哪裡、幾度？左手呢？兩手同向、反向、斜向，還是保持？";
    }

    coachButton("← 上一拍", () => moveTrainingBeat(-1));
    if (state.training.intervalReveal){
      coachButton("答對・下一拍", () => recordIntervalAnswer(true), {primary:true});
      coachButton("答錯・再看", () => recordIntervalAnswer(false), {danger:true});
    } else {
      coachButton("揭曉音程", () => { state.training.intervalReveal = true; renderCoach(); }, {primary:true});
      coachButton("跳過 →", () => moveTrainingBeat(1));
    }
    coachButton("同向題", () => applyIntervalPreset("parallel"), {pressed:pattern === "parallel"});
    coachButton("反向題", () => applyIntervalPreset("contrary"), {pressed:pattern === "contrary"});
  } else if (mode === "skeleton"){
    const names = ["左手完整＋右手每小節一音", "左手完整＋右手每拍骨架", "完整原譜"];
    stat.textContent = "目前：" + names[state.training.skeletonStep];
    names.forEach((n, i) => coachButton(String(i + 1) + " · " + n, () => {
      state.training.skeletonStep = i;
      redraw();
    }, {pressed:state.training.skeletonStep === i}));
  } else if (mode === "flow"){
    const r = state.training.run;
    const past = Library.coachStats("flow");
    const clean = past.attempts ? Math.round(past.clean / past.attempts * 100) : 0;
    stat.textContent = "本段：停 " + r.stops + "・左手掉 " + r.leftDrops + "・省略 " + r.omissions +
      (past.attempts ? "｜歷史不中斷率 " + clean + "%（" + past.attempts + " 段）" : "");
    coachButton("停頓 +1", () => addTrainingIssue("stops"), {danger:true});
    coachButton("左手掉拍 +1", () => addTrainingIssue("leftDrops"), {danger:true});
    coachButton("省略音 +1", () => addTrainingIssue("omissions"));
    coachButton("完成並換題", completeFlowRun, {primary:true});
  } else if (mode === "leftmap"){
    const ready = $("hands").value === "lh" && $("dens").value === "long";
    stat.textContent = ready ? "定位題已套用：低音譜表・長音・手動換題" : "尚未套用定位題設定";
    coachButton("套用左手定位題", applyLeftMapPreset, {primary:true});
    coachButton($("shownames").checked ? "藏音名" : "核對音名", () => {
      $("shownames").checked = !$("shownames").checked;
      redraw();
    });
    coachButton("換一題", () => generate());
  }
}

function setTrainingMode(mode){
  const next = TRAINING[mode] ? mode : "free";
  const prev = trainingMode();
  if (Metro.on) toggleMetro();

  if (prev === "flow" && next !== "flow" && state.training.savedFlow){
    $("flow").value = state.training.savedFlow;
    state.training.savedFlow = null;
    syncFlow();
  }
  if (next === "flow" && prev !== "flow"){
    state.training.savedFlow = $("flow").value;
    $("flow").value = "manual";
    syncFlow();
  }

  state.training.mode = next;
  state.training.manualBeat = 0;
  state.training.skeletonStep = 0;
  state.training.intervalReveal = false;
  state.training.intervalAnswered = false;
  resetTrainingRun();
  $("trainmode").value = next;
  if (next === "interval"){
    applyIntervalPreset("parallel");
    return;
  }
  redraw();
  renderCoach();
  if (!Metro.on && (next === "slice" || next === "interval" || next === "ahead")){
    updateCursor(manualTrainingPosition());
  }
}

/* 一列譜可以用多高。頁面本身不捲，所以這是硬上限 ——
   連續流要同時擺兩段，每一段就只有一半的高度。
   放大超過 100% 時使用者是刻意要看大的，這時不設限，改由譜面區自己捲。 */
function rowMaxHeight(){
  if (document.body.classList.contains("zoomed")) return 0;
  const h = $("stage").clientHeight;
  if (!h) return 0;
  const rows = (state.mode === "read" && $("flow").value === "flow") ? 2 : 1;
  // 每一列有 14px 的列標籤；第二列還多「列間距 + 1px 分隔線 + 8px 內距」。
  // 列間距在矮螢幕會被改小，所以是量出來的而不是寫死的
  const gap = parseFloat(getComputedStyle($("stage")).rowGap) || 10;
  const chrome = rows * 14 + (rows - 1) * (gap + 9);
  return Math.max(140, (h - chrome) / rows);
}

function drawOpts(){
  return {
    showNames: $("shownames").checked,
    showHarmony: $("showharm").checked,
    showChords: $("showchords").checked,
    repeat: isLoop(),
    maxHeight: rowMaxHeight(),
    zoom: parseInt($("zoom").value, 10) / 100
  };
}

/* 譜面標題下面那一行。設定愈加愈多，全部列出來就變成一條讀不完的字串 ——
   所以只列「這一題實際是什麼」，非預設的設定才額外標出來。 */
function describe(ex){
  const hand = (HAND_MODES.find(h => h.id === ex.hands) || {}).short || "";
  const opt = [];
  const dens = NOTE_DENSITY.find(d => d.id === ex.density);
  if (dens && dens.id !== "auto") opt.push(dens.label.split(" · ")[0]);
  const foc = FOCUS.find(f => f.id === ex.focus);
  if (foc && foc.id !== "none") opt.push("強化" + foc.label.split(" · ")[0]);
  if (ex.inversion === "first")  opt.push("第一轉位");
  if (ex.inversion === "second") opt.push("第二轉位");
  if (ex.inversion === "mix")    opt.push("隨機轉位");
  if (ex.inversion === "cycle")  opt.push("轉位輪替");

  return [
    ex.key.displayName + "（" + ex.key.signatureLabel + "）· " + ex.ts + " · 第 " + ex.cfg.level + " 級",
    hand + (ex.lhLabel ? "・" + ex.lhLabel : ""),
    opt.join("・"),
    ex.roman.join(" │ ") + " · " + (CADENCE_ZH[ex.cadence] || ex.cadence),
    "#" + ex.seed.toString(36)
  ].filter(Boolean).join("  ·  ");
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
  applyTrainingPresentation(row, plan);
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
    if (!isNow){
      row.querySelector(".cursor").hidden = true;
      row.querySelector(".lookahead").hidden = true;
    }
  });
}

function renderRead(){
  const st = state.stream;
  const cur = st.current();
  // 一定要先把版面定好再畫：還掛著 is-hidden 的那一列量到的寬度是 0，
  // 繪圖端就會退回寫死的 900px，畫出來的譜跟容器對不起來
  syncRows();
  state.plan = paintRow(state.nowRow, cur, "現在");
  if ($("flow").value === "flow" && st.next()){
    paintRow(1 - state.nowRow, st.next(), "下一段 · 眼睛先跑到這裡");
  }
  $("sheetTitle").textContent = "視譜練習";
  $("sheetSub").textContent = describe(cur);
  $("answer").hidden = true;
  buildBeatStrip(cur.beats);
  renderReview();
  renderCoach();
  if (!Metro.on && (trainingMode() === "slice" || trainingMode() === "interval" || trainingMode() === "ahead")){
    updateCursor(manualTrainingPosition());
  }
}

/* 段落結束：下一列升上來（它已經畫好了），舊的那一列拿去畫新的下一段。
   不清空、不重畫正在看的譜，所以換段時畫面不會閃。 */
function advanceSegment(barsDone){
  const st = state.stream;
  st.advance(barsDone);
  state.training.manualBeat = 0;
  state.training.intervalReveal = false;
  state.training.intervalAnswered = false;
  resetTrainingRun();
  if ($("flow").value === "flow"){
    state.nowRow = 1 - state.nowRow;
    state.rows[state.nowRow].querySelector(".rowtag").textContent = "現在";
    state.plan = state.plans[state.nowRow];          // 它畫好的時候就存起來了
    syncRows();                                      // 同樣先定版面再畫
    paintRow(1 - state.nowRow, st.next(), "下一段 · 眼睛先跑到這裡");
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
  state.layouts[0] = state.plan.layout;      // 游標要靠這個定位，忘了存就會卡在原點
  $("sheetTitle").textContent = "爵士和弦練習";
  $("sheetSub").textContent = [
    d.label,
    VOICINGS[d.cfg.style] ? VOICINGS[d.cfg.style].label : d.cfg.style,
    compLabel(d.cfg.comp),
    d.grand ? "雙手" : "左手",
    d.systems.map(s => s.tonic.shortName).join(" → "),
    "#" + d.seed.toString(36)
  ].filter(Boolean).join(" · ");
  renderAnswerBox();
  buildBeatStrip(4);
  renderCoach();
}

/* ---------- 本次練習的段落存檔 ---------- */

const CAD_SHORT = {authentic:"正格", half:"半終止", deceptive:"假終止", plagal:"變格"};

/* 存檔籤展開／收合。矮螢幕（橫放的 iPad）預設收起來 ——
   那 90px 拿去給五線譜比較值得，要看的時候點一下就開。 */
function toggleReviewList(open){
  const box = $("review");
  const on = (open === undefined) ? box.classList.contains("collapsed") : open;
  box.classList.toggle("collapsed", !on);
  $("revtoggle").setAttribute("aria-expanded", on ? "true" : "false");
  redraw();                 // 高度變了，譜要重新算能用多高
}

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
  state.rows[state.nowRow].querySelector(".lookahead").hidden = true;
  $("stage").classList.add("reviewing");
  state.plan = paintRow(state.nowRow, ex, "回顧 · 第 " + (i + 1) + " 段");
  $("sheetSub").textContent = describe(ex);
  renderReview();
  renderCoach();
}

function exitReview(){
  state.reviewIdx = -1;
  $("stage").classList.remove("reviewing");
  const ex = state.stream.current();
  state.libId = ex ? Library.idOf(ex.usedCfg) : null;   // 認回原本那段，但不算又練一次
  renderRead();
  syncMarkButton();
}

/* ---------- 音訊狀態 ---------- */

/* 「沒聲音」最難查的地方在於畫面上完全沒有線索。
   這裡把音訊引擎的實際狀態攤開來，至少能一眼分辨是
   還沒解鎖、被系統打斷、被自己靜音、還是要去看 iPad 的實體靜音鍵。 */
function renderAudioStatus(){
  const el = $("audiostat");
  if (!el) return;
  const st = Audio.state;
  const banner = $("audiobanner");
  const muted = Metro.muted || Metro.volume <= 0;
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
              (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  let cls = "ok", lines = [];
  if (st === "未建立"){
    lines.push("音訊尚未啟用 —— 點畫面任一處或按開始即可");
  } else if (st !== "running"){
    cls = "warn";
    lines.push("音訊被系統暫停（<b>" + st + "</b>）—— 點一下畫面通常就會回來");
  } else {
    lines.push("音訊引擎 <b>正常</b>");
  }
  if (muted){
    cls = "warn";
    lines.push("節拍器目前是<b>靜音</b>（音量 " + Math.round(Metro.volume * 100) + "）");
  }
  if (iOS && st === "running" && !muted){
    lines.push("沒聲音的話先撥一下 iPad 側邊的實體靜音鍵，再按上面的測試音");
  }
  // 離線與安裝狀態：iOS 上只有 Safari 能真的裝成主畫面 App，
  // 其他瀏覽器不註冊 Service Worker，離線就是不會有 —— 這件事要講出來。
  const swOn = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
  const standalone = window.matchMedia("(display-mode: standalone)").matches ||
                     window.navigator.standalone === true;
  if (iOS && !swOn){
    lines.push('離線快取<b>未啟用</b>：iOS 上只有 <b>Safari</b> 能裝成主畫面 App。' +
               '要離線可用，請改用 Safari 開這個網址再「加入主畫面」');
  } else if (swOn){
    lines.push("離線快取<b>已啟用</b>" + (standalone ? "（主畫面 App）" : ""));
  }

  el.className = "audiostat " + cls;
  el.innerHTML = lines.join("<br>");

  /* 有問題就壓在譜面正上方。診斷訊息藏在設定面板裡等於沒有 ——
     使用者根本不會為了找原因去翻選項。 */
  if (!banner) return;
  if (cls === "warn"){
    banner.className = "audiobanner";
    banner.innerHTML = "🔇 " + lines.join(" · ") +
      '<button class="ab-x" id="abx" aria-label="關閉">×</button>';
    banner.hidden = false;
    const x = $("abx");
    if (x) x.addEventListener("click", () => { banner.hidden = true; });
  } else {
    banner.hidden = true;
  }
}

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
  state.rows[state.nowRow].querySelector(".lookahead").hidden = true;
  $("stage").classList.add("reviewing");
  state.plan = paintRow(state.nowRow, ex, "複習清單 · " + entry.keyName);
  $("sheetSub").textContent = describe(ex);
  $("revback").hidden = false;
  $("review").hidden = false;
  syncMarkButton();
  renderCoach();
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
  const ahead = row.querySelector(".lookahead");
  const live = (posOverride !== undefined) || Metro.on;
  if (!live){ el.hidden = true; ahead.hidden = true; return; }

  const pos = (posOverride !== undefined) ? posOverride : Metro.position();
  if (pos < 0){ el.hidden = true; ahead.hidden = true; return; } // 預備拍期間不顯示

  const layout = state.layouts[state.nowRow];
  if (!layout || !layout.length){ el.hidden = true; ahead.hidden = true; return; }

  let bar, beat = 0, beats = 4;
  if (state.mode === "read"){
    const ex = state.stream && state.stream.current();
    if (!ex){ el.hidden = true; ahead.hidden = true; return; }
    beats = ex.beats;
    const local = pos - state.stream.segStartBar * beats;
    bar = Math.floor(local / beats);
    beat = Math.max(0, Math.min(beats - 1, Math.floor(local - bar * beats)));
  } else {
    // 和弦模式沒有換段，就在整條進行上循環 —— 練 changes 本來就是一直繞
    const d = state.drill;
    if (!d){ el.hidden = true; ahead.hidden = true; return; }
    beats = d.beats;
    const n = Math.floor(pos / d.beats);
    bar = ((n % layout.length) + layout.length) % layout.length;
  }
  if (bar < 0 || bar >= layout.length){ el.hidden = true; ahead.hidden = true; return; }

  const L = layout[bar];
  const svg = row.querySelector(".score svg");
  if (!svg){ el.hidden = true; ahead.hidden = true; return; }
  // 版面座標是「邏輯單位」（譜面縮放前），還要再乘上 SVG 被 CSS 壓縮的比例
  const lw = (state.plans[state.nowRow] && state.plans[state.nowRow].lw) || svg.width.baseVal.value || 1;
  const scale = svg.getBoundingClientRect().width / lw;
  const top = row.querySelector(".score").offsetTop;

  el.hidden = false;
  if (usesBeatSlices()){
    const nx = L.noteX === undefined ? L.x : L.noteX;
    const nw = L.noteW === undefined ? L.w : L.noteW;
    el.style.left = ((nx + nw * beat / beats) * scale) + "px";
    el.style.width = Math.max(8, nw / beats * scale) + "px";
  } else {
    el.style.left = (L.x * scale) + "px";
    el.style.width = (L.w * scale) + "px";
  }
  el.style.top    = (top + L.y * scale) + "px";
  el.style.height = (Math.max(40, L.h) * scale) + "px";

  ahead.hidden = true;
  if (state.mode === "read" && trainingMode() === "ahead"){
    const nextLocal = bar * beats + beat + 1;
    const nextBar = Math.floor(nextLocal / beats);
    const nextBeat = nextLocal % beats;
    if (nextBar >= 0 && nextBar < layout.length){
      const A = layout[nextBar];
      const anx = A.noteX === undefined ? A.x : A.noteX;
      const anw = A.noteW === undefined ? A.w : A.noteW;
      ahead.hidden = false;
      ahead.style.left = ((anx + anw * nextBeat / beats) * scale) + "px";
      ahead.style.width = Math.max(8, anw / beats * scale) + "px";
      ahead.style.top = (top + A.y * scale) + "px";
      ahead.style.height = (Math.max(40, A.h) * scale) + "px";
    }
  }
}

function cursorLoop(){
  state.cursorRaf = requestAnimationFrame(cursorLoop);
  updateCursor();
}

function startCursor(){ if (!state.cursorRaf) cursorLoop(); }
function stopCursor(){
  if (state.cursorRaf) cancelAnimationFrame(state.cursorRaf);
  state.cursorRaf = null;
  state.rows.forEach(r => {
    r.querySelector(".cursor").hidden = true;
    r.querySelector(".lookahead").hidden = true;
  });
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
    density: $("dens").value,
    focus: $("focus").value,
    inversion: $("inv").value,
    bars: parseInt($("bars").value, 10),
    step: state.step
  };
}

/* 重複次數的欄位只有在「重複同一段」時才有意義 */
function syncFlow(){
  $("repsfield").hidden = ($("flow").value !== "loop");
  state.loopCount = 0;
}

/* 左右手交換練：同一段譜，換一隻手當主角。
   走 restyle 而不是重新出題 —— 換了題目就不是「同一段」，那就沒得比了。 */
function swapHands(){
  if (state.mode !== "read" || !state.stream || !state.stream.current()) return;
  const sel = $("hands");
  sel.value = HAND_SWAP[sel.value] || "swap";
  refreshLhPatterns();
  Audio.stop(); highlight(null); setPlayLabel(false);
  state.reviewIdx = -1;
  $("stage").classList.remove("reviewing");
  state.stream.restyle({hands: sel.value});
  renderRead();
  logCurrent();
  syncSwapButton();
}

function syncSwapButton(){
  const btn = $("swaphands");
  if (!btn) return;
  btn.disabled = (state.mode !== "read");
  const to = HAND_SWAP[$("hands").value];
  const label = (HAND_MODES.find(h => h.id === to) || {}).short || "";
  btn.textContent = "⇄ 同一段換手練 → " + label;
}

function generate(opts){
  const o = opts || {};
  Audio.stop();
  highlight(null);
  setPlayLabel(false);
  state.revealed = $("revealed").checked;
  state.reviewIdx = -1;
  state.loopCount = 0;
  state.training.manualBeat = 0;
  state.training.intervalReveal = false;
  state.training.intervalAnswered = false;
  resetTrainingRun();
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
  syncSwapButton();
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

/* ---------- 跟著節拍器同步播放解答音 ---------- */

/* 排在節拍器的同一個硬體時鐘上，所以第一顆音就對得準；
   用 setTimeout 去湊會漂，而且是聽得出來的那種漂。 */
function startPlayAlong(){
  const playPlan = currentPlaybackPlan();
  if (!$("playalong").checked || !Metro.on || !playPlan.events.length) return;
  let startBeat;
  if (state.mode === "read"){
    startBeat = state.stream.segStartBar * (state.stream.current().beats || 4);
  } else {
    const bars = (state.plans[0] && state.plans[0].layout.length) || 1;
    startBeat = state.playAlongCycle * bars * (state.drill ? state.drill.beats : 4);
  }
  const ok = Audio.play(playPlan, currentBpm(), highlight, onPlayAlongEnd,
                        Metro.timeOfBeat(startBeat));
  if (ok) setPlayLabel(true);
}

function onPlayAlongEnd(){
  setPlayLabel(false);
  // 和弦模式沒有換段，播完就接下一輪，跟循環的游標一致
  if ($("playalong").checked && Metro.on && state.mode === "chord"){
    state.playAlongCycle++;
    startPlayAlong();
  }
}

function togglePlay(){
  if (Audio.playing){
    Audio.stop(); highlight(null); setPlayLabel(false);
    return;
  }
  const ok = Audio.play(currentPlaybackPlan(), currentBpm(), highlight, () => setPlayLabel(false));
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

/* 頂欄那一格：重複模式要看得到現在是第幾遍，不然反覆記號等於沒有回饋 */
function liveLabel(){
  if (!isLoop()) return "進行中";
  const lim = repeatLimit();
  return "第 " + (state.loopCount + 1) + (lim ? " / " + lim : "") + " 遍";
}

function repeatLimit(){ return parseInt($("reps").value, 10) || 0; }   // 0 = 一直重複

Metro.onBeat = (i, counting) => {
  const cells = $("beatstrip").children;
  for (let k = 0; k < cells.length; k++) cells[k].classList.remove("on");
  if (cells[i]) cells[i].classList.add("on");
  $("clipmeta").textContent = counting ? "預備" : liveLabel();
  updateCursor();          // rAF 被節流時，靠這裡把游標推下去
};

Metro.onBar = (barsDone) => {
  $("barcount").textContent = String(barsDone);
  if (state.mode !== "read" || !state.stream) return;
  if ($("flow").value === "manual" || state.reviewIdx !== -1) return;
  const cur = state.stream.current();
  if (!cur) return;
  // 彈滿一整段才換 —— 舊版在最後一小節的第一拍就換，等於少給一小節
  if (barsDone - state.stream.segStartBar < cur.cfg.bars) return;

  Audio.stop(); highlight(null); setPlayLabel(false);

  /* 重複同一段：不換譜、不重畫，只把段落起點對到現在，游標就回到第一小節。
     次數滿了才真的往下一段走。 */
  if (isLoop()){
    state.loopCount++;
    const lim = repeatLimit();
    if (!lim || state.loopCount < lim){
      state.stream.segStartBar = barsDone;
      $("clipmeta").textContent = liveLabel();
      startPlayAlong();
      return;
    }
    state.loopCount = 0;
  }

  advanceSegment(barsDone);
  startPlayAlong();          // 新的一段接著播，中間不斷
};

/* 頂欄那顆與右下角浮動那顆是同一個狀態的兩個出口，一起更新 */
function setMetroLabel(on){
  $("metro").setAttribute("aria-pressed", on ? "true" : "false");
  $("metro").textContent = on ? "停止" : "開始";
  const f = $("fabmetro");
  f.setAttribute("aria-pressed", on ? "true" : "false");
  f.setAttribute("aria-label", on ? "停止節拍器" : "開始節拍器");
  f.textContent = on ? "■" : "▶";
}

function toggleMetro(){
  if (Metro.on){
    Metro.stop();
    stopCursor();
    Wake.release();
    Audio.stop(); highlight(null); setPlayLabel(false);
    if (state.practiceStart){
      Library.addSeconds((Date.now() - state.practiceStart) / 1000);
      state.practiceStart = 0;
      renderLibrary();
    }
    setMetroLabel(false);
    $("clipmeta").textContent = "停止";
    const cells = $("beatstrip").children;
    for (let k = 0; k < cells.length; k++) cells[k].classList.remove("on");
    if (trainingMode() === "slice" || trainingMode() === "interval" || trainingMode() === "ahead"){
      updateCursor(manualTrainingPosition());
    }
    return;
  }
  const cur = state.mode === "read" && state.stream ? state.stream.current() : null;
  const beats = cur ? cur.beats : (state.drill ? state.drill.beats : 4);
  buildBeatStrip(beats);
  $("barcount").textContent = "0";
  if (state.stream) state.stream.segStartBar = 0;
  state.playAlongCycle = 0;
  state.loopCount = 0;
  if (!Metro.start(currentBpm(), beats, $("countin").checked ? 1 : 0)){
    $("clipmeta").textContent = "此瀏覽器不支援音訊";
    return;
  }
  startCursor();
  setMetroLabel(true);
  $("clipmeta").textContent = "預備";
  Wake.request();
  state.practiceStart = Date.now();
  startPlayAlong();
  renderAudioStatus();
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
    renderAudioStatus();
    window.removeEventListener("pointerdown", once);
    window.removeEventListener("keydown", once);
  };
  Audio.onStateChange = renderAudioStatus;
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
    // 放大超過 100% 就改成譜面區自己捲（頁面仍然不捲）
    document.body.classList.toggle("zoomed", parseInt(this.value, 10) > 100);
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
  $("fabmetro").addEventListener("click", toggleMetro);
  $("fabgen").addEventListener("click", () => generate());

  $("swaphands").addEventListener("click", swapHands);
  $("trainmode").addEventListener("change", function(){ setTrainingMode(this.value); });

  // 出題設定變了，整條佇列都要重來（下一段是用舊設定生的）
  ["lv", "ts", "hands"].forEach(id =>
    $(id).addEventListener("change", () => { refreshLhPatterns(); generate({fresh:true}); }));
  ["keysel", "bars", "lhpat", "dens", "focus", "inv"].forEach(id =>
    $(id).addEventListener("change", () => generate({fresh:true})));
  // 換流程不必換題目 —— 只是重畫（反覆記號、預讀那一列）並歸零遍數
  $("flow").addEventListener("change", () => { syncFlow(); redraw(); });
  $("reps").addEventListener("change", () => { state.loopCount = 0; });
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

  $("tempo").addEventListener("input", function(){ setBpm(parseInt(this.value, 10)); });
  // 數字框讓人邊打邊清空，所以只在打完（change / blur）時才夾回合法範圍
  $("bpm").addEventListener("input", function(){
    const v = parseInt(this.value, 10);
    if (v >= 30 && v <= 220) setBpm(v);
  });
  $("bpm").addEventListener("change", function(){ setBpm(parseInt(this.value, 10)); });

  $("vol").addEventListener("change", function(){
    const v = Math.max(0, Math.min(100, parseInt(this.value, 10) || 0));
    Metro.volume = v / 100;
    if (v > 0 && $("mute").checked){ $("mute").checked = false; Metro.muted = false; }
    renderAudioStatus();
  });
  $("mute").addEventListener("change", function(){
    Metro.muted = this.checked;
    renderAudioStatus();
  });

  $("bypasssilent").addEventListener("change", function(){
    Audio.setSilentSwitchOverride(this.checked);
    renderAudioStatus();
  });

  /* 測試音：把「有沒有聲音」變成量得出來的事，不用靠猜。 */
  $("testtone").addEventListener("click", async () => {
    const btn = $("testtone");
    btn.disabled = true;
    btn.textContent = "🔊 播放中…";
    const r = await Audio.testTone();
    btn.disabled = false;
    btn.textContent = "🔊 測試音";
    const el = $("audiostat");
    if (r.ok){
      el.className = "audiostat ok";
      el.innerHTML = "測試音已送出，量到的振幅 <b>" + r.peak.toFixed(3) + "</b>" +
        "（狀態 " + r.state + "、" + r.sampleRate + " Hz、路由 " + r.channel + "）<br>" +
        "<b>有聽到嗶聲嗎？</b><br>" +
        "聽到 → 音訊正常，問題在別處。<br>" +
        "沒聽到 → 訊號有出去但沒到喇叭：檢查 iPad 側邊實體靜音鍵、" +
        "音量鍵、藍牙輸出，或把上面「繞過實體靜音鍵」切換一次再試。";
      $("audiobanner").hidden = true;
    } else {
      el.className = "audiostat warn";
      el.innerHTML = "測試音<b>沒有產生訊號</b>（" + (r.reason || ("狀態 " + r.state)) +
                     "）—— 這是程式端的問題，請告訴我這一行。";
    }
  });

  $("revtoggle").addEventListener("click", () => toggleReviewList());
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
    else if (k === "h"){ e.preventDefault(); swapHands(); }
    else if (e.key === "[" && (trainingMode() === "slice" || trainingMode() === "interval" || trainingMode() === "ahead")){
      e.preventDefault(); moveTrainingBeat(-1);
    }
    else if (e.key === "]" && (trainingMode() === "slice" || trainingMode() === "interval" || trainingMode() === "ahead")){
      e.preventDefault(); moveTrainingBeat(1);
    }
    else if (e.key === "ArrowUp" || e.key === "ArrowDown"){
      e.preventDefault();
      const d = e.key === "ArrowUp" ? 1 : -1;
      setBpm(currentBpm() + d * (e.shiftKey ? 5 : 1));
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
  state.training.mode = $("trainmode").value || "free";
  fillLevels();
  fillHands();
  fillDensity();
  fillFocus();
  fillInversions();
  fillKeySelect();
  refreshLhPatterns();
  fillProgressions();
  refreshChordKeys();
  setBpm(parseInt($("bpm").value, 10));
  $("zoomread").textContent = $("zoom").value + "%";
  Metro.volume = parseInt($("vol").value, 10) / 100;
  Metro.muted = $("mute").checked;
  bind();
  syncFlow();
  syncSwapButton();
  // 矮螢幕預設收起存檔籤（不呼叫 toggleReviewList，此時還沒有譜可以重畫）
  if (window.innerHeight < 860){
    $("review").classList.add("collapsed");
    $("revtoggle").setAttribute("aria-expanded", "false");
  }
  installAudioUnlock();
  installGestures();
  registerServiceWorker();
  renderLibrary();
  renderAudioStatus();

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
