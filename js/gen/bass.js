/* 伴奏聲部模式庫。
   舊版只有三種寫死的寫法（全音符 / 二分 / 固定阿爾貝提），而且永遠是左手。
   這裡把它寫成「與旋律相對的那一隻手」：可以伴奏、可以跟旋律齊奏、
   可以反向對位；旋律換到左手時，同一套寫法整組搬到右手（見 opts.clef / opts.dir）。 */

import { N, dIdx } from "../core/pitch.js";
import { chordAt } from "./harmony.js";
import { DUR } from "./rhythm.js";

/* 依難度可以用哪些模式。愈後面手部獨立要求愈高。 */
/* 塊狀和弦／華爾滋式伴奏原本要求第 3 級才開放，理由其實不是難度，
   是「左手音域不夠寬，三個音疊起來會擠成一團」—— 那是音域的問題，
   不是彈奏難度的問題。音域現在由 exercise.js 的 chordRange() 保證撐到至少一個八度，
   所以和弦伴奏在所有難度都選得到。 */
export const LH_PATTERNS = {
  sustain:   {label:"持續低音",       minLevel:1, needsMelody:false},
  rootFifth: {label:"根音－五音",     minLevel:1, needsMelody:false},
  block:     {label:"塊狀和弦",       minLevel:1, needsMelody:false},
  waltz:     {label:"低音－和弦－和弦", minLevel:1, needsMelody:false, tsOnly:"3/4"},
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

/* 和弦成員：0=低音、1、2… 往上疊。ns 是已經套過轉位的音陣列。
 *
 * 舊寫法只做「超出音域才移八度」，於是和弦常常整團停在音域頂端，
 * 實測第 4 級有三成的小節左手爬到右手旋律上面去。
 * 現在低音會主動貼到 anchor，其餘成員從它往上堆。
 * anchor 由呼叫端決定 —— 每一題會在音域裡挑不同的落點，
 * 左手才不會每一題都從同一個 C2 開始。
 */
function member(ns, i, lo, hi, anchor){
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

/* ---------- 轉位 ---------- */

/* 注意「照和聲原樣」不等於「全部都是原位」——
   和聲進行本身就會出現 I6、V65 這種帶轉位的級數，那是和聲的一部分。
   這一欄控制的是「伴奏那隻手要不要再另外轉位」。 */
export const INVERSIONS = [
  {id:"auto",   label:"依難度（低階原樣・高階最省力）"},
  {id:"root",   label:"照和聲原樣，不另外轉位"},
  {id:"smooth", label:"最省力（自動選最近的轉位）"},
  {id:"mix",    label:"隨機轉位"},
  {id:"cycle",  label:"輪替：原位 → 第一 → 第二"},
  {id:"first",  label:"只練第一轉位（三音在低音）"},
  {id:"second", label:"只練第二轉位（五音在低音）"}
];

export function inversionMode(id){
  for (let i = 0; i < INVERSIONS.length; i++) if (INVERSIONS[i].id === id) return INVERSIONS[i].id;
  return "auto";
}

/* 轉位就是把低音搬到上面去。只在前三個音之間轉 ——
   七和弦的第三轉位（七音在低音）對這個階段的左手來說太難按。 */
function rotate(ns, k){
  const n = Math.min(ns.length, 3);
  const j = ((k % n) + n) % n;
  if (!j) return ns;
  return ns.slice(j).concat(ns.slice(0, j).map(x => N(x.l, x.a, x.o + 1)));
}

/* 一整段共用一個轉位策略。smooth 要記得上一個和弦的低音在哪。 */
function inversionPicker(rng, mode, level, lo, hi, anchor){
  const m = (mode === "auto") ? (level <= 2 ? "root" : "smooth") : mode;
  let step = 0, prevBass = null;

  return function(chord){
    const ns = chord.notes;
    let inv = 0;
    if (m === "first")       inv = 1;
    else if (m === "second") inv = 2;
    else if (m === "cycle")  inv = (step++) % 3;
    else if (m === "mix")    inv = rng.int(3);
    else if (m === "smooth"){
      // 低音離上一個和弦最近的那個轉位 —— 手不用跑，這就是導音連接
      let best = 0, bd = 1e9;
      for (let k = 0; k < 3; k++){
        const b = member(rotate(ns, k), 0, lo, hi, anchor);
        const d = (prevBass === null) ? 0 : Math.abs(dIdx(b) - prevBass);
        if (d < bd){ bd = d; best = k; }
      }
      inv = best;
    }
    const out = rotate(ns, inv);
    prevBass = dIdx(member(out, 0, lo, hi, anchor));
    return out;
  };
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
  const anchor = ctx.anchor;
  const pickInv = ctx.pickInv;
  // 同一個和弦在同一小節內要用同一個轉位，所以先解析再重複使用
  const voiced = new Map();
  const V = (ch) => {
    if (!voiced.has(ch)) voiced.set(ch, pickInv(ch));
    return voiced.get(ch);
  };
  const mem = (ch, i) => member(V(ch), i, lo, hi, anchor);
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
        bar.push({rest:false, chordNotes: V(ch).slice(0, 3).map((n, i) => mem(ch, i)),
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

/* 這一題的伴奏落在音域的哪個位置。
   永遠貼著音域下緣，結果就是每一題的左手都從同一個 C2 開始 ——
   那正是「左手聽起來一直在重複」的來源。音域放得下就往上挪，
   以四度／八度為單位，落點才不會怪。 */
function pickAnchor(rng, lo, hi, up, melody){
  if (up) return Math.max(lo, hi - 7);        // 在旋律上方的那隻手貼上緣，不然會壓到旋律
  let room = hi - lo - 7;
  if (room <= 0) return lo;

  // 但整團和弦要留在旋律最低音之下，不然抬高的代價就是兩手疊在一起
  if (melody){
    let melLo = 1e9;
    melody.forEach(bar => bar.forEach(it => {
      if (!it.rest && it.note) melLo = Math.min(melLo, dIdx(it.note));
    }));
    if (melLo < 1e9) room = Math.min(room, melLo - 5 - lo);
  }
  const steps = [0, 4, 7, 11].filter(v => v <= room);
  return lo + (steps.length ? rng.pick(steps) : 0);
}

/**
 * 伴奏聲部。
 * @param {string} forced 指定模式；不給就依難度隨機
 * @param {object} opts   {clef, dir:-1|+1, inversion} —— 這隻手在旋律的下方還是上方、練哪種轉位
 */
export function bassLine(rng, cfg, H, key, range, melody, forced, opts){
  const o = opts || {};
  const lo = dIdx(range.lo), hi = dIdx(range.hi);
  const up = (o.dir || -1) > 0;
  let name = forced;
  if (!name || !LH_PATTERNS[name]){
    const avail = availablePatterns(cfg.level, cfg.ts)
      .filter(k => !LH_PATTERNS[k].needsMelody || melody);
    name = rng.pick(avail);
  }
  if (LH_PATTERNS[name] && LH_PATTERNS[name].needsMelody && !melody) name = "sustain";

  const anchor = pickAnchor(rng, lo, hi, up, melody);
  const invMode = inversionMode(o.inversion);
  const pickInv = inversionPicker(rng, invMode, cfg.level, lo, hi, anchor);

  return {
    pattern: name,
    label: LH_PATTERNS[name] ? LH_PATTERNS[name].label : name,
    inversion: invMode,
    measures: patternNotes(rng, name, {H, key, cfg, lo, hi, melody, anchor, pickInv,
                                       clef: o.clef || "bass", dir: o.dir || -1})
  };
}
