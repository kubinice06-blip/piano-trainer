/* 伴奏聲部模式庫。
   舊版只有三種寫死的寫法（全音符 / 二分 / 固定阿爾貝提），而且永遠是左手。
   這裡把它寫成「與旋律相對的那一隻手」：可以伴奏、可以跟旋律齊奏、
   可以反向對位；旋律換到左手時，同一套寫法整組搬到右手（見 opts.clef / opts.dir）。 */

import { N, dIdx } from "../core/pitch.js";
import { chordAt } from "./harmony.js";
import { DUR } from "./rhythm.js";

/* 依難度可以用哪些模式。愈後面手部獨立要求愈高。 */
export const LH_PATTERNS = {
  sustain:   {label:"持續低音",       minLevel:1, needsMelody:false},
  rootFifth: {label:"根音－五音",     minLevel:2, needsMelody:false},
  block:     {label:"塊狀和弦",       minLevel:3, needsMelody:false},
  waltz:     {label:"低音－和弦－和弦", minLevel:3, needsMelody:false, tsOnly:"3/4"},
  arpeggio:  {label:"分解和弦",       minLevel:4, needsMelody:false},
  alberti:   {label:"阿爾貝提低音",   minLevel:4, needsMelody:false, tsOnly:"4/4"},
  parallel:  {label:"與旋律平行三/六度", minLevel:5, needsMelody:true},
  contrary:  {label:"與旋律反向對位",   minLevel:5, needsMelody:true}
};

export function availablePatterns(level, ts){
  return Object.keys(LH_PATTERNS).filter(k => {
    const p = LH_PATTERNS[k];
    if (level < p.minLevel) return false;
    if (p.tsOnly && p.tsOnly !== ts) return false;
    return true;
  });
}

/* 套上和弦帶來的變化音 */
function alt(key, note, chord){
  if (!chord || !chord.alterations.length) return note;
  const d = key.degreeOf(note.l);
  for (const a of chord.alterations) if (a.deg === d) return N(note.l, note.a + a.off, note.o);
  return note;
}

/* 夾進音域 */
function place(note, loIdx, hiIdx){
  let n = note;
  let guard = 0;
  while (dIdx(n) < loIdx && guard++ < 12) n = N(n.l, n.a, n.o + 1);
  guard = 0;
  while (dIdx(n) > hiIdx && guard++ < 12) n = N(n.l, n.a, n.o - 1);
  return n;
}

/* 和弦成員：0=低音（依轉位）、1、2… 往上疊。
 *
 * 舊寫法只做「超出音域才移八度」，於是和弦常常整團停在音域頂端，
 * 實測第 4 級有三成的小節左手爬到右手旋律上面去。
 * 現在低音會主動貼到該貼的那一端，其餘成員從它往上堆：
 *   伴奏在旋律下方（左手）→ 貼音域下緣
 *   伴奏在旋律上方（右手）→ 貼音域上緣往下留一個八度給整團和弦
 */
function member(chord, i, lo, hi, up){
  const ns = chord.notes;
  const anchor = up ? Math.max(lo, hi - 7) : lo;

  let base = ns[0];
  let guard = 0;
  while (dIdx(base) < anchor && guard++ < 12) base = N(base.l, base.a, base.o + 1);
  guard = 0;
  while (dIdx(base) - 7 >= anchor && guard++ < 12) base = N(base.l, base.a, base.o - 1);
  const baseIdx = dIdx(base);

  if (i === 0) return place(base, lo, hi);

  const wrapped = ns[i % ns.length];
  let n = N(wrapped.l, wrapped.a, base.o + Math.floor(i / ns.length));
  guard = 0;
  while (dIdx(n) <= baseIdx && guard++ < 12) n = N(n.l, n.a, n.o + 1);   // 一定在低音之上
  guard = 0;
  while (dIdx(n) > hi && guard++ < 12) n = N(n.l, n.a, n.o - 1);          // 但不能衝出音域
  return n;
}

/* 依字母級數往下找音（平行三六度用） */
function diatonicBelow(key, note, steps, chord){
  const raw = note.l - steps;
  const l = ((raw % 7) + 7) % 7;
  const o = note.o + Math.floor(raw / 7);
  return alt(key, N(l, key.accFor(l), o), chord);
}

/* ---------- 各種模式 ---------- */

function patternNotes(rng, name, ctx){
  const {H, key, cfg, lo, hi, melody} = ctx;
  const clef = ctx.clef || "bass";
  const dir = ctx.dir || -1;          // 伴奏走在旋律的下方（-1，左手）或上方（+1，右手）
  const beats = cfg.beats;
  const mem = (ch, i) => member(ch, i, lo, hi, dir > 0);
  const out = [];

  for (let mi = 0; mi < H.bars.length; mi++){
    const slots = H.bars[mi].slots;
    const bar = [];

    const emitFor = (slot, dur, pick) => {
      const ch = slot.chord;
      bar.push({rest:false, note: pick(ch), dur, clef, bar:mi});
    };

    if (name === "sustain"){
      // 一個和弦一個長音；一小節兩個和弦就各半
      slots.forEach(sl => {
        const d = sl.beats === beats ? (beats === 4 ? "w" : beats === 3 ? "hd" : "h")
                                     : (sl.beats === 2 ? "h" : "q");
        emitFor(sl, d, ch => mem(ch, 0));
      });

    } else if (name === "rootFifth"){
      slots.forEach(sl => {
        const half = sl.beats / 2;
        const d = half === 2 ? "h" : half === 1.5 ? "qd" : "q";
        emitFor(sl, d, ch => mem(ch, 0));
        emitFor(sl, d, ch => mem(ch, 2));
      });

    } else if (name === "block"){
      slots.forEach(sl => {
        const d = sl.beats === 4 ? "w" : sl.beats === 3 ? "hd" : sl.beats === 2 ? "h" : "q";
        const ch = sl.chord;
        bar.push({rest:false, chordNotes: ch.notes.slice(0, 3).map((n, i) => mem(ch, i)),
                  note: mem(ch, 0), dur: d, clef, bar:mi});
      });

    } else if (name === "waltz"){
      const sl = slots[0];
      emitFor(sl, "q", ch => mem(ch, 0));
      for (let b = 1; b < 3; b++){
        const s2 = chordAt(H, mi, b);
        const ch = s2.chord;
        bar.push({rest:false, chordNotes:[mem(ch, 1), mem(ch, 2)],
                  note: mem(ch, 1), dur:"q", clef, bar:mi});
      }

    } else if (name === "arpeggio"){
      const up = rng.chance(0.6);
      slots.forEach(sl => {
        const n = Math.round(sl.beats);
        const order = up ? [0,1,2,1] : [0,2,1,2];
        for (let b = 0; b < n; b++) emitFor(sl, "q", ch => mem(ch, order[b % 4]));
      });

    } else if (name === "alberti"){
      slots.forEach(sl => {
        const n = Math.round(sl.beats * 2);        // 每拍兩個八分
        const order = [0, 2, 1, 2];
        for (let b = 0; b < n; b++) emitFor(sl, "8", ch => mem(ch, order[b % 4]));
      });

    } else if (name === "parallel" && melody){
      // 與旋律同節奏，平行三度或六度 —— 兩手一起唱同一句。
      // 方向跟著 dir：旋律在右手就往下疊，旋律在左手就往上疊，兩手才不會交叉。
      const steps = (rng.chance(0.5) ? 2 : 5) * (dir < 0 ? 1 : -1);
      melody[mi].forEach(it => {
        if (it.rest){ bar.push({rest:true, dur:it.dur, clef, bar:mi}); return; }
        const sl = chordAt(H, mi, it.beat || 0);
        let n = diatonicBelow(key, it.note, steps, sl.chord);
        while (dIdx(n) > hi) n = N(n.l, n.a, n.o - 1);
        while (dIdx(n) < lo) n = N(n.l, n.a, n.o + 1);
        bar.push({rest:false, note:n, dur:it.dur, clef, bar:mi});
      });

    } else if (name === "contrary" && melody){
      // 反向對位：旋律上行時伴奏下行。骨架仍落在和弦音上，否則會撞在一起。
      const mel = melody[mi].filter(it => !it.rest);
      const n = Math.max(1, Math.min(mel.length, Math.round(beats)));
      for (let b = 0; b < n; b++){
        const sl = chordAt(H, mi, b * (beats / n));
        const ch = sl.chord;
        const ref = mel[Math.min(mel.length - 1, Math.floor(b * mel.length / n))];
        // 旋律在高處就取和弦低音，旋律在低處就取和弦上方的音
        const high = ref ? (dIdx(ref.note) % 7) : 0;
        const pickIdx = (b % 2 === 0) ? 0 : (high > 3 ? 1 : 2);
        bar.push({rest:false, note: mem(ch, pickIdx),
                  dur: n === 4 ? "q" : n === 3 ? "q" : n === 2 ? "h" : "w", clef, bar:mi});
      }

    } else {
      slots.forEach(sl => emitFor(sl, sl.beats === 4 ? "w" : sl.beats === 3 ? "hd" : sl.beats === 2 ? "h" : "q",
                                  ch => mem(ch, 0)));
    }

    // 時值保險：湊不滿或超過就退回最單純的持續低音
    const len = bar.reduce((a, x) => a + DUR[x.dur], 0);
    if (Math.abs(len - beats) > 1e-9){
      const ch = slots[0].chord;
      out.push([{rest:false, note: mem(ch, 0),
                 dur: beats === 4 ? "w" : beats === 3 ? "hd" : "h", clef, bar:mi}]);
    } else {
      out.push(bar);
    }
  }
  return out;
}

/**
 * 伴奏聲部。
 * @param {string} forced 指定模式；不給就依難度隨機
 * @param {object} opts   {clef:"bass"|"treble", dir:-1|+1} —— 這隻手在旋律的下方還是上方
 */
export function bassLine(rng, cfg, H, key, range, melody, forced, opts){
  const o = opts || {};
  const lo = dIdx(range.lo), hi = dIdx(range.hi);
  let name = forced;
  if (!name || !LH_PATTERNS[name]){
    const avail = availablePatterns(cfg.level, cfg.ts)
      .filter(k => !LH_PATTERNS[k].needsMelody || melody);
    name = rng.pick(avail);
  }
  if (LH_PATTERNS[name] && LH_PATTERNS[name].needsMelody && !melody) name = "sustain";

  return {
    pattern: name,
    label: LH_PATTERNS[name] ? LH_PATTERNS[name].label : name,
    measures: patternNotes(rng, name, {H, key, cfg, lo, hi, melody,
                                       clef: o.clef || "bass", dir: o.dir || -1})
  };
}
