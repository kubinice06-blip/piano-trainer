/* 長期練習紀錄。
 *
 * 和「本次練習存檔」（stream.history）不一樣：那個是這一輪的暫存，按換一題就清空；
 * 這裡是跨場次的，關掉瀏覽器再開還在。
 *
 * 只存 cfg —— 要看譜的時候用同一份設定重新生一次就好，逐音一致。
 * 一筆大約 200 bytes，兩千筆也才 0.4 MB，localStorage 綽綽有餘。
 */

const KEY = "putai.library.v1";
const MAX_ENTRIES = 2000;

function stableStringify(o){
  if (o === null || typeof o !== "object") return JSON.stringify(o);
  if (Array.isArray(o)) return "[" + o.map(stableStringify).join(",") + "]";
  return "{" + Object.keys(o).sort().map(k => JSON.stringify(k) + ":" + stableStringify(o[k])).join(",") + "}";
}

/* cfg 決定譜面，所以 cfg 的雜湊就是這一段的身分證。
   同一段再練一次是累加次數，不是多一筆。 */
function hashCfg(cfg){
  const s = stableStringify(cfg);
  let h = 0x811C9DC5;
  for (let i = 0; i < s.length; i++){
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

function emptyStore(){
  return {v: 1, entries: [], seconds: 0, coach: {}, startedAt: Date.now()};
}

export const Library = {
  data: emptyStore(),
  available: true,

  load(){
    try {
      const raw = localStorage.getItem(KEY);
      this.data = raw ? JSON.parse(raw) : emptyStore();
      if (!this.data || this.data.v !== 1 || !Array.isArray(this.data.entries)) this.data = emptyStore();
      if (!this.data.coach || typeof this.data.coach !== "object") this.data.coach = {};
    } catch (e) {
      // iOS 在 file:// 或無痕模式下可能整個不給用。功能降級，但不能讓程式掛掉。
      this.available = false;
      this.data = emptyStore();
    }
    return this.data;
  },

  save(){
    if (!this.available) return;
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); }
    catch (e) {
      // 滿了就砍掉最舊的一半再試一次
      this.data.entries = this.data.entries.slice(-Math.floor(MAX_ENTRIES / 2));
      try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e2) { this.available = false; }
    }
  },

  /** 記錄一段練過的題目 */
  log(ex){
    if (!ex || !ex.usedCfg) return null;
    const id = hashCfg(ex.usedCfg);
    let e = this.data.entries.find(x => x.id === id);
    if (e){
      e.count++;
      e.at = Date.now();
    } else {
      e = {
        id,
        cfg: ex.usedCfg,
        key: ex.key.id,
        keyName: ex.key.displayName,
        level: ex.cfg.level,
        ts: ex.ts,
        hands: ex.hands,
        bars: ex.cfg.bars,
        roman: ex.roman.join(" │ "),
        cadence: ex.cadence,
        lh: ex.lhLabel || null,
        at: Date.now(),
        count: 1,
        marked: false
      };
      this.data.entries.push(e);
      if (this.data.entries.length > MAX_ENTRIES) this.data.entries.shift();
    }
    this.save();
    return e;
  },

  get(id){ return this.data.entries.find(x => x.id === id) || null; },

  /* 只要 id，不留紀錄 —— 回到練習時要認回原本那一段，
     但那不算又練了一次，不能讓次數灌水 */
  idOf(cfg){ return cfg ? hashCfg(cfg) : null; },

  toggleMark(id){
    const e = this.get(id);
    if (!e) return null;
    e.marked = !e.marked;
    e.markedAt = e.marked ? Date.now() : null;
    this.save();
    return e;
  },

  marked(){
    return this.data.entries.filter(e => e.marked)
      .sort((a, b) => (b.markedAt || 0) - (a.markedAt || 0));
  },

  recent(n){
    return this.data.entries.slice(-(n || 20)).reverse();
  },

  /** 累計練習秒數（節拍器實際在跑的時間） */
  addSeconds(s){
    if (!(s > 0)) return;
    this.data.seconds = (this.data.seconds || 0) + s;
    this.save();
  },

  /** 讀譜教練的自評。沒有 MIDI 輸入時，停頓與漏音由使用者按鈕回報。 */
  recordCoach(mode, result){
    if (!mode || mode === "free") return null;
    const c = this.data.coach[mode] = this.data.coach[mode] || {
      attempts:0, clean:0, stops:0, leftDrops:0, omissions:0, at:0
    };
    const r = result || {};
    c.attempts++;
    c.stops += Math.max(0, r.stops || 0);
    c.leftDrops += Math.max(0, r.leftDrops || 0);
    c.omissions += Math.max(0, r.omissions || 0);
    if (!(r.stops || r.leftDrops)) c.clean++;
    c.at = Date.now();
    this.save();
    return c;
  },

  coachStats(mode){
    return (this.data.coach && this.data.coach[mode]) || {
      attempts:0, clean:0, stops:0, leftDrops:0, omissions:0, at:0
    };
  },

  /** 垂直音程以「每拍一次判斷」統計，並分開記錄方向關係。 */
  recordInterval(correct, relation){
    const c = this.data.coach.interval = this.data.coach.interval || {
      attempts:0, correct:0, wrong:0, relations:{}, at:0
    };
    if (!c.relations || typeof c.relations !== "object") c.relations = {};
    c.attempts++;
    if (correct) c.correct++; else c.wrong++;
    const key = relation || "未分類";
    const r = c.relations[key] = c.relations[key] || {attempts:0, correct:0};
    r.attempts++;
    if (correct) r.correct++;
    c.at = Date.now();
    this.save();
    return c;
  },

  intervalStats(){
    const c = this.data.coach && this.data.coach.interval;
    return c || {attempts:0, correct:0, wrong:0, relations:{}, at:0};
  },

  clear(){
    this.data = emptyStore();
    this.save();
  },

  /**
   * 統計。重點不是好看，是回答「下次該練什麼」——
   * 所以看的是「標記率」而不是「練最少」：練得多還是常出錯，才是真的卡住。
   */
  stats(){
    const es = this.data.entries;
    const total = es.reduce((a, e) => a + e.count, 0);
    const byKey = {}, byLevel = {};
    es.forEach(e => {
      const k = byKey[e.key] = byKey[e.key] || {name: e.keyName, count: 0, marked: 0};
      k.count += e.count;
      if (e.marked) k.marked++;
      const l = byLevel[e.level] = byLevel[e.level] || {count: 0, marked: 0};
      l.count += e.count;
      if (e.marked) l.marked++;
    });

    // 只在練過足夠次數的調裡面比，否則練一次標一次的調會永遠排第一
    const weak = Object.keys(byKey)
      .map(id => ({id, ...byKey[id], rate: byKey[id].marked / byKey[id].count}))
      .filter(k => k.count >= 3 && k.marked > 0)
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 3);

    // 完全沒碰過的調（要由呼叫端提供全部調的清單）
    return {
      segments: total,
      unique: es.length,
      marked: es.filter(e => e.marked).length,
      minutes: Math.round((this.data.seconds || 0) / 60),
      byKey, byLevel, weak
    };
  },

  /** 從沒練過的調 */
  untouched(allKeys){
    const seen = new Set(this.data.entries.map(e => e.key));
    return allKeys.filter(k => !seen.has(k.id));
  }
};
