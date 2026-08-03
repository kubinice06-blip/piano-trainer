/* 節奏型庫。
   每個型都在載入時驗證時值總和 —— 原本靠 setStrict(false) 吞掉錯誤，
   結果是節奏一變複雜就排出鬼畫符卻不報錯。 */

export const DUR = {
  "w":4, "hd":3, "h":2, "qd":1.5, "q":1,
  "8d":0.75, "8":0.5, "16d":0.375, "16":0.25
};

export const TIME_SIGNATURES = {
  "4/4": {beats:4, beatValue:4, beamGroups:[[1,4]]},
  "3/4": {beats:3, beatValue:4, beamGroups:[[1,4]]},
  "2/4": {beats:2, beatValue:4, beamGroups:[[1,4]]}
};

export function tsInfo(ts){ return TIME_SIGNATURES[ts] || TIME_SIGNATURES["4/4"]; }

export function patternLength(pat){
  var t = 0;
  for (var i = 0; i < pat.length; i++){
    var d = DUR[pat[i]];
    if (d === undefined) throw new Error("未知時值 " + pat[i]);
    t += d;
  }
  return t;
}

/* ---------- 節奏語彙階梯 ----------
 *
 * 舊版是「難度 n＝第 1..n 層混在一起抽」，於是同一段的第一小節可能是全音符、
 * 第二小節就是六個八分音符 —— 讀起來忽長忽短。那不是難度，是雜訊。
 *
 * 這一版是階梯：每一階只有一組窄的音符語彙，一段之內的節奏因此是一致的。
 * 順序照教材走：長音 → 加四分 → 純四分 → 加八分 → 純八分 → 附點切分 →
 * 加十六分 → 純十六分。純的那幾階整段只有同一種音符，那正是重點 ——
 * 練「認四分音符」的時候節奏不該再變，眼睛才騰得出全部注意力給音高。
 *
 * cells 是「剛好填滿一拍」的組合，longs 是跨拍的長音；一小節從第一拍往後鋪。
 * 以拍為單位鋪，十六分就不會跨過拍點黏成一團，符桿分組自然是對的。
 * signature 是這一階的招牌音符，含有它的型權重加重，不然附點會被平凡的型淹沒。
 */
const STEPS = [
  {id:"long",            label:"長音（全・二分）",    split:0,
   cells:[],                    longs:["w","hd","h"]},
  {id:"longQuarter",     label:"長音＋四分混合",      split:0.30,
   cells:[["q"]],               longs:["w","hd","h"]},
  {id:"quarter",         label:"四分",                split:0,
   cells:[["q"]],               longs:[]},
  /* 混合階只在「一拍之內」變化，不放跨拍長音 —— 否則同一段裡
     A 抽到二分音符、B 抽到連續八分，忽長忽短的老問題又回來了。
     樂句仍然落在長音上：那是收尾小節的事，見 buildClosings。 */
  {id:"quarterEighth",   label:"四分＋八分混合",      split:0.30,
   cells:[["q"],["8","8"]],     longs:[]},
  {id:"eighth",          label:"八分",                split:0,
   cells:[["8","8"]],           longs:[]},
  {id:"dotted",          label:"附點與切分",          split:0.35, syncopation:true,
   cells:[["q"],["8","8"]],     longs:[],   signature:["qd","8d"]},
  {id:"eighthSixteenth", label:"八分＋十六分混合",    split:0.30,
   cells:[["q"],["8","8"],["8","16","16"],["16","16","8"],["16","16","16","16"]],
   longs:[],  signature:["16"]},
  {id:"16th",            label:"十六分",              split:0,
   cells:[["16","16","16","16"],["8","16","16"],["16","16","8"]], longs:[]},
  /* 垂直音程專用：每拍剛好一個音，兩手的縱向關係才對得整齊 */
  {id:"pulse",           label:"每拍一音（垂直音程）", split:0,
   cells:[["q"]],               longs:[]}
];

/* 附點與切分跨過拍點，排不進「一拍一格」的模型，只能列舉。 */
const SYNCOPATION = {
  "4/4":[["qd","8","h"], ["h","qd","8"], ["qd","8","q","q"], ["q","q","qd","8"],
         ["qd","8","qd","8"], ["qd","qd","q"], ["q","qd","8","q"], ["8d","16","q","h"],
         ["8","q","8","h"], ["8","q","q","q","8"], ["8","8","q","8","8","q"],
         ["8","q","q","8","q"], ["q","8","q","8","q"]],
  "3/4":[["qd","8","q"], ["q","qd","8"], ["qd","qd"], ["qd","8","8","8"],
         ["8","q","q","8"], ["8","q","8","q"], ["q","8","q","8"]],
  "2/4":[["qd","8"], ["8","qd"], ["8","q","8"], ["8d","16","q"]]
};

/* 從第一拍往後鋪，把這一階排得出來的小節全部列出來 */
function buildBars(beats, cells, longs, out, acc, pos){
  out = out || []; acc = acc || []; pos = pos || 0;
  if (Math.abs(pos - beats) < 1e-9){ out.push(acc.slice()); return out; }
  for (var i = 0; i < longs.length; i++){
    var n = DUR[longs[i]];
    if (pos + n > beats + 1e-9) continue;
    acc.push(longs[i]);
    buildBars(beats, cells, longs, out, acc, pos + n);
    acc.pop();
  }
  for (var c = 0; c < cells.length; c++){
    if (pos + 1 > beats + 1e-9) break;
    for (var k = 0; k < cells[c].length; k++) acc.push(cells[c][k]);
    buildBars(beats, cells, longs, out, acc, pos + 1);
    acc.length -= cells[c].length;
  }
  return out;
}

/* 收尾小節：前面照這一階的語彙，最後一個音落在長音 —— 樂句要落地。
   純八分、純十六分自己排不出長音，收尾是這幾階唯一的例外。 */
function buildClosings(beats, cells, longs){
  var out = [];
  ["w","hd","h","q"].forEach(function(tail){
    var n = DUR[tail];
    if (n > beats + 1e-9) return;
    if (Math.abs(n - beats) < 1e-9){ out.push([tail]); return; }
    buildBars(beats - n, cells, longs).forEach(function(head){
      out.push(head.concat(tail));
    });
  });
  return out;
}

/* 每個拍號 × 每一階的譜面全部在載入時算好並驗長度 ——
   寧可開發時炸掉，也不要出題時默默畫出小節長度不對的譜。 */
const STEP_BANKS = {};
(function buildAllBanks(){
  var bad = [];
  Object.keys(TIME_SIGNATURES).forEach(function(ts){
    var beats = TIME_SIGNATURES[ts].beats;
    STEP_BANKS[ts] = {};
    STEPS.forEach(function(step){
      var bank = buildBars(beats, step.cells, step.longs);
      if (step.syncopation) bank = bank.concat(SYNCOPATION[ts] || []);
      if (!bank.length) bank = [buildBars(beats, [["q"]], [])[0]];
      var closing = buildClosings(beats, step.cells, step.longs);
      var vocab = {};
      bank.concat(closing).forEach(function(pat){
        pat.forEach(function(d){ vocab[d] = 1; });
        var len = patternLength(pat);
        if (Math.abs(len - beats) > 1e-9){
          bad.push(ts + " " + step.id + " [" + pat.join(" ") + "] = " + len + " 拍，應為 " + beats);
        }
      });
      STEP_BANKS[ts][step.id] = {bank:bank, closing:closing.length ? closing : bank, vocab:vocab};
    });
  });
  if (bad.length) throw new Error("節奏型時值錯誤：\n" + bad.join("\n"));
})();

/* 舊存檔（弱點指紋、練習紀錄）裡還留著上一版的 id */
const ALIASES = {auto:"quarter", varied:"dotted"};

export const NOTE_DENSITY = STEPS.map(function(s){ return {id:s.id, label:s.label}; });

export function densityMode(id){
  var wanted = ALIASES[id] || id;
  for (var i = 0; i < STEPS.length; i++) if (STEPS[i].id === wanted) return STEPS[i];
  return STEPS[0];
}

function stepBank(ts, densityId){
  return STEP_BANKS[TIME_SIGNATURES[ts] ? ts : "4/4"][densityMode(densityId).id];
}

export function rhythmBank(ts, densityId){ return stepBank(ts, densityId).bank; }
export function closingBank(ts, densityId){ return stepBank(ts, densityId).closing; }

/* 這一階容許哪些音符。動機變形只能拆出這裡面有的東西，
   不然練純四分的段落會被變形偷渡進八分音符。 */
export function rhythmVocabulary(ts, densityId){ return stepBank(ts, densityId).vocab; }

function patternWeights(bank, densityId){
  var sig = densityMode(densityId).signature;
  return bank.map(function(pat){
    if (!sig) return 1;
    return pat.some(function(d){ return sig.indexOf(d) >= 0; }) ? 3 : 1;
  });
}

export function pickRhythm(rng, bank, densityId){
  if (bank.length < 2) return bank[0].slice();
  var w = patternWeights(bank, densityId);
  var uniform = w.every(function(x){ return x === w[0]; });
  return uniform ? rng.pick(bank) : rng.weighted(bank, w);
}

/* 動機變形時「把長音拆碎」的機率。純語彙的階不拆，整段才會維持同一種音符。 */
export function splitChance(densityId){ return densityMode(densityId).split || 0; }

/* 節奏型 → 每個音的起始拍 */
export function beatsOf(pat){
  var t = 0, out = [];
  for (var i = 0; i < pat.length; i++){ out.push(t); t += DUR[pat[i]]; }
  return out;
}

export function isStrong(beat, ts){
  if (ts === "3/4") return beat === 0;
  if (ts === "2/4") return beat === 0;
  return beat === 0 || beat === 2;          // 4/4 的一、三拍
}
