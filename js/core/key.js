/* 調性。
   調號不再查表，改由五度圈推導 —— 15 個大調 + 15 個小調全部涵蓋，
   而且不會再出現「查不到就回傳 0」這種靜默錯音。 */

import { LETTERS, N, letterIdx, accSym, accAscii } from "./pitch.js";

/* 升記號出現順序 F C G D A E B；降記號反過來 B E A D G C F */
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6];
const FLAT_ORDER  = [6, 2, 5, 1, 4, 0, 3];

/* 大調：I ii iii IV V vi vii°
   小調：以和聲小調為實用基準 —— V 是大三和弦、vii° 是減和弦，
        III 維持自然小調的大三和弦（增三和弦幾乎不用） */
const QUALITY = {
  major: {
    triad:   ["maj", "min", "min", "maj", "maj", "min", "dim"],
    seventh: ["maj7", "m7", "m7", "maj7", "dom7", "m7", "m7b5"],
    roman:   ["I", "ii", "iii", "IV", "V", "vi", "vii°"]
  },
  minor: {
    triad:   ["min", "dim", "maj", "min", "maj", "maj", "dim"],
    seventh: ["m7", "m7b5", "maj7", "m7", "dom7", "maj7", "dim7"],
    roman:   ["i", "ii°", "III", "iv", "V", "VI", "vii°"]
  }
};

/* 和弦音的音級（三度堆疊），與調式無關 */
export function chordDegrees(d){
  return [d % 7, (d + 2) % 7, (d + 4) % 7];
}
export function seventhDegrees(d){
  return [d % 7, (d + 2) % 7, (d + 4) % 7, (d + 6) % 7];
}

export class Key {
  /** @param {number} letter 0..6  @param {number} acc -1..1  @param {"major"|"minor"} mode */
  constructor(letter, acc, mode){
    this.letter = letter;
    this.acc = acc;
    this.mode = mode === "minor" ? "minor" : "major";

    var pos = SHARP_ORDER.indexOf(letter);
    this.fifths = pos - 1 + 7 * acc - (this.mode === "minor" ? 3 : 0);

    // 調號給的升降，依字母索引
    var map = [0, 0, 0, 0, 0, 0, 0];
    if (this.fifths > 0){
      for (var i = 0; i < this.fifths && i < 7; i++) map[SHARP_ORDER[i]] = 1;
    } else if (this.fifths < 0){
      for (var j = 0; j < -this.fifths && j < 7; j++) map[FLAT_ORDER[j]] = -1;
    }
    this.sigAcc = map;
  }

  get isMinor(){ return this.mode === "minor"; }
  get accidentalCount(){ return Math.abs(this.fifths); }

  /* 調號賦予這個字母的升降 */
  accFor(letter){ return this.sigAcc[letter]; }

  /* 這個音在譜上需不需要寫臨時記號 */
  needsAccidental(n){ return n.a !== this.sigAcc[n.l]; }

  /* 依調號把某個字母組成音 */
  noteAt(letter, oct){ return N(letter, this.sigAcc[letter], oct); }

  /* 主音（不含八度資訊時給 0） */
  tonic(oct){ return N(this.letter, this.acc, oct === undefined ? 0 : oct); }

  /* 某個字母是本調的第幾音級（0 = 主音） */
  degreeOf(letter){ return ((letter - this.letter) % 7 + 7) % 7; }
  letterOfDegree(d){ return (this.letter + d) % 7; }

  triadQuality(d){ return QUALITY[this.mode].triad[d % 7]; }
  seventhQuality(d){ return QUALITY[this.mode].seventh[d % 7]; }
  roman(d){ return QUALITY[this.mode].roman[d % 7]; }

  /* 小調的變化音：V 與 vii° 要升第 7 音，否則沒有導音，聽起來不會想回家。
     III 刻意不升 —— 升了會變增三和弦，實務上不用。
     回傳 [{deg, off}]，deg 是音級、off 是升降量。 */
  alterationsFor(d){
    if (!this.isMinor) return [];
    var deg = d % 7;
    if (deg === 4 || deg === 6) return [{deg: 6, off: 1}];
    return [];
  }

  /* VexFlow 的調號字串 */
  get vexSignature(){
    var s = LETTERS[this.letter] + (this.acc === 1 ? "#" : this.acc === -1 ? "b" : "");
    return this.isMinor ? s + "m" : s;
  }

  /* 存檔 / URL 用的穩定 id："C" "F#" "Bb" "Am" "F#m" */
  get id(){
    return LETTERS[this.letter] + accAscii(this.acc) + (this.isMinor ? "m" : "");
  }

  /* 顯示名：大調大寫、小調小寫，符合樂理慣例 */
  get shortName(){
    var s = LETTERS[this.letter] + accSym(this.acc);
    return this.isMinor ? s.toLowerCase() : s;
  }
  get displayName(){
    return LETTERS[this.letter] + accSym(this.acc) + (this.isMinor ? " 小調" : " 大調");
  }

  /* 調號描述，例如「3♯」「2♭」「無升降」 */
  get signatureLabel(){
    if (this.fifths === 0) return "無升降";
    return Math.abs(this.fifths) + (this.fifths > 0 ? "♯" : "♭");
  }

  static fromId(id){
    if (!id) return new Key(0, 0, "major");
    var minor = /m$/.test(id);
    var body = minor ? id.slice(0, -1) : id;
    var l = letterIdx(body[0]);
    var rest = body.slice(1), a = 0;
    if (rest === "#") a = 1;
    else if (rest === "b") a = -1;
    if (l < 0) return new Key(0, 0, "major");
    return new Key(l, a, minor ? "minor" : "major");
  }
}

/* 依五度圈排出全部大調：C♭…C…C♯（fifths -7..7） */
function buildCircle(mode){
  var out = [], seen = {};
  for (var f = -7; f <= 7; f++){
    // 由 fifths 反推主音字母與升降
    var mf = f + (mode === "minor" ? 3 : 0);      // 對應的大調 fifths
    var acc = Math.floor((mf + 1) / 7);
    var pos = mf + 1 - 7 * acc;
    if (pos < 0 || pos > 6) continue;
    var k = new Key(SHARP_ORDER[pos], acc, mode);
    if (k.fifths !== f || seen[k.id]) continue;
    seen[k.id] = true;
    out.push(k);
  }
  return out;
}

export const MAJOR_KEYS = buildCircle("major");
export const MINOR_KEYS = buildCircle("minor");
export const ALL_KEYS = MAJOR_KEYS.concat(MINOR_KEYS);

/* 調號在 max 個以內的調，用來把難度和調性掛在一起 */
export function keysWithin(max, opts){
  var o = opts || {};
  var pool = [];
  if (o.major !== false) pool = pool.concat(MAJOR_KEYS);
  if (o.minor) pool = pool.concat(MINOR_KEYS);
  return pool.filter(function(k){ return k.accidentalCount <= max; });
}

/* 五度圈順序（往降的方向走，C F B♭ E♭…，爵士練十二調的標準走法） */
export function cycleOfFourths(mode){
  var src = mode === "minor" ? MINOR_KEYS : MAJOR_KEYS;
  var byFifths = {};
  src.forEach(function(k){ byFifths[k.fifths] = k; });
  var out = [];
  for (var i = 0; i < 12; i++){
    // 走過 6 個降記號就翻到等音的升記號寫法：
    // C F B♭ E♭ A♭ D♭ G♭ B E A D G，而不是一路降到 C♭
    var f = (-i < -6) ? (-i + 12) : -i;
    var k = byFifths[f];
    if (k) out.push(k);
  }
  return out;
}
