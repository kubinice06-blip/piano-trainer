/* 旋律。
 *
 * 舊版是「一個音一個音往前挑，強拍限制在和弦音、弱拍可以是任何音階音」——
 * 這正是聽起來乾澀的原因：弱拍的音沒有理由，只是剛好合法。
 *
 * 這一版分兩層做，也就是傳統的「骨架 + 加花」：
 *   第一層  骨架音：每個和弦落一到兩個和弦音，管聲部進行、七音解決、導音解決、輪廓
 *   第二層  修飾音：骨架音之間的空隙用「有名字的」非和弦音填 ——
 *           經過音、鄰音、倚音、掛留音、先現音、逃逸音，每一種都有規定的進入與離開方式
 * 有名字，就代表它有解決的義務；有解決，聽起來才像句子而不像亂數。
 */

import { N, dIdx, absPitch, parseVexKey, isAugmentedSecond } from "../core/pitch.js";
import { chordAt } from "./harmony.js";
import { rhythmBank, closingBank, beatsOf, isStrong, DUR } from "./rhythm.js";

/* 依調號在指定音域內排出音階池（低→高） */
export function scalePool(key, loVexKey, hiVexKey){
  const lo = dIdx(parseVexKey(loVexKey)), hi = dIdx(parseVexKey(hiVexKey));
  const pool = [];
  for (let i = lo; i <= hi; i++){
    const l = ((i % 7) + 7) % 7;
    pool.push(N(l, key.accFor(l), Math.floor(i / 7)));
  }
  return pool;
}

export function degreeMap(pool, key){
  return pool.map(n => key.degreeOf(n.l));
}

/* 套上當下和弦帶來的變化音（應用和弦的升記號、小調導音…） */
function withChord(pool, degs, idx, chord){
  const n = pool[idx];
  if (!chord || !chord.alterations.length) return n;
  for (const a of chord.alterations){
    if (a.deg === degs[idx]) return N(n.l, n.a + a.off, n.o);
  }
  return n;
}

/* ---------- 節奏：以「動機」為單位，不是每小節亂抽 ---------- */

/* 樂句的節奏形式。A 是動機，A' 是變形，B 是對比，C 是收尾。
   會重複，聽起來才有句子感 —— 舊版只有「第 3 小節重用第 1 小節」這一條規則。 */
const PHRASE_FORMS = [
  ["A","A","B","C"], ["A","A2","B","C"], ["A","B","A","C"],
  ["A","A2","A","C"], ["A","B","A2","C"], ["A","A","A2","C"]
];

/* 動機變形：把節奏切碎或合併，但保留輪廓長度 */
function varyRhythm(rng, pat, beats){
  const out = [];
  for (const d of pat){
    if (DUR[d] >= 1 && rng.chance(0.45)){
      // 一個四分拆成兩個八分
      if (d === "q"){ out.push("8", "8"); continue; }
      if (d === "h"){ out.push("q", "q"); continue; }
      if (d === "qd"){ out.push("q", "8"); continue; }
    }
    out.push(d);
  }
  const len = out.reduce((a, b) => a + DUR[b], 0);
  return Math.abs(len - beats) < 1e-9 ? out : pat.slice();
}

function planRhythm(rng, cfg, barCount, beats){
  const bank = rhythmBank(cfg.ts, cfg.level);
  const closing = closingBank(cfg.ts, cfg.level);
  const form = barCount === 4 ? rng.pick(PHRASE_FORMS)
             : Array.from({length: barCount}, (_, i) =>
                 i === barCount - 1 ? "C" : (i % 4 === 0 ? "A" : (i % 4 === 2 ? "A2" : "B")));

  const cells = {};
  return form.map((tag, i) => {
    if (i === barCount - 1 || tag === "C") return rng.pick(closing);
    if (tag === "A2"){
      cells.A2 = cells.A2 || varyRhythm(rng, cells.A || rng.pick(bank), beats);
      return cells.A2.slice();
    }
    cells[tag] = cells[tag] || rng.pick(bank);
    return cells[tag].slice();
  });
}

/* ---------- 骨架 ---------- */

/* 找出離 from 最近、音級屬於 allowed 的池索引 */
function nearestWith(pool, degs, from, allowed, maxLeap){
  let best = -1, bestD = 1e9;
  for (let i = 0; i < pool.length; i++){
    if (allowed.indexOf(degs[i]) < 0) continue;
    const d = Math.abs(i - from);
    if (maxLeap && d > maxLeap) continue;
    if (d < bestD){ bestD = d; best = i; }
  }
  return best;
}

function chordDegreesOf(key, chord){
  return chord ? chord.notes.map(n => key.degreeOf(n.l)) : [0, 2, 4];
}

/**
 * 骨架：每個和弦位置挑一個和弦音。
 * 規則來自對位法而不是隨機：
 *   - 七音必須級進下行解決
 *   - 導音（V 級和弦的三音）必須上行解決到主音
 *   - 優先級進，大跳之後反向
 *   - 跟著輪廓弧線走，高點只有一個
 */
function buildSkeleton(rng, key, H, pool, degs, anchors, startIdx, lv){
  const span = pool.length;
  const nAnchor = anchors.length;
  const climax = Math.max(1, Math.min(nAnchor - 2, Math.round(nAnchor * 0.62)));
  const lowC = Math.round(span * 0.30), highC = Math.round(span * 0.80);

  const out = [];
  let cur = startIdx;
  let lastStep = 0;
  let pendingResolve = null;         // {dir, from} 七音或導音欠一個解決

  for (let a = 0; a < nAnchor; a++){
    const {chord, isLast} = anchors[a];
    const tones = chordDegreesOf(key, chord);
    const target = Math.round(lowC + (highC - lowC) *
      (a <= climax ? (climax ? a / climax : 1)
                   : 1 - (a - climax) / Math.max(1, nAnchor - 1 - climax)) * 0.9);

    // 最後一個骨架音收在主和弦的根音或三音，聽起來才算話講完
    let allowed = tones;
    if (isLast) allowed = [tones[0], tones[0], tones[1]];

    const cands = [];
    for (let j = Math.max(0, cur - lv.leap); j <= Math.min(span - 1, cur + lv.leap); j++){
      if (allowed.indexOf(degs[j]) < 0) continue;
      const step = j - cur, d = Math.abs(step);
      let sc = 0;
      if (d === 0) sc -= 9;                    // 骨架音原地不動，聽起來就是停滯
      else if (d === 1) sc += 8;
      else if (d === 2) sc += 5.5;
      else if (d === 3) sc += 2.5;
      else if (d === 4) sc += 1.5;
      else if (d === 6) sc -= 8;               // 七度，旋律禁忌
      else sc += 0.4;

      // 欠解決的音：必須往指定方向級進
      if (pendingResolve){
        if (step === pendingResolve.dir) sc += 14;
        else sc -= 10;
      }
      // 大跳之後要反向級進
      if (Math.abs(lastStep) > 2){
        if (d > 2) sc -= 6;
        else if (step !== 0 && (step > 0) !== (lastStep > 0)) sc += 5;
      }
      const prev = withChord(pool, degs, cur, anchors[a - 1] ? anchors[a-1].chord : chord);
      const cand = withChord(pool, degs, j, chord);
      if (d > 0 && Math.abs(absPitch(cand) - absPitch(prev)) === 6) sc -= 9;   // 三全音跳進
      if (isAugmentedSecond(cand, prev)) sc -= 14;                             // 小調的 ♭6→♯7
      sc += 3 * (1 - Math.abs(j - target) / span);
      cands.push({j, sc});
    }

    let pick;
    if (!cands.length){
      const fb = nearestWith(pool, degs, cur, allowed, 0);
      pick = {j: fb >= 0 ? fb : cur};
    } else {
      pick = rng.weighted(cands, cands.map(c => Math.pow(Math.max(0.05, c.sc), 3)));
    }

    lastStep = pick.j - cur;
    cur = pick.j;
    out.push(cur);

    // 這個音欠不欠解決？（用 members 而不是 notes —— notes 被轉位旋轉過）
    pendingResolve = null;
    if (chord){
      const deg = degs[cur];
      if (chord.members.seventh && deg === key.degreeOf(chord.members.seventh.l)){
        pendingResolve = {dir: -1};                       // 七音級進下行解決
      } else if (chord.leadingTone && deg === key.degreeOf(chord.leadingTone.l)){
        pendingResolve = {dir: +1};                       // 導音上行解決到主音
      }
    }
  }
  return out;
}

/* ---------- 加花：骨架之間的空隙 ---------- */

/* 兩個骨架音之間怎麼走過去。
 *
 * 不用查表列舉音型，而是先決定「這幾步各走幾度」，再把順序打散：
 * 位移總和固定，所以不論怎麼排都一定走到目標音；每一步都不為零，
 * 所以結構上就不可能產生重複音 —— 舊寫法有一半的音型是「原地不動」，
 * 那正是聽起來乾的元兇。
 *
 * 走出來的東西自然就是那些有名字的音型：
 *   全部 +1        → 經過音
 *   +1 −1 成對     → 鄰音
 *   −1 +1 +1       → 迴音 / 逃逸音
 *   ±2            → 和弦內的琶音跳進
 */
function movePlan(rng, disp, steps){
  const s = Math.sign(disp) || (rng.chance(0.5) ? 1 : -1);
  const need = Math.abs(disp);
  const moves = [];

  if (need >= steps){
    // 距離比音數多：平均分配，餘數補在前面
    const base = Math.floor(need / steps), rem = need % steps;
    for (let i = 0; i < steps; i++) moves.push(s * (base + (i < rem ? 1 : 0)));
  } else {
    for (let i = 0; i < need; i++) moves.push(s);
    let extra = steps - need;
    // 多出來的音成對來回 —— 這就是鄰音
    while (extra >= 2){ moves.push(-s); moves.push(s); extra -= 2; }
    if (extra === 1){
      // 奇數：把一步併成三度，再補一個反向，形成逃逸音
      const i = moves.indexOf(s);
      if (i >= 0) moves[i] = s * 2; else moves.push(s * 2);
      moves.push(-s);
    }
  }
  return moves;
}

function diminution(rng, a, b, count, pool, degs, cons){
  if (count <= 0) return [];
  const steps = count + 1;
  const sevenDeg = cons && cons.seventhDeg !== null ? cons.seventhDeg : -1;

  for (let attempt = 0; attempt < 12; attempt++){
    const moves = rng.shuffle(movePlan(rng, b - a, steps));

    // 七音必須級進下行解決。骨架音是七音時第一步就得往下，
    // 中途踩到七音時下一步也得往下 —— 不合格就重排。
    if (cons && cons.startIsSeventh && moves[0] !== -1) continue;
    let violates = false, probe = a;
    for (let i = 0; i < count; i++){
      probe += moves[i];
      if (probe >= 0 && probe < pool.length && degs[probe] === sevenDeg && moves[i + 1] !== -1){
        violates = true; break;
      }
    }
    if (violates) continue;

    const seq = [];
    let cur = a, ok = true;
    for (let i = 0; i < count; i++){
      cur += moves[i];
      if (cur < 0 || cur >= pool.length){ ok = false; break; }
      seq.push(cur);
    }
    if (ok) return seq;
  }

  // 六次都撞到音域邊界：退回單純的級進填入（仍然不會有重複音）
  const dir = Math.sign(b - a) || 1;
  const seq = [];
  for (let k = 1; k <= count; k++){
    const v = a + k * dir;
    seq.push(Math.max(0, Math.min(pool.length - 1, v)));
  }
  return seq;
}

/* ---------- 主流程 ---------- */

export function melodyLine(rng, cfg, H, key, pool, degs, rangeCenter){
  const barCount = H.bars.length;
  const beats = cfg.beats;
  const lv = cfg.levelSpec;
  const pats = planRhythm(rng, cfg, barCount, beats);

  /* 1. 標出骨架位置：每個音符落在哪一拍、屬於哪個和弦、是不是骨架音。
        骨架 = 和弦剛換的位置 + 小節的強拍。 */
  const slots = [];              // 全曲攤平：{bar, k, beat, chord, structural}
  for (let mi = 0; mi < barCount; mi++){
    const bts = beatsOf(pats[mi]);
    for (let k = 0; k < pats[mi].length; k++){
      const beat = bts[k];
      const sl = chordAt(H, mi, beat);
      const chordStart = Math.abs(beat - sl.beat) < 1e-9;
      slots.push({
        bar: mi, k, beat, chord: sl.chord,
        structural: chordStart || (isStrong(beat, cfg.ts) && rng.chance(0.85)),
        isLastBar: mi === barCount - 1
      });
    }
  }
  slots[0].structural = true;
  slots[slots.length - 1].structural = true;

  const anchorIdx = slots.map((s, i) => s.structural ? i : -1).filter(i => i >= 0);
  const anchors = anchorIdx.map((i, n) => ({
    chord: slots[i].chord,
    isLast: n === anchorIdx.length - 1
  }));

  /* 2. 骨架 */
  let start = rangeCenter;
  if (cfg.startIndex >= 0 && cfg.startIndex < pool.length) start = cfg.startIndex;
  const skel = buildSkeleton(rng, key, H, pool, degs, anchors, start, lv);

  /* 3. 加花填空隙 */
  const idxOf = new Array(slots.length).fill(-1);
  anchorIdx.forEach((si, n) => { idxOf[si] = skel[n]; });

  for (let n = 0; n < anchorIdx.length - 1; n++){
    const from = anchorIdx[n], to = anchorIdx[n + 1];
    const count = to - from - 1;
    if (count <= 0) continue;
    const ch = slots[from].chord;
    const sevenDeg = ch && ch.members.seventh ? key.degreeOf(ch.members.seventh.l) : null;
    const fill = diminution(rng, skel[n], skel[n + 1], count, pool, degs, {
      seventhDeg: sevenDeg,
      startIsSeventh: sevenDeg !== null && degs[skel[n]] === sevenDeg
    });
    for (let c = 0; c < count; c++){
      idxOf[from + 1 + c] = (fill && fill[c] !== undefined) ? fill[c] : skel[n];
    }
  }
  // 最後一個骨架音之後若還有音（收尾小節），一律級進走向它
  for (let i = anchorIdx[anchorIdx.length - 1] + 1; i < slots.length; i++) idxOf[i] = skel[skel.length - 1];

  /* 4. 休止符：只放小節頭或尾，首末小節不放。碎休止是斷訊，不是樂句。 */
  const restSet = new Set();
  for (let mi = 1; mi < barCount - 1; mi++){
    if (!rng.chance(lv.rest * 2.4)) continue;
    const inBar = slots.map((s, i) => s.bar === mi ? i : -1).filter(i => i >= 0);
    if (inBar.length < 3) continue;
    const at = rng.chance(0.45) ? inBar[0] : inBar[inBar.length - 1];
    if (slots[at].structural) continue;               // 骨架音不能變休止
    if (DUR[pats[mi][slots[at].k]] > 1) continue;     // 不放長休止
    restSet.add(at);
  }

  /* 5. 組裝，並在寫下每個音時套上和弦的變化音 */
  const measures = Array.from({length: barCount}, () => []);
  const flat = [];

  slots.forEach((s, i) => {
    const dur = pats[s.bar][s.k];
    if (restSet.has(i)){
      measures[s.bar].push({rest: true, dur, clef: cfg.__clef});
      return;
    }
    const idx = Math.max(0, Math.min(pool.length - 1, idxOf[i] >= 0 ? idxOf[i] : skel[0]));
    const item = {rest:false, note: withChord(pool, degs, idx, s.chord), dur,
                  clef: cfg.__clef, idx, beat: s.beat, bar: s.bar};
    measures[s.bar].push(item);
    flat.push({item, slot: s, structural: s.structural, pool, degs});
  });

  fixAugmentedSeconds(flat, key);

  return {measures, endIndex: skel[skel.length - 1]};
}

/* 小調的 ♭6 與 ♯7 直接相鄰會形成增二度，是旋律寫作的老問題。
   實務上的解法不是硬吞，是改用旋律小調的音 —— 把下面那個音升上去。
   只有在兩個音都是和弦音（真的動不了）時，才改成跳進繞開。 */
function fixAugmentedSeconds(flat, key){
  const isChordTone = (note, chord) => {
    if (!chord) return false;
    return chord.notes.some(n => n.l === note.l && n.a === note.a);
  };

  for (let i = 1; i < flat.length; i++){
    const A = flat[i - 1], B = flat[i];
    if (!isAugmentedSecond(A.item.note, B.item.note)) continue;

    const lower = absPitch(A.item.note) < absPitch(B.item.note) ? A : B;
    const upper = lower === A ? B : A;

    // 首選：把下面那個（一定是 ♭6）升半音，變成旋律小調的大二度
    if (!isChordTone(lower.item.note, lower.slot.chord)){
      const n = lower.item.note;
      lower.item.note = N(n.l, n.a + 1, n.o);
      continue;
    }
    // 次選：把上面那個（♯7）降回自然小調的第七音
    if (!isChordTone(upper.item.note, upper.slot.chord)){
      const n = upper.item.note;
      upper.item.note = N(n.l, n.a - 1, n.o);
      continue;
    }
    // 兩個都是和弦音（例如 VI 接 V）：級進走不過去，改成跳到和弦的另一個音
    const target = B.slot.chord;
    if (!target) continue;
    let best = null, bd = 1e9;
    for (const cn of target.notes){
      for (let oct = -1; oct <= 1; oct++){
        const cand = N(cn.l, cn.a, B.item.note.o + oct);
        if (isAugmentedSecond(cand, A.item.note)) continue;
        const d = Math.abs(absPitch(cand) - absPitch(B.item.note));
        if (d > 0 && d < bd){ bd = d; best = cand; }
      }
    }
    if (best) B.item.note = best;
  }
}
