/* 段落串流。
 *
 * 舊版的自動換題是「時間到 → 清空 → 重畫」，眼睛永遠是冷的：
 * 你看到新的四小節時，第一拍已經在響了。
 *
 * 這裡永遠維持兩段：正在彈的，和「已經畫好的」下一段。
 * 視譜訓練的核心就是眼睛跑在手前面，所以下一段必須事先存在，不是事後生出來。
 */

import { generateExercise } from "./gen/exercise.js";
import { randomSeed } from "./core/rng.js";
import { dIdx } from "./core/pitch.js";

function intervalNotes(ex){
  if (!ex?.cfg?.intervalDrill) return [];
  return ex.measures.flatMap(measure => (measure.top || []))
    .filter(item => !item.rest && item.note).map(item => dIdx(item.note));
}

/* 樂句開頭的形狀（前四個音的譜面位置）。
   一段接一段地讀時，最容易察覺的重複就是「每一題都從同一串音開始」，
   所以開頭要跟前幾段比對過才放行 —— 光比對和聲進行擋不掉這件事。 */
function openingSignature(ex){
  const which = ex.melodyOn === "bottom" ? "bottom" : "top";
  const out = [];
  for (const measure of ex.measures){
    for (const item of (measure[which] || measure.top || [])){
      if (item.rest || !item.note) continue;
      out.push(dIdx(item.note));
      if (out.length === 4) return out.join(",");
    }
  }
  return out.join(",");
}

function intervalDifference(a, b){
  const left = intervalNotes(a), right = intervalNotes(b);
  if (!left.length || left.length !== right.length) return {notes:left.length + right.length, motions:left.length + right.length};
  let notes = 0, motions = 0;
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) notes++;
  for (let i = 1; i < left.length; i++){
    if (left[i] - left[i - 1] !== right[i] - right[i - 1]) motions++;
  }
  return {notes, motions};
}

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
    const fixedSeed = cfg.seed !== undefined && cfg.seed !== null;
    if (seed !== undefined) cfg.seed = seed;
    cfg.step = this.step;
    if (prev){
      // 音域承接：從上一段最後一個音附近起頭，不會突然跳兩個八度
      cfg.startNote = prev.lastNote || null;
      // 上一段停在半終止或假終止 → 這一段一定要從主和弦解決回來
      cfg.mustResolve = (prev.cadence === "half" || prev.cadence === "deceptive");
    }
    let ex = generateExercise(cfg);

    /* 連著好幾段同樣的和聲進行，聽起來就是一直在重複 —— 每一段各自隨機是不夠的。
       做法是「換一顆 seed 重生」而不是在產生器裡重抽：
       usedCfg 裡就仍然只有一顆 seed，回顧與列印才重現得出一模一樣的譜。 */
    if (seed === undefined && !fixedSeed && cfg.intervalDrill && prev){
      // 簡單級的音域與音程都受限，只換 seed 仍可能畫出幾乎相同的折返線。
      // 最多比較 32 題，選和上一題差異最大的；達到明顯差異便提早停止。
      let best = ex, bestScore = -1;
      for (let t = 0; t < 32; t++){
        cfg.seed = randomSeed();
        const candidate = generateExercise(cfg);
        const diff = intervalDifference(candidate, prev);
        const score = diff.notes * 2 + diff.motions;
        if (score > bestScore){ best = candidate; bestScore = score; }
        if (diff.notes >= 8 && diff.motions >= 6) break;
      }
      ex = best;
      cfg.seed = ex.seed;
    } else if (seed === undefined && !fixedSeed){
      const progressions = this.recentProgressions();
      const openings = this.recentOpenings();
      for (let t = 0; t < 8; t++){
        if (progressions.indexOf(ex.harmony.tokens.join(" ")) < 0 &&
            openings.indexOf(openingSignature(ex)) < 0) break;
        cfg.seed = randomSeed();
        ex = generateExercise(cfg);
      }
    }

    ex.lastNote = lastSoundingNote(ex);
    // 把真正用過的設定原封不動留著。重現一段練習光有 seed 不夠 ——
    // 五度圈進度、承接上一段的起始音都是輸入的一部分。
    ex.usedCfg = Object.assign({}, cfg, {seed: ex.seed, generatorVersion: ex.generatorVersion});
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

  /* 佇列裡與剛練過的那幾段用了哪些進行 */
  recentProgressions(){
    const out = [];
    this.queue.forEach(ex => { if (ex && ex.harmony) out.push(ex.harmony.tokens.join(" ")); });
    this.history.slice(-2).forEach(h => { if (h.tokens) out.push(h.tokens); });
    return out;
  }

  /* 同上，但比的是樂句開頭 */
  recentOpenings(){
    const out = [];
    this.queue.forEach(ex => { if (ex) out.push(openingSignature(ex)); });
    this.history.slice(-3).forEach(h => { if (h.opening) out.push(h.opening); });
    return out;
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

  /* 就地改一項設定，其餘（seed、和聲、五度圈進度、承接的起始音）原封不動。
     交換左右手用的就是這個 —— 重新出題會變成另一段，那就不叫交換練了。
     下一段也要一起改，否則預讀那一列還停在舊的分工。 */
  restyle(patch){
    const cur = this.current();
    if (!cur || !cur.usedCfg) return this.reset();
    for (let i = 0; i < this.queue.length; i++){
      const base = this.queue[i] && this.queue[i].usedCfg;
      if (!base) continue;
      const cfg = Object.assign({}, base, patch);
      const ex = generateExercise(cfg);
      ex.lastNote = lastSoundingNote(ex);
      ex.usedCfg = cfg;
      this.queue[i] = ex;
    }
    return this.current();
  }

  /* 每一段練過的都建檔。只存 usedCfg —— 一段幾十 bytes，
     要調閱時再用同一份設定重新生一次，譜面保證一模一樣。 */
  _remember(ex){
    this.history.push({
      cfg: ex.usedCfg,
      key: ex.key.displayName,
      tokens: ex.harmony ? ex.harmony.tokens.join(" ") : "",
      opening: openingSignature(ex),
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

/* 下一段要從上一段的結尾音附近接上，所以看的必須是「旋律」那一行。
   左手拿旋律時旋律在下面，抓 top 會抓到右手的伴奏，接出來的音域整個偏掉。 */
function lastSoundingNote(ex){
  if (ex.tailNote) return ex.tailNote;
  const which = ex.melodyOn === "bottom" ? "bottom" : "top";
  for (let i = ex.measures.length - 1; i >= 0; i--){
    const line = ex.measures[i][which] || ex.measures[i].top;
    for (let k = line.length - 1; k >= 0; k--) if (!line[k].rest) return line[k].note;
  }
  return null;
}
