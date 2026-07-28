/* 節拍器。
 *
 * 聲音排在 AudioContext 的硬體時鐘上，所以拍點本身永遠是準的。
 * 但「什麼時候去排下一批拍點」不能靠 requestAnimationFrame ——
 * 分頁切到背景、螢幕變暗、iPad 切去別的 App，rAF 會被瀏覽器完全停掉，
 * 於是再也沒有新的拍點被排出去，節拍器就這樣安靜地死掉。
 * 這裡改用 setInterval 當排程驅動：背景時它會被節流到大約每秒一次，
 * 所以看不見的時候把預排長度拉長到 1.5 秒，讓它撐得過去。
 * 視覺的平順交給 main.js 自己的 rAF，那邊停掉只是畫面不動，不會沒聲音。
 */

import { Audio } from "./sound.js";

export const Metro = {
  ac: null,
  on: false,
  timer: null,
  _onVisible: null,
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
    var self = this;
    this.timer = setInterval(function(){ self._schedule(); }, 25);
    this._onVisible = function(){ if (!document.hidden) self._schedule(); };
    document.addEventListener("visibilitychange", this._onVisible);
    this._schedule();
    return true;
  },

  /* 往前排一批拍點，並把已經響過的回報給 UI。
     看不見的時候 setInterval 會被節流到大約 1 秒一次，所以預排要拉長。 */
  _schedule(){
    if (!this.on || !this.ac) return;
    var now = this.ac.currentTime;
    var lookahead = (typeof document !== "undefined" && document.hidden) ? 1.5 : 0.30;

    while (this._nextTime < now + lookahead){
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
  },

  stop(){
    this.on = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this._onVisible){
      document.removeEventListener("visibilitychange", this._onVisible);
      this._onVisible = null;
    }
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
