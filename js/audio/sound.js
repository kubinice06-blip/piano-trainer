/* 聲音引擎 —— 加法合成的擊弦音色。
   AudioContext 收在這裡統一管理，節拍器共用同一個 context（iOS 只給你一個）。 */

export function mtof(m){ return 440 * Math.pow(2, (m - 69) / 12); }

export function playbackVoiceProfile(event, noteIndex = 0){
  const left = event?.part === "left";
  return {
    velocity:Math.max(0.10, (left ? 0.31 : 0.24) - noteIndex * 0.028),
    tone:left ? "bass" : "piano",
  };
}

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
    /* 真的要離開時把音訊裝置還回去。不關的話瀏覽器會一直握著，
       重載很多次之後有機會把輸出卡死 —— 那種狀況只能整個關掉瀏覽器才會好。
       event.persisted 為真代表進了 bfcache，等一下可能會還原，那就不能關。 */
    window.addEventListener("pagehide", function(e){
      if (e.persisted) return;
      try { if (self.ac && self.ac.state !== "closed") self.ac.close(); } catch (err) {}
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

  /* iOS 的 WebAudio 預設走鈴聲通道，實體靜音鍵一撥就沒聲。
     Safari 16.4+ 的 navigator.audioSession 可以宣告成播放用途來繞過。
     但那個宣告會改變整個音訊路由，我沒有 iOS 裝置可以驗證，
     實際上也出現過「其他網站有聲、這個 App 完全沒聲」的回報 ——
     所以預設不碰，改成使用者自己開。預設能出聲比繞過靜音鍵重要得多。 */
  overrideSilentSwitch: false,

  _takePlaybackChannel(){
    if (!this.overrideSilentSwitch){ this.playbackChannel = "default"; return; }
    try {
      if (navigator.audioSession){
        navigator.audioSession.type = "playback";
        this.playbackChannel = "audioSession";
        return;
      }
    } catch (e) {}
    this.playbackChannel = "none";
  },

  /* 讓使用者現場切換，不用重開 App */
  setSilentSwitchOverride(on){
    this.overrideSilentSwitch = !!on;
    if (!this.ac) return;
    try {
      if (navigator.audioSession){
        navigator.audioSession.type = on ? "playback" : "auto";
        this.playbackChannel = on ? "audioSession" : "default";
      }
    } catch (e) {}
    this.resume();
  },

  /* 測試音：一秒的明顯嗶聲，同時量測真正送到輸出的振幅。
     「有沒有聲音」不該只能靠耳朵回報，程式自己要量得出來。 */
  testTone(){
    var ac = this.ctx();
    if (!ac) return Promise.resolve({ok:false, reason:"這個瀏覽器不支援 Web Audio"});
    var self = this;
    var tap = ac.createAnalyser();
    tap.fftSize = 2048;
    var buf = new Float32Array(tap.fftSize);

    var g = ac.createGain();
    var o = ac.createOscillator();
    o.type = "triangle";
    o.frequency.value = 660;
    var t = ac.currentTime + 0.05;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
    g.gain.setValueAtTime(0.5, t + 0.85);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    o.connect(g);
    g.connect(ac.destination);
    g.connect(tap);
    o.start(t); o.stop(t + 1.05);

    return new Promise(function(resolve){
      var peak = 0, n = 0;
      var iv = setInterval(function(){
        tap.getFloatTimeDomainData(buf);
        for (var i = 0; i < buf.length; i++){
          var v = Math.abs(buf[i]);
          if (v > peak) peak = v;
        }
        if (++n > 55){
          clearInterval(iv);
          resolve({
            ok: peak > 0.01,
            peak: peak,
            state: self.ac.state,
            channel: self.playbackChannel,
            sampleRate: self.ac.sampleRate,
            outputs: (self.ac.destination && self.ac.destination.maxChannelCount) || null
          });
        }
      }, 20);
    });
  },

  /* 這個瀏覽器有沒有能力繞過實體靜音鍵（不管目前有沒有開） */
  get canOverrideSilentSwitch(){
    try { return !!navigator.audioSession; } catch (e) { return false; }
  },

  /* 一個音：三個泛音 + 低通衰減，模擬鋼琴被敲擊後的亮度下降 */
  voice(freq, t, dur, vel, tone = "piano"){
    var ac = this.ac;
    var bass = tone === "bass";
    var g = ac.createGain();
    var f = ac.createBiquadFilter();
    f.type = "lowpass"; f.Q.value = 0.5;
    f.frequency.setValueAtTime(Math.min(11000, freq * (bass ? 14 : 9)), t);
    f.frequency.exponentialRampToValueAtTime(Math.max(320, freq * 2.4), t + Math.min(1.4, dur + 0.3));

    var o1 = ac.createOscillator(); o1.type = "triangle"; o1.frequency.value = freq;
    var o2 = ac.createOscillator(); o2.type = "sine";     o2.frequency.value = freq * 2;
    var o3 = ac.createOscillator(); o3.type = "sine";     o3.frequency.value = freq * 3.01;
    var g2 = ac.createGain(); g2.gain.value = bass ? 0.34 : 0.20;
    var g3 = ac.createGain(); g3.gain.value = bass ? 0.11 : 0.06;

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
        var profile = playbackVoiceProfile(ev, i);
        self.voice(mtof(ev.midi[i]), t, dur, profile.velocity, profile.tone);
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
