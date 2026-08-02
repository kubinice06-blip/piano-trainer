/* Continuous sight-reading drill driven by a touch piano.
 * Every score event is judged; a wrong key never advances the sequence. */

const BLACK_PCS = new Set([1, 3, 6, 8, 10]);
const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

function median(values){
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function pitchClass(midi){ return ((midi % 12) + 12) % 12; }

export function pianoNoteName(midi){
  return `${NAMES[pitchClass(midi)]}${Math.floor(midi / 12) - 1}`;
}

export function buildTapEvents(plan){
  const groups = new Map();
  for (const source of plan?.events || []){
    const key = Number(source.t || 0).toFixed(4);
    if (!groups.has(key)) groups.set(key, {t:Number(source.t) || 0, d:Number(source.d) || 0, midi:[], gids:[]});
    const event = groups.get(key);
    event.d = Math.max(event.d, Number(source.d) || 0);
    event.midi.push(...(source.midi || []).map(Number).filter(Number.isFinite));
    if (source.gid) event.gids.push(source.gid);
  }
  return [...groups.values()].map((event, index) => ({
    ...event, index,
    midi:[...new Set(event.midi)], gids:[...new Set(event.gids)],
  })).sort((a, b) => a.t - b.t).map((event, index) => ({...event, index}));
}

export function pianoRange(events, minimumWhites = 8){
  const notes = events.flatMap((event) => event.midi).filter(Number.isFinite);
  const minimum = notes.length ? Math.min(...notes) : 60;
  const maximum = notes.length ? Math.max(...notes) : 72;
  let start = minimum - pitchClass(minimum); // C below the lowest note
  let end = maximum + ((12 - pitchClass(maximum)) % 12); // C above the highest note
  if (end === start) end += 12;
  const whiteCount = (end - start) / 12 * 7 + 1;
  if (whiteCount < minimumWhites) end = start + 12;
  const keys = [];
  let whiteIndex = -1;
  for (let midi = start; midi <= end; midi++){
    const black = BLACK_PCS.has(pitchClass(midi));
    if (!black) whiteIndex += 1;
    keys.push({midi, black, whiteIndex, slot:black ? whiteIndex + 1 : null, name:pianoNoteName(midi)});
  }
  return {start, end, keys, whiteCount:keys.filter((key) => !key.black).length};
}

export class TapSightMatcher {
  constructor(events, bpm, startMs, windowMs = 420){
    const msPerBeat = 60000 / Math.max(1, bpm);
    this.events = events.map((event) => ({
      ...event, at:startMs + event.t * msPerBeat,
      status:"pending", errorMs:null, playedMidi:null,
    }));
    this.windowMs = windowMs;
    this.wrongTaps = 0;
  }

  tick(atMs){
    for (const event of this.events){
      if (event.status === "pending" && atMs > event.at + this.windowMs) event.status = "missed";
    }
  }

  tap(midi, atMs){
    this.tick(atMs);
    const candidates = this.events.filter((event) =>
      event.status === "pending" && Math.abs(atMs - event.at) <= this.windowMs);
    candidates.sort((a, b) => Math.abs(atMs - a.at) - Math.abs(atMs - b.at));
    const target = candidates[0] || null;
    if (!target || !target.midi.includes(midi)){
      this.wrongTaps += 1;
      return {correct:false, target, midi};
    }
    target.status = "hit";
    target.errorMs = atMs - target.at;
    target.playedMidi = midi;
    return {correct:true, target, midi};
  }

  current(atMs, leadMs = 500){
    const pending = this.events.filter((event) => event.status === "pending");
    return pending.find((event) => event.at >= atMs - this.windowMs && event.at <= atMs + leadMs)
      || pending[0] || null;
  }

  result(atMs = Infinity){
    this.tick(atMs);
    const hit = this.events.filter((event) => event.status === "hit");
    const missed = this.events.filter((event) => event.status === "missed").length;
    const timing = hit.map((event) => Math.abs(event.errorMs));
    const expected = this.events.length;
    const accuracy = expected ? hit.length / expected : 0;
    return {
      expected, correct:hit.length, missed, wrongTaps:this.wrongTaps, accuracy,
      medianTimingMs:median(timing),
      rating:accuracy >= 0.9 && (median(timing) ?? 999) <= 140 ? "smooth"
        : (accuracy >= 0.65 ? "stumble" : "collapse"),
    };
  }
}
