/* 羅馬數字和弦：解析、實現成實際的音、算出低音。
   代號與 tools/build-harmony-stats.mjs 產出的統計表同一套，
   所以語料庫學到的接續可以直接拿來用。 */

import { N, iv, stack, dIdx, noteName } from "./pitch.js";

const ROMAN_IDX = {I:0, II:1, III:2, IV:3, V:4, VI:5, VII:6};
const IDX_ROMAN = ["I","II","III","IV","V","VI","VII"];
/* 音級 → 距主音的音程（以大調為基準；小調的差異由品質決定） */
const DEG_INTERVAL = ["P1","M2","M3","P4","P5","M6","M7"];

/* 品質 → 三和弦的音程 */
const TRIAD = {
  maj:     ["P1","M3","P5"],
  min:     ["P1","m3","P5"],
  dim:     ["P1","m3","d5"],
  halfdim: ["P1","m3","d5"],
  aug:     ["P1","M3","A5"]
};

/**
 * 解析統計表用的和弦代號，例：
 *   "V7" "ii65" "I64" "V43/V" "N6" "viio7" "bVII"
 * @returns {null|{degree,alter,quality,seventh,inv,applied,token}}
 */
export function parseToken(tok){
  if (!tok) return null;
  let s = tok;

  if (s === "Cad64") return {degree:0, alter:0, quality:"maj", seventh:false, inv:2, applied:null, token:tok};
  if (s === "Aug6")  return null;                 // 增六和弦暫不支援
  if (s === "N6")    return {degree:1, alter:-1, quality:"maj", seventh:false, inv:1, applied:null, token:tok};

  let applied = null;
  const parts = s.split("/");
  if (parts.length > 1){
    const t = ROMAN_IDX[parts[1].replace(/[b#]/g, "").toUpperCase()];
    if (t === undefined) return null;
    applied = t;
    s = parts[0];
  }

  let alter = 0;
  const am = s.match(/^([b#]+)/);
  if (am){ alter = am[1][0] === "b" ? -am[1].length : am[1].length; s = s.slice(am[1].length); }

  const rm = s.match(/^(VII|III|II|IV|VI|V|I|vii|iii|ii|iv|vi|v|i)/);
  if (!rm) return null;
  const rn = rm[1];
  const degree = ROMAN_IDX[rn.toUpperCase()];
  let rest = s.slice(rn.length);

  let quality = (rn === rn.toUpperCase()) ? "maj" : "min";
  if (rest[0] === "o"){ quality = "dim"; rest = rest.slice(1); }
  else if (rest[0] === "ø"){ quality = "halfdim"; rest = rest.slice(1); }
  else if (rest[0] === "+"){ quality = "aug"; rest = rest.slice(1); }

  const FIG = {"":[false,0], "6":[false,1], "64":[false,2],
               "7":[true,0], "65":[true,1], "43":[true,2], "42":[true,3]};
  const f = FIG[rest];
  if (!f) return null;

  return {degree, alter, quality, seventh:f[0], inv:f[1], applied, token:tok};
}

/* 七音的品質：屬七是小七，大三和弦當主/下屬時是大七，減三和弦視情況減七或小七 */
function seventhInterval(c, isDominantFunction){
  if (c.quality === "dim") return "d7";
  if (c.quality === "halfdim") return "m7";
  if (c.quality === "min") return "m7";
  if (c.quality === "aug") return "M7";
  return isDominantFunction ? "m7" : "M7";        // maj
}

/**
 * 把和弦實現成實際的音。
 * @param {Key} key
 * @param {object} c parseToken 的結果
 * @returns {{root, notes:[], bass, degree, token, roman}} notes 由低到高（已套用轉位）
 */
export function realizeChord(key, c){
  if (!c) return null;

  let root;
  if (c.applied !== null && c.applied !== undefined){
    // 應用和弦：先算出被暫時主音化的那個音，再從它往上量音程。
    // V/V 在 C 大調 → 目標 G，往上純五度 = D；viio/V → 目標 G，往上大七度 = F♯
    const tl = key.letterOfDegree(c.applied);
    const tRoot = N(tl, key.accFor(tl), 4);
    root = iv(tRoot, DEG_INTERVAL[c.degree]);
    if (c.alter) root = N(root.l, root.a + c.alter, root.o);
  } else {
    const l = key.letterOfDegree(c.degree);
    root = N(l, key.accFor(l) + c.alter, 4);
    // 小調的 vii° 指的是導音上的和弦，不是自然小調的下主音
    if (key.isMinor && c.degree === 6 && (c.quality === "dim" || c.quality === "halfdim")){
      root = N(root.l, root.a + 1, root.o);
    }
  }

  const dominantFn = (c.applied !== null && c.applied !== undefined) ||
                     (c.degree === 4 && c.quality === "maj") ||
                     c.quality === "dim" || c.quality === "halfdim";

  const ints = TRIAD[c.quality].slice();
  if (c.seventh) ints.push(seventhInterval(c, dominantFn));

  let notes = stack(root, ints);
  // 轉位會把陣列旋轉，所以先把「第幾音」記下來 ——
  // 否則轉位和弦的七音解決、導音解決全部會找錯音
  const members = {
    root: notes[0],
    third: notes[1],
    fifth: notes[2],
    seventh: c.seventh ? notes[3] : null
  };

  // 轉位：把低音以下的音往上搬一個八度
  for (let i = 0; i < c.inv; i++){
    const low = notes.shift();
    notes.push(N(low.l, low.a, low.o + 1));
    // 重新排到最低音之上
    while (dIdx(notes[notes.length - 1]) <= dIdx(notes[notes.length - 2])){
      const t = notes[notes.length - 1];
      notes[notes.length - 1] = N(t.l, t.a, t.o + 1);
    }
  }

  // 屬功能的大三和弦帶七音時是屬七（G7），不是大七（Gmaj7）
  const symbol = (c.quality === "maj" && c.seventh && dominantFn)
    ? chordSymbol(root, "maj", false, notes[0]).replace(/^([^/]*)/, "$1" + "7")
    : chordSymbol(root, c.quality, c.seventh, notes[0]);

  return {
    root, notes, bass: notes[0], members, symbol,
    degree: c.degree, applied: c.applied, token: c.token,
    quality: c.quality, seventh: c.seventh, inv: c.inv,
    /* 導音：屬功能和弦的三音，必須上行解決到主音 */
    leadingTone: (dominantFn && (c.degree === 4 || c.quality === "dim" || c.quality === "halfdim" ||
                                 c.applied !== null && c.applied !== undefined))
                 ? (c.quality === "dim" || c.quality === "halfdim" ? members.root : members.third)
                 : null,
    /* 這個和弦用到的音級與其變化量，給旋律與左手套用 */
    alterations: chordAlterations(key, notes)
  };
}

/* 羅馬數字是「這個和弦在調裡的功能」，和弦代號是「這個和弦本身叫什麼」。
   視譜時看代號比較實用 —— 你按下去的是 G7，不是 V7。
   轉位寫成斜線和弦，因為那正是低音實際在彈的音。 */
function chordSymbol(root, quality, seventh, bass){
  let sfx;
  if (quality === "min")          sfx = seventh ? "m7" : "m";
  else if (quality === "dim")     sfx = seventh ? "°7" : "°";
  else if (quality === "halfdim") sfx = seventh ? "m7♭5" : "°";
  else if (quality === "aug")     sfx = seventh ? "+7" : "+";
  else                            sfx = seventh ? "maj7" : "";   // maj，屬和弦在下面改掉

  let s = noteName(root) + sfx;
  if (bass && bass.l !== root.l) s += "/" + noteName(bass);
  return s;
}

/* 和弦裡有哪些音偏離了調號 —— 旋律碰到同音級時要跟著變 */
function chordAlterations(key, notes){
  const out = [];
  notes.forEach(n => {
    const diff = n.a - key.accFor(n.l);
    if (diff !== 0 && !out.some(o => o.deg === key.degreeOf(n.l))){
      out.push({deg: key.degreeOf(n.l), off: diff});
    }
  });
  return out;
}

/* 和弦包含哪些音級（0..6），旋律判斷「這是不是和弦音」用 */
export function chordToneDegrees(key, ch){
  return ch.notes.map(n => key.degreeOf(n.l));
}

/* 顯示用：把內部代號轉成人看的樣子 */
export function prettyToken(tok){
  return tok.replace(/o/g, "°").replace(/ø/g, "ø");
}

export function isTonicToken(tok){ return /^(I|i)(6|64)?$/.test(tok) || tok === "Cad64"; }
export function isDominantToken(tok){ return /^(V|v|viio|viiø)/.test(tok) && !/\//.test(tok); }
