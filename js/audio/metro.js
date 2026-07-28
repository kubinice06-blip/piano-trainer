/* 節拍器。
   聲音排在 AudioContext 的硬體時鐘上（準），視覺回呼改用 requestAnimationFrame
   輪詢已排定的拍點（不會被 setTimeout 節流拖走）—— 這是 iPad 上不漂拍的前提。 */

import { Audio } from "./sound.js";

export const Metro = {
  ac: null,
  on: false,
  raf: null,
  bpm: 60,
  beatsPerBar: 4,
  countInBars: 0,

  _scheduled: [],      // 已排定但還沒到的拍點 {t, beat, idx, counting}
  _nextTime: 0,
  _beat: 0,
  _bars: 0,
  _lastFired: -1,

  onBeat: null,        // (idxInBar, counting) => void
  onBar: null,         // (barNumber) => void

  ensure(){
    this.ac = Audio.ctx();
    return !!this.ac;
  },

  /* 靜音只關聲音 —— 拍點條與游標照常走，所以還是看得到拍子。
     這裡不影響「播放解答音」，那條路走的是 Audio 的 master。 */
  volume: 0.8,
  muted: false,

  _click(t, accent){
    if (this.muted || this.volume <= 0) return;
    var o = this.ac.createOscillator(), g = this.ac.createGain();
    o.type = "square";
    o.frequency.value = accent ? 1580 : 900;
    var peak = (accent ? 0.34 : 0.2) * this.volume;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);
    o.connect(g); g.connect(this.ac.destination);
    o.start(t); o.stop(t + 0.07);
  },

  start(bpm, beatsPerBar, countInBars){
    if (!this.ensure()) return false;
    this.bpm = bpm;
    this.beatsPerBar = beatsPerBar;
    this._beat = 0;
    this._bars = 0;
    this._lastFired = -1;
    this._scheduled = [];
    this._countInTotal = (countInBars || 0) * beatsPerBar;
    this._countIn = this._countInTotal;
    this._nextTime = this.ac.currentTime + 0.12;
    this.on = true;
    this._loop();
    return true;
  },

  /* 往前排 0.2 秒的拍點，並把已經響過的拍點回報給 UI */
  _loop(){
    if (!this.on) return;
    var now = this.ac.currentTime;

    while (this._nextTime < now + 0.20){
      var idx = this._beat % this.beatsPerBar;
      var counting = this._countIn > 0;
      this._click(this._nextTime, idx === 0);
      this._scheduled.push({t:this._nextTime, beat:this._beat, idx:idx, counting:counting});
      if (counting) this._countIn--;
      this._beat++;
      this._nextTime += 60 / this.bpm;
    }

    while (this._scheduled.length && this._scheduled[0].t <= now){
      var ev = this._scheduled.shift();
      if (ev.beat <= this._lastFired) continue;
      this._lastFired = ev.beat;
      if (this.onBeat) this.onBeat(ev.idx, ev.counting);
      if (ev.idx === 0 && !ev.counting){
        this._bars++;
        // 回報「已彈完幾小節」而不是「正在彈第幾小節」——
        // 舊版在第 4 小節的第一拍就換題，實際只給了 3 小節
        if (this._bars > 1 && this.onBar) this.onBar(this._bars - 1);
      }
    }

    var self = this;
    this.raf = requestAnimationFrame(function(){ self._loop(); });
  },

  stop(){
    this.on = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this._scheduled = [];
  },

  /* 從第一個正式拍算起、已經過的拍數（含小數）。P2 的游標靠這個定位。
     預備拍期間為負數。 */
  position(){
    if (!this.on || !this.ac) return 0;
    var spb = 60 / this.bpm;
    var elapsed = this._beat - (this._nextTime - this.ac.currentTime) / spb;
    return elapsed - this._countInTotal;
  },

  get barsDone(){ return Math.max(0, this._bars - 1); },

  /* 第 n 個正式拍（0 起算，不含預備拍）的 AudioContext 絕對時間。
     要讓解答音跟節拍器對齊，就得排在同一個硬體時鐘上 ——
     用 setTimeout 去湊會漂，而且是聽得出來的那種漂。 */
  timeOfBeat(n){
    if (!this.ac) return 0;
    var spb = 60 / this.bpm;
    // _nextTime 是「還沒排定的下一拍」的時間，序號是 _beat
    return this._nextTime + (n + this._countInTotal - this._beat) * spb;
  }
};
