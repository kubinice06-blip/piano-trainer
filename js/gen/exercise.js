/* 視譜出題的入口。一段練習 = seed + cfg，其他全部由此推導出來。 */

import { Rng, randomSeed } from "../core/rng.js";
import { N, parseVexKey, dIdx } from "../core/pitch.js";
import { Key, MAJOR_KEYS, MINOR_KEYS, ALL_KEYS, keysWithin, cycleOfFourths } from "../core/key.js";
import { tsInfo, NOTE_DENSITY, densityMode } from "./rhythm.js";
import { buildHarmony, cadenceKind, chordAt } from "./harmony.js";
import { melodyLine, scalePool, degreeMap, FOCUS, focusMode } from "./melody.js";
import { bassLine, availablePatterns, LH_PATTERNS, INVERSIONS, inversionMode } from "./bass.js";
import { normaliseVector, generatorLevels } from "../adaptive.js";

/* Stored with every new exercise/attempt. Increment this whenever a generator
   change can make the same seed + settings produce a different score. */
export const GENERATOR_VERSION = 4;

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

/* 垂直音程以和聲骨架出題：強拍與換和弦點只選當下和弦音，弱拍才使用
   順階經過音。兩手分別作最近音聲部進行，並避開同名音的八度複製。
   音域刻意縮在高、低音譜表內，難度只改變移動距離與轉向頻率。 */
function scaleNote(key, degree, tonicOctave){
  const raw = key.letter + degree;
  const letter = ((raw % 7) + 7) % 7;
  const octave = tonicOctave + Math.floor(raw / 7);
  return key.noteAt(letter, octave);
}

const INTERVAL_STAFF = {
  treble:{low:30, high:36, centre:33}, // E4–D5：不使用加線
  bass:{low:18, high:24, centre:21}    // B2–A3：不使用加線
};

function pitchClassKey(note){ return note.l + ":" + note.a; }

function noteAtDiatonicPosition(key, position){
  return scaleNote(key, position - (4 * 7 + key.letter), 4);
}

function chordCandidates(chord, staff){
  const out = [], seen = new Set();
  for (const source of chord.notes){
    for (let shift = -4; shift <= 4; shift++){
      const note = N(source.l, source.a, source.o + shift);
      const position = dIdx(note);
      const id = position + ":" + note.a;
      if (position < staff.low || position > staff.high || seen.has(id)) continue;
      seen.add(id);
      out.push({note, pc:pitchClassKey(note)});
    }
  }
  return out;
}

function chooseAnchorPair(rng, chord, previous, directions, level){
  const right = chordCandidates(chord, INTERVAL_STAFF.treble);
  const left = chordCandidates(chord, INTERVAL_STAFF.bass);
  const pairs = [];
  for (const r of right){
    for (const l of left){
      if (r.pc === l.pc) continue;
      const rd = previous ? dIdx(r.note) - dIdx(previous.top) : 0;
      const ld = previous ? dIdx(l.note) - dIdx(previous.bottom) : 0;
      let score = Math.abs(dIdx(r.note) - INTERVAL_STAFF.treble.centre) * 0.35 +
                  Math.abs(dIdx(l.note) - INTERVAL_STAFF.bass.centre) * 0.35;
      if (previous){
        score += Math.abs(rd) + Math.abs(ld);
        score += Math.max(0, Math.abs(rd) - level * 2) * 5;
        score += Math.max(0, Math.abs(ld) - level * 2) * 5;
        const directionPenalty = [12, 8, 4][level - 1];
        const repeatPenalty = [5, 3.5, 2][level - 1];
        if (rd && Math.sign(rd) !== directions.top) score += directionPenalty;
        if (ld && Math.sign(ld) !== directions.bottom) score += directionPenalty;
        if (!rd) score += repeatPenalty;
        if (!ld) score += repeatPenalty;
      }
      pairs.push({top:r.note, bottom:l.note, score:score + rng.next() * 1.5});
    }
  }
  pairs.sort((a, b) => a.score - b.score);
  if (!pairs.length) throw new Error("interval coach cannot place two different chord members inside the staves");
  return pairs[0];
}

function passingPosition(rng, key, from, to, staff, level, fallbackDirection){
  const start = dIdx(from), target = to ? dIdx(to) : start + fallbackDirection * level;
  let direction = Math.sign(target - start) || fallbackDirection;
  const distance = Math.abs(target - start);
  const maxStep = Math.max(1, Math.min(level, distance || level));
  const step = level === 1 ? 1 : rng.range(1, maxStep);
  let position = start + direction * step;
  if (position < staff.low || position > staff.high){
    direction *= -1;
    position = start + direction * step;
  }
  position = Math.max(staff.low, Math.min(staff.high, position));
  return noteAtDiatonicPosition(key, position);
}

function avoidOctaveCopy(rng, key, top, bottom, staff, from, to, level, direction){
  if (pitchClassKey(top) !== pitchClassKey(bottom)) return bottom;
  const base = dIdx(bottom);
  const options = [];
  for (const offset of [-1, 1, -2, 2]){
    const position = base + offset;
    if (position < staff.low || position > staff.high) continue;
    const note = noteAtDiatonicPosition(key, position);
    if (pitchClassKey(note) === pitchClassKey(top)) continue;
    const pathCost = Math.abs(position - dIdx(from)) + (to ? Math.abs(dIdx(to) - position) : 0);
    const directionCost = Math.sign(position - dIdx(from)) === direction ? 0 : 1;
    options.push({note, score:pathCost + directionCost + rng.next() * 0.2});
  }
  options.sort((a, b) => a.score - b.score);
  return options[0]?.note || bottom;
}

function intervalHarmonyMeasures(rng, key, harmony, bars, beats, drill){
  const total = Math.max(1, bars * beats);
  const level = Math.max(1, Math.min(3, Number(drill?.level) || 1));
  const settings = [
    {segment:[3, 4]},
    {segment:[2, 3]},
    {segment:[1, 2]}
  ][level - 1];
  const directions = {top:rng.chance(0.5) ? 1 : -1, bottom:rng.chance(0.5) ? 1 : -1};
  let directionLeft = rng.range(settings.segment[0], settings.segment[1]);
  const anchors = new Map();
  let previous = null;

  for (let i = 0; i < total; i++){
    const bar = Math.floor(i / beats), beat = i % beats;
    const slot = chordAt(harmony, bar, beat);
    const isAnchor = i === 0 || beat % 2 === 0 || Math.abs(beat - slot.beat) < 1e-9;
    if (!isAnchor) continue;
    if (previous && --directionLeft <= 0){
      if (level === 1 || rng.chance(level === 2 ? 0.7 : 0.9)) directions.top *= -1;
      if (rng.chance(level === 1 ? 0.35 : 0.65)) directions.bottom *= -1;
      directionLeft = rng.range(settings.segment[0], settings.segment[1]);
    }
    const pair = chooseAnchorPair(rng, slot.chord, previous, directions, level);
    anchors.set(i, pair);
    previous = pair;
  }

  const measures = Array.from({length:bars}, () => ({top:[], bottom:[]}));
  for (let i = 0; i < total; i++){
    const bar = Math.floor(i / beats), beat = i % beats;
    const slot = chordAt(harmony, bar, beat);
    let top, bottom, harmonicRole;
    if (anchors.has(i)){
      ({top, bottom} = anchors.get(i));
      harmonicRole = "chord";
    } else {
      let previousIndex = i - 1;
      while (previousIndex >= 0 && !anchors.has(previousIndex)) previousIndex--;
      let nextIndex = i + 1;
      while (nextIndex < total && !anchors.has(nextIndex)) nextIndex++;
      const before = anchors.get(previousIndex);
      const after = anchors.get(nextIndex);
      const topDirection = after ? (Math.sign(dIdx(after.top) - dIdx(before.top)) || directions.top) : directions.top;
      const bottomDirection = after ? (Math.sign(dIdx(after.bottom) - dIdx(before.bottom)) || directions.bottom) : directions.bottom;
      top = passingPosition(rng, key, before.top, after?.top, INTERVAL_STAFF.treble, level, topDirection);
      bottom = passingPosition(rng, key, before.bottom, after?.bottom, INTERVAL_STAFF.bass, level, bottomDirection);
      bottom = avoidOctaveCopy(rng, key, top, bottom, INTERVAL_STAFF.bass,
        before.bottom, after?.bottom, level, bottomDirection);
      harmonicRole = "passing";
    }
    const common = {rest:false, dur:"q", bar, beat, harmonicRole, chordToken:slot.token};
    measures[bar].top.push({...common, note:top, clef:"treble"});
    measures[bar].bottom.push({...common, note:bottom, clef:"bass"});
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
    const drillLevel = Math.max(1, Math.min(3, Number(cfg.intervalDrill.level) || 1));
    const intervalRng = rng.fork("interval");
    out.cfg.intervalDrill = {level:drillLevel, harmonyGuided:true};
    out.measures = intervalHarmonyMeasures(intervalRng, key, H, barCount, beats, {level:drillLevel});
    out.lhPattern = "voice-leading";
    out.lhLabel = ["和弦骨架・級進為主", "和弦骨架・到三度", "和弦骨架・到四度"][drillLevel - 1];
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
