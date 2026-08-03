/* 視譜出題的入口。一段練習 = seed + cfg，其他全部由此推導出來。 */

import { Rng, randomSeed } from "../core/rng.js";
import { N, parseVexKey, dIdx } from "../core/pitch.js";
import { Key, MAJOR_KEYS, MINOR_KEYS, ALL_KEYS, keysWithin, cycleOfFourths } from "../core/key.js";
import { tsInfo, NOTE_DENSITY, densityMode } from "./rhythm.js";
import { buildHarmony, cadenceKind } from "./harmony.js";
import { melodyLine, scalePool, degreeMap, FOCUS, focusMode } from "./melody.js";
import { bassLine, availablePatterns, LH_PATTERNS, INVERSIONS, inversionMode } from "./bass.js";
import { normaliseVector, generatorLevels } from "../adaptive.js";

/* Stored with every new exercise/attempt. Increment this whenever a generator
   change can make the same seed + settings produce a different score. */
export const GENERATOR_VERSION = 3;

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
  {id:"both", label:"雙手 · 右手主旋律", short:"右手主旋律", clef:"grand"},
  {id:"swap", label:"雙手 · 左手主旋律", short:"左手主旋律", clef:"grand"},
  {id:"rh",   label:"只有右手",         short:"只有右手",   clef:"treble"},
  {id:"lh",   label:"只有左手",         short:"只有左手",   clef:"bass"}
];

/* 交換練：同一段譜換一隻手當主角。只有主旋律換手，其他全部不動。 */
export const HAND_SWAP = {both:"swap", swap:"both", rh:"lh", lh:"rh"};

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

/* 伴奏得放得下和弦。第一級的旋律音域只有五度，直接拿來排三個音會全疊在同一格，
   所以伴奏那一隻手至少給到一個八度。 */
function chordRange(r){
  if (dIdx(r.hi) - dIdx(r.lo) >= 7) return r;
  return {lo: r.lo, hi: N(r.lo.l, r.lo.a, r.lo.o + 1)};
}

function limitBeginnerLeftHand(measures, maxSpan = 4){
  for (const measure of measures){
    for (const item of measure){
      if (!item.chordNotes || item.chordNotes.length < 2) continue;
      const notes = item.chordNotes.slice().sort((a, b) => dIdx(a) - dIdx(b));
      let best = [];
      for (let from = 0; from < notes.length; from++){
        for (let to = from; to < notes.length; to++){
          if (dIdx(notes[to]) - dIdx(notes[from]) > maxSpan) break;
          const candidate = notes.slice(from, to + 1);
          if (candidate.length > best.length) best = candidate;
        }
      }
      item.chordNotes = best.length ? best : [notes[0]];
      item.note = item.chordNotes[0];
    }
  }
  return measures;
}

function lastNoteOf(measures){
  for (let i = measures.length - 1; i >= 0; i--){
    const line = measures[i];
    for (let k = line.length - 1; k >= 0; k--) if (!line[k].rest) return line[k].note;
  }
  return null;
}

/* 垂直音程不是一般旋律加上伴奏：練習目標是兩手同時走同一條音階，
   所以兩個聲部都必須由同一個「全音階座標」直接生成。這可避免和聲伴奏
   為了落在和弦音而打斷方向，造成看起來像是平行、實際卻亂跳的題目。 */
function scaleNote(key, degree, tonicOctave){
  const raw = key.letter + degree;
  const letter = ((raw % 7) + 7) % 7;
  const octave = tonicOctave + Math.floor(raw / 7);
  return key.noteAt(letter, octave);
}

function intervalScaleMeasures(key, bars, beats, drill){
  const total = Math.max(1, bars * beats);
  const direction = drill?.direction === "down" ? -1 : 1;
  const stepsBelow = Math.max(1, Math.min(3, Number(drill?.degree) || 2));
  // 上行由主音出發；下行先從高八度主音出發，兩種都是完整、連續的音階。
  const start = direction > 0 ? 0 : 7;
  const measures = Array.from({length:bars}, () => ({top:[], bottom:[]}));
  for (let i = 0; i < total; i++){
    const degree = start + direction * i;
    const top = scaleNote(key, degree, 4);
    const bottom = scaleNote(key, degree - stepsBelow, 4);
    const bar = Math.floor(i / beats);
    measures[bar].top.push({rest:false, note:top, dur:"q", clef:"treble", bar});
    measures[bar].bottom.push({rest:false, note:bottom, dur:"q", clef:"bass", bar});
  }
  return measures;
}

/**
 * @param {object} cfg {level, keyPool|key, ts, hands, lhPattern, bars, density, step, startIndex, seed}
 */
export function generateExercise(cfg){
  const seed = (cfg.seed === undefined || cfg.seed === null) ? randomSeed() : cfg.seed;
  const rng = new Rng(seed);

  const level = Math.max(1, Math.min(6, Number(cfg.level) || 1));
  const difficulty = normaliseVector(cfg.difficulty, level);
  const axis = generatorLevels(difficulty);
  const spec = LEVELS[axis.rangeLevel - 1];
  const key = cfg.key instanceof Key ? cfg.key : chooseKey(rng, axis.keyLevel, cfg.keyPool, cfg.step);
  const ts = cfg.ts;
  const beats = tsInfo(ts).beats;
  const barCount = cfg.bars;
  const hands = cfg.hands || "both";
  const density = densityMode(cfg.density || axis.density).id;
  const focus = focusMode(cfg.focus).id;
  const inversion = inversionMode(cfg.inversion);
  const clef = (HAND_MODES.find(h => h.id === hands) || HAND_MODES[0]).clef;

  const H = buildHarmony(rng.fork("harmony"), key, barCount,
                         {level:Math.max(axis.rhythmLevel, axis.textureLevel), beats,
                          mustResolve: !!cfg.mustResolve,
                          preferredBars:cfg.preferredHarmonyBars});

  const inner = {
    level:axis.rhythmLevel, textureLevel:axis.textureLevel, levelSpec: spec, ts, beats, density, focus,
    preferredRhythms:cfg.preferredRhythms,
    startIndex: (cfg.startIndex === undefined) ? -1 : cfg.startIndex
  };

  const out = {
    seed,
    generatorVersion: GENERATOR_VERSION,
    cfg: {level, difficulty, keyPool: cfg.keyPool, ts, hands, bars: barCount, step: cfg.step || 0,
          lhPattern: cfg.lhPattern || null, density, focus, inversion},
    difficulty,
    key, ts, clef, hands, beats, density, focus, inversion,
    harmony: H,
    roman: H.roman,
    measures: [],
    cadence: cadenceKind(H),
    endIndex: -1,
    lhLabel: null,
    createdAt: Date.now()
  };

  if (cfg.intervalDrill){
    const degree = Math.max(1, Math.min(3, Number(cfg.intervalDrill.degree) || 2));
    const direction = cfg.intervalDrill.direction === "down" ? "down" : "up";
    out.cfg.intervalDrill = {direction, degree};
    out.measures = intervalScaleMeasures(key, barCount, beats, {direction, degree});
    out.lhPattern = "parallel";
    out.lhLabel = "左手平行" + (degree + 1) + "度・" + (direction === "up" ? "上行音階" : "下行音階");
    out.tailNote = out.measures.at(-1)?.top.at(-1)?.note || null;
    return out;
  }

  /* 旋律走在哪一手。旋律永遠在那隻手自己的音域裡寫成 ——
     所以左手拿旋律時，它落在左手本來就該待的位置，而不是右手音域硬搬下來。 */
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
  // 段落銜接是在「產生旋律的那個音域」裡算的，所以回報的是移八度之前的音
  out.tailNote = lastNoteOf(mel.measures);

  if (hands === "rh" || hands === "lh"){
    for (let i = 0; i < barCount; i++) out.measures.push({top: mel.measures[i], bottom: null});
    return out;
  }

  /* 交換練：左手拿旋律，右手接下整套伴奏音型。
     伴奏跟著換到右手的音域，所以兩手各自都待在該待的位置，不會擠在一起。 */
  if (hands === "swap"){
    const rh = bassLine(rng.fork("lh"), inner, H, key, chordRange(range(spec, "treble")),
                        mel.measures, cfg.lhPattern, {clef:"treble", dir:+1, inversion});
    out.lhLabel = "右手" + rh.label;
    out.lhPattern = rh.pattern;
    out.melodyOn = "bottom";
    for (let i = 0; i < barCount; i++) out.measures.push({top: rh.measures[i], bottom: mel.measures[i]});
    return out;
  }

  // 雙手：右手旋律 + 左手伴奏。
  // 初階的核心是固定五指手位：左手從最低到最高不得超過五度。
  // 第 2 級起才為塊狀和弦擴到一個八度；這個判斷跟著「音高音域」軸，而不是總難度。
  const beginnerLeftRange = range(spec, "bass");
  const accompanimentRange = axis.rangeLevel === 1 ? beginnerLeftRange : chordRange(beginnerLeftRange);
  const lh = bassLine(rng.fork("lh"), inner, H, key, accompanimentRange, mel.measures,
                      cfg.lhPattern, {clef:"bass", dir:-1, inversion});
  if (axis.rangeLevel === 1) limitBeginnerLeftHand(lh.measures);
  out.lhLabel = "左手" + lh.label;
  out.lhPattern = lh.pattern;
  for (let i = 0; i < barCount; i++) out.measures.push({top: mel.measures[i], bottom: lh.measures[i]});
  return out;
}

export { availablePatterns, LH_PATTERNS, NOTE_DENSITY, FOCUS, INVERSIONS };
