/* 節奏型庫。
   每個型都在載入時驗證時值總和 —— 原本靠 setStrict(false) 吞掉錯誤，
   結果是節奏一變複雜就排出鬼畫符卻不報錯。 */

export const DUR = {
  "w":4, "hd":3, "h":2, "qd":1.5, "q":1,
  "8d":0.75, "8":0.5, "16d":0.375, "16":0.25
};

/* 依難度分層，第 n 層以內的都會被抽到 */
const BANK_44 = [
  [["w"], ["h","h"], ["h","q","q"], ["q","q","h"], ["q","q","q","q"], ["q","h","q"]],
  [["q","q","8","8","q"], ["8","8","q","h"], ["q","8","8","q","q"], ["h","8","8","q"], ["8","8","8","8","h"]],
  [["hd","q"], ["q","hd"], ["h","8","8","q"]],
  [["qd","8","h"], ["h","qd","8"], ["qd","8","q","q"], ["q","q","qd","8"]],
  [["q","8","16","16","h"], ["8","8","8","8","q","q"], ["q","16","16","8","q","q"]],
  [["8","q","8","h"], ["8","q","q","q","8"], ["8","8","q","8","8","q"]]
];

const BANK_34 = [
  [["hd"], ["h","q"], ["q","h"], ["q","q","q"]],
  [["q","8","8","q"], ["8","8","q","q"], ["q","q","8","8"], ["8","8","8","8","q"]],
  [["h","8","8"]],
  [["qd","8","q"], ["q","qd","8"]],
  [["q","16","16","8","q"], ["8","8","q","8","8"]],
  [["8","q","q","8"]]
];

const BANK_24 = [
  [["h"], ["q","q"]],
  [["q","8","8"], ["8","8","q"], ["8","8","8","8"]],
  [["qd","8"]],
  [["8","q","8"]],
  [["q","16","16","8"], ["16","16","8","q"]],
  [["8","16","16","8","8"], ["16","16","8","16","16","8"]]
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

export function rhythmBank(ts, level){
  var info = tsInfo(ts);
  var out = [];
  for (var i = 0; i < Math.min(level, info.bank.length); i++) out = out.concat(info.bank[i]);
  return out;
}

/* 收尾小節：最後一個音必須是長音，樂句才會落地 */
export function closingBank(ts, level){
  var b = rhythmBank(ts, level).filter(function(p){
    var last = p[p.length - 1];
    return last === "w" || last === "h" || last === "hd";
  });
  return b.length ? b : rhythmBank(ts, level);
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
