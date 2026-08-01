/* 和聲進行：不再是 13 個寫死的四小節模板，改成走語料庫學到的機率。
 *
 * 做法是「可達性回推 + 加權前向取樣」：
 *   1. 先決定要收在哪個終止式（也是從語料庫的終止式分布抽的）
 *   2. 從終止式往回算，每個位置有哪些和弦「走得到終點」
 *   3. 再從頭往前抽，只在走得到終點的集合裡抽，權重用三連/接續的實際出現次數
 * 所以它既會出現語料庫裡真實存在的接續，又保證一定收得漂亮。
 */

import { HARMONY_STATS } from "../data/harmony-stats.js";
import { parseToken, realizeChord } from "../core/roman.js";

/* ---------- 詞彙表：只留我們畫得出來的和弦，並按複雜度分級 ---------- */

function complexity(tok){
  if (/\//.test(tok)) return 4;                       // 應用和弦
  if (/^[b#]/.test(tok) || tok === "N6") return 4;    // 借用 / 拿波里
  if (/(65|43|42)$/.test(tok)) return 3;
  if (/64$/.test(tok) || tok === "Cad64") return 3;
  if (/o|ø/.test(tok)) return 3;
  if (/7$/.test(tok)) return /^V7$/.test(tok) ? 2 : 3;
  if (/6$/.test(tok)) return 2;
  return 1;
}

const LEVEL_COMPLEXITY = [1, 1, 2, 3, 4, 4];

function buildVocab(mode){
  const uni = HARMONY_STATS[mode].uni;
  const out = {};
  for (const tok of Object.keys(uni)){
    const p = parseToken(tok);
    if (!p) continue;
    // 應用和弦只能是屬功能（V / vii°）。語料庫裡的 "I/III" "iii/III" 這類
    // 是「暫時主音化」的標記法，當成和弦看不是應用和弦，會生出怪東西。
    if (p.applied !== null && p.applied !== undefined && p.degree !== 4 && p.degree !== 6) continue;
    out[tok] = {token: tok, parsed: p, count: uni[tok], cx: complexity(tok)};
  }
  return out;
}

/* 同一個根音只是換了七音或轉位，算同一個和弦 —— 語料庫裡 V7 後面接 V
   多半是七音進出造成的記譜，不是真的和聲移動。這種接續要擋掉，
   否則出題會出現 V7→V 這種聽起來在倒退的進行。 */
function sameHarmony(a, b){
  const pa = parseToken(a), pb = parseToken(b);
  if (!pa || !pb) return false;
  return pa.degree === pb.degree && pa.alter === pb.alter && pa.applied === pb.applied;
}

const VOCAB = {major: buildVocab("major"), minor: buildVocab("minor")};

/* ---------- 取樣溫度 ----------
 *
 * 語料庫的出現次數是冪次分布：I>IV 之類的常見接續比冷門的多好幾個數量級。
 * 直接拿次數當權重，抽出來的東西就塌成前三名 ——
 * 實測第 1、2 級 400 題只出得到 7 種進行，I–IV–V–I 一個就佔一半，
 * 也就是「都可以猜到是 C F G C」的來源。
 *
 * 開根號把分布壓平。真實常見的接續還是比較常出現，但不再壟斷；
 * 而且路徑本來就只走語料庫真的存在的邊，壓平不會生出不存在的接續。
 */
const TEMP = 0.42;
function flat(w){ return Math.pow(Math.max(w, 0), TEMP); }

/* ---------- 轉移機率 ---------- */

function edges(mode, vocabSet){
  // from -> [{to, w}]
  const bi = HARMONY_STATS[mode].bi;
  const map = {};
  for (const k of Object.keys(bi)){
    const [a, b] = k.split(">");
    if (!vocabSet.has(a) || !vocabSet.has(b)) continue;
    if (sameHarmony(a, b)) continue;
    (map[a] = map[a] || []).push({to: b, w: bi[k]});
  }
  return map;
}

function triWeight(mode, a, b, c){
  return HARMONY_STATS[mode].tri[a + ">" + b + ">" + c] || 0;
}

/* ---------- 終止式 ---------- */

const CADENCE_KIND = {
  authentic: /^(V|V7|V65|viio6|viio7|viiø7)>(I|i)$/,      // 正格終止，收在主和弦原位
  half:      /^.+>(V|V7|V6)$/,                            // 半終止，停在屬和弦
  deceptive: /^(V|V7)>(vi|VI)$/,                          // 假終止
  plagal:    /^(IV|iv|ii6)>(I|i)$/                        // 變格終止
};

function cadenceOptions(mode, kind, vocabSet){
  const cad = HARMONY_STATS[mode].cadence;
  const out = [];
  for (const k of Object.keys(cad)){
    const [a, b] = k.split(">");
    if (!vocabSet.has(a) || !vocabSet.has(b)) continue;
    if (!CADENCE_KIND[kind].test(k)) continue;
    out.push({pair: [a, b], w: cad[k]});
  }
  return out;
}

/* ---------- 主體：走一條長度 n 的路徑，且結尾必須是 suffix ---------- */

function walk(rng, mode, n, suffix, vocabSet, edgeMap, startFilter){
  const free = n - suffix.length;
  if (free <= 0) return suffix.slice(-n);

  // 回推：R[k] = 在第 k 個位置放了這個和弦，還走得到 suffix[0]
  const R = new Array(free);
  R[free - 1] = new Set();
  for (const t of vocabSet){
    if ((edgeMap[t] || []).some(e => e.to === suffix[0])) R[free - 1].add(t);
  }
  for (let k = free - 2; k >= 0; k--){
    R[k] = new Set();
    for (const t of vocabSet){
      if ((edgeMap[t] || []).some(e => R[k + 1].has(e.to))) R[k].add(t);
    }
    if (!R[k].size) return null;
  }
  if (!R[0].size) return null;

  // 起頭：語料庫裡真的當過段落開頭的和弦，優先主和弦。
  // 第一個樂句會再收緊成只能從主和弦出發 —— 練習曲從家裡出門才聽得懂。
  const starts = HARMONY_STATS[mode].start;
  let pool = [...R[0]];
  if (startFilter){
    const f = pool.filter(t => startFilter.test(t));
    if (f.length) pool = f;
  }
  const named = pool.filter(t => starts[t]);
  if (named.length) pool = named;
  const path = [rng.weighted(pool, pool.map(t => flat(starts[t] || 1) * (/^(I|i)$/.test(t) ? 2 : 1)))];

  for (let k = 1; k < free; k++){
    const prev = path[k - 1], prev2 = path[k - 2];
    const next = (edgeMap[prev] || []).filter(e => R[k].has(e.to));
    if (!next.length) return null;
    // 三連統計優先：同樣的 A>B 之後，語料庫裡最常接什麼
    const ws = next.map(e => flat(e.w) + (prev2 ? flat(triWeight(mode, prev2, prev, e.to)) * 2.5 : 0));
    path.push(rng.weighted(next, ws).to);
  }
  return path.concat(suffix);
}

/* ---------- 樂句規劃 ---------- */

/* 4 小節 = 一個樂句；8 = 問句(半終止) + 答句(正格)；12 = 三句 */
function phrasePlan(rng, bars){
  if (bars <= 2) return [{bars, cadence: "authentic"}];
  if (bars <= 4) return [{bars, cadence: rng.chance(0.7) ? "authentic" : (rng.chance(0.6) ? "half" : "deceptive")}];
  if (bars === 8) return [{bars:4, cadence:"half"}, {bars:4, cadence:"authentic"}];
  if (bars === 12) return [{bars:4, cadence:"half"}, {bars:4, cadence: rng.chance(0.5) ? "deceptive" : "half"},
                           {bars:4, cadence:"authentic"}];
  const out = [];
  let left = bars;
  while (left > 0){ const n = Math.min(4, left); out.push({bars:n, cadence: left === n ? "authentic" : "half"}); left -= n; }
  return out;
}

/* 和聲節奏：每小節幾個和弦。終止小節不切碎。
 *
 * 一小節兩個和弦是變化量最便宜的來源，而且低難度也需要 ——
 * 四小節、一小節一個和弦、頭尾又被「從主和弦出發」和終止式各佔掉，
 * 中間就只剩一個位置可以變，所以第 1、2 級不管怎麼抽都只有 7 種進行。
 * 現在每一級都有機會切成兩個，愈高愈常切。
 */
const SPLIT_CHANCE = [0.14, 0.18, 0.22, 0.26, 0.32, 0.34];

function harmonicRhythm(rng, bars, level, beats){
  const p = SPLIT_CHANCE[Math.min(Math.max(level, 1), 6) - 1];
  const out = [];
  for (let i = 0; i < bars; i++){
    const last = (i === bars - 1);
    out.push(!last && beats >= 3 && rng.chance(p) ? 2 : 1);
  }
  return out;
}

/**
 * @returns {{bars:Array, tokens:string[], roman:string[], cadence:string}}
 *   bars[i].slots = [{beat, beats, chord, token}]
 */
export function buildHarmony(rng, key, barCount, opts){
  const o = opts || {};
  const level = o.level || 1;
  const beats = o.beats || 4;
  const mode = key.isMinor ? "minor" : "major";
  const maxCx = LEVEL_COMPLEXITY[Math.min(level, 6) - 1];

  // A weakness review preserves the harmonic fingerprint but re-realises the
  // melody, voicing and seed. Invalid/obsolete tokens safely fall back to the
  // regular generator below.
  const preferred = Array.isArray(o.preferredBars) ? o.preferredBars.slice(0, barCount) : null;
  if (preferred?.length === barCount && preferred.every((bar) => Array.isArray(bar) && bar.length)){
    try {
      const preferredBars = preferred.map((bar) => {
        const slots = bar.map((tok, i) => ({
          beat:i * (beats / bar.length),
          beats:beats / bar.length,
          token:String(tok),
          chord:realizeChord(key, parseToken(String(tok))),
        }));
        if (slots.some((slot) => !slot.chord)) throw new Error("invalid harmony fingerprint");
        return {slots};
      });
      const preferredTokens = preferred.flat().map(String);
      return {
        bars:preferredBars,
        tokens:preferredTokens,
        roman:preferredBars.map((bar) => bar.slots.map((slot) => slot.token).join(" ")),
        cadence:"review",
      };
    } catch {
      // Continue with a newly sampled progression.
    }
  }

  const vocab = VOCAB[mode];
  const vocabSet = new Set(Object.keys(vocab).filter(t => vocab[t].cx <= maxCx));
  const edgeMap = edges(mode, vocabSet);

  const plan = phrasePlan(rng, barCount);
  const rhythm = harmonicRhythm(rng, barCount, level, beats);

  // 各樂句要幾個和弦
  let barCursor = 0;
  const tokens = [];
  let usedCadence = plan[plan.length - 1].cadence;

  for (const ph of plan){
    const first = (barCursor === 0);
    // 上一段停在半終止或假終止時，這一段必須從原位主和弦解決回來
    const startFilter = first ? (o.mustResolve ? /^(I|i)$/ : /^(I|i)(6)?$/) : null;
    const slots = rhythm.slice(barCursor, barCursor + ph.bars).reduce((a, b) => a + b, 0);
    let seq = null;
    for (const kind of [ph.cadence, "authentic", "half"]){
      const opts2 = cadenceOptions(mode, kind, vocabSet);
      if (!opts2.length) continue;
      for (let tryN = 0; tryN < 8 && !seq; tryN++){
        const cad = rng.weighted(opts2, opts2.map(c => flat(c.w)));
        seq = walk(rng, mode, slots, cad.pair, vocabSet, edgeMap, startFilter);
      }
      if (seq){ if (ph === plan[plan.length - 1]) usedCadence = kind; break; }
    }
    // 真的走不出來就退回最保守的進行，不讓出題整個失敗
    if (!seq){
      const T = key.isMinor ? "i" : "I", D = vocabSet.has("V7") ? "V7" : "V";
      seq = Array.from({length: slots}, (_, i) => (i === slots - 1 ? T : (i === slots - 2 ? D : T)));
    }
    tokens.push(...seq);
    barCursor += ph.bars;
  }

  // 攤平成小節 / 拍點
  const bars = [];
  let ti = 0;
  for (let i = 0; i < barCount; i++){
    const nSlots = rhythm[i];
    const slots = [];
    for (let s = 0; s < nSlots; s++){
      const tok = tokens[ti++] || tokens[tokens.length - 1];
      const parsed = parseToken(tok);
      slots.push({
        beat: s * (beats / nSlots),
        beats: beats / nSlots,
        token: tok,
        chord: realizeChord(key, parsed)
      });
    }
    bars.push({slots});
  }

  return {
    bars,
    tokens,
    roman: bars.map(b => b.slots.map(s => s.token).join(" ")),
    cadence: usedCadence
  };
}

/* 給某一拍找出當時的和弦 */
export function chordAt(H, barIndex, beat){
  const slots = H.bars[barIndex].slots;
  for (let i = slots.length - 1; i >= 0; i--){
    if (beat >= slots[i].beat - 1e-9) return slots[i];
  }
  return slots[0];
}

/* 段落銜接用：這一段收在哪裡，決定下一段從哪裡起 */
export function cadenceKind(H){ return H.cadence; }
