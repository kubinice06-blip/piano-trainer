/* 爵士和弦出題。
 *
 * 進行全部以「距主音的音程 + 和弦類型」描述，所以同一條進行可以移到任何調。
 * 每小節可以有一或兩個和弦；bars 是小節數，不是和弦數。
 */

import { Rng, randomSeed } from "../core/rng.js";
import { iv, noteName, dIdx, parseVexKey } from "../core/pitch.js";
import { Key, cycleOfFourths } from "../core/key.js";
import { chordLabel } from "../core/chords.js";
import { voice, shellForm, VOICINGS } from "./voicing.js";
import { compBar, walkingBass, compPatterns, COMP_PATTERNS,
         ARPEGGIOS, isArpeggio, arpeggioBar } from "./comping.js";
import { tsInfo } from "./rhythm.js";

/* 一格 = [距主音音程, 和弦類型]。一個小節放一格或兩格。 */
const P = {
  /* ---------- 基礎 ---------- */
  ii_V_I:    {label:"ii–V–I（大調）", cat:"基礎", minor:false,
              bars:[[["M2","m7"]], [["P5","dom7"]], [["P1","maj7"]], [["P1","maj7"]]]},
  ii_V_i:    {label:"iiø–V–i（小調）", cat:"基礎", minor:true,
              bars:[[["M2","m7b5"]], [["P5","dom7b9"]], [["P1","mMaj7"]], [["P1","m6"]]]},
  ii_V_I_2:  {label:"ii–V 每小節兩個和弦", cat:"基礎", minor:false,
              bars:[[["M2","m9"],["P5","dom13"]], [["P1","maj9"]],
                    [["M2","m9"],["P5","dom7b9"]], [["P1","maj9"]]]},
  turn:      {label:"I–vi–ii–V 迴轉", cat:"基礎", minor:false,
              bars:[[["P1","maj7"]], [["M6","m7"]], [["M2","m7"]], [["P5","dom7"]]]},
  turn_fast: {label:"I–vi–ii–V 每小節兩個", cat:"基礎", minor:false,
              bars:[[["P1","maj7"],["M6","m7"]], [["M2","m7"],["P5","dom7"]],
                    [["M3","m7"],["M6","dom7b9"]], [["M2","m7"],["P5","dom7alt"]]]},
  iii_vi:    {label:"iii–vi–ii–V", cat:"基礎", minor:false,
              bars:[[["M3","m7"]], [["M6","m7"]], [["M2","m7"]], [["P5","dom7"]]]},
  I_IV:      {label:"I–IV–iii–vi", cat:"基礎", minor:false,
              bars:[[["P1","maj7"]], [["P4","maj7"]], [["M3","m7"]], [["M6","m7"]]]},

  /* 根音每次下行純五度：C → F → B → E → A → D → G → C。
     七個調性和弦形成完整圈，最後用 V7 回到 I。 */
  circle_down:{label:"五度圈下行（I–IV–viiø–iii–vi–ii–V–I）", cat:"五度圈", minor:false,
              bars:[[["P1","maj7"]], [["P4","maj7"]], [["M7","m7b5"]], [["M3","m7"]],
                    [["M6","m7"]], [["M2","m7"]], [["P5","dom7"]], [["P1","maj7"]]]},

  /* ---------- 代理與經過 ---------- */
  tritone:   {label:"三全音代理 ii–♭II7–I", cat:"代理", minor:false,
              bars:[[["M2","m7"]], [["m2","dom7s11"]], [["P1","maj7"]], [["P1","maj7"]]]},
  backdoor:  {label:"Backdoor ♭VII7–I", cat:"代理", minor:false,
              bars:[[["P1","maj7"]], [["P4","m7"]], [["m7","dom7"]], [["P1","maj7"]]]},
  sec_chain: {label:"副屬連鎖 III7–VI7–II7–V7", cat:"代理", minor:false,
              bars:[[["M3","dom7b9"]], [["M6","dom7"]], [["M2","dom7"]], [["P5","dom7alt"]]]},
  dim_pass:  {label:"經過減和弦 I–♯i°–ii–V", cat:"代理", minor:false,
              bars:[[["P1","maj7"]], [["m2","dim7"]], [["M2","m7"]], [["P5","dom7"]]]},
  min_plag:  {label:"小下屬 IV–iv–I", cat:"代理", minor:false,
              bars:[[["P1","maj7"]], [["P4","maj7"]], [["P4","m6"]], [["P1","maj7"]]]},
  sus_res:   {label:"V7sus4 → V7 → I", cat:"代理", minor:false,
              bars:[[["M2","m7"]], [["P5","dom7sus4"]], [["P5","dom7b9"]], [["P1","maj69"]]]},

  /* ---------- 藍調 ---------- */
  blues:     {label:"12 小節藍調（基本）", cat:"藍調", minor:false,
              bars:[[["P1","dom7"]],[["P4","dom7"]],[["P1","dom7"]],[["P1","dom7"]],
                    [["P4","dom7"]],[["P4","dom7"]],[["P1","dom7"]],[["P1","dom7"]],
                    [["P5","dom7"]],[["P4","dom7"]],[["P1","dom7"]],[["P5","dom7"]]]},
  blues_jazz:{label:"12 小節 Jazz Blues", cat:"藍調", minor:false,
              bars:[[["P1","dom9"]],[["P4","dom9"]],[["P1","dom7"]],[["P5","m7"],["P1","dom7"]],
                    [["P4","dom9"]],[["A4","dim7"]],[["P1","dom7"]],[["M6","dom7b9"]],
                    [["M2","m7"]],[["P5","dom7alt"]],[["P1","dom7"],["M6","dom7b9"]],
                    [["M2","m7"],["P5","dom7alt"]]]},
  blues_bird:{label:"12 小節 Bird Blues", cat:"藍調", minor:false,
              bars:[[["P1","maj7"]],[["M7","m7b5"],["M3","dom7b9"]],[["M6","m7"],["M2","dom7"]],
                    [["P5","m7"],["P1","dom7"]],[["P4","maj7"]],[["P4","m7"],["m7","dom7"]],
                    [["M3","m7"]],[["m3","m7"],["m6","dom7"]],[["M2","m7"]],[["P5","dom7"]],
                    [["M3","m7"],["M6","dom7"]],[["M2","m7"],["P5","dom7"]]]},
  blues_min: {label:"12 小節小調藍調", cat:"藍調", minor:true,
              bars:[[["P1","m7"]],[["P1","m7"]],[["P1","m7"]],[["P1","m7"]],
                    [["P4","m7"]],[["P4","m7"]],[["P1","m7"]],[["P1","m7"]],
                    [["m6","dom9"]],[["P5","dom7alt"]],[["P1","m7"]],[["P5","dom7alt"]]]},

  /* ---------- 曲式 ---------- */
  rhythm_A:  {label:"Rhythm Changes A 段", cat:"曲式", minor:false,
              bars:[[["P1","maj6"],["M6","m7"]], [["M2","m7"],["P5","dom7"]],
                    [["M3","m7"],["M6","dom7b9"]], [["M2","m7"],["P5","dom7"]],
                    [["P4","maj7"]], [["A4","dim7"]],
                    [["P1","maj6"],["M6","dom7"]], [["M2","m7"],["P5","dom7"]]]},
  rhythm_B:  {label:"Rhythm Changes B 段（橋）", cat:"曲式", minor:false,
              bars:[[["M3","dom9"]],[["M3","dom13"]],[["M6","dom9"]],[["M6","dom13"]],
                    [["M2","dom9"]],[["M2","dom13"]],[["P5","dom9"]],[["P5","dom7alt"]]]},
  coltrane:  {label:"Coltrane Changes（Giant Steps 前八）", cat:"曲式", minor:false,
              bars:[[["P1","maj7"],["m6","dom7"]], [["M3","maj7"],["M2","dom7"]],
                    [["P5","maj7"]], [["m3","m7"],["m6","dom7"]],
                    [["M3","maj7"],["M2","dom7"]], [["P5","maj7"],["P4","dom7"]],
                    [["M7","maj7"]], [["M3","m7"],["M6","dom7"]]]},
  autumn:    {label:"Autumn Leaves（前八）", cat:"曲式", minor:false,
              bars:[[["M2","m7"]],[["P5","dom7"]],[["P1","maj7"]],[["P4","maj7"]],
                    [["M7","m7b5"]],[["M3","dom7b9"]],[["M6","m7"]],[["M6","m7"]]]},
  bluebossa: {label:"Blue Bossa（16 小節）", cat:"曲式", minor:true,
              bars:[[["P1","m7"]],[["P1","m7"]],[["P4","m7"]],[["P4","m7"]],
                    [["M2","m7b5"]],[["P5","dom7b9"]],[["P1","m7"]],[["P1","m7"]],
                    [["m6","m7"]],[["m2","dom7"]],[["m6","maj7"]],[["m6","maj7"]],
                    [["M2","m7b5"]],[["P5","dom7b9"]],[["P1","m7"]],[["M2","m7b5"],["P5","dom7b9"]]]},
  satindoll: {label:"Satin Doll（前八）", cat:"曲式", minor:false,
              bars:[[["M2","m7"],["P5","dom7"]],[["M2","m7"],["P5","dom7"]],
                    [["M3","m7"],["M6","dom7"]],[["M3","m7"],["M6","dom7"]],
                    [["M2","m7"]],[["P5","dom7"]],[["P1","maj6"]],[["P1","maj6"]]]},
  atrain:    {label:"Take the A Train（前八）", cat:"曲式", minor:false,
              bars:[[["P1","maj6"]],[["P1","maj6"]],[["M2","dom7s11"]],[["M2","dom7s11"]],
                    [["M2","m7"]],[["P5","dom7"]],[["P1","maj6"]],[["P1","maj6"]]]},
  allthings: {label:"All the Things You Are（前八）", cat:"曲式", minor:false,
              bars:[[["M6","m7"]],[["M2","m7"]],[["P5","dom7"]],[["P1","maj7"]],
                    [["P4","maj7"]],[["M7","m7"]],[["M3","dom7"]],[["M6","maj7"]]]},
  flyme:     {label:"Fly Me to the Moon（循環）", cat:"曲式", minor:false,
              bars:[[["M6","m7"]],[["M2","m7"]],[["P5","dom7"]],[["P1","maj7"]],
                    [["P4","maj7"]],[["M7","m7b5"]],[["M3","dom7b9"]],[["M6","m7"]]]},

  /* ---------- 調式 ---------- */
  so_what:   {label:"So What / Impressions（調式）", cat:"調式", minor:true,
              bars:[[["P1","m11"]],[["P1","m11"]],[["P1","m11"]],[["P1","m11"]],
                    [["m2","m11"]],[["m2","m11"]],[["P1","m11"]],[["P1","m11"]]]},
  modal_maj: {label:"Lydian vamp", cat:"調式", minor:false,
              bars:[[["P1","maj7s11"]],[["P1","maj7s11"]],[["M2","dom7sus4"]],[["M2","dom7sus4"]]]}
};

export const PROGRESSIONS = P;

export function progressionCategories(){
  const out = {};
  Object.keys(P).forEach(id => { (out[P[id].cat] = out[P[id].cat] || []).push(id); });
  return out;
}

export { VOICINGS, COMP_PATTERNS, ARPEGGIOS, compPatterns, isArpeggio };

/* 給 UI 顯示用的 comping 名稱 */
export function compLabel(id){
  if (id === "walking") return "走路低音";
  if (ARPEGGIOS[id]) return ARPEGGIOS[id].label;
  return (COMP_PATTERNS[id] || {}).label || id;
}

/* 把一條進行套到某個調上，展開成每小節的和弦格 */
export function realize(progId, tonicKey){
  const spec = P[progId];
  const t = tonicKey.tonic(0);
  return spec.bars.map(bar => bar.map(([interval, type]) => ({
    root: iv(t, interval),
    type,
    label: chordLabel(iv(t, interval), type)
  })));
}

/**
 * @param cfg {prog, order, fixed, count, style, comp, ts, seed}
 */
export function generateChordDrill(cfg){
  const seed = (cfg.seed === undefined || cfg.seed === null) ? randomSeed() : cfg.seed;
  const rng = new Rng(seed);
  const spec = P[cfg.prog] || P.ii_V_I;
  const ts = cfg.ts || "4/4";
  const beats = tsInfo(ts).beats;
  const cycle = cycleOfFourths(spec.minor ? "minor" : "major");

  let tonics;
  if (cfg.order === "single"){
    tonics = [Key.fromId(cfg.fixed)];
  } else {
    let start = 0;
    for (let s = 0; s < cycle.length; s++) if (cycle[s].id === cfg.fixed) start = s;
    tonics = [];
    if (cfg.order === "cycle"){
      for (let i = 0; i < cfg.count; i++) tonics.push(cycle[(start + i) % cycle.length]);
    } else {
      let pool = cycle.slice();
      for (let j = 0; j < cfg.count; j++){
        if (!pool.length) pool = cycle.slice();
        tonics.push(pool.splice(rng.int(pool.length), 1)[0]);
      }
    }
  }

  const walking = cfg.comp === "walking";
  const lo = dIdx(parseVexKey("e/2")), hi = dIdx(parseVexKey("c/4"));

  const systems = tonics.map(key => {
    const bars = realize(cfg.prog, key);
    const flat = [];
    bars.forEach(b => b.forEach(c => flat.push(c)));

    // 走路低音需要知道整條和弦序列才能接得起來
    const walk = walking ? walkingBass(rng.fork("walk"), flat, beats, lo, hi) : null;
    let flatIdx = 0;

    const measures = bars.map((bar, mi) => {
      const perBar = bar.length;
      const top = [], bottom = [];
      const labels = [];

      bar.forEach((c, ci) => {
        const v = voice(c.root, c.type, walking ? "rootless" + (ci % 2 ? "B" : "A") : cfg.style,
                        shellForm(flatIdx));
        labels.push({label: c.label, beat: ci * (beats / perBar)});

        if (walking){
          // 右手 voicing、左手每拍一個四分音符
          const d = perBar === 1 ? (beats === 4 ? "w" : beats === 3 ? "hd" : "h") : "h";
          top.push({rest:false, chordNotes:v.lh, note:v.lh[0], dur:d, clef:"treble"});
          const wb = walk[flatIdx] || [];
          const take = Math.round(beats / perBar);
          for (let k = 0; k < take; k++){
            bottom.push(wb[k] || {rest:false, note:v.lh[0], dur:"q", clef:"bass"});
          }
        } else if (isArpeggio(cfg.comp)){
          const cell = arpeggioBar(v, cfg.comp, beats / perBar);
          cell.top.forEach(x => top.push(x));
          if (cell.bottom) cell.bottom.forEach(x => bottom.push(x));
        } else {
          const cell = compBar(v, perBar === 1 ? (cfg.comp || "whole") : "half", perBar === 1 ? ts : "x", beats / perBar);
          cell.top.forEach(x => top.push(x));
          if (cell.bottom) cell.bottom.forEach(x => bottom.push(x));
        }
        flatIdx++;
      });

      return {top, bottom: bottom.length ? bottom : null, labels,
              names: bar.map(c => voice(c.root, c.type, cfg.style, 0).lh.map(noteName).join(" – ")),
              chords: bar};
    });

    return {tonic: key, measures};
  });

  return {
    seed, cfg, systems,
    style: cfg.style, prog: cfg.prog, ts, beats,
    grand: systems[0].measures.some(m => m.bottom),
    label: spec.label,
    createdAt: Date.now()
  };
}
