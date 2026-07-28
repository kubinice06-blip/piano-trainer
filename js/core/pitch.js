/* 音高表示與音程運算。
   一個音 = {l: 字母 0..6 (C..B), a: 升降 -2..2, o: 八度}。
   字母與升降分開存，是為了讓 F♯ 和 G♭ 是兩個不同的音 ——
   調號、增二度、副屬和弦這些東西全都靠這個區分才寫得對。 */

export const LETTERS = ["C","D","E","F","G","A","B"];
export const LETTER_PC = [0,2,4,5,7,9,11];

export function N(letter, acc, oct){ return {l:letter, a:acc, o:oct}; }

/* 全音階序號：只數字母，不管升降。用來判斷「誰在譜上比較高」 */
export function dIdx(n){ return n.o * 7 + n.l; }

/* 絕對半音高，C0 = 0 */
export function absPitch(n){ return n.o * 12 + LETTER_PC[n.l] + n.a; }

/* MIDI 音高，C4 = 60 */
export function midiOf(n){ return absPitch(n) + 12; }

export function letterIdx(ch){ return LETTERS.indexOf(ch.toUpperCase()); }

export function accSym(a){
  if (a === 0) return "";
  if (a === 1) return "♯";
  if (a === 2) return "𝄪";
  if (a === -1) return "♭";
  if (a === -2) return "𝄫";
  return "";
}

/* VexFlow 用的 ASCII 記號 */
export function accVex(a){
  if (a === 1) return "#";
  if (a === 2) return "##";
  if (a === -1) return "b";
  if (a === -2) return "bb";
  return "n";
}

/* 純 ASCII 的升降，用於 id 與存檔（♯ 在 localStorage / URL 裡不好處理） */
export function accAscii(a){
  if (a === 1) return "#";
  if (a === 2) return "x";
  if (a === -1) return "b";
  if (a === -2) return "bb";
  return "";
}

export function noteName(n){ return LETTERS[n.l] + accSym(n.a); }

export function vexKey(n){
  return LETTERS[n.l].toLowerCase() + accVex(n.a).replace("n","") + "/" + n.o;
}

/* "c#/4" -> 音 */
export function parseVexKey(s){
  var p = s.split("/");
  var l = letterIdx(p[0][0]);
  var rest = p[0].slice(1), a = 0;
  if (rest === "#") a = 1;
  else if (rest === "##" || rest === "x") a = 2;
  else if (rest === "b") a = -1;
  else if (rest === "bb") a = -2;
  return N(l, a, parseInt(p[1], 10));
}

/* 移調：steps = 字母級數差，semis = 半音差。
   兩個都給才能決定拼法 —— C 往上 4 個半音、2 個字母 = E；4 個半音、3 個字母 = F♭。 */
export function tr(n, steps, semis){
  var raw = n.l + steps;
  var l = ((raw % 7) + 7) % 7;
  var o = n.o + Math.floor(raw / 7);
  var target = absPitch(n) + semis;
  var natural = o * 12 + LETTER_PC[l];
  return N(l, target - natural, o);
}

export const INTERVALS = {
  P1:[0,0],   m2:[1,1],   M2:[1,2],   A2:[1,3],
  d3:[2,2],   m3:[2,3],   M3:[2,4],
  P4:[3,5],   A4:[3,6],   d5:[4,6],   P5:[4,7],   A5:[4,8],
  m6:[5,8],   M6:[5,9],   d7:[6,9],   m7:[6,10],  M7:[6,11],
  P8:[7,12],  b9:[8,13],  M9:[8,14],  s9:[8,15],
  P11:[10,17], s11:[10,18], b13:[12,20], M13:[12,21]
};

export function iv(n, key){
  var spec = INTERVALS[key];
  if (!spec) throw new Error("未知音程 " + key);
  return tr(n, spec[0], spec[1]);
}

/* 由低往高堆疊，每個音都必須嚴格高於前一個 */
export function stack(root, names){
  var out = [], prev = null;
  for (var i = 0; i < names.length; i++){
    var x = iv(root, names[i]);
    if (prev){ while (dIdx(x) <= dIdx(prev)) x = N(x.l, x.a, x.o + 1); }
    out.push(x); prev = x;
  }
  return out;
}

/* 把整組音平移八度，讓最低音落進指定的全音階窗 */
export function fitWindow(notes, loIdx, hiIdx){
  if (!notes.length) return notes;
  var low = dIdx(notes[0]), shift = 0, guard = 0;
  while (low + shift * 7 < loIdx && guard++ < 12) shift++;
  guard = 0;
  while (low + shift * 7 > hiIdx && guard++ < 12) shift--;
  return notes.map(function(n){ return N(n.l, n.a, n.o + shift); });
}

/* 兩音之間是不是增二度（一個字母級、三個半音）。
   小調旋律最刺耳的那個音程，出題時要避開。 */
export function isAugmentedSecond(a, b){
  return Math.abs(dIdx(a) - dIdx(b)) === 1 &&
         Math.abs(absPitch(a) - absPitch(b)) === 3;
}
