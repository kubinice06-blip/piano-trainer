/* 爵士和弦出題。
 *
 * 進行全部以「距主音的音程 + 和弦類型」描述，所以同一條進行可以移到任何調。
 * 每小節可以有一或兩個和弦；bars 是小節數，不是和弦數。
 */

import { Rng, randomSeed } from "../core/rng.js";
import { N, iv, noteName, dIdx } from "../core/pitch.js";
import { Key, cycleOfFourths } from "../core/key.js";
import { CHORDS, resolveType, chordLabel, bassOctave } from "../core/chords.js";
import { VOICINGS } from "./voicing.js";
import { compPatterns, COMP_PATTERNS, ARPEGGIOS, isArpeggio } from "./comping.js";
import { DUR, tsInfo } from "./rhythm.js";

export const CHORD_STAGES = {
  guide:   {label:"第 1 · 導音骨架（根音＋3、7）", short:"導音骨架"},
  seventh: {label:"第 2 · 完整七和弦（1、3、5、7）", short:"七和弦"}
};

export const CHORD_CONTOURS = {
  up:      {label:"上行 · 從低到高認音"},
  down:    {label:"下行 · 從高到低認音"},
  updown:  {label:"上下行 · 越過八度再折返"},
  guide:   {label:"3–7 起步 · 先抓功能音"}
};

export const CHORD_RANGES = {
  one: {label:"初階 · 一個八度（到八度即折返）", short:"一個八度", octaves:1},
  two: {label:"進階 · 兩個八度", short:"兩個八度", octaves:2}
};

export const CHORD_RHYTHMS = {
  eighth:     {label:"平均八分 · 均勻流動"},
  quarter:    {label:"四分音符 · 一拍一音"},
  longshort:  {label:"長短交錯 · ♩ ♪♪ ♩ ♪♪"},
  dotted:     {label:"附點型 · ♩. ♪ ♩ ♪♪"},
  syncopated: {label:"切分型 · 錯開強拍"},
  offbeat:    {label:"反拍進入 · 先休止再彈"}
};

const RHYTHM_PATTERNS = {
  eighth: {
    4:[["8",0],["8",0],["8",0],["8",0],["8",0],["8",0],["8",0],["8",0]],
    2:[["8",0],["8",0],["8",0],["8",0]]
  },
  quarter: {
    4:[["q",0],["q",0],["q",0],["q",0]],
    2:[["q",0],["q",0]]
  },
  longshort: {
    4:[["q",0],["8",0],["8",0],["q",0],["8",0],["8",0]],
    2:[["q",0],["8",0],["8",0]]
  },
  dotted: {
    4:[["qd",0],["8",0],["q",0],["8",0],["8",0]],
    2:[["qd",0],["8",0]]
  },
  syncopated: {
    4:[["8",0],["q",0],["8",0],["q",0],["q",0]],
    2:[["8",0],["q",0],["8",0]]
  },
  offbeat: {
    4:[["8",1],["8",0],["q",0],["8",1],["8",0],["q",0]],
    2:[["8",1],["8",0],["q",0]]
  }
};

export function chordRhythmPattern(id, beats){
  const pattern = RHYTHM_PATTERNS[id]?.[beats];
  if (pattern) return pattern.map(cell => cell.slice());
  return Array.from({length:Math.max(1, Math.round(beats * 2))}, () => ["8", 0]);
}

(function validateChordRhythms(){
  Object.keys(CHORD_RHYTHMS).forEach(id => [2, 4].forEach(beats => {
    const total = chordRhythmPattern(id, beats).reduce((sum, cell) => sum + DUR[cell[0]], 0);
    if (Math.abs(total - beats) > 1e-9) throw new Error(`分解節奏 ${id}/${beats} 拍長度錯誤：${total}`);
  }));
})();

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

  /* 根音每次下行純五度：C → F → B♭ → E♭ → A♭ → D♭ → G♭ → B → E → A → D → G。
     十二個屬七涵蓋完整十二音，下一輪自然回到起始根音。 */
  circle_down:{label:"五度圈下行（12 個屬七・含降音）", cat:"五度圈", minor:false,
              bars:[[["P1","dom7"]], [["P4","dom7"]], [["m7","dom7"]], [["m3","dom7"]],
                    [["m6","dom7"]], [["m2","dom7"]], [["d5","dom7"]], [["M7","dom7"]],
                    [["M3","dom7"]], [["M6","dom7"]], [["M2","dom7"]], [["P5","dom7"]]]},

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

function fifthOf(C){
  return C.ints.find(i => i === "P5" || i === "d5" || i === "A5") || "P5";
}

function intervalDegree(interval){
  const labels = {
    P1:"1", M3:"3", m3:"♭3", P4:"4", P5:"5", d5:"♭5", A5:"♯5",
    M6:"6", m7:"♭7", M7:"7", d7:"𝄫7", M9:"9", b9:"♭9", s9:"♯9",
    P11:"11", s11:"♯11", M13:"13", b13:"♭13"
  };
  return labels[interval] || interval;
}

function explicitExtensions(C){
  return C.ints.filter(interval => /(?:9|11|13)$/.test(interval));
}

function colorIntervals(type){
  const C = CHORDS[resolveType(type)];
  const explicit = explicitExtensions(C);
  if (explicit.length) return explicit;
  if (C.fam === "maj") return ["M9", "M13"];
  if (C.fam === "min") return ["M9", "P11"];
  if (C.fam === "dom" || C.fam === "sus") return ["M9", "M13"];
  if (C.fam === "halfdim") return ["M9", "P11"];
  return ["M9"];
}

function uniqueIntervals(intervals){ return intervals.filter((v, i, a) => a.indexOf(v) === i); }

function targetIntervals(type, stage, extensions = false){
  const C = CHORDS[resolveType(type)];
  const core = uniqueIntervals(["P1", C.third, fifthOf(C), C.sev]);
  const base = stage === "guide" ? uniqueIntervals(["P1", C.third, C.sev]) : core;
  return extensions ? uniqueIntervals(base.concat(colorIntervals(type))) : base;
}

function notesForIntervals(root, intervals){
  const base = N(root.l, root.a, 4);
  return intervals.map(interval => iv(base, interval));
}

export function chordLesson(chord, stage = "seventh", extensions = false){
  const C = CHORDS[resolveType(chord.type)];
  const core = uniqueIntervals(["P1", C.third, fifthOf(C), C.sev]);
  const colors = colorIntervals(chord.type);
  const target = targetIntervals(chord.type, stage, extensions);
  return {
    label:chord.label,
    extensions,
    coreDegrees:core.map(intervalDegree),
    colorDegrees:colors.map(intervalDegree),
    targetDegrees:target.map(intervalDegree),
    targetNotes:notesForIntervals(chord.root, target).map(noteName)
  };
}

function normalizeToOctave(root, intervals){
  const tonic = N(root.l, root.a, 4);
  const low = dIdx(tonic), high = low + 7;
  return uniqueIntervals(intervals).map(interval => {
    let note = iv(tonic, interval);
    while (dIdx(note) > high) note = N(note.l, note.a, note.o - 1);
    while (dIdx(note) < low) note = N(note.l, note.a, note.o + 1);
    return note;
  });
}

function rangePath(root, intervals, octaves){
  const tonic = N(root.l, root.a, 4);
  const source = normalizeToOctave(root, intervals).sort((a, b) => dIdx(a) - dIdx(b));
  const out = [];
  for (let octave = 0; octave < octaves; octave++){
    source.forEach(note => out.push(N(note.l, note.a, note.o + octave)));
  }
  out.push(N(tonic.l, tonic.a, tonic.o + octaves));
  return out;
}

function repeatPath(path, count){
  if (!path.length || !count) return [];
  const bounce = path.length > 1 ? path.concat(path.slice(0, -1).reverse()) : path;
  return Array.from({length:count}, (_, i) => bounce[i % bounce.length]);
}

function arpeggioLine(chord, stage, extensions, rangeId, contour, count){
  let intervals = targetIntervals(chord.type, stage, extensions);
  if (contour === "guide"){
    const C = CHORDS[resolveType(chord.type)];
    intervals = uniqueIntervals([C.third, C.sev].concat(intervals.filter(interval =>
      interval !== C.third && interval !== C.sev)));
  }
  const octaves = (CHORD_RANGES[rangeId] || CHORD_RANGES.one).octaves;
  let path = rangePath(chord.root, intervals, octaves);
  if (contour === "guide"){
    // 3、7 先出現，但所有音仍被限制在選定的八度範圍內。
    const preferred = normalizeToOctave(chord.root, intervals);
    const C = CHORDS[resolveType(chord.type)];
    const third = normalizeToOctave(chord.root, [C.third])[0];
    const seventh = normalizeToOctave(chord.root, [C.sev])[0];
    const ordered = [third, seventh].concat(preferred.filter(note =>
      dIdx(note) !== dIdx(third) && dIdx(note) !== dIdx(seventh)));
    path = [];
    for (let octave = 0; octave < octaves; octave++){
      ordered.forEach(note => path.push(N(note.l, note.a, note.o + octave)));
    }
  }
  if (contour === "down") path = path.slice().reverse();
  return repeatPath(path, count);
}

function durationForBeats(beats){
  if (beats === 4) return "w";
  if (beats === 3) return "hd";
  if (beats === 2) return "h";
  return "q";
}

/**
 * 和弦代號反應練習：左手只給根音，右手由代號推算骨架與外音後分解。
 * @param cfg {prog, order, fixed, count, stage, extensions, range, contour, rhythm, ts, seed}
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

  const stage = CHORD_STAGES[cfg.stage] ? cfg.stage : "seventh";
  const extensions = !!cfg.extensions;
  const range = CHORD_RANGES[cfg.range] ? cfg.range : "one";
  const contour = CHORD_CONTOURS[cfg.contour] ? cfg.contour : "up";
  const rhythm = CHORD_RHYTHMS[cfg.rhythm] ? cfg.rhythm : "eighth";

  const systems = tonics.map(key => {
    const bars = realize(cfg.prog, key);
    const lessons = bars.flat().map(chord => chordLesson(chord, stage, extensions));

    const measures = bars.map((bar) => {
      const perBar = bar.length;
      const top = [], bottom = [];
      const labels = [];
      const cellBeats = beats / perBar;

      bar.forEach((c, ci) => {
        labels.push({label: c.label, beat: ci * (beats / perBar)});
        const pattern = chordRhythmPattern(rhythm, cellBeats);
        const count = pattern.filter(cell => !cell[1]).length;
        const line = arpeggioLine(c, stage, extensions, range, contour, count);
        let noteIndex = 0;
        pattern.forEach(([dur, rest]) => {
          if (rest) top.push({rest:true, dur, clef:"treble"});
          else top.push({rest:false, note:line[noteIndex++], dur, clef:"treble"});
        });
        const bass = N(c.root.l, c.root.a, bassOctave(c.root));
        bottom.push({rest:false, note:bass, dur:durationForBeats(cellBeats), clef:"bass"});
      });

      return {top, bottom: bottom.length ? bottom : null, labels,
              label:bar.map(c => c.label).join(" → "),
              names:bar.map(c => chordLesson(c, stage, extensions).targetNotes.join(" – ")),
              chords: bar};
    });

    return {tonic: key, measures, lessons};
  });

  return {
    seed, cfg, systems,
    stage, extensions, range, contour, rhythm, prog: cfg.prog, ts, beats,
    grand:true,
    label: spec.label,
    createdAt: Date.now()
  };
}
