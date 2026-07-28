/* 段落串流。
 *
 * 舊版的自動換題是「時間到 → 清空 → 重畫」，眼睛永遠是冷的：
 * 你看到新的四小節時，第一拍已經在響了。
 *
 * 這裡永遠維持兩段：正在彈的，和「已經畫好的」下一段。
 * 視譜訓練的核心就是眼睛跑在手前面，所以下一段必須事先存在，不是事後生出來。
 */

import { generateExercise } from "./gen/exercise.js";

export class Stream {
  /**
   * @param {() => object} readCfg 取得當下 UI 設定
   */
  constructor(readCfg){
    this.readCfg = readCfg;
    this.step = 0;            // 五度圈輪替走到第幾個調
    this.segStartBar = 0;     // 目前這一段從節拍器的第幾小節開始
    this.queue = [];
    this.history = [];        // 給 P4 回顧用；這裡只留 seed
  }

  /* 依上一段的結尾決定下一段怎麼接 */
  _make(prev, seed){
    const cfg = this.readCfg();
    cfg.seed = seed;
    cfg.step = this.step;
    if (prev){
      // 音域承接：從上一段最後一個音附近起頭，不會突然跳兩個八度
      cfg.startNote = prev.lastNote || null;
      // 上一段停在半終止或假終止 → 這一段一定要從主和弦解決回來
      cfg.mustResolve = (prev.cadence === "half" || prev.cadence === "deceptive");
    }
    const ex = generateExercise(cfg);
    ex.lastNote = lastSoundingNote(ex);
    // 把真正用過的設定原封不動留著。重現一段練習光有 seed 不夠 ——
    // 五度圈進度、承接上一段的起始音都是輸入的一部分。
    ex.usedCfg = Object.assign({}, cfg, {seed: ex.seed});
    return ex;
  }

  /* 換新題目：整條佇列與檔案全部重來 */
  reset(){
    this.queue = [];
    this.history = [];
    this.segStartBar = 0;
    const a = this._make(null, undefined);
    this.queue.push(a);
    this._pushNext();
    this._remember(a);
    return this.current();
  }

  _pushNext(){
    const prev = this.queue[this.queue.length - 1];
    if (this.cycleMode()) this.step++;
    this.queue.push(this._make(prev, undefined));
  }

  cycleMode(){
    const c = this.readCfg();
    return typeof c.keyPool === "string" && c.keyPool.indexOf("cycle") === 0;
  }

  current(){ return this.queue[0]; }
  next(){ return this.queue[1]; }

  /* 段落結束：下一段升上來，再預先生一段新的 */
  advance(barsDone){
    this.queue.shift();
    if (!this.queue.length) this.queue.push(this._make(null, undefined));
    this._pushNext();
    this.segStartBar = (barsDone === undefined) ? this.segStartBar + this.current().cfg.bars : barsDone;
    this._remember(this.current());
    return this.current();
  }

  /* 手動換題 = 換一個新題目，所以檔案清空，只保留五度圈輪替進度 */
  regenerate(){
    const keep = this.queue[0];
    this.queue = [];
    this.history = [];
    this.segStartBar = 0;
    if (this.cycleMode()) this.step++;
    const a = this._make(keep || null, undefined);
    this.queue.push(a);
    this._pushNext();
    this._remember(a);
    return this.current();
  }

  /* 重來同一題：用當初那份設定重跑，不是只重用 seed */
  replay(){
    const cur = this.current();
    if (!cur || !cur.usedCfg) return this.reset();
    const ex = generateExercise(Object.assign({}, cur.usedCfg));
    ex.lastNote = lastSoundingNote(ex);
    ex.usedCfg = cur.usedCfg;
    this.queue[0] = ex;
    return this.current();
  }

  /* 每一段練過的都建檔。只存 usedCfg —— 一段幾十 bytes，
     要調閱時再用同一份設定重新生一次，譜面保證一模一樣。 */
  _remember(ex){
    this.history.push({
      cfg: ex.usedCfg,
      key: ex.key.displayName,
      roman: ex.roman.join(" │ "),
      cadence: ex.cadence,
      seed: ex.seed,
      at: ex.createdAt
    });
    if (this.history.length > 500) this.history.shift();
  }

  /* 把存檔的那一段重新生出來（不動佇列） */
  recall(index){
    const h = this.history[index];
    if (!h) return null;
    const ex = generateExercise(Object.assign({}, h.cfg));
    ex.usedCfg = h.cfg;
    ex.lastNote = lastSoundingNote(ex);
    return ex;
  }

  /* 目前這一段走到第幾小節（0 起算）。posBeats 由節拍器提供。 */
  barInSegment(posBeats, beats){
    const cur = this.current();
    if (!cur) return -1;
    const abs = Math.floor(posBeats / beats);
    return abs - this.segStartBar;
  }
}

function lastSoundingNote(ex){
  for (let i = ex.measures.length - 1; i >= 0; i--){
    const line = ex.measures[i].top;
    for (let k = line.length - 1; k >= 0; k--) if (!line[k].rest) return line[k].note;
  }
  return null;
}
