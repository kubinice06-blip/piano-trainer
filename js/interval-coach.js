/* 垂直音程教練的純分析層。
 *
 * 樂譜繪製完成後，播放計畫已經知道每顆音的手別、起拍、時值與 MIDI。
 * 這裡把每一拍轉成「右手怎麼移動、左手怎麼移動、兩手是什麼方向關係」。
 * 不碰 DOM，方便獨立測試，也讓之後接 Web MIDI 時沿用同一套判讀文字。
 */

const SIMPLE = [
  "同音", "小二度", "大二度", "小三度", "大三度", "完全四度",
  "增四度／減五度", "完全五度", "小六度", "大六度", "小七度", "大七度"
];

const PITCH = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

export function pitchName(midi){
  if (!Number.isFinite(midi)) return "休止";
  return PITCH[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

export function intervalName(semitones){
  const n = Math.max(0, Math.round(Math.abs(semitones)));
  const oct = Math.floor(n / 12), rem = n % 12;
  if (!oct) return SIMPLE[rem];
  if (!rem) return oct === 1 ? "完全八度" : oct + " 個八度";
  return (oct === 1 ? "一個八度" : oct + " 個八度") + "＋" + SIMPLE[rem];
}

function representative(event, hand){
  if (!event || !event.midi || !event.midi.length) return null;
  return hand === "left" ? Math.min(...event.midi) : Math.max(...event.midi);
}

function soundingAt(events, hand, t){
  const eps = 1e-6;
  let found = null;
  for (const e of events){
    if ((e.hand || e.part) !== hand) continue;
    if (e.t <= t + eps && e.t + e.d > t + eps) found = e;
  }
  return representative(found, hand);
}

function motion(now, prev){
  if (!Number.isFinite(now)) return {dir:null, text:"休止"};
  // 起點與保持只練「位置／方向」；不要在這裡顯示推算的等音拼法，
  // 以免在升降號較多的調裡，答案文字和譜上的寫法不一致。
  if (!Number.isFinite(prev)) return {dir:null, text:"起點"};
  const d = now - prev;
  if (!d) return {dir:0, text:"保持原音"};
  return {dir:Math.sign(d), text:(d > 0 ? "上行 " : "下行 ") + intervalName(d)};
}

function relation(r, l, first){
  if (first) return "起點";
  if (r.dir === null || l.dir === null) return "含休止";
  if (r.dir === 0 && l.dir === 0) return "兩手保持";
  if (r.dir === 0 || l.dir === 0) return "斜向進行";
  return r.dir === l.dir ? "同向進行" : "反向進行";
}

/**
 * @returns 每拍一筆：{bar, beat, right, left, relation, vertical, answer}
 */
export function analyzeVerticalIntervals(plan, beats, bars){
  const events = plan && Array.isArray(plan.events) ? plan.events : [];
  const total = Math.max(0, Math.round((bars || 0) * (beats || 0)));
  const out = [];

  for (let t = 0; t < total; t++){
    const rightPitch = soundingAt(events, "right", t);
    const leftPitch = soundingAt(events, "left", t);
    const prevRight = t ? soundingAt(events, "right", t - 1) : null;
    const prevLeft = t ? soundingAt(events, "left", t - 1) : null;
    const right = motion(rightPitch, prevRight);
    const left = motion(leftPitch, prevLeft);
    const rel = relation(right, left, t === 0);
    const vertical = Number.isFinite(rightPitch) && Number.isFinite(leftPitch)
      ? intervalName(rightPitch - leftPitch) : "無法形成垂直音程";

    out.push({
      index:t,
      bar:Math.floor(t / beats) + 1,
      beat:(t % beats) + 1,
      rightPitch,
      leftPitch,
      right:right.text,
      left:left.text,
      relation:rel,
      vertical,
      answer:"右手：" + right.text + "｜左手：" + left.text + "｜" + rel + "｜兩手外距：" + vertical
    });
  }
  return out;
}
