/* Comping 節奏與走路低音。
 *
 * 「和弦練習太單調」的真正來源不是進行太少，是每個和弦都畫成一小節一顆全音符、
 * 右手完全沒事做。這個檔案處理的就是那件事。
 */

import { N, iv, dIdx, absPitch } from "../core/pitch.js";
import { CHORDS, resolveType, bassOctave } from "../core/chords.js";
import { DUR } from "./rhythm.js";

/* [時值, 是否為休止]。總和必須等於一小節。 */
export const COMP_PATTERNS = {
  whole:      {label:"全音符（最單純）", pat:[["w",0]]},
  half:       {label:"二分音符",         pat:[["h",0],["h",0]]},
  charleston: {label:"Charleston",       pat:[["qd",0],["8",0],["h",1]]},
  offbeat:    {label:"反拍切分",         pat:[["8",1],["8",0],["q",1],["8",1],["8",0],["q",1]]},
  push:       {label:"搶拍進入",         pat:[["q",1],["8",1],["8",0],["h",0]]},
  four:       {label:"每拍一下",         pat:[["q",0],["q",0],["q",0],["q",0]]},
  anticipate: {label:"前一拍先進",       pat:[["h",0],["q",1],["8",1],["8",0]]}
};

/* 分解和弦不是節奏型，是把 voicing 拆開來一個一個彈，所以另外列。 */
export const ARPEGGIOS = {
  arp_up:     {label:"分解和弦（上行）",   dir:"up"},
  arp_down:   {label:"分解和弦（下行）",   dir:"down"},
  arp_updown: {label:"分解和弦（上下行）", dir:"updown"}
};

export function compPatterns(ts){
  // 這些型都是為 4/4 寫的；其他拍號只給最單純的兩種
  const base = (ts !== "4/4") ? ["whole", "half"] : Object.keys(COMP_PATTERNS);
  return base.concat(Object.keys(ARPEGGIOS));
}

export function isArpeggio(name){ return !!ARPEGGIOS[name]; }

(function validate(){
  const bad = [];
  Object.keys(COMP_PATTERNS).forEach(k => {
    const len = COMP_PATTERNS[k].pat.reduce((a, p) => a + DUR[p[0]], 0);
    if (Math.abs(len - 4) > 1e-9) bad.push(k + " = " + len + " 拍");
  });
  if (bad.length) throw new Error("comping 節奏時值錯誤：" + bad.join("、"));
})();

/**
 * 把一個 voicing 依 comping 節奏鋪成一小節的音符。
 * @param {object} v voice() 的結果 {lh, rh}
 * @returns {{top:[], bottom:[]}}
 */
export function compBar(v, patternName, ts, beats){
  const spec = COMP_PATTERNS[patternName];
  const pat = (spec && ts === "4/4") ? spec.pat
            : [[beats === 4 ? "w" : beats === 3 ? "hd" : "h", 0]];

  const hasRh = !!(v.rh && v.rh.length);
  const top = [], bottom = [];

  pat.forEach(([dur, isRest]) => {
    if (isRest){
      top.push({rest:true, dur, clef: hasRh ? "treble" : "bass"});
      if (hasRh) bottom.push({rest:true, dur, clef:"bass"});
      return;
    }
    if (hasRh){
      top.push({rest:false, chordNotes: v.rh, note: v.rh[0], dur, clef:"treble"});
      bottom.push({rest:false, chordNotes: v.lh, note: v.lh[0], dur, clef:"bass"});
    } else {
      top.push({rest:false, chordNotes: v.lh, note: v.lh[0], dur, clef:"bass"});
    }
  });

  return hasRh ? {top, bottom} : {top, bottom: null};
}

/* ---------- 分解和弦 ---------- */

/* 把 voicing 的音排成一條夠長的上行序列（不夠就往上疊八度）。
   分解的是實際會按的那個 voicing，不是課本上的原位和弦 ——
   練的才是手真的要做的動作。 */
function ascendingRun(notes, need){
  const out = [];
  let oct = 0;
  while (out.length < need){
    for (const n of notes){
      out.push(N(n.l, n.a, n.o + oct));
      if (out.length >= need) break;
    }
    oct++;
    if (oct > 4) break;
  }
  return out;
}

function arpSequence(notes, count, dir){
  if (!notes.length) return [];
  if (dir === "down"){
    const asc = ascendingRun(notes, count);
    return asc.slice().reverse();
  }
  if (dir === "updown"){
    const upN = Math.ceil((count + 1) / 2);
    const up = ascendingRun(notes, upN);
    const down = up.slice(0, -1).reverse();          // 折返時不重複最高音
    const seq = up.concat(down);
    while (seq.length < count) seq.push(seq[seq.length - 1 - (seq.length % 2 ? 1 : 0)] || seq[0]);
    return seq.slice(0, count);
  }
  return ascendingRun(notes, count);
}

/**
 * 一小節的分解和弦。八分音符逐音彈；
 * 兩手 voicing 時左手分解、右手持和弦，就是實際伴奏的樣子。
 */
export function arpeggioBar(v, dirName, beats){
  const dir = (ARPEGGIOS[dirName] || ARPEGGIOS.arp_up).dir;
  const count = Math.round(beats * 2);               // 每拍兩個八分
  const hasRh = !!(v.rh && v.rh.length);
  const seq = arpSequence(v.lh, count, dir);

  const bottom = seq.map(n => ({rest:false, note:n, dur:"8", clef:"bass"}));
  if (!hasRh) return {top: bottom, bottom: null};

  const hold = beats === 4 ? "w" : beats === 3 ? "hd" : beats === 2 ? "h" : "q";
  return {
    top: [{rest:false, chordNotes:v.rh, note:v.rh[0], dur:hold, clef:"treble"}],
    bottom
  };
}

/* ---------- 走路低音 ---------- */

/* 和弦音（不含延伸音），用來當落腳點 */
function chordTones(root, type){
  const C = CHORDS[resolveType(type)];
  const core = C.ints.filter(i => ["P1","M3","m3","P4","P5","d5","A5","M6","m7","M7","d7"].indexOf(i) >= 0);
  return core.map(i => iv(root, i));
}

function nearest(cands, ref){
  let best = cands[0], bd = 1e9;
  for (const c of cands){
    for (let oct = -1; oct <= 1; oct++){
      const n = N(c.l, c.a, c.o + oct);
      const d = Math.abs(absPitch(n) - absPitch(ref));
      if (d < bd){ bd = d; best = n; }
    }
  }
  return best;
}

/* 半音接近音：從上方或下方半音走進目標。走路低音的招牌手法。 */
function chromaticApproach(target, fromAbove){
  const step = fromAbove ? -1 : 1;
  // 用字母級數決定拼法：上方接近寫成降的上一級，下方接近寫成升的下一級
  const l = ((target.l + (fromAbove ? 1 : -1)) % 7 + 7) % 7;
  const o = target.o + (fromAbove && target.l === 6 ? 1 : (!fromAbove && target.l === 0 ? -1 : 0));
  const want = absPitch(target) - step;
  const nat = o * 12 + [0,2,4,5,7,9,11][l];
  return N(l, want - nat, o);
}

/**
 * 走路低音：每拍一個四分音符。
 * 第一拍落在根音，最後一拍接近下一個和弦的根音，中間走和弦音與級進。
 * @param {Array} slots [{root, type}]，一小節一格（或一小節兩格）
 */
export function walkingBass(rng, chords, beats, loIdx, hiIdx){
  const bars = [];
  let prev = null;

  for (let i = 0; i < chords.length; i++){
    const cur = chords[i];
    const next = chords[i + 1] || chords[0];
    const root = N(cur.root.l, cur.root.a, bassOctave(cur.root));
    const nextRoot = N(next.root.l, next.root.a, bassOctave(next.root));

    const notes = [];
    let here = prev ? nearest([root], prev) : root;
    // 音域保險
    while (dIdx(here) < loIdx) here = N(here.l, here.a, here.o + 1);
    while (dIdx(here) > hiIdx) here = N(here.l, here.a, here.o - 1);
    notes.push(here);

    const tones = chordTones(cur.root, cur.type);
    const target = nearest([nextRoot], here);

    for (let b = 1; b < beats; b++){
      let pick;
      if (b === beats - 1){
        // 最後一拍：半音或全音接近下一個根音
        pick = rng.chance(0.6) ? chromaticApproach(target, rng.chance(0.5))
                               : nearest(tones, target);
      } else {
        pick = nearest(tones.filter(t => absPitch(N(t.l, t.a, here.o)) !== absPitch(here)), here);
        if (rng.chance(0.3)) pick = nearest(tones, N(here.l, here.a, here.o));
      }
      // 不要原地踏步，也不要一次跳太遠
      let guard = 0;
      while (Math.abs(absPitch(pick) - absPitch(here)) > 9 && guard++ < 3){
        pick = N(pick.l, pick.a, pick.o + (absPitch(pick) > absPitch(here) ? -1 : 1));
      }
      while (dIdx(pick) < loIdx) pick = N(pick.l, pick.a, pick.o + 1);
      while (dIdx(pick) > hiIdx) pick = N(pick.l, pick.a, pick.o - 1);
      notes.push(pick);
      here = pick;
    }

    prev = here;
    bars.push(notes.map(n => ({rest:false, note:n, dur:"q", clef:"bass"})));
  }
  return bars;
}
