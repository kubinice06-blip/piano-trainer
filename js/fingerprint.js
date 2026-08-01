/* Weakness fingerprints repeat musical features, never the original score. */

import { midiOf } from "./core/pitch.js";

function melodyItems(ex){
  const side = ex.melodyOn === "bottom" ? "bottom" : "top";
  return ex.measures.flatMap((measure) => measure[side] || measure.top || []);
}

export function fingerprintExercise(ex){
  if (!ex) return null;
  const sounding = melodyItems(ex).filter((item) => !item.rest && item.note);
  const midis = sounding.map((item) => midiOf(item.note));
  return {
    key:ex.key?.id || null,
    keyName:ex.key?.displayName || null,
    ts:ex.ts,
    density:ex.density,
    focus:ex.focus,
    hands:ex.hands,
    bars:ex.cfg?.bars || ex.measures.length,
    level:ex.cfg?.level || 1,
    difficulty:ex.usedCfg?.difficulty || null,
    texture:ex.lhPattern || null,
    range:{min:midis.length ? Math.min(...midis) : null, max:midis.length ? Math.max(...midis) : null},
    harmonyBars:ex.harmony?.bars?.map((bar) => bar.slots.map((slot) => slot.token)) || [],
    harmonyNgram:ex.harmony?.tokens?.slice(0, 4) || [],
    rhythmCells:ex.measures.map((measure) => {
      const line = ex.melodyOn === "bottom" ? measure.bottom : measure.top;
      return (line || []).map((item) => item.dur);
    }),
  };
}

export function fingerprintKey(fp){
  if (!fp) return null;
  const stable = {
    key:fp.key, ts:fp.ts, density:fp.density, focus:fp.focus, hands:fp.hands,
    texture:fp.texture, harmonyNgram:fp.harmonyNgram, range:fp.range,
  };
  const text = JSON.stringify(stable);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++){ hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
}

export function cfgFromFingerprint(fp, base = {}){
  if (!fp) return {...base};
  return {
    ...base,
    level:fp.level || base.level || 1,
    keyPool:fp.key || base.keyPool,
    ts:fp.ts || base.ts,
    hands:fp.hands || base.hands,
    bars:fp.bars || base.bars,
    density:fp.density || base.density,
    focus:fp.focus || base.focus,
    lhPattern:fp.texture || base.lhPattern,
    difficulty:fp.difficulty || base.difficulty,
    preferredHarmonyBars:fp.harmonyBars,
    preferredRhythms:fp.rhythmCells,
  };
}
