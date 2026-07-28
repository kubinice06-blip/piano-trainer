/* 和弦字典。
   音程用「級數 + 半音」表示，所以 D♭7♯11 的 ♯11 會拼成 G 而不是 F𝄪 ——
   拼寫對了，調號與臨時記號才會對。 */

import { N, iv, stack, dIdx, noteName, fitWindow, LETTER_PC } from "./pitch.js";

export const CHORDS = {
  /* --- 三和弦 --- */
  maj      : {sfx:"",        ints:["P1","M3","P5"],                    third:"M3", sev:"P5",  fam:"maj"},
  min      : {sfx:"m",       ints:["P1","m3","P5"],                    third:"m3", sev:"P5",  fam:"min"},
  dim      : {sfx:"°",       ints:["P1","m3","d5"],                    third:"m3", sev:"d5",  fam:"dim"},
  aug      : {sfx:"+",       ints:["P1","M3","A5"],                    third:"M3", sev:"A5",  fam:"aug"},
  sus4     : {sfx:"sus4",    ints:["P1","P4","P5"],                    third:"P4", sev:"P5",  fam:"sus"},

  /* --- 大調家族 --- */
  maj7     : {sfx:"maj7",    ints:["P1","M3","P5","M7"],               third:"M3", sev:"M7",  fam:"maj"},
  maj9     : {sfx:"maj9",    ints:["P1","M3","P5","M7","M9"],          third:"M3", sev:"M7",  fam:"maj"},
  maj7s11  : {sfx:"maj7♯11", ints:["P1","M3","P5","M7","s11"],         third:"M3", sev:"M7",  fam:"maj"},
  maj6     : {sfx:"6",       ints:["P1","M3","P5","M6"],               third:"M3", sev:"M6",  fam:"maj"},
  maj69    : {sfx:"6/9",     ints:["P1","M3","P5","M6","M9"],          third:"M3", sev:"M6",  fam:"maj"},

  /* --- 小調家族 --- */
  m7       : {sfx:"m7",      ints:["P1","m3","P5","m7"],               third:"m3", sev:"m7",  fam:"min"},
  m9       : {sfx:"m9",      ints:["P1","m3","P5","m7","M9"],          third:"m3", sev:"m7",  fam:"min"},
  m11      : {sfx:"m11",     ints:["P1","m3","P5","m7","M9","P11"],    third:"m3", sev:"m7",  fam:"min"},
  m6       : {sfx:"m6",      ints:["P1","m3","P5","M6"],               third:"m3", sev:"M6",  fam:"min"},
  m69      : {sfx:"m6/9",    ints:["P1","m3","P5","M6","M9"],          third:"m3", sev:"M6",  fam:"min"},
  mMaj7    : {sfx:"m(maj7)", ints:["P1","m3","P5","M7"],               third:"m3", sev:"M7",  fam:"min"},

  /* --- 屬和弦家族 --- */
  dom7     : {sfx:"7",       ints:["P1","M3","P5","m7"],               third:"M3", sev:"m7",  fam:"dom"},
  dom9     : {sfx:"9",       ints:["P1","M3","P5","m7","M9"],          third:"M3", sev:"m7",  fam:"dom"},
  dom13    : {sfx:"13",      ints:["P1","M3","m7","M9","M13"],         third:"M3", sev:"m7",  fam:"dom"},
  dom7sus4 : {sfx:"7sus4",   ints:["P1","P4","P5","m7"],               third:"P4", sev:"m7",  fam:"sus"},
  dom7b9   : {sfx:"7♭9",     ints:["P1","M3","P5","m7","b9"],          third:"M3", sev:"m7",  fam:"dom"},
  dom7s9   : {sfx:"7♯9",     ints:["P1","M3","P5","m7","s9"],          third:"M3", sev:"m7",  fam:"dom"},
  dom7s11  : {sfx:"7♯11",    ints:["P1","M3","m7","M9","s11"],         third:"M3", sev:"m7",  fam:"dom"},
  dom7b13  : {sfx:"7♭13",    ints:["P1","M3","m7","b13"],              third:"M3", sev:"m7",  fam:"dom"},
  dom7s5   : {sfx:"7♯5",     ints:["P1","M3","A5","m7"],               third:"M3", sev:"m7",  fam:"dom"},
  dom7alt  : {sfx:"7alt",    ints:["P1","M3","m7","b9","s9","b13"],    third:"M3", sev:"m7",  fam:"dom"},

  /* --- 減與半減 --- */
  m7b5     : {sfx:"m7♭5",    ints:["P1","m3","d5","m7"],               third:"m3", sev:"m7",  fam:"halfdim"},
  m11b5    : {sfx:"m11♭5",   ints:["P1","m3","d5","m7","P11"],         third:"m3", sev:"m7",  fam:"halfdim"},
  dim7     : {sfx:"°7",      ints:["P1","m3","d5","d7"],               third:"m3", sev:"d7",  fam:"dim"}
};

/* 允許用簡寫指名 */
export const CHORD_ALIASES = {
  "":"maj", "M":"maj", "m":"min", "7":"dom7", "9":"dom9", "13":"dom13",
  "6":"maj6", "M7":"maj7", "alt":"dom7alt", "ø":"m7b5", "o7":"dim7"
};

export function resolveType(t){
  if (CHORDS[t]) return t;
  if (CHORD_ALIASES[t] && CHORDS[CHORD_ALIASES[t]]) return CHORD_ALIASES[t];
  throw new Error("未知和弦類型 " + t);
}

export function chordLabel(root, type){
  return noteName(root) + CHORDS[resolveType(type)].sfx;
}

/** 由低到高的完整和弦音（收在第 4 八度附近） */
export function chordNotes(root, type){
  return stack(N(root.l, root.a, 4), CHORDS[resolveType(type)].ints);
}

/** 依角色取單一和弦音；找不到就回傳根音 */
export function tone(root, type, role){
  const C = CHORDS[resolveType(type)];
  const map = {root:"P1", third:C.third, fifth:null, seventh:C.sev};
  if (role === "fifth"){
    const f = C.ints.find(i => i === "P5" || i === "d5" || i === "A5");
    return iv(root, f || "P5");
  }
  return iv(root, map[role] || "P1");
}

/* 根音落在 F2–E3 這一段，左手最舒服的位置 */
export function bassOctave(root){
  const pc = ((LETTER_PC[root.l] + root.a) % 12 + 12) % 12;
  return pc >= 5 ? 2 : 3;
}

export { fitWindow, dIdx };
