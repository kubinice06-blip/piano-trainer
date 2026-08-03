/* 單音旋律的手位／轉指建議。
 * 目標不是取代老師編訂指法，而是在陌生視譜時清楚標出「這裡不能再撐手，
 * 要換拇指、跨指或整手移位」。 */

import { dIdx, noteName } from "./core/pitch.js";

function stepDirection(a, b){
  const delta = dIdx(b.note) - dIdx(a.note);
  return Math.abs(delta) === 1 ? Math.sign(delta) : 0;
}

function patternFor(hand, direction, length){
  const outward = (hand === "right" && direction > 0) || (hand === "left" && direction < 0);
  if (length <= 5){
    const simple = outward ? [1, 2, 3, 4, 5] : [5, 4, 3, 2, 1];
    return simple.slice(0, length);
  }
  const cycle = outward ? [1, 2, 3, 1, 2, 3, 4] : [5, 4, 3, 2, 1, 3, 2];
  return Array.from({length}, (_, index) => cycle[index % cycle.length]);
}

function travelDirection(entries, index){
  if (entries[index + 1]){
    const next = dIdx(entries[index + 1].note) - dIdx(entries[index].note);
    if (next) return Math.sign(next);
  }
  if (entries[index - 1]){
    const previous = dIdx(entries[index].note) - dIdx(entries[index - 1].note);
    if (previous) return Math.sign(previous);
  }
  return 0;
}

function travelFinger(hand, direction){
  if (!direction) return 3;
  if (hand === "right") return direction > 0 ? 1 : 5;
  return direction > 0 ? 5 : 1;
}

function melodySide(ex){ return ex.melodyOn === "bottom" ? "bottom" : "top"; }

export function melodyFingering(ex){
  const side = melodySide(ex);
  const hand = side === "bottom" || ex.clef === "bass" ? "left" : "right";
  const entries = [];
  const measures = ex.measures.map((measure, measureIndex) => {
    const hints = Array((measure[side] || []).length).fill(null);
    (measure[side] || []).forEach((item, itemIndex) => {
      if (!item.rest && item.note) entries.push({measure:measureIndex, item:itemIndex, note:item.note});
    });
    return hints;
  });

  let start = 0;
  while (start < entries.length){
    const direction = start + 1 < entries.length ? stepDirection(entries[start], entries[start + 1]) : 0;
    let end = start;
    if (direction){
      while (end + 1 < entries.length && stepDirection(entries[end], entries[end + 1]) === direction) end++;
    }
    const length = end - start + 1;
    const fingers = direction ? patternFor(hand, direction, length)
                              : [travelFinger(hand, travelDirection(entries, start))];
    for (let offset = 0; offset < length; offset++){
      const entry = entries[start + offset];
      const finger = fingers[offset];
      let transition = null;
      // Short stepwise fragments already fit under one five-finger position.
      // Only call out a crossing in a run that actually exceeds five notes;
      // otherwise a change of melodic direction would produce noisy, false hints.
      if (offset > 0){
        if (length > 5){
          const previous = fingers[offset - 1];
          const outward = (hand === "right" && direction > 0) || (hand === "left" && direction < 0);
          if (outward && finger < previous) transition = "轉";
          else if (!outward && finger > previous) transition = "跨";
        }
      } else if (start > 0){
        const previousEntry = entries[start - 1];
        if (Math.abs(dIdx(entry.note) - dIdx(previousEntry.note)) > 4) transition = "移";
      }
      const hint = {...entry, finger, transition, key:start + offset === 0 || !!transition};
      entries[start + offset] = hint;
      if (hint.key) measures[entry.measure][entry.item] = hint;
    }
    start = end + 1;
  }

  return {side, hand, entries, measures};
}

export function fingeringSummary(ex){
  const result = melodyFingering(ex);
  const handName = result.hand === "left" ? "左手" : "右手";
  const first = result.entries[0];
  if (!first) return "本段沒有需要標示的指法";
  const opening = `${handName}起始：${noteName(first.note)}${first.note.o} 用 ${first.finger} 指`;
  const turns = result.entries.filter((entry) => entry.transition);
  if (!turns.length) return `${opening}；其餘維持同一手位`;
  const points = turns.slice(0, 6).map((entry) =>
    `${noteName(entry.note)}${entry.note.o} ${entry.transition}${entry.finger}`).join("、");
  return `${opening}；關鍵換位：${points}${turns.length > 6 ? "…" : ""}（譜上只標起點與 ↪ 換位點）`;
}
