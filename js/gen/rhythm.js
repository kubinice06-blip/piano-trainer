/* 節奏型庫。
   每個型都在載入時驗證時值總和 —— 原本靠 setStrict(false) 吞掉錯誤，
   結果是節奏一變複雜就排出鬼畫符卻不報錯。 */

export const DUR = {
  "w":4, "hd":3, "h":2, "qd":1.5, "q":1,
  "8d":0.75, "8":0.5, "16d":0.375, "16":0.25
};

/* 依難度分層，第 n 層以內的都會被抽到。
   分層的軸是「讀起來有多難」：長音 → 八分 → 附點 → 十六分 → 切分。
   同一層裡面盡量多給幾個型，不然同一個難度連出四題就會開始重複。 */
const BANK_44 = [
  [["w"], ["h","h"], ["h","q","q"], ["q","q","h"], ["q","q","q","q"], ["q","h","q"]],
  [["q","q","8","8","q"], ["8","8","q","h"], ["q","8","8","q","q"], ["h","8","8","q"],
   ["8","8","8","8","h"], ["q","q","q","8","8"], ["8","8","q","q","q"], ["q","8","8","8","8","q"],
   ["8","8","8","8","q","q"], ["h","8","8","8","8"]],
  [["hd","q"], ["q","hd"], ["h","8","8","q"], ["q","h","8","8"], ["8","8","hd"]],
  [["qd","8","h"], ["h","qd","8"], ["qd","8","q","q"], ["q","q","qd","8"],
   ["qd","8","qd","8"], ["qd","qd","q"], ["q","qd","8","q"], ["8d","16","q","h"]],
  [["q","8","16","16","h"], ["q","16","16","8","q","q"], ["16","16","8","q","h"],
   ["8","8","16","16","8","q","q"], ["q","q","8","16","16","q"], ["16","16","8","8","8","h"]],
  [["8","q","8","h"], ["8","q","q","q","8"], ["8","8","q","8","8","q"],
   ["8","q","q","8","q"], ["8","q","8","q","8","8"], ["q","8","q","8","q"]]
];

const BANK_34 = [
  [["hd"], ["h","q"], ["q","h"], ["q","q","q"]],
  [["q","8","8","q"], ["8","8","q","q"], ["q","q","8","8"], ["8","8","8","8","q"],
   ["q","8","8","8","8"], ["8","8","8","8","8","8"]],
  [["h","8","8"], ["8","8","h"]],
  [["qd","8","q"], ["q","qd","8"], ["qd","qd"], ["qd","8","8","8"]],
  [["q","16","16","8","q"], ["8","8","q","8","8"], ["16","16","8","q","q"], ["q","q","16","16","8"]],
  [["8","q","q","8"], ["8","q","8","q"], ["q","8","q","8"]]
];

const BANK_24 = [
  [["h"], ["q","q"]],
  [["q","8","8"], ["8","8","q"], ["8","8","8","8"]],
  [["qd","8"], ["8","qd"]],
  [["8","q","8"], ["8d","16","q"]],
  [["q","16","16","8"], ["16","16","8","q"], ["8","8","16","16","8"]],
  [["8","16","16","8","8"], ["16","16","8","16","16","8"], ["16","16","8","8","8"]]
];

export const TIME_SIGNATURES = {
  "4/4": {beats:4, beatValue:4, bank:BANK_44, beamGroups:[[1,4]]},
  "3/4": {beats:3, beatValue:4, bank:BANK_34, beamGroups:[[1,4]]},
  "2/4": {beats:2, beatValue:4, bank:BANK_24, beamGroups:[[1,4]]}
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

/* 載入時就把長度不對的型抓出來，寧可開發時炸掉也不要出題時默默畫錯 */
(function validateBanks(){
  var bad = [];
  Object.keys(TIME_SIGNATURES).forEach(function(ts){
    var info = TIME_SIGNATURES[ts];
    info.bank.forEach(function(tier, ti){
      tier.forEach(function(pat){
        var len = patternLength(pat);
        if (Math.abs(len - info.beats) > 1e-9){
          bad.push(ts + " 第" + (ti + 1) + "層 [" + pat.join(" ") + "] = " + len + " 拍，應為 " + info.beats);
        }
      });
    });
  });
  if (bad.length) throw new Error("節奏型時值錯誤：\n" + bad.join("\n"));
})();

/* ---------- 音符長短：跟難度分開的第二個軸 ----------
 *
 * 難度決定「用得到第幾層的節奏型」，這一軸決定「在拿得到的型裡面偏好長音還是短音」。
 * 兩件事本來就該分開：同一個難度，練慢的長音與練跑動的八分是兩種練習。
 * minTier 是「這個選擇至少要開到第幾層」—— 選了八分音符卻停在只有全音符與
 * 二分音符的第一層，設定會看起來完全沒作用。
 */
export const NOTE_DENSITY = [
  {id:"auto",    label:"隨難度",               bias: 0,   minTier:0},
  {id:"long",    label:"長音為主（慢慢讀）",    bias:-2.2, minTier:0},
  {id:"quarter", label:"四分音符為主",          bias:-1.0, minTier:0},
  {id:"pulse",   label:"每拍一音（垂直音程）",  bias: 0,   minTier:0, exactPulse:true},
  {id:"eighth",  label:"八分音符多一點",        bias: 1.6, minTier:2},
  {id:"varied",  label:"長短交錯（附點・切分）", bias: 0.5, minTier:4, varied:true},
  {id:"16th",    label:"十六分音符多一點",      bias: 2.6, minTier:5}
];

export function densityMode(id){
  for (var i = 0; i < NOTE_DENSITY.length; i++) if (NOTE_DENSITY[i].id === id) return NOTE_DENSITY[i];
  return NOTE_DENSITY[0];
}

/* 實際開到第幾層 = 難度與音符長短兩者取大 */
export function effectiveTier(level, densityId){
  return Math.max(level, densityMode(densityId).minTier);
}

export function rhythmBank(ts, level, densityId){
  var info = tsInfo(ts);
  if (densityMode(densityId).exactPulse){
    return [Array.from({length:info.beats}, function(){ return "q"; })];
  }
  var n = Math.min(effectiveTier(level, densityId), info.bank.length);
  var out = [];
  for (var i = 0; i < n; i++) out = out.concat(info.bank[i]);
  return out;
}

/* 收尾小節：最後一個音必須是長音，樂句才會落地 */
export function closingBank(ts, level, densityId){
  var all = rhythmBank(ts, level, densityId);
  var b = all.filter(function(p){
    var last = p[p.length - 1];
    return last === "w" || last === "h" || last === "hd";
  });
  return b.length ? b : all;
}

/* 一個型裡面用到幾種不同的時值。長短交錯的型分數高。 */
function spread(pat){
  var seen = {}, n = 0;
  for (var i = 0; i < pat.length; i++) if (!seen[pat[i]]){ seen[pat[i]] = 1; n++; }
  return Math.min(1, (n - 1) / 2);
}

/* 權重 = 密度^bias。密度差一倍，權重就差 2^bias 倍 ——
   所以 bias 為正時八分音符的型會比全音符的型常出現得多。 */
export function patternWeights(bank, densityId){
  var m = densityMode(densityId);
  return bank.map(function(p){
    var w = Math.pow(density(p), m.bias);
    if (m.varied) w *= 1 + 1.8 * spread(p);
    return Math.max(1e-6, w);
  });
}

export function pickRhythm(rng, bank, densityId){
  var m = densityMode(densityId);
  if (!m.bias && !m.varied) return rng.pick(bank);
  return rng.weighted(bank, patternWeights(bank, densityId));
}

/* 動機變形時「把長音拆碎」的機率。偏短音就拆得兇一點。 */
export function splitChance(densityId){
  var m = densityMode(densityId);
  if (m.exactPulse) return 0;
  return Math.max(0.05, Math.min(0.9, 0.45 + m.bias * 0.22));
}

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

/* 節奏的「密度」，用來讓兩手不要同時都很忙 */
export function density(pat){ return pat.length / patternLength(pat); }
