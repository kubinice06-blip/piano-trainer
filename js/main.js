/* UI 綁定與應用狀態。 */

import { loadVexFlow } from "./render/vexloader.js";
import { drawExercise, drawChordDrill } from "./render/score.js";
import { Audio, mtof } from "./audio/sound.js";
import { Metro } from "./audio/metro.js";
import { LEVELS, KEY_POOLS, HAND_MODES, HAND_SWAP, NOTE_DENSITY, FOCUS, INVERSIONS,
         availablePatterns, LH_PATTERNS } from "./gen/exercise.js";
import { PROGRESSIONS, generateChordDrill, progressionCategories,
         CHORD_STAGES, CHORD_RANGES, CHORD_CONTOURS, CHORD_RHYTHMS } from "./gen/chordprog.js";
import { MAJOR_KEYS, MINOR_KEYS, ALL_KEYS, cycleOfFourths } from "./core/key.js";
import { Stream } from "./stream.js";
import { Library } from "./library.js";
import { generateExercise } from "./gen/exercise.js";
import { AXES, AXIS_INFO, EYE_HAND_BEATS, presetVector, normaliseVector,
         axisValueLabel, generatorLevels } from "./adaptive.js";
import { fingerprintExercise, cfgFromFingerprint } from "./fingerprint.js";
import { noteName, midiOf } from "./core/pitch.js";
import { MidiInput } from "./input/midi.js";
import { OnsetInput } from "./input/onset.js";
import { PerformanceMatcher } from "./input/performance.js";
import { buildTapEvents, pianoRange, pianoNoteName, TapSightMatcher } from "./drills/tap-piano.js";
import { fingeringSummary } from "./fingering.js";

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;",
})[char]);

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
  pendingRatingId: null,
  exerciseOverride: null,
  activeWeaknessId: null,
  flashTimer: null,
  matcher: null,
  inputMode: null,
  practicePianoOpen: false,
  micro: {
    open:false, kind:"piano", item:null, startedAt:0, attempts:0, correct:0, lessonOwned:false,
    endsAt:0, timer:null, roundTimer:null, rhythmMatcher:null,
    tapMatcher:null, tapTimer:null, tapStartMs:0, tapEndMs:0, tapCurrentId:null,
  },
  lesson: null,
  weekly: null,
};

state.midi = new MidiInput((note, at, type) => type === "off"
  ? state.matcher?.noteOff(note, at) : state.matcher?.hit(note, at));
state.onset = new OnsetInput((at) => state.matcher?.hit(null, at));

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

  availablePatterns(level, ts).forEach(id => {
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

  const stage = $("chordstage");
  Object.keys(CHORD_STAGES).forEach(id => {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = CHORD_STAGES[id].label;
    stage.appendChild(o);
  });
  stage.value = "seventh";

  const range = $("chordrange");
  Object.keys(CHORD_RANGES).forEach(id => {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = CHORD_RANGES[id].label;
    range.appendChild(o);
  });
  range.value = "one";

  const contour = $("chordcontour");
  Object.keys(CHORD_CONTOURS).forEach(id => {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = CHORD_CONTOURS[id].label;
    contour.appendChild(o);
  });
  contour.value = "up";

  const rhythm = $("chordrhythm");
  Object.keys(CHORD_RHYTHMS).forEach(id => {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = CHORD_RHYTHMS[id].label;
    rhythm.appendChild(o);
  });
  rhythm.value = "eighth";
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

function clearEyeMasks(){
  clearTimeout(state.flashTimer);
  state.flashTimer = null;
  $("stage").querySelectorAll(".vf-eye-masked").forEach((element) => element.classList.remove("vf-eye-masked"));
}

function maskPlanEvents(plan, predicate){
  for (const event of plan?.events || []){
    if (!event.gid) continue;
    const element = document.getElementById(event.gid);
    if (element) element.classList.toggle("vf-eye-masked", !!predicate(event));
  }
}

function setupEyeMask(){
  clearEyeMasks();
  if (state.mode !== "read") return;
  const mode = $("maskmode").value;
  if (mode === "flash"){
    const seconds = Math.max(1, Number($("scansecs").value) || 3);
    $("maskstatus").textContent = `先掃描 ${seconds} 秒，之後譜面隱藏`;
    state.flashTimer = setTimeout(() => maskPlanEvents(state.plan, () => true), seconds * 1000);
  } else if (mode === "follow") {
    const lead = generatorLevels(currentVector()).maskLead ?? 0;
    $("maskstatus").textContent = `移動遮罩：手前 ${lead} 拍內會被遮住`;
  } else {
    $("maskstatus").textContent = "眼手距離：關閉";
  }
}

function updateEyeMask(position){
  if (state.mode !== "read" || $("maskmode").value !== "follow" || !state.stream) return;
  const ex = state.stream.current();
  if (!ex) return;
  const localBeat = position - state.stream.segStartBar * ex.beats;
  const lead = generatorLevels(currentVector()).maskLead ?? 0;
  maskPlanEvents(state.plan, (event) => event.t <= localBeat + lead + 1e-6);
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
  $("toptemporange").value = String(b);
  // 預設清單用於快速選速；拉桿可保留每一 BPM 的微調，不強迫跳回最近預設。
  $("toptempo").value = Array.from($("toptempo").options).some((option) => Number(option.value) === b) ? String(b) : "";
  if (Metro.on) Metro.bpm = b;
  return b;
}

function isLoop(){ return state.mode === "read" && $("flow").value === "loop"; }

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
    showFingering: $("showfingering").checked,
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
  // 一定要先把版面定好再畫：還掛著 is-hidden 的那一列量到的寬度是 0，
  // 繪圖端就會退回寫死的 900px，畫出來的譜跟容器對不起來
  syncRows();
  state.plan = paintRow(state.nowRow, cur, "現在");
  if ($("flow").value === "flow" && st.next()){
    paintRow(1 - state.nowRow, st.next(), "下一段 · 眼睛先跑到這裡");
  }
  $("sheetTitle").textContent = "視譜練習";
  $("sheetSub").textContent = describe(cur);
  renderFingeringGuide(cur);
  renderChordCoach(null);
  $("answer").hidden = true;
  buildBeatStrip(cur.beats);
  renderReview();
  setupEyeMask();
  renderPracticePiano();
}

function renderFingeringGuide(ex){
  const visible = state.mode === "read" && !!ex && $("showfingering").checked;
  $("fingerguide").hidden = !visible;
  $("fingerguide").textContent = visible ? fingeringSummary(ex) : "";
}

function renderChordCoach(drill){
  const box = $("chordcoach");
  if (state.mode !== "chord" || !drill){ box.hidden = true; box.innerHTML = ""; return; }
  const seen = new Set();
  const lessons = (drill.systems[0]?.lessons || []).filter(item => {
    if (seen.has(item.label)) return false;
    seen.add(item.label); return true;
  });
  const showActual = state.revealed && $("shownotes").checked;
  const extensionLabel = drill.extensions ? "外音開啟" : "外音關閉";
  box.innerHTML =
    '<div class="chord-coach-head"><b>讀法：根音 → 3、7 → 外音 → 分解</b><span>' +
      esc(CHORD_STAGES[drill.stage].short + " · " + CHORD_RANGES[drill.range].short + " · " + extensionLabel + " · " + CHORD_RHYTHMS[drill.rhythm].label) + '</span></div>' +
    '<div class="chord-coach-cards">' + lessons.map(item =>
      '<div class="chord-card"><strong>' + esc(item.label) + '</strong>' +
      '<span>目標 ' + esc(item.targetDegrees.join("–")) + '　' +
        (drill.extensions ? '加入外音 ' + esc(item.colorDegrees.join("、")) : '七以上外音關閉') + '</span>' +
      '<span class="actual">' + (showActual ? esc(item.targetNotes.join(" · ")) : '先從代號推算，按「看答案」核對') + '</span></div>'
    ).join("") + '</div>';
  box.hidden = false;
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
    syncRows();                                      // 同樣先定版面再畫
    paintRow(1 - state.nowRow, st.next(), "下一段 · 眼睛先跑到這裡");
    $("sheetSub").textContent = describe(st.current());
    renderReview();
    setupEyeMask();
  } else {
    renderRead();
  }
  renderPracticePiano();
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
  $("sheetTitle").textContent = "和弦代號分解練習";
  renderFingeringGuide(null);
  renderChordCoach(d);
  $("sheetSub").textContent = [
    d.label,
    CHORD_STAGES[d.stage].short,
    CHORD_RANGES[d.range].short,
    d.extensions ? "外音開啟" : "外音關閉",
    CHORD_CONTOURS[d.contour].label,
    CHORD_RHYTHMS[d.rhythm].label,
    "左手根音＋右手分解",
    d.systems.map(s => s.tonic.shortName).join(" → "),
    "#" + d.seed.toString(36)
  ].filter(Boolean).join(" · ");
  renderAnswerBox();
  buildBeatStrip(4);
  renderPracticePiano();
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
  $("stage").classList.add("reviewing");
  state.plan = paintRow(state.nowRow, ex, "回顧 · 第 " + (i + 1) + " 段");
  $("sheetSub").textContent = describe(ex);
  renderFingeringGuide(ex);
  renderReview();
  renderPracticePiano();
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
  const e = Library.present(ex);
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
  const marked = Library.toggleMark(state.libId);
  if (marked && state.mode === "read" && state.stream?.current()){
    Library.captureWeakness(fingerprintExercise(state.stream.current()), state.libId);
  }
  syncMarkButton();
  renderLibrary();
}

function sparkline(values){
  const numbers = values.filter((value) => value != null).map(Number).filter(Number.isFinite);
  if (!numbers.length) return "";
  const lo = Math.min(...numbers), hi = Math.max(...numbers);
  const range = Math.max(0.001, hi - lo);
  const points = values.map((value, index) => {
    if (value == null || !Number.isFinite(Number(value))) return null;
    const x = values.length === 1 ? 80 : index * 160 / (values.length - 1);
    const y = 27 - (Number(value) - lo) / range * 22;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).filter(Boolean).join(" ");
  return `<svg viewBox="0 0 160 32" aria-hidden="true"><polyline points="${points}"></polyline></svg>`;
}

function renderLibrary(){
  const s = Library.stats();
  const untouched = Library.untouched(ALL_KEYS);
  const storageName = Library.backend === "indexeddb" ? "這台 iPad（IndexedDB）"
    : (Library.backend === "localstorage" ? "這台裝置（相容儲存）" : "暫存記憶體");

  let html = '<div class="big">' +
    '<div><b>' + s.segments + '</b><span>完成段數</span></div>' +
    '<div><b>' + s.attempts + '</b><span>實際嘗試</span></div>' +
    '<div><b>' + s.minutes + '</b><span>累計分鐘</span></div>' +
    '<div><b>' + s.weaknessDue + '</b><span>到期弱點</span></div>' +
    '<div><b>' + (30 - untouched.length) + '/30</b><span>完成過的調</span></div>' +
    "</div>";

  html += '<div class="line">紀錄位置：<span class="ok">' + storageName + '</span></div>';
  if (s.ratings){
    html += '<div class="line">自評順暢率：<span class="ok">' +
      Math.round(s.smoothRate * 100) + '%</span>（' + s.ratings + ' 段）</div>';
  }
  if (s.objectiveAccuracy != null){
    html += '<div class="line">演奏偵測：<span class="ok">' +
      Math.round(s.objectiveAccuracy * 100) + '% 音符命中</span>' +
      (s.medianTimingMs == null ? '' : ' · 中位誤差 ' + Math.round(s.medianTimingMs) + 'ms') + '</div>';
  }
  if (s.latestWeekly){
    html += '<div class="line">最近週測：<span class="ok">' + esc(s.latestWeekly.week || '本週') +
      ' · ' + s.latestWeekly.completed + '/' + s.latestWeekly.segments + ' 段</span></div>';
  }

  if (s.weak.length){
    html += '<div class="line">最常卡住：' +
      s.weak.map(w => '<span class="tag">' + esc(w.name) + "</span>（" +
                      Math.round(w.rate * 100) + "%）").join("、") + "</div>";
  }
  if (untouched.length){
    const show = untouched.slice(0, 6).map(k => k.shortName).join(" ");
    html += '<div class="line">還沒完成過：<span class="ok">' + show +
            (untouched.length > 6 ? " …共 " + untouched.length + " 個" : "") + "</span></div>";
  } else if (s.segments){
    html += '<div class="line"><span class="ok">30 個調都練過了。</span></div>';
  }
  if (s.legacyEntries){
    html += '<div class="line">已保留 ' + s.legacyEntries +
      ' 筆舊紀錄；舊版只記得「出過題」，因此不灌入完成次數。</div>';
  }
  if (!Library.available){
    html += '<div class="line">瀏覽器目前不允許永久儲存，紀錄只會留到這次關閉前；請先匯出備份。</div>';
  }
  $("stats").innerHTML = html;
  $("practiceweak").disabled = s.weaknessActive === 0;
  $("practiceweak").textContent = s.weaknessDue
    ? `複習到期弱點 ${s.weaknessDue}` : (s.weaknessActive ? "尚未到期 · 可提前複習" : "尚無弱點指紋");
  const maxHeat = Math.max(1, ...s.weaknessHeatmap.map((item) => item.count));
  $("weakheat").innerHTML = s.weaknessHeatmap.map((item) =>
    `<span class="cell" style="--heat:${(0.08 + item.count / maxHeat * 0.36).toFixed(2)}">${esc(item.label)} ×${item.count}</span>`
  ).join("");
  const weeks = s.weeklyHistory || [];
  const latest = weeks[weeks.length - 1];
  $("weeklytrend").innerHTML = weeks.length ? [
    ["週測順暢", weeks.map((item) => item.smoothRate == null ? null : item.smoothRate * 5), latest?.smoothRate == null ? "—" : `${Math.round(latest.smoothRate * 5)}/5`],
    ["眼手距離", weeks.map((item) => item.eyeHandBeats), latest?.eyeHandBeats == null ? "—" : `+${latest.eyeHandBeats}拍`],
    ["音名中位", weeks.map((item) => item.noteMedianMs), latest?.noteMedianMs == null ? "—" : `${Math.round(latest.noteMedianMs)}ms`],
  ].map(([label, values, value]) => `<div class="kpi-row"><span>${label}</span>${sparkline(values)}<strong>${value}</strong></div>`).join("") : "";

  const notePositions = (s.notePositions || []).slice(0, 10);
  $("noteheatlabel").hidden = notePositions.length === 0;
  const slowest = Math.max(1, ...notePositions.map((item) => item.medianResponseMs || 0));
  $("noteheat").innerHTML = notePositions.map((item) =>
    `<span class="cell" style="--heat:${(0.08 + (item.medianResponseMs || 0) / slowest * 0.36).toFixed(2)}">` +
    `${esc(item.position)} · ${Math.round(item.medianResponseMs || 0)}ms</span>`
  ).join("");

  const list = Library.marked();
  $("markcount").textContent = String(list.length);
  const box = $("marklist");
  box.innerHTML = "";
  list.forEach(e => {
    const b = document.createElement("button");
    b.className = "revchip";
    b.innerHTML = '<span class="k">' + esc(e.keyName) + "</span> " +
                  '<span class="n">lv' + esc(e.level) + "</span><br>" + esc(e.roman);
    b.addEventListener("click", () => openLibraryEntry(e));
    box.appendChild(b);
  });
}

async function connectMidi(){
  const status = $("inputstatus");
  try {
    state.onset.disconnect();
    const names = await state.midi.connect();
    if (!names.length) throw new Error("沒有偵測到 MIDI 鍵盤，請接上後再試。");
    state.inputMode = "midi";
    status.textContent = `MIDI 已連接：${names.join("、")}。將比對音高與拍點。`;
    $("connectmidi").setAttribute("aria-pressed", "true");
    $("connectmic").setAttribute("aria-pressed", "false");
  } catch (error) {
    state.inputMode = null;
    status.textContent = error?.name === "NotAllowedError" || /permission|not granted/i.test(error?.message || "")
      ? "MIDI 權限未開啟；仍可使用「順／有絆／垮掉」自評。"
      : (error?.message || "MIDI 連接失敗。");
  }
}

async function connectMicrophone(){
  const status = $("inputstatus");
  try {
    state.midi.disconnect();
    await state.onset.connect();
    state.inputMode = "onset";
    status.textContent = "麥克風已啟用：只評估落鍵拍點，不宣稱辨識鋼琴和弦音高。";
    $("connectmidi").setAttribute("aria-pressed", "false");
    $("connectmic").setAttribute("aria-pressed", "true");
  } catch (error) {
    state.inputMode = null;
    status.textContent = error?.name === "NotAllowedError" || /permission|not granted/i.test(error?.message || "")
      ? "麥克風權限未開啟；請到 Safari 網站設定允許後再試。"
      : (error?.message || "麥克風無法啟用；請檢查 Safari 麥克風權限。");
  }
}

function currentVector(){
  const value = {};
  for (const axis of AXES){
    const select = $("axis-" + axis);
    value[axis] = select ? parseInt(select.value, 10) : 0;
  }
  return normaliseVector(value, parseInt($("lv").value, 10) || 1);
}

function fillAxisControls(){
  const host = $("axiscontrols");
  host.innerHTML = "";
  for (const axis of AXES){
    const wrap = document.createElement("label");
    wrap.className = "axis-item";
    wrap.textContent = AXIS_INFO[axis].label;
    const select = document.createElement("select");
    select.id = "axis-" + axis;
    AXIS_INFO[axis].levels.forEach((label, value) => {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = (value + 1) + " · " + label;
      select.appendChild(option);
    });
    select.addEventListener("change", () => {
      applyVectorToUi(currentVector(), {persist:true, regenerate:true});
    });
    wrap.appendChild(select);
    host.appendChild(wrap);
  }
}

function syncAxisTarget(){
  const adaptive = Library.data.adaptive || {};
  const axis = adaptive.lastAxis;
  $("axistarget").textContent = AXES.includes(axis)
    ? "目前強化：" + AXIS_INFO[axis].label : "目前強化：—";
}

function applyVectorToUi(value, options = {}){
  const vector = normaliseVector(value, parseInt($("lv").value, 10) || 1);
  for (const axis of AXES){
    const select = $("axis-" + axis);
    if (select) select.value = String(vector[axis]);
  }
  const mapped = generatorLevels(vector);
  $("lv").value = String(Math.max(mapped.rangeLevel, mapped.rhythmLevel, mapped.textureLevel));
  if (Array.from($("dens").options).some((option) => option.value === mapped.density)) $("dens").value = mapped.density;
  setBpm(mapped.bpm);

  const textures = [
    {hands:"rh", pattern:null}, {hands:"both", pattern:"sustain"},
    {hands:"both", pattern:"block"}, {hands:"both", pattern:"arpeggio"},
    {hands:"both", pattern:"parallel"}, {hands:"both", pattern:"contrary"},
  ];
  const texture = textures[vector.texture];
  $("hands").value = texture.hands;
  refreshLhPatterns();
  if (texture.pattern && Array.from($("lhpat").options).some((option) => option.value === texture.pattern)) {
    $("lhpat").value = texture.pattern;
  }
  const lead = EYE_HAND_BEATS[vector.eyeHand];
  $("maskstatus").textContent = lead == null ? "眼手距離：關閉" : `眼手距離：${lead} 拍（遮罩迫使視線提前）`;
  if (vector.eyeHand > 0 && $("maskmode").value === "off") $("maskmode").value = "follow";
  if (vector.eyeHand === 0 && $("maskmode").value === "follow") $("maskmode").value = "off";
  if (options.persist) Library.setAdaptive({vector});
  syncAxisTarget();
  if (options.regenerate && state.stream){
    if (Metro.on) toggleMetro();
    generate({fresh:true});
  }
  return vector;
}

async function exportLibrary(){
  await Library.flush();
  const blob = new Blob([Library.backup()], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const date = new Date().toLocaleDateString("sv-SE");
  a.href = url;
  a.download = "putai-practice-" + date + ".json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importLibrary(file){
  if (!file) return;
  if (!confirm("匯入會以備份檔取代這台 iPad 現有的練習紀錄。要繼續嗎？")) return;
  try {
    if (Metro.on) toggleMetro();
    await Library.restore(await file.text());
    state.libId = null;
    state.pendingRatingId = null;
    $("ratingbar").hidden = true;
    applyStoredAdaptive();
    renderLibrary();
    syncMarkButton();
    alert("練習紀錄已還原。");
  } catch (error) {
    alert(error?.message || "備份檔無法匯入。");
  }
}

function applyStoredAdaptive(){
  const adaptive = Library.data.adaptive || {};
  $("adaptive").checked = adaptive.enabled !== false;
  applyVectorToUi(adaptive.vector || presetVector(adaptive.level || 1));
}

function applyStaircase(result){
  if (!result?.direction || !$("adaptive").checked || !result.axis) return null;
  applyVectorToUi(result.vector);
  const verb = result.direction === "up" ? "提高" : "降低";
  return `${AXIS_INFO[result.axis].label}${verb}為 ${axisValueLabel(result.axis, result.vector[result.axis])}`;
}

function ratePending(rating, automatic){
  if (!state.pendingRatingId) return null;
  const id = state.pendingRatingId;
  state.pendingRatingId = null;
  $("ratingbar").hidden = true;
  const result = Library.rateAttempt(id, rating);
  if (!result) return null;
  const adjustment = applyStaircase(result);
  const labels = {smooth:"順", stumble:"有絆", collapse:"垮掉"};
  if (!automatic){
    $("clipmeta").textContent = "已記錄「" + labels[rating] + "」" + (adjustment ? " · " + adjustment : "");
  }
  if (result.attempt.weaknessId){
    state.exerciseOverride = null;
    state.activeWeaknessId = null;
  }
  weeklyAcceptAttempt(result.attempt);
  renderLibrary();
  return result;
}

function askForRating(attempt){
  if (!attempt?.completed) return;
  state.pendingRatingId = attempt.id;
  $("ratingbar").hidden = false;
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
  renderFingeringGuide(ex);
  $("revback").hidden = false;
  $("review").hidden = false;
  syncMarkButton();
  renderPracticePiano();
  setDrawer(false);
}

function practiceWeakness(id = null){
  const weakness = id ? Library.weakness(id)
    : (Library.dueWeaknesses()[0] || Library.activeWeaknesses()[0]);
  if (!weakness) return false;
  if (state.mode !== "read") setMode("read");
  state.activeWeaknessId = weakness.id;
  state.exerciseOverride = cfgFromFingerprint(weakness.fingerprint, readCfg());
  // The preserved fingerprint determines musical features; the seed remains
  // new, so this is transfer practice rather than memorising the old score.
  delete state.exerciseOverride.seed;
  $("flow").value = "manual";
  syncFlow();
  generate({fresh:true});
  $("clipmeta").textContent = `弱點複習 · 第 ${weakness.stage + 1}/3 階段`;
  setDrawer(false);
  return true;
}

/* ---------- P9：90 秒微練習 ---------- */

const MICRO_LEVEL_KEY = "putai.micro.level";
const TAP_HAND_KEY = "putai.tap.hand";
const TAP_LABELS_KEY = "putai.tap.labels";

function microLevel(){
  return Math.max(1, Math.min(6, parseInt($("microlevel")?.value, 10) || 3));
}

function restoreMicroLevel(){
  try {
    $("microlevel").value = String(Math.max(1, Math.min(6, Number(localStorage.getItem(MICRO_LEVEL_KEY)) || 3)));
    $("taphand").value = localStorage.getItem(TAP_HAND_KEY) === "lh" ? "lh" : "rh";
    $("taplabels").checked = localStorage.getItem(TAP_LABELS_KEY) === "1";
  } catch {
    $("microlevel").value = "3";
    $("taphand").value = "rh";
    $("taplabels").checked = false;
  }
}

function melodyNotes(ex){
  const side = ex.melodyOn === "bottom" ? "bottom" : "top";
  return ex.measures.flatMap((measure) => measure[side] || measure.top || [])
    .filter((item) => !item.rest && item.note);
}

function tapHand(){ return $("taphand")?.value === "lh" ? "lh" : "rh"; }

function buildTapExercise(){
  const level = microLevel();
  const density = ["long", "quarter", "eighth", "varied", "16th", "16th"][level - 1];
  const difficulty = presetVector(level);
  // The pitch challenge still grows, but the on-screen keyboard stays within
  // a comfortable two-octave hand area on an iPad.
  difficulty.pitchRange = Math.min(3, difficulty.pitchRange);
  difficulty.texture = 0;
  difficulty.eyeHand = 0;
  let best = null;
  for (let tries = 0; tries < 30; tries++){
    const ex = generateExercise({
      ...readCfg(), level, difficulty, bars:2, hands:tapHand(), lhPattern:null,
      density, focus:"none", seed:undefined,
    });
    const notes = melodyNotes(ex).map((item) => midiOf(item.note));
    const range = pianoRange([{midi:notes}]);
    if (!notes.length) continue;
    const score = range.whiteCount * 100 + (Math.max(...notes) - Math.min(...notes));
    if (!best || score < best.score) best = {ex, score};
    if (notes.length >= 4 && range.whiteCount <= 15) return ex;
  }
  return best.ex;
}

function clearTapScoreClasses(){
  $("microscore").querySelectorAll(".tap-current,.tap-hit,.tap-missed")
    .forEach((element) => element.classList.remove("tap-current", "tap-hit", "tap-missed"));
}

function tapEventElements(event){
  return (event?.gids || []).map((id) => document.getElementById(id)).filter(Boolean);
}

function paintTapProgress(now = performance.now()){
  const matcher = state.micro.tapMatcher;
  if (!matcher) return;
  clearTapScoreClasses();
  matcher.events.forEach((event) => {
    const className = event.status === "hit" ? "tap-hit" : (event.status === "missed" ? "tap-missed" : null);
    if (className) tapEventElements(event).forEach((element) => element.classList.add(className));
  });
  const current = matcher.current(now, 620);
  if (current?.status === "pending") tapEventElements(current).forEach((element) => element.classList.add("tap-current"));
}

function stopTapPiano(clear = true){
  clearInterval(state.micro.tapTimer);
  clearTimeout(state.micro.roundTimer);
  state.micro.tapTimer = null;
  state.micro.roundTimer = null;
  state.micro.tapMatcher = null;
  if (clear) clearTapScoreClasses();
}

function renderPianoKeyboard(events){
  renderKeyboard($("pianokeys"), $("pianoscroll"), events, $("taplabels").checked, tapPianoKey);
}

function renderKeyboard(host, scroll, events, showAll, onPointerDown){
  const range = pianoRange(events);
  host.innerHTML = "";
  host.style.setProperty("--white-count", String(range.whiteCount));
  host.style.setProperty("--piano-min-width", `${Math.max(420, range.whiteCount * 46)}px`);
  for (const key of range.keys){
    const button = document.createElement("button");
    button.type = "button";
    button.className = `piano-key ${key.black ? "black" : "white"}`;
    button.dataset.midi = String(key.midi);
    button.setAttribute("aria-label", key.name);
    if (key.black) button.style.setProperty("--slot", String(key.slot));
    button.textContent = showAll || key.name.startsWith("C") ? key.name : "";
    button.addEventListener("pointerdown", onPointerDown);
    host.appendChild(button);
  }
  scroll.scrollLeft = 0;
  return range;
}

const PRACTICE_PIANO_KEY = "putai.practice.piano.open";

function renderPracticePiano(){
  if (!state.practicePianoOpen) return;
  const events = state.plan?.events || [];
  const range = renderKeyboard($("practicepianokeys"), $("practicepianoscroll"), events, false, tapPracticePianoKey);
  $("practicepianorange").textContent = `${pianoNoteName(range.start)}–${pianoNoteName(range.end)} · 音域較寬時可左右滑動`;
}

function tapPracticePianoKey(event){
  event.preventDefault();
  const button = event.currentTarget;
  const midi = Number(button.dataset.midi);
  const ac = Audio.ctx();
  if (ac) Audio.voice(mtof(midi), ac.currentTime, 0.32, midi < 60 ? 0.31 : 0.24, midi < 60 ? "bass" : "piano");
  flashPianoKey(button);
}

function setPracticePiano(open, redrawScore = true){
  state.practicePianoOpen = !!open;
  $("practicepiano").hidden = !state.practicePianoOpen;
  $("togglepracticepiano").setAttribute("aria-expanded", state.practicePianoOpen ? "true" : "false");
  try { localStorage.setItem(PRACTICE_PIANO_KEY, state.practicePianoOpen ? "1" : "0"); } catch {}
  if (state.practicePianoOpen) renderPracticePiano();
  if (redrawScore) requestAnimationFrame(redraw);
}

function restorePracticePiano(){
  let open = false;
  try { open = localStorage.getItem(PRACTICE_PIANO_KEY) === "1"; } catch {}
  setPracticePiano(open, false);
}

function renderTapPiano(){
  stopTapPiano();
  const ex = buildTapExercise();
  const plan = drawExercise($("microscore"), ex, {
    showNames:false, showHarmony:false, showChords:false, zoom:1.05, perLine:2, maxHeight:210,
  });
  const events = buildTapEvents(plan);
  const bpm = generatorLevels(presetVector(microLevel())).bpm;
  state.micro.item = {kind:"piano", ex, plan, events, bpm};
  state.micro.attempts = 0;
  state.micro.correct = 0;
  $("microquestion").textContent = `${tapHand() === "lh" ? "左手低音譜" : "右手高音譜"} · ${ex.key.displayName} · ${ex.ts} · ♩=${bpm} · 共 ${events.length} 個音`;
  $("microstats").textContent = `0 / ${events.length}`;
  $("tapstatus").textContent = "按開始後先聽一小節預備拍";
  $("tapstart").disabled = events.length === 0;
  $("tapstart").textContent = "開始跟拍";
  $("microfeedback").textContent = "每個音都要按；按錯不會跳過，拍點過了才算漏音。";
  $("microfeedback").style.color = "#8A6520";
  renderPianoKeyboard(events);
}

function startTapPiano(){
  const item = state.micro.item;
  if (!state.micro.open || item?.kind !== "piano" || !item.events.length) return;
  stopTapPiano();
  if (!Metro.ensure()){
    $("microfeedback").textContent = "點一下畫面啟用音訊後再試。";
    return;
  }
  const secondsPerBeat = 60 / item.bpm;
  const countIn = item.ex.beats || 4;
  const audioStart = Metro.ac.currentTime + 0.18;
  const totalClicks = Math.ceil(countIn + item.plan.total);
  for (let beat = 0; beat < totalClicks; beat++) Metro._click(audioStart + beat * secondsPerBeat, beat % countIn === 0);
  const startMs = performance.now() + (audioStart - Metro.ac.currentTime + countIn * secondsPerBeat) * 1000;
  const windowMs = Math.max(260, Math.min(500, secondsPerBeat * 1000 * 0.48));
  state.micro.tapMatcher = new TapSightMatcher(item.events, item.bpm, startMs, windowMs);
  state.micro.tapStartMs = startMs;
  state.micro.tapEndMs = startMs + item.plan.total * secondsPerBeat * 1000;
  $("tapstart").disabled = true;
  $("tapstatus").textContent = "預備拍…手先放在小鋼琴上";
  $("microfeedback").textContent = "先看譜，正拍開始後跟著節奏按鍵。";
  state.micro.tapTimer = setInterval(updateTapPiano, 40);
  state.micro.roundTimer = setTimeout(finishTapPiano,
    Math.max(0, state.micro.tapEndMs - performance.now()) + windowMs + 100);
  paintTapProgress(startMs - 1);
}

function updateTapPiano(){
  const matcher = state.micro.tapMatcher;
  if (!matcher) return;
  const now = performance.now();
  matcher.tick(now);
  paintTapProgress(now);
  if (now < state.micro.tapStartMs){
    const left = Math.max(1, Math.ceil((state.micro.tapStartMs - now) / 1000));
    $("tapstatus").textContent = `預備拍 · ${left}`;
    return;
  }
  const done = matcher.events.filter((event) => event.status !== "pending").length;
  const hit = matcher.events.filter((event) => event.status === "hit").length;
  $("microstats").textContent = `${hit} / ${matcher.events.length}`;
  $("tapstatus").textContent = `進行中 · 第 ${Math.min(done + 1, matcher.events.length)} / ${matcher.events.length} 音`;
}

function flashPianoKey(button, className){
  button.classList.add("is-pressed");
  if (className) button.classList.add(className);
  setTimeout(() => {
    button.classList.remove("is-pressed");
    if (className) button.classList.remove(className);
  }, 150);
}

function tapPianoKey(event){
  event.preventDefault();
  const button = event.currentTarget;
  const midi = Number(button.dataset.midi);
  const ac = Audio.ctx();
  if (ac) Audio.voice(mtof(midi), ac.currentTime, 0.22, 0.16);
  const matcher = state.micro.tapMatcher;
  if (!matcher){
    flashPianoKey(button);
    $("microfeedback").textContent = `這是 ${pianoNoteName(midi)}；準備好再按「開始跟拍」。`;
    return;
  }
  const now = performance.now();
  if (now < state.micro.tapStartMs - matcher.windowMs){
    flashPianoKey(button);
    $("microfeedback").textContent = "還在預備拍；可以先把手放好，正拍開始才計分。";
    $("microfeedback").style.color = "#8A6520";
    return;
  }
  const result = matcher.tap(midi, now);
  flashPianoKey(button, result.correct ? "is-correct" : "is-wrong");
  $("microfeedback").textContent = result.correct
    ? `正確 · ${result.target.errorMs >= 0 ? "+" : ""}${Math.round(result.target.errorMs)}ms`
    : "音高不對，這一拍還沒過可以立刻改按。";
  $("microfeedback").style.color = result.correct ? "#2D6A45" : "#A33A2B";
  paintTapProgress();
}

function finishTapPiano(){
  const matcher = state.micro.tapMatcher;
  if (!matcher) return;
  clearInterval(state.micro.tapTimer);
  state.micro.tapTimer = null;
  const result = matcher.result(state.micro.tapEndMs + matcher.windowMs + 1);
  paintTapProgress(state.micro.tapEndMs);
  state.micro.tapMatcher = null;
  $("microstats").textContent = `${result.correct} / ${result.expected}`;
  $("tapstatus").textContent = `完成 · 命中 ${Math.round(result.accuracy * 100)}%`;
  $("tapstart").disabled = false;
  $("tapstart").textContent = "再練同一段";
  $("microfeedback").textContent = `答對 ${result.correct}/${result.expected} · 漏 ${result.missed} · 按錯 ${result.wrongTaps}` +
    (result.medianTimingMs == null ? "" : ` · 拍點中位誤差 ${Math.round(result.medianTimingMs)}ms`);
  $("microfeedback").style.color = result.rating === "smooth" ? "#2D6A45" : "#8A6520";
  Library.recordDrill("tap-piano", {
    correct:result.rating !== "collapse", responseMs:result.medianTimingMs || 0, rating:result.rating,
    details:{accuracy:result.accuracy, expected:result.expected, missed:result.missed,
      wrongTaps:result.wrongTaps, hand:tapHand(), level:microLevel(), bpm:state.micro.item.bpm},
  });
  renderLibrary();
}

function buildMicroItem(kind){
  const level = microLevel();
  const make = (density, keyPool = "level") => generateExercise({
    ...readCfg(), bars:1, hands:"rh", lhPattern:null, keyPool,
    level, difficulty:presetVector(level), density, focus:"none", seed:undefined,
  });

  if (kind === "note"){
    const history = new Map(Library.notePositionStats().map((item) => [item.position, item]));
    const candidates = [];
    for (let tries = 0; tries < 12; tries++){
      const ex = make("long");
      const note = melodyNotes(ex)[0]?.note;
      if (!note) continue;
      const position = `${noteName(note)}${note.o}`;
      const prior = history.get(position);
      const weight = 1 + (prior ? (1 - (prior.accuracy ?? 1)) * 4 + (prior.medianResponseMs || 0) / 900 : 0);
      candidates.push({ex, note, position, weight});
    }
    let pick = candidates[0], ticket = Math.random() * candidates.reduce((sum, item) => sum + item.weight, 0);
    for (const candidate of candidates){ ticket -= candidate.weight; if (ticket <= 0){ pick = candidate; break; } }
    if (!pick){
      const ex = make("long"), note = melodyNotes(ex)[0]?.note || {l:0,a:0,o:4};
      pick = {ex, note, position:`${noteName(note)}${note.o}`};
    }
    const answer = noteName(pick.note);
    return {kind:"note", ex:pick.ex, position:pick.position, question:"這個音的音名是？", answer, choices:["C", "D", "E", "F", "G", "A", "B"]};
  }

  if (kind === "rhythm"){
    const rhythmDensity = ["long", "quarter", "eighth", "varied", "16th", "16th"][level - 1];
    const source = make(rhythmDensity, "C");
    const ex = source;
    for (const measure of ex.measures){
      for (const side of ["top", "bottom"]){
        for (const item of measure[side] || []) if (!item.rest) item.note = {l:6,a:0,o:4};
      }
    }
    const bpm = generatorLevels(presetVector(level)).bpm;
    return {kind:"rhythm", ex, bpm, question:`先聽一小節預備拍，再照譜拍節奏 · ♩=${bpm}`, choices:[]};
  }

  const allChoices = ["上行級進", "下行級進", "上行跳進", "下行跳進"];
  const choices = level <= 2 ? allChoices.slice(0, 2) : allChoices;
  const answer = choices[Math.floor(Math.random() * choices.length)];
  const noteCount = level === 1 ? 2 : (level <= 3 ? 3 : 4);
  const ex = make("quarter", "C"), notes = melodyNotes(ex).slice(0, noteCount);
  const direction = answer.startsWith("上") ? 1 : -1;
  const distance = answer.endsWith("級進") ? 1 : Math.min(4, 2 + Math.floor((level - 3) / 2));
  const start = direction > 0 ? 28 : 35;
  notes.forEach((item, index) => {
    const value = start + direction * distance * index;
    item.note = {l:((value % 7) + 7) % 7, a:0, o:Math.floor(value / 7)};
  });
  return {kind:"shape", ex, question:"把音讀成形狀：這段是？", answer, choices};
}

function renderMicro(){
  const micro = state.micro;
  if (micro.kind === "piano"){
    renderTapPiano();
    return;
  }
  clearTimeout(micro.roundTimer);
  micro.roundTimer = null;
  micro.rhythmMatcher = null;
  micro.item = buildMicroItem(micro.kind);
  micro.startedAt = performance.now();
  $("microquestion").textContent = micro.item.question;
  $("microfeedback").textContent = "";
  $("microstats").textContent = `${micro.correct} / ${micro.attempts}`;
  micro.item.plan = drawExercise($("microscore"), micro.item.ex, {
    showNames:false, showHarmony:false, showChords:false, zoom:1.05, perLine:1, maxHeight:220,
  });
  const answers = $("microanswers");
  answers.innerHTML = "";
  if (micro.item.kind === "rhythm"){
    const button = document.createElement("button");
    button.type = "button";
    button.className = "rhythm-tap";
    button.textContent = "開始節奏拍打";
    button.addEventListener("click", startRhythmRound, {once:true});
    answers.appendChild(button);
    return;
  }
  micro.item.choices.forEach((choice) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = choice;
    button.addEventListener("click", () => answerMicro(choice));
    answers.appendChild(button);
  });
}

function updateMicroTime(){
  if (!state.micro.open) return;
  const seconds = Math.max(0, Math.ceil((state.micro.endsAt - Date.now()) / 1000));
  $("microtime").textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  if (seconds <= 0 && !state.micro.lessonOwned) closeMicro(true);
}

function startMicroClock(seconds = 90){
  clearInterval(state.micro.timer);
  state.micro.endsAt = Date.now() + seconds * 1000;
  updateMicroTime();
  state.micro.timer = setInterval(updateMicroTime, 250);
}

function openMicro(kind = "piano", lessonOwned = false){
  if (Metro.on) toggleMetro();
  state.micro.open = true;
  state.micro.kind = kind;
  state.micro.lessonOwned = lessonOwned;
  state.micro.attempts = 0;
  state.micro.correct = 0;
  $("micropanel").hidden = false;
  $("mode-micro").setAttribute("aria-pressed", "true");
  $("micropanel").querySelectorAll("[data-kind]").forEach((button) =>
    button.setAttribute("aria-pressed", button.dataset.kind === kind ? "true" : "false"));
  renderMicro();
  if (kind !== "piano") startMicroClock(lessonOwned ? (LESSON_PHASES[state.lesson?.phase]?.seconds || 90) : 90);
}

function closeMicro(force = false){
  if (state.micro.lessonOwned && !force){ stopLesson(); return; }
  state.micro.open = false;
  state.micro.lessonOwned = false;
  stopTapPiano();
  clearInterval(state.micro.timer);
  clearTimeout(state.micro.roundTimer);
  state.micro.timer = null;
  state.micro.roundTimer = null;
  state.micro.rhythmMatcher = null;
  $("micropanel").hidden = true;
  $("mode-micro").setAttribute("aria-pressed", "false");
}

function startRhythmRound(){
  const micro = state.micro;
  if (!micro.open || micro.kind !== "rhythm" || !micro.item?.plan) return;
  if (!Metro.ensure()){
    $("microfeedback").textContent = "點一下畫面啟用音訊後再試。";
    return;
  }
  const bpm = micro.item.bpm || generatorLevels(presetVector(microLevel())).bpm;
  const beats = micro.item.ex.beats || 4;
  const secondsPerBeat = 60 / bpm;
  const audioStart = Metro.ac.currentTime + 0.18;
  for (let beat = 0; beat < beats * 2; beat++) Metro._click(audioStart + beat * secondsPerBeat, beat % beats === 0);
  const performanceStart = performance.now() + (audioStart - Metro.ac.currentTime + beats * secondsPerBeat) * 1000;
  micro.rhythmMatcher = new PerformanceMatcher(micro.item.plan, bpm, performanceStart, "onset");
  const button = $("microanswers").querySelector("button");
  button.textContent = "拍一下（空白鍵也可以）";
  button.addEventListener("click", tapRhythm);
  $("microfeedback").textContent = "預備拍…";
  micro.roundTimer = setTimeout(finishRhythmRound, (beats * 2 * secondsPerBeat + 0.65) * 1000);
}

function tapRhythm(){
  if (!state.micro.rhythmMatcher) return;
  state.micro.rhythmMatcher.hit(null, performance.now());
  $("microfeedback").textContent = "已拍 · 繼續";
}

function finishRhythmRound(){
  const micro = state.micro;
  if (!micro.rhythmMatcher) return;
  const result = micro.rhythmMatcher.result();
  micro.rhythmMatcher = null;
  micro.attempts += 1;
  const correct = result.rating !== "collapse";
  if (correct) micro.correct += 1;
  $("microstats").textContent = `${micro.correct} / ${micro.attempts}`;
  Library.recordDrill("rhythm", {
    correct, responseMs:result.medianTimingMs || 0, rating:result.rating,
    details:{accuracy:result.accuracy, expected:result.expected, hits:result.hits, errorTags:result.errorTags},
  });
  $("microfeedback").textContent = `命中 ${Math.round(result.accuracy * 100)}% · 中位誤差 ${Math.round(result.medianTimingMs || 0)}ms`;
  renderLibrary();
  micro.roundTimer = setTimeout(() => { if (micro.open && micro.kind === "rhythm") renderMicro(); }, 850);
}

function answerMicro(choice){
  const micro = state.micro;
  if (!micro.item) return;
  const correct = choice === micro.item.answer;
  const responseMs = Math.round(performance.now() - micro.startedAt);
  micro.attempts += 1;
  if (correct) micro.correct += 1;
  $("microstats").textContent = `${micro.correct} / ${micro.attempts}`;
  Library.recordDrill(micro.kind, {
    correct, responseMs,
    details:{answer:micro.item.answer, chosen:choice, key:micro.item.ex.key?.id, ts:micro.item.ex.ts,
      position:micro.item.position || null},
  });
  $("microfeedback").textContent = correct ? `正確 · ${responseMs}ms` : `答案是 ${micro.item.answer}`;
  $("microfeedback").style.color = correct ? "#2D6A45" : "#A33A2B";
  $("microanswers").querySelectorAll("button").forEach((button) => { button.disabled = true; });
  renderLibrary();
  micro.roundTimer = setTimeout(() => { if (state.micro.open) renderMicro(); }, 450);
}

/* ---------- 8 分鐘導引與每週固定測驗 ---------- */

const LESSON_PHASES = [
  {seconds:15, title:"準備掃描", detail:"先找：調號？最小音符？最難的小節？", kind:"scan"},
  {seconds:180, title:"1/3 跟拍選音", detail:"逐音看譜，跟著節拍在小鋼琴上選音", kind:"micro-piano"},
  {seconds:240, title:"2/3 連續閱讀", detail:"六軸自適應；遮罩強迫眼睛留在手前方", kind:"read"},
  {seconds:60, title:"3/3 弱點重生", detail:"保留卡點特徵，換新種子收尾", kind:"weak"},
];

function savedSessionSettings(){
  return {
    flow:$("flow").value, mask:$("maskmode").value, bars:$("bars").value,
    bpm:currentBpm(), vector:currentVector(), exerciseOverride:state.exerciseOverride,
  };
}

function restoreSessionSettings(saved){
  if (!saved) return;
  state.exerciseOverride = saved.exerciseOverride || null;
  $("flow").value = saved.flow;
  $("maskmode").value = saved.mask;
  $("bars").value = saved.bars;
  applyVectorToUi(saved.vector);
  setBpm(saved.bpm);
  syncFlow();
}

function startLesson(){
  if (state.weekly) finishWeekly(false);
  if (state.lesson) return;
  state.lesson = {
    phase:0, openedAt:Date.now(), trainingStartedAt:0, phaseEndsAt:0, timer:null,
    saved:savedSessionSettings(),
  };
  $("lessonbar").hidden = false;
  $("lessonnext").hidden = false;
  $("lessonstop").textContent = "停止";
  enterLessonPhase(0);
  state.lesson.timer = setInterval(tickLesson, 250);
}

function enterLessonPhase(index){
  const lesson = state.lesson;
  if (!lesson) return;
  if (index >= LESSON_PHASES.length){ stopLesson(true); return; }
  if (Metro.on) toggleMetro();
  closeMicro(true);
  document.body.classList.remove("lesson-scanning");
  lesson.phase = index;
  const phase = LESSON_PHASES[index];
  lesson.phaseEndsAt = Date.now() + phase.seconds * 1000;
  $("lessonphase").textContent = phase.title;
  $("lessondetail").textContent = phase.detail;

  if (phase.kind === "scan"){
    if (state.mode !== "read") setMode("read");
    state.exerciseOverride = null;
    state.activeWeaknessId = null;
    $("flow").value = "manual";
    $("maskmode").value = "off";
    syncFlow();
    generate({fresh:true});
    document.body.classList.add("lesson-scanning");
    $("clipmeta").textContent = "先掃描，不要彈：調號？最小音符？最難的小節？";
    return;
  }
  if (!lesson.trainingStartedAt) lesson.trainingStartedAt = Date.now();

  if (phase.kind === "micro-piano"){
    openMicro("piano", true);
    return;
  }

  if (state.mode !== "read") setMode("read");
  state.exerciseOverride = null;
  state.activeWeaknessId = null;
  $("bars").value = "4";
  $("flow").value = phase.kind === "read" ? "flow" : "manual";
  $("maskmode").value = phase.kind === "read" ? "follow" : "off";
  if (phase.kind === "weak" && practiceWeakness()){
    // practiceWeakness has already generated a feature-preserving score.
  } else {
    if (phase.kind === "read"){
      setBpm(Math.min(60, currentBpm()));
      const vector = currentVector();
      vector.eyeHand = Math.max(2, vector.eyeHand);
      applyVectorToUi(vector);
    }
    generate({fresh:true});
  }
  if (!Metro.on) toggleMetro();
}

function tickLesson(){
  const lesson = state.lesson;
  if (!lesson) return;
  const phaseLeft = Math.max(0, Math.ceil((lesson.phaseEndsAt - Date.now()) / 1000));
  if (lesson.phase === 0){
    $("lessontime").textContent = `準備 ${String(phaseLeft).padStart(2, "0")}`;
  } else {
    const totalLeft = Math.max(0, 480 - Math.floor((Date.now() - lesson.trainingStartedAt) / 1000));
    $("lessontime").textContent = `${String(Math.floor(totalLeft / 60)).padStart(2, "0")}:${String(totalLeft % 60).padStart(2, "0")}`;
    if (state.micro.lessonOwned) $("microtime").textContent = `${String(Math.floor(phaseLeft / 60)).padStart(2, "0")}:${String(phaseLeft % 60).padStart(2, "0")}`;
  }
  if (phaseLeft <= 0) enterLessonPhase(lesson.phase + 1);
}

function stopLesson(completed = false){
  const lesson = state.lesson;
  if (!lesson) return;
  clearInterval(lesson.timer);
  if (Metro.on) toggleMetro();
  closeMicro(true);
  document.body.classList.remove("lesson-scanning");
  const elapsed = lesson.trainingStartedAt
    ? Math.min(480, Math.max(0, Math.round((Date.now() - lesson.trainingStartedAt) / 1000))) : 0;
  Library.recordDrill("guided-8min", {responseMs:elapsed * 1000, details:{completed, phase:lesson.phase + 1}});
  const saved = lesson.saved;
  state.lesson = null;
  restoreSessionSettings(saved);
  $("lessonbar").hidden = true;
  $("clipmeta").textContent = completed ? "8 分鐘導引完成" : "導引已停止";
  generate({fresh:true});
}

const WEEKLY_SEGMENTS = [
  {seed:0x51a001,level:2,ts:"4/4",hands:"rh",density:"quarter",focus:"none",bars:4,difficulty:presetVector(2)},
  {seed:0x51a002,level:3,ts:"3/4",hands:"both",lhPattern:"sustain",density:"eighth",focus:"none",bars:4,difficulty:presetVector(3)},
  {seed:0x51a003,level:3,ts:"4/4",hands:"lh",density:"varied",focus:"leap",bars:4,difficulty:presetVector(3)},
  {seed:0x51a004,level:4,ts:"4/4",hands:"both",lhPattern:"block",density:"varied",focus:"ledger",bars:4,difficulty:presetVector(4)},
  {seed:0x51a005,level:4,ts:"3/4",hands:"swap",lhPattern:"arpeggio",density:"varied",focus:"none",bars:4,difficulty:presetVector(4)},
];

function isoWeekId(date = new Date()){
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  utc.setUTCDate(utc.getUTCDate() + 4 - (utc.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function weeklySeed(base, week){
  let hash = 2166136261;
  for (const char of week){ hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (base ^ (hash >>> 0)) >>> 0;
}

function startWeekly(){
  if (state.lesson) stopLesson(false);
  closeMicro(true);
  if (Metro.on) toggleMetro();
  const week = isoWeekId();
  state.weekly = {
    week, index:0, attempts:[], startedAt:new Date().toISOString(), saved:savedSessionSettings(),
    eyeHandBeats:EYE_HAND_BEATS[currentVector().eyeHand] ?? 0,
    noteMedianMs:Library.drillStats("note").medianResponseMs,
  };
  $("lessonbar").hidden = false;
  $("lessonnext").hidden = true;
  $("lessonstop").textContent = "結束測驗";
  setupWeeklySegment();
}

function setupWeeklySegment(){
  const weekly = state.weekly;
  if (!weekly) return;
  if (weekly.index >= WEEKLY_SEGMENTS.length){ finishWeekly(true); return; }
  if (state.mode !== "read") setMode("read");
  state.activeWeaknessId = null;
  const spec = WEEKLY_SEGMENTS[weekly.index];
  state.exerciseOverride = {...spec, seed:weeklySeed(spec.seed, weekly.week)};
  $("flow").value = "manual";
  $("maskmode").value = "off";
  setBpm(60);
  syncFlow();
  $("lessonphase").textContent = `本週測驗 ${weekly.index + 1} / ${WEEKLY_SEGMENTS.length}`;
  $("lessondetail").textContent = "固定難度規格；每週使用全新種子；無遮蔽・♩=60";
  $("lessontime").textContent = `${weekly.index + 1}/5`;
  generate({fresh:true});
  if (!Metro.on) toggleMetro();
}

function weeklyAcceptAttempt(attempt){
  if (!state.weekly || !attempt?.completed || !attempt.rating) return;
  state.weekly.attempts.push({
    rating:attempt.rating,
    accuracy:attempt.metrics?.accuracy ?? null,
    medianTimingMs:attempt.metrics?.timingMedianMs ?? attempt.metrics?.medianTimingMs ?? null,
    seed:state.stream?.current()?.seed ?? null,
  });
  state.weekly.index += 1;
  setTimeout(() => {
    if (!state.weekly) return;
    if (Metro.on) toggleMetro();
    setupWeeklySegment();
  }, 120);
}

function finishWeekly(completed){
  const weekly = state.weekly;
  if (!weekly) return;
  if (Metro.on) toggleMetro();
  const details = weekly.attempts;
  const objective = details.filter((item) => item.accuracy != null);
  const timing = details.map((item) => item.medianTimingMs).filter(Number.isFinite).sort((a, b) => a - b);
  const smooth = details.filter((item) => item.rating === "smooth").length;
  Library.recordWeeklyTest({
    week:weekly.week, startedAt:weekly.startedAt, endedAt:new Date().toISOString(),
    segments:WEEKLY_SEGMENTS.length, completed:details.length,
    accuracy:objective.length ? objective.reduce((sum, item) => sum + item.accuracy, 0) / objective.length : null,
    medianTimingMs:timing.length ? timing[Math.floor(timing.length / 2)] : null,
    smoothRate:details.length ? smooth / details.length : null,
    eyeHandBeats:weekly.eyeHandBeats, noteMedianMs:weekly.noteMedianMs, details,
  });
  const saved = weekly.saved;
  state.weekly = null;
  restoreSessionSettings(saved);
  $("lessonbar").hidden = true;
  $("lessonnext").hidden = false;
  $("clipmeta").textContent = completed ? `週測完成 · 順暢 ${smooth}/${details.length}` : `週測已結束 · 完成 ${details.length}/5`;
  generate({fresh:true});
  renderLibrary();
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
    div.innerHTML = '<div class="cap">' + (i + 1) + ". " + esc(e.keyName) +
                    " · lv" + esc(e.level) + " · " + esc(e.ts) + " · " + esc(e.roman) + "</div>" +
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
  const live = (posOverride !== undefined) || Metro.on;
  if (!live){ el.hidden = true; return; }

  const pos = (posOverride !== undefined) ? posOverride : Metro.position();
  if (pos < 0){ el.hidden = true; return; }        // 預備拍期間不顯示
  updateEyeMask(pos);

  const layout = state.layouts[state.nowRow];
  if (!layout || !layout.length){ el.hidden = true; return; }

  let bar;
  if (state.mode === "read"){
    const ex = state.stream && state.stream.current();
    if (!ex){ el.hidden = true; return; }
    bar = state.stream.barInSegment(pos, ex.beats);
  } else {
    // 和弦模式沒有換段，就在整條進行上循環 —— 練 changes 本來就是一直繞
    const d = state.drill;
    if (!d){ el.hidden = true; return; }
    const n = Math.floor(pos / d.beats);
    bar = ((n % layout.length) + layout.length) % layout.length;
  }
  if (bar < 0 || bar >= layout.length){ el.hidden = true; return; }

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
  if ($("maskmode").value === "follow") clearEyeMasks();
}

function renderAnswerBox(){
  const box = $("answer");
  // 和弦拆解卡與揭曉後的譜面已經同時提供級數、音名與實際節奏；
  // 舊答案列只會重複資訊並吃掉 iPad 橫向時最珍貴的譜面高度。
  box.innerHTML = "";
  box.hidden = true;
}

function redraw(){
  if (state.mode === "read" && state.stream && state.stream.current()) renderRead();
  else if (state.mode === "chord" && state.drill) renderChord();
}

/* ---------- 出題 ---------- */

function readCfg(){
  const base = {
    level: parseInt($("lv").value, 10),
    difficulty:currentVector(),
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
  return state.exerciseOverride ? Object.assign(base, state.exerciseOverride) : base;
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
  if (Metro.on) finishCurrentAttempt(false, "changed", currentAttemptBars());
  const sel = $("hands");
  sel.value = HAND_SWAP[sel.value] || "swap";
  refreshLhPatterns();
  Audio.stop(); highlight(null); setPlayLabel(false);
  state.reviewIdx = -1;
  $("stage").classList.remove("reviewing");
  state.stream.restyle({hands: sel.value});
  if (Metro.on) state.stream.segStartBar = nextAttemptStartBar(state.stream.current());
  renderRead();
  logCurrent();
  if (Metro.on) beginCurrentAttempt();
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
  if (Metro.on) finishCurrentAttempt(false, "changed", currentAttemptBars());
  Audio.stop();
  highlight(null);
  setPlayLabel(false);
  state.revealed = $("revealed").checked;
  state.reviewIdx = -1;
  state.loopCount = 0;
  $("stage").classList.remove("reviewing");

  if (state.mode === "read"){
    if (o.sameSeed) state.stream.replay();
    else if (o.fresh) state.stream.reset();
    else state.stream.regenerate();
    // 手動換題等於把節拍器的段落起點對到現在
    state.stream.segStartBar = Metro.on ? nextAttemptStartBar(state.stream.current()) : 0;
    renderRead();
    logCurrent();
    if (Metro.on) beginCurrentAttempt();
  } else {
    const drill = {
      prog: $("prog").value,
      order: $("korder").value,
      fixed: $("kfixed").value,
      count: parseInt($("ncyc").value, 10),
      stage: $("chordstage").value,
      extensions: $("chordextensions").checked,
      range: $("chordrange").value,
      contour: $("chordcontour").value,
      rhythm: $("chordrhythm").value,
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
  if (Metro.on) toggleMetro();
  if (state.micro.open) closeMicro(true);
  state.mode = m;
  $("mode-read").setAttribute("aria-pressed", m === "read" ? "true" : "false");
  $("mode-chord").setAttribute("aria-pressed", m === "chord" ? "true" : "false");
  $("mode-micro").setAttribute("aria-pressed", "false");
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
  if (!$("playalong").checked || !Metro.on || !state.plan.events.length) return;
  let startBeat;
  if (state.mode === "read"){
    startBeat = state.stream.segStartBar * (state.stream.current().beats || 4);
  } else {
    const bars = (state.plans[0] && state.plans[0].layout.length) || 1;
    startBeat = state.playAlongCycle * bars * (state.drill ? state.drill.beats : 4);
  }
  const ok = Audio.play(state.plan, currentBpm(), highlight, onPlayAlongEnd,
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
  const ok = Audio.play(state.plan, currentBpm(), highlight, () => setPlayLabel(false));
  if (!ok){ $("clipmeta").textContent = "沒有可播放的內容"; return; }
  setPlayLabel(true);
}

/* ---------- 節拍器 ---------- */

function nextAttemptStartBar(cur){
  if (!Metro.on || !cur) return 0;
  const positionInBars = Metro.position() / (cur.beats || 4);
  return Math.max(Metro.barsDone, Math.ceil(positionInBars - 0.0001), 0);
}

function currentAttemptBars(){
  if (!Metro.on || state.mode !== "read" || !state.stream) return 0;
  const cur = state.stream.current();
  if (!cur) return 0;
  const elapsed = Metro.position() / (cur.beats || 4) - state.stream.segStartBar;
  return Math.max(0, Math.min(cur.cfg.bars, elapsed));
}

function beginCurrentAttempt(){
  if (!Metro.on || state.mode !== "read" || state.reviewIdx !== -1 || !state.stream) return null;
  const cur = state.stream.current();
  if (!cur) return null;
  const attempt = Library.startAttempt(cur, {
    barsPlanned: cur.cfg.bars,
    bpm: currentBpm(),
    mode: state.mode,
    flow: $("flow").value,
    targetAxis:Library.data.adaptive.lastAxis,
    weaknessId:state.activeWeaknessId,
  });
  if (attempt){
    state.libId = attempt.exerciseId;
    if (state.inputMode && Metro.ac){
      const firstBeat = state.stream.segStartBar * (cur.beats || 4);
      const startMs = performance.now() + (Metro.timeOfBeat(firstBeat) - Metro.ac.currentTime) * 1000;
      state.matcher = new PerformanceMatcher(state.plan, currentBpm(), startMs, state.inputMode);
    } else {
      state.matcher = null;
    }
  }
  return attempt;
}

function finishCurrentAttempt(completed, reason, barsCompleted){
  if (!Library.activeAttemptId) return null;
  // 連續流不能被表單卡住：上一段若一直沒評，直到下一段完成才預設為「順」。
  if (completed) ratePending("smooth", true);
  const metrics = state.matcher?.result() || null;
  state.matcher = null;
  const attempt = Library.finishAttempt({completed, reason, barsCompleted, metrics, errorTags:metrics?.errorTags});
  if (attempt){
    if (completed && metrics?.hits){
      const result = Library.rateAttempt(attempt.id, metrics.rating);
      const adjustment = applyStaircase(result);
      $("clipmeta").textContent = `偵測 ${Math.round(metrics.accuracy * 100)}% · ${metrics.rating === "smooth" ? "順" : (metrics.rating === "stumble" ? "有絆" : "垮掉")}` +
        (adjustment ? ` · ${adjustment}` : "");
      weeklyAcceptAttempt(attempt);
      if (attempt.weaknessId){ state.exerciseOverride = null; state.activeWeaknessId = null; }
    } else if (completed) askForRating(attempt);
    renderLibrary();
  }
  return attempt;
}

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
  if (state.reviewIdx !== -1) return;
  const cur = state.stream.current();
  if (!cur) return;
  // 彈滿一整段才換 —— 舊版在最後一小節的第一拍就換，等於少給一小節
  if (barsDone - state.stream.segStartBar < cur.cfg.bars) return;

  finishCurrentAttempt(true, "completed", cur.cfg.bars);
  if ($("flow").value === "manual"){
    $("clipmeta").textContent = "本段完成 · 節拍器仍在跑";
    return;
  }

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
      beginCurrentAttempt();
      return;
    }
    state.loopCount = 0;
  }

  advanceSegment(barsDone);
  beginCurrentAttempt();
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
    const barsCompleted = currentAttemptBars();
    const planned = state.stream?.current()?.cfg?.bars || 0;
    const completed = planned > 0 && barsCompleted >= planned;
    finishCurrentAttempt(completed, completed ? "completed" : "stopped", barsCompleted);
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
  beginCurrentAttempt();
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
  $("mode-micro").addEventListener("click", () => openMicro("piano"));
  $("togglepracticepiano").addEventListener("click", () => setPracticePiano(!state.practicePianoOpen));
  $("closepracticepiano").addEventListener("click", () => setPracticePiano(false));
  $("startlesson").addEventListener("click", startLesson);
  $("gen").addEventListener("click", () => generate());
  $("reveal").addEventListener("click", toggleReveal);
  $("print").addEventListener("click", () => window.print());
  $("play").addEventListener("click", togglePlay);
  $("metro").addEventListener("click", toggleMetro);
  $("fabmetro").addEventListener("click", toggleMetro);
  $("fabgen").addEventListener("click", () => generate());

  $("swaphands").addEventListener("click", swapHands);
  $("ratingbar").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-rating]");
    if (button) ratePending(button.dataset.rating, false);
  });
  $("adaptive").addEventListener("change", function(){
    Library.setAdaptive({enabled:this.checked, level:parseInt($("lv").value, 10), density:$("dens").value, vector:currentVector()});
  });

  $("maskmode").addEventListener("change", setupEyeMask);
  $("scansecs").addEventListener("change", setupEyeMask);

  // 出題設定變了，整條佇列都要重來（下一段是用舊設定生的）
  ["lv", "ts", "hands"].forEach(id =>
    $(id).addEventListener("change", () => {
      if (Metro.on) toggleMetro();
      if (id === "lv") applyVectorToUi(presetVector(parseInt($("lv").value, 10) || 1), {persist:true});
      refreshLhPatterns();
      generate({fresh:true});
    }));
  ["keysel", "bars", "lhpat", "dens", "focus", "inv"].forEach(id =>
    $(id).addEventListener("change", () => {
      if (Metro.on) toggleMetro();
      generate({fresh:true});
    }));
  ["lv", "dens"].forEach(id => $(id).addEventListener("change", () => {
    Library.setAdaptive({level:parseInt($("lv").value, 10), density:$("dens").value});
  }));
  // 換流程不必換題目 —— 只是重畫（反覆記號、預讀那一列）並歸零遍數
  $("flow").addEventListener("change", () => { syncFlow(); redraw(); });
  $("reps").addEventListener("change", () => { state.loopCount = 0; });
  ["shownames", "showharm", "showchords", "showfingering"].forEach(id =>
    $(id).addEventListener("change", () => { redraw(); updateRevealButton(); }));

  $("prog").addEventListener("change", () => { refreshChordKeys(); generate(); });
  ["korder", "kfixed", "ncyc", "chordstage", "chordrange", "chordextensions", "chordcontour", "chordrhythm"].forEach(id =>
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
  $("toptemporange").addEventListener("input", function(){ setBpm(parseInt(this.value, 10)); });
  $("toptempo").addEventListener("change", function(){
    if (this.value) setBpm(parseInt(this.value, 10));
  });
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
  $("practiceweak").addEventListener("click", () => practiceWeakness());
  $("startweekly").addEventListener("click", startWeekly);
  $("connectmidi").addEventListener("click", connectMidi);
  $("connectmic").addEventListener("click", connectMicrophone);
  $("closemicro").addEventListener("click", () => closeMicro());
  $("microlevel").addEventListener("change", () => {
    try { localStorage.setItem(MICRO_LEVEL_KEY, String(microLevel())); } catch {}
    if (state.micro.open) renderMicro();
  });
  $("taphand").addEventListener("change", () => {
    try { localStorage.setItem(TAP_HAND_KEY, tapHand()); } catch {}
    if (state.micro.open) renderMicro();
  });
  $("taplabels").addEventListener("change", () => {
    try { localStorage.setItem(TAP_LABELS_KEY, $("taplabels").checked ? "1" : "0"); } catch {}
    if (state.micro.open && state.micro.item?.kind === "piano") renderPianoKeyboard(state.micro.item.events);
  });
  $("tapstart").addEventListener("click", startTapPiano);
  $("tapnew").addEventListener("click", renderMicro);
  $("micropanel").querySelectorAll("[data-kind]").forEach((button) => button.addEventListener("click", () => {
    state.micro.kind = button.dataset.kind;
    $("micropanel").querySelectorAll("[data-kind]").forEach((item) =>
      item.setAttribute("aria-pressed", item === button ? "true" : "false"));
    renderMicro();
  }));
  $("lessonnext").addEventListener("click", () => {
    if (state.lesson) enterLessonPhase(state.lesson.phase + 1);
  });
  $("lessonstop").addEventListener("click", () => {
    if (state.weekly) finishWeekly(false);
    else if (state.lesson) stopLesson(false);
  });
  $("printsheet").addEventListener("click", printSheet);
  $("exportlib").addEventListener("click", exportLibrary);
  $("importlib").addEventListener("click", () => $("importfile").click());
  $("importfile").addEventListener("change", async function(){
    await importLibrary(this.files?.[0]);
    this.value = "";
  });
  $("clearlib").addEventListener("click", async () => {
    if (!confirm("清除全部長期練習紀錄？包含複習清單與累計時數。")) return;
    if (Metro.on) toggleMetro();
    await Library.clear();
    state.libId = null;
    state.pendingRatingId = null;
    $("ratingbar").hidden = true;
    applyStoredAdaptive();
    renderLibrary();
    syncMarkButton();
  });

  // 練到一半關掉分頁，時數也要算進去
  window.addEventListener("pagehide", () => {
    stopTapPiano(false);
    if (Metro.on){
      const barsCompleted = currentAttemptBars();
      const planned = state.stream?.current()?.cfg?.bars || 0;
      const completed = planned > 0 && barsCompleted >= planned;
      finishCurrentAttempt(completed, completed ? "completed" : "interrupted", barsCompleted);
    }
    ratePending("smooth", true);
    if (state.practiceStart){
      Library.addSeconds((Date.now() - state.practiceStart) / 1000);
      state.practiceStart = 0;
    }
  });

  document.addEventListener("keydown", (e) => {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (document.body.classList.contains("lesson-scanning") && ["m", "p", "n", "r"].includes(k)){
      e.preventDefault();
    }
    else if (state.micro.open && state.micro.kind === "rhythm" && e.code === "Space"){
      e.preventDefault();
      tapRhythm();
    }
    else if (state.pendingRatingId && (k === "1" || k === "2" || k === "3")){
      e.preventDefault();
      ratePending({"1":"smooth", "2":"stumble", "3":"collapse"}[k], false);
    }
    else if (k === "n"){ e.preventDefault(); generate(); }
    else if (k === "r"){ e.preventDefault(); generate({sameSeed:true}); }
    else if (k === "x"){ e.preventDefault(); toggleMark(); }
    else if (k === "s"){ e.preventDefault(); toggleReveal(); }
    else if (k === "m"){ e.preventDefault(); toggleMetro(); }
    else if (k === "p"){ e.preventDefault(); togglePlay(); }
    else if (k === "h"){ e.preventDefault(); swapHands(); }
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
  await Library.load();
  Library.requestPersistence();
  fillLevels();
  fillHands();
  fillDensity();
  fillFocus();
  fillInversions();
  fillAxisControls();
  applyStoredAdaptive();
  fillKeySelect();
  refreshLhPatterns();
  fillProgressions();
  refreshChordKeys();
  restoreMicroLevel();
  restorePracticePiano();
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
