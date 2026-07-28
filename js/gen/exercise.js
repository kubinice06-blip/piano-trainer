/* 視譜出題的入口。一段練習 = seed + cfg，其他全部由此推導出來。 */

import { Rng, randomSeed } from "../core/rng.js";
import { parseVexKey, dIdx } from "../core/pitch.js";
import { Key, MAJOR_KEYS, MINOR_KEYS, ALL_KEYS, keysWithin, cycleOfFourths } from "../core/key.js";
import { tsInfo } from "./rhythm.js";
import { buildHarmony, cadenceKind } from "./harmony.js";
import { melodyLine, scalePool, degreeMap } from "./melody.js";
import { bassLine, chordPad, availablePatterns, LH_PATTERNS } from "./bass.js";

/* 難度不再綁死調名清單，改成「調號數上限」——
   所以每個難度都自然涵蓋到該範圍內的全部調，含小調。 */
export const LEVELS = [
  {n:"1 · 五指位置",       maxAcc:0, minor:false, treble:["c/4","g/4"], bass:["c/3","g/3"], leap:2, rest:0,    chrom:0},
  {n:"2 · 一個八度",       maxAcc:1, minor:false, treble:["c/4","c/5"], bass:["f/2","c/4"], leap:3, rest:0,    chrom:0},
  {n:"3 · 加線起步",       maxAcc:2, minor:true,  treble:["a/3","e/5"], bass:["c/2","e/4"], leap:4, rest:0.10, chrom:0},
  {n:"4 · 附點與跳進",     maxAcc:3, minor:true,  treble:["f/3","g/5"], bass:["c/2","e/4"], leap:5, rest:0.12, chrom:0},
  {n:"5 · 十六分音符",     maxAcc:5, minor:true,  treble:["a/3","a/5"], bass:["e/2","c/4"], leap:6, rest:0.14, chrom:0.04},
  {n:"6 · 切分與臨時記號", maxAcc:7, minor:true,  treble:["e/3","c/6"], bass:["c/2","e/4"], leap:7, rest:0.14, chrom:0.12}
];

export const KEY_POOLS = [
  {id:"level",    label:"依難度"},
  {id:"allMajor", label:"全部大調（15）"},
  {id:"allMinor", label:"全部小調（15）"},
  {id:"all",      label:"全部 30 個調"},
  {id:"cycle",    label:"五度圈輪替"},
  {id:"cycleMin", label:"五度圈輪替（小調）"}
];

export const HAND_MODES = [
  {id:"both", label:"雙手", clef:"grand"},
  {id:"swap", label:"雙手（左手旋律）", clef:"grand"},
  {id:"rh",   label:"只有右手", clef:"treble"},
  {id:"lh",   label:"只有左手", clef:"bass"}
];

export function resolveKeyPool(level, poolId){
  const spec = LEVELS[level - 1];
  switch (poolId){
    case "allMajor": return MAJOR_KEYS.slice();
    case "allMinor": return MINOR_KEYS.slice();
    case "all":      return ALL_KEYS.slice();
    case "cycle":    return cycleOfFourths("major");
    case "cycleMin": return cycleOfFourths("minor");
    default:         return keysWithin(spec.maxAcc, {major:true, minor:spec.minor});
  }
}

export function chooseKey(rng, level, poolId, step){
  if (poolId && poolId.indexOf("cycle") === 0){
    const cyc = resolveKeyPool(level, poolId);
    return cyc[((step || 0) % cyc.length + cyc.length) % cyc.length];
  }
  if (poolId && poolId !== "level" && Key.fromId(poolId).id === poolId) return Key.fromId(poolId);
  return rng.pick(resolveKeyPool(level, poolId));
}

function range(spec, which){
  return {lo: parseVexKey(spec[which][0]), hi: parseVexKey(spec[which][1])};
}

/**
 * @param {object} cfg {level, keyPool|key, ts, hands, lhPattern, bars, step, startIndex, seed}
 */
export function generateExercise(cfg){
  const seed = (cfg.seed === undefined || cfg.seed === null) ? randomSeed() : cfg.seed;
  const rng = new Rng(seed);

  const level = cfg.level;
  const spec = LEVELS[level - 1];
  const key = cfg.key instanceof Key ? cfg.key : chooseKey(rng, level, cfg.keyPool, cfg.step);
  const ts = cfg.ts;
  const beats = tsInfo(ts).beats;
  const barCount = cfg.bars;
  const hands = cfg.hands || "both";
  const clef = (HAND_MODES.find(h => h.id === hands) || HAND_MODES[0]).clef;

  const H = buildHarmony(rng.fork("harmony"), key, barCount,
                         {level, beats, mustResolve: !!cfg.mustResolve});

  const inner = {
    level, levelSpec: spec, ts, beats,
    startIndex: (cfg.startIndex === undefined) ? -1 : cfg.startIndex
  };

  const out = {
    seed,
    cfg: {level, keyPool: cfg.keyPool, ts, hands, bars: barCount, step: cfg.step || 0,
          lhPattern: cfg.lhPattern || null},
    key, ts, clef, hands, beats,
    harmony: H,
    roman: H.roman,
    measures: [],
    cadence: cadenceKind(H),
    endIndex: -1,
    lhLabel: null,
    createdAt: Date.now()
  };

  /* 旋律走在哪一手 */
  const melodyOnBass = (hands === "lh" || hands === "swap");
  const melRangeKey = melodyOnBass ? "bass" : "treble";
  const melClef = melodyOnBass ? "bass" : "treble";

  const mp = scalePool(key, spec[melRangeKey][0], spec[melRangeKey][1]);
  const md = degreeMap(mp, key);

  // 段落銜接：從上一段的結尾音附近起頭，兩段之間才不會突然跳掉一個八度。
  // 換調時字母級數會對不上，所以是找「譜面上最接近的位置」而不是同一個索引。
  if (cfg.startNote){
    const want = dIdx(cfg.startNote);
    let best = -1, bd = 1e9;
    for (let i = 0; i < mp.length; i++){
      const d = Math.abs(dIdx(mp[i]) - want);
      if (d < bd){ bd = d; best = i; }
    }
    if (best >= 0) inner.startIndex = best;
  }

  const mel = melodyLine(rng.fork("melody"),
    Object.assign({}, inner, {__clef: melClef}), H, key, mp, md, Math.round(mp.length * 0.45));
  out.endIndex = mel.endIndex;

  if (hands === "rh" || hands === "lh"){
    for (let i = 0; i < barCount; i++) out.measures.push({top: mel.measures[i], bottom: null});
    return out;
  }

  if (hands === "swap"){
    const pad = chordPad(inner, H, range(spec, "treble"), "treble");
    for (let i = 0; i < barCount; i++) out.measures.push({top: pad[i], bottom: mel.measures[i]});
    out.lhLabel = "左手旋律 · 右手和弦";
    return out;
  }

  // 雙手：右手旋律 + 左手模式
  const lh = bassLine(rng.fork("lh"), inner, H, key, range(spec, "bass"), mel.measures, cfg.lhPattern);
  out.lhLabel = lh.label;
  out.lhPattern = lh.pattern;
  for (let i = 0; i < barCount; i++) out.measures.push({top: mel.measures[i], bottom: lh.measures[i]});
  return out;
}

export { availablePatterns, LH_PATTERNS };
