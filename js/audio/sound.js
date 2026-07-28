/* 聲音引擎 —— 加法合成的擊弦音色。
   AudioContext 收在這裡統一管理，節拍器共用同一個 context（iOS 只給你一個）。 */

export function mtof(m){ return 440 * Math.pow(2, (m - 69) / 12); }

export const Audio = {
  ac: null,
  master: null,
  timers: [],
  endTimer: null,
  playing: false,

  /* 必須在使用者手勢裡第一次呼叫，否則 iOS 不給聲音 */
  ctx(){
    if (!this.ac){
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ac = new AC();
      this._newMaster();
      this._takePlaybackChannel();
      this._watchState();
    }
    if (this.ac.state !== "running") this.resume();
    return this.ac;
  },

  /* iOS 會在來電、切換 App、鎖屏時把 AudioContext 打斷，而且不會自己回來。
     這裡盯著狀態，一有機會就重新啟動 —— 否則使用者看到的就是「突然沒聲音」，
     而且畫面上沒有任何線索。 */
  _watchState(){
    var self = this;
    try {
      this.ac.addEventListener("statechange", function(){
        if (self.ac.state !== "running") self.resume();
        if (self.onStateChange) self.onStateChange(self.ac.state);
      });
    } catch (e) {}
    document.addEventListener("visibilitychange", function(){
      if (!document.hidden) self.resume();
    });
  },

  resume(){
    if (!this.ac) return;
    try {
      var p = this.ac.resume();
      if (p && p.catch) p.catch(function(){});
    } catch (e) {}
  },

  get state(){ return this.ac ? this.ac.state : "未建立"; },

  _newMaster(){
    this.master = this.ac.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ac.destination);
  },

  /* iOS 的 WebAudio 預設走鈴聲通道 —— 側邊的實體靜音鍵一撥就整個沒聲。
     Safari 16.4+ 可以用 audioSession 宣告成播放用途，這是唯一有支援的做法。
　　 舊版本沒有替代方案：這裡曾經放過一個「循環播放無聲 <audio>」的偏方，
     但那段 WAV 的資料只有 7 個取樣（約 0.44 毫秒）卻設成無限循環，
     而且我從沒驗證過它真的有效 —— 沒有證據支持、卻有卡住 iOS 音訊工作階段的風險，
     所以移除。舊版 Safari 就老實提示使用者去看實體靜音鍵。 */
  _takePlaybackChannel(){
    try {
      if (navigator.audioSession){
        navigator.audioSession.type = "playback";
        this.playbackChannel = "audioSession";
        return;
      }
    } catch (e) {}
    this.playbackChannel = "none";
  },

  /* iOS 的實體靜音鍵有沒有辦法被繞過。UI 拿來決定要不要提醒使用者。 */
  get canOverrideSilentSwitch(){
    return this.playbackChannel === "audioSession";
  },

  /* 一個音：三個泛音 + 低通衰減，模擬鋼琴被敲擊後的亮度下降 */
  voice(freq, t, dur, vel){
    var ac = this.ac;
    var g = ac.createGain();
    var f = ac.createBiquadFilter();
    f.type = "lowpass"; f.Q.value = 0.5;
    f.frequency.setValueAtTime(Math.min(11000, freq * 9), t);
    f.frequency.exponentialRampToValueAtTime(Math.max(320, freq * 2.4), t + Math.min(1.4, dur + 0.3));

    var o1 = ac.createOscillator(); o1.type = "triangle"; o1.frequency.value = freq;
    var o2 = ac.createOscillator(); o2.type = "sine";     o2.frequency.value = freq * 2;
    var o3 = ac.createOscillator(); o3.type = "sine";     o3.frequency.value = freq * 3.01;
    var g2 = ac.createGain(); g2.gain.value = 0.20;
    var g3 = ac.createGain(); g3.gain.value = 0.06;

    var peak = Math.max(0.015, vel);
    var tail = Math.max(0.30, dur * 0.75);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(peak * 0.30, t + Math.min(0.6, dur * 0.55) + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + tail);

    o1.connect(g); o2.connect(g2); g2.connect(g); o3.connect(g3); g3.connect(g);
    g.connect(f); f.connect(this.master);

    var stopAt = t + dur + tail + 0.05;
    o1.start(t); o2.start(t); o3.start(t);
    o1.stop(stopAt); o2.stop(stopAt); o3.stop(stopAt);
  },

  /* 0.5 = 平均八分；0.62 左右是典型的 swing。只影響後半拍的起點。 */
  swing: 0.5,

  /**
   * @param startAt 可選：AudioContext 絕對時間。給了就把第 0 拍排在那個時刻 ——
   *                跟節拍器同步播放時必須用這個，不能靠 setTimeout 湊。
   */
  play(plan, bpm, onNote, onDone, startAt){
    var ac = this.ctx();
    if (!ac || !plan || !plan.events.length) return false;
    this.stop();
    var self = this, spb = 60 / bpm;
    var t0 = (startAt !== undefined && startAt !== null) ? startAt : ac.currentTime + 0.15;
    if (t0 < ac.currentTime + 0.02) t0 = ac.currentTime + 0.02;   // 已經過去的時間排不了
    var sw = this.swing;

    plan.events.forEach(function(ev){
      var beat = ev.t;
      if (sw > 0.5){
        // 落在後半拍的音往後挪，前半拍的音就自然變長 —— 這就是 swing
        var f = beat - Math.floor(beat);
        if (Math.abs(f - 0.5) < 1e-6) beat = Math.floor(beat) + sw;
      }
      var t = t0 + beat * spb;
      var dur = Math.max(0.10, ev.d * spb * 0.90);
      for (var i = 0; i < ev.midi.length; i++){
        self.voice(mtof(ev.midi[i]), t, dur, 0.26 - i * 0.035);
      }
      if (ev.gid && onNote){
        self.timers.push(setTimeout(function(){ onNote(ev.gid); },
                                     Math.max(0, (t - ac.currentTime) * 1000)));
      }
    });

    this.playing = true;
    this.endTimer = setTimeout(function(){
      self.playing = false;
      if (onNote) onNote(null);
      if (onDone) onDone();
    }, (t0 + plan.total * spb - ac.currentTime + 0.35) * 1000);
    return true;
  },

  stop(){
    this.timers.forEach(clearTimeout);
    this.timers = [];
    if (this.endTimer){ clearTimeout(this.endTimer); this.endTimer = null; }
    if (this.ac && this.master){
      var old = this.master, now = this.ac.currentTime;
      try {
        old.gain.cancelScheduledValues(now);
        old.gain.setValueAtTime(old.gain.value, now);
        old.gain.linearRampToValueAtTime(0.0001, now + 0.05);
      } catch (e) {}
      setTimeout(function(){ try { old.disconnect(); } catch (e) {} }, 300);
      this._newMaster();
    }
    this.playing = false;
  }
};
