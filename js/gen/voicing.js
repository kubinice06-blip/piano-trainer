/* Voicing 庫。
 *
 * 舊版只有四種，而且全部塞在低音譜號的一顆全音符裡。
 * 這裡每一種都回傳 {lh, rh} 兩隻手 —— 有些 voicing 右手是空的（左手獨奏用），
 * 上部結構則是真的兩手一起，那才是爵士鋼琴實際在彈的東西。
 */

import { N, iv, stack, dIdx, absPitch, fitWindow } from "../core/pitch.js";
import { CHORDS, resolveType, bassOctave } from "../core/chords.js";

export const VOICINGS = {
  shell:     {label:"Shell 1–3–7 / 1–7–3", hands:1, minNotes:3},
  guide:     {label:"導音 3–7（兩個音）",   hands:1, minNotes:2},
  rootlessA: {label:"Rootless A form",      hands:1, minNotes:4},
  rootlessB: {label:"Rootless B form",      hands:1, minNotes:4},
  drop2:     {label:"Drop 2",               hands:1, minNotes:4},
  drop3:     {label:"Drop 3",               hands:1, minNotes:4},
  quartal:   {label:"四度堆疊（So What）",  hands:1, minNotes:4},
  upper:     {label:"上部結構（雙手）",     hands:2, minNotes:4},
  rootShell: {label:"左手根音 + 右手和弦",  hands:2, minNotes:4}
};

const ROOTLESS = {
  min:     {A:["m3","P5","m7","M9"],  B:["m7","M9","m3","P5"]},
  dom:     {A:["m7","M9","M3","M6"],  B:["M3","M6","m7","M9"]},
  maj:     {A:["M3","P5","M7","M9"],  B:["M7","M9","M3","P5"]},
  halfdim: {A:["m3","d5","m7","P11"], B:["m3","d5","m7","P11"]},
  dim:     {A:["m3","d5","d7","P8"],  B:["d5","d7","P8","m3"]},
  sus:     {A:["m7","M9","P4","M6"],  B:["P4","M6","m7","M9"]},
  aug:     {A:["M3","A5","m7","M9"],  B:["m7","M9","M3","A5"]}
};

/* 上部結構：左手放 shell，右手疊一個三和弦，疊哪一個由屬和弦的變化音決定。
   這是爵士鋼琴課本上的標準做法 —— 右手那個三和弦本身好按，聲響卻是完整的變化屬和弦。 */
const UPPER_TRIAD = {
  dom7:     ["P5", "maj"],   // V 上的大三和弦 = 9 11 13 的味道
  dom9:     ["M2", "min"],
  dom13:    ["M2", "maj"],
  dom7b9:   ["m3", "maj"],   // ♭III 大三 → ♭9 ♯9 13
  dom7s9:   ["m3", "maj"],
  dom7s11:  ["M2", "maj"],
  dom7b13:  ["m6", "maj"],
  dom7alt:  ["b9", "maj"],   // ♭II 大三 → ♭9 ♯11 ♭13
  dom7s5:   ["M3", "aug"],
  maj7:     ["P5", "min"],
  maj9:     ["P5", "min"],
  maj7s11:  ["M2", "maj"],
  maj6:     ["M2", "min"],
  maj69:    ["M2", "min"],
  m7:       ["m3", "maj"],
  m9:       ["m3", "maj"],
  m11:      ["P4", "maj"],
  m6:       ["M2", "min"],
  mMaj7:    ["m3", "aug"],
  m7b5:     ["m3", "min"],
  m11b5:    ["P4", "min"],
  dim7:     ["m3", "dim"]
};

const TRIAD_INTS = {maj:["P1","M3","P5"], min:["P1","m3","P5"], dim:["P1","m3","d5"], aug:["P1","M3","A5"]};

/* 把一組音搬到指定的全音階窗內 */
function window7(notes, loVexIdx, hiVexIdx){
  return fitWindow(notes, loVexIdx, hiVexIdx);
}

/* drop voicing：從最高音往下數第 n 個音掉一個八度，再重新排序 */
function drop(closed, n){
  if (closed.length < 4) return closed.slice();
  const arr = closed.slice();
  const idx = arr.length - n;                 // drop2 → 從上數第 2 個
  if (idx < 0) return arr;
  const moved = N(arr[idx].l, arr[idx].a, arr[idx].o - 1);
  arr.splice(idx, 1);
  arr.push(moved);
  return arr.sort((a, b) => absPitch(a) - absPitch(b));
}

/* 四度堆疊：從指定的和弦音往上疊三個四度（So What 那個聲響） */
function quartalFrom(base){
  const out = [base];
  for (let i = 0; i < 3; i++) out.push(iv(out[out.length - 1], "P4"));
  return out;
}

/**
 * @returns {{lh: note[], rh: note[]|null, label: string}}
 */
export function voice(rootPc, typeRaw, style, formHint){
  const type = resolveType(typeRaw);
  const C = CHORDS[type];
  const root = N(rootPc.l, rootPc.a, bassOctave(rootPc));
  const LO = 3 * 7, HI = 3 * 7 + 6;              // C3–B3，左手上半部最舒服的位置
  const RLO = 4 * 7, RHI = 4 * 7 + 6;            // C4–B4，右手

  if (style === "guide"){
    return {lh: window7(stack(root, [C.third, C.sev]), LO, HI), rh: null};
  }

  if (style === "shell"){
    if (formHint === "173"){
      const sev = iv(root, C.sev);
      let thd = iv(root, C.third);
      while (dIdx(thd) <= dIdx(sev)) thd = N(thd.l, thd.a, thd.o + 1);
      return {lh: [root, sev, thd], rh: null};
    }
    return {lh: [root, iv(root, C.third), iv(root, C.sev)], rh: null};
  }

  if (style === "rootlessA" || style === "rootlessB"){
    const spec = ROOTLESS[C.fam] || ROOTLESS.dom;
    const form = style === "rootlessB" ? "B" : "A";
    return {lh: window7(stack(N(rootPc.l, rootPc.a, 3), spec[form]), LO, HI), rh: null};
  }

  if (style === "drop2" || style === "drop3"){
    // 取前四個音當密集排列，再把指定的音掉八度
    const closed = stack(N(rootPc.l, rootPc.a, 4), C.ints.slice(0, 4));
    const v = drop(closed, style === "drop2" ? 2 : 3);
    return {lh: window7(v, LO - 7, HI), rh: null};
  }

  if (style === "quartal"){
    // 從三音或七音起疊，聲響比從根音起漂亮
    const base = iv(N(rootPc.l, rootPc.a, 3), C.fam === "dom" ? C.sev : C.third);
    return {lh: window7(quartalFrom(base), LO - 7, HI), rh: null};
  }

  if (style === "rootShell"){
    // 左手只有根音與五音，右手拿完整和弦 —— 兩手分工最單純的一種
    const fifth = C.ints.find(i => i === "P5" || i === "d5" || i === "A5") || "P5";
    const lh = [root, iv(root, fifth)];
    const rh = window7(stack(N(rootPc.l, rootPc.a, 4), C.ints.slice(1, 5)), RLO, RHI);
    return {lh, rh};
  }

  if (style === "upper"){
    const spec = UPPER_TRIAD[type];
    const lh = [root, iv(root, C.third), iv(root, C.sev)];
    if (!spec){
      const rh = window7(stack(N(rootPc.l, rootPc.a, 4), C.ints.slice(1, 4)), RLO, RHI);
      return {lh, rh};
    }
    const triadRoot = iv(N(rootPc.l, rootPc.a, 4), spec[0]);
    const rh = window7(stack(triadRoot, TRIAD_INTS[spec[1]]), RLO, RHI);
    return {lh, rh};
  }

  // 認不得就退回 shell，不讓出題掛掉
  return {lh: [root, iv(root, C.third), iv(root, C.sev)], rh: null};
}

/* ii=1-3-7、V=1-7-3、I=1-3-7 交替，讓導音只走半音 */
export function shellForm(idx){ return (idx % 2 === 1) ? "173" : "137"; }
