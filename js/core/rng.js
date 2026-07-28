/* 種子亂數。
   出題全程只能透過這裡取亂數 —— 一段練習等於 {seed, cfg}，
   有了這個才談得上「回顧」「重播」「列印成練習單」。 */

export function randomSeed(){
  return (Math.random() * 4294967296) >>> 0;
}

/* mulberry32：32 bit 狀態、週期 2^32、統計品質對出題綽綽有餘 */
function mulberry32(a){
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed){
    this.seed = (seed >>> 0) || 1;
    this._next = mulberry32(this.seed);
  }
  /* [0,1) */
  next(){ return this._next(); }
  /* [0,n) 整數 */
  int(n){ return Math.floor(this._next() * n); }
  /* [lo,hi] 整數 */
  range(lo, hi){ return lo + this.int(hi - lo + 1); }
  chance(p){ return this._next() < p; }
  pick(arr){ return arr[this.int(arr.length)]; }
  /* 依權重挑選，w 為對應的正數陣列 */
  weighted(arr, weights){
    var tot = 0, i;
    for (i = 0; i < weights.length; i++) tot += weights[i];
    var r = this._next() * tot, acc = 0;
    for (i = 0; i < arr.length; i++){
      acc += weights[i];
      if (r <= acc) return arr[i];
    }
    return arr[arr.length - 1];
  }
  /* 原地洗牌（Fisher–Yates） */
  shuffle(arr){
    for (var i = arr.length - 1; i > 0; i--){
      var j = this.int(i + 1);
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  /* 分岔出一條獨立的序列，用來讓「換左手寫法」不會連帶改變右手旋律 */
  fork(tag){
    var h = this.seed ^ 0x9E3779B9;
    for (var i = 0; i < String(tag).length; i++){
      h = Math.imul(h ^ String(tag).charCodeAt(i), 0x85EBCA6B) >>> 0;
    }
    return new Rng(h >>> 0);
  }
}
