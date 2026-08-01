/* Match played notes/onsets against a rendered plan using monotonic timestamps. */

function median(values){
  if (!values.length) return null;
  const sorted = values.slice().sort((a,b) => a-b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
}

export class PerformanceMatcher {
  constructor(plan, bpm, startMs, mode = "midi"){
    const msPerBeat = 60000 / bpm;
    const grouped = new Map();
    for (const event of plan?.events || []){
      const key = event.t.toFixed(4);
      if (!grouped.has(key)) grouped.set(key, {t:event.t, midi:[], durations:{}});
      const group = grouped.get(key);
      group.midi.push(...(event.midi || []));
      for (const note of event.midi || []) group.durations[note] = event.d || 0;
    }
    this.expected = [...grouped.values()].sort((a,b) => a.t-b.t)
      .map((event) => ({...event, at:startMs + event.t * msPerBeat, hits:[]}));
    this.mode = mode;
    this.msPerBeat = msPerBeat;
    this.hits = [];
  }

  hit(midi, atMs = performance.now()){
    if (!this.expected.length) return;
    const onsetOnly = this.mode !== "midi" || midi == null;
    const available = (event) => onsetOnly
      ? event.hits.length === 0
      : event.midi.includes(midi) && !event.hits.some((hit) => hit.pitchOk && hit.midi === midi);
    let best = null, distance = Infinity;
    for (const event of this.expected){
      if (!available(event)) continue;
      const d = Math.abs(atMs - event.at);
      if (d < distance){ distance = d; best = event; }
    }
    // MIDI mistakes are still useful evidence. Attach them to the nearest beat,
    // but never count a repeated correct key as another expected note.
    if (!best && !onsetOnly){
      for (const event of this.expected){
        const d = Math.abs(atMs - event.at);
        if (d < distance){ distance = d; best = event; }
      }
    }
    if (!best || distance > 500) return;
    const pitchOk = onsetOnly || (best.midi.includes(midi)
      && !best.hits.some((hit) => hit.pitchOk && hit.midi === midi));
    const hit = {midi,atMs,errorMs:atMs-best.at,pitchOk,
      targetDurationMs:pitchOk && midi != null ? (best.durations[midi] || 0) * this.msPerBeat : null,
      durationMs:null, durationErrorMs:null};
    best.hits.push(hit);
    this.hits.push(hit);
    return hit;
  }

  noteOff(midi, atMs = performance.now()){
    const hit = this.hits.slice().reverse().find((item) =>
      item.pitchOk && item.midi === midi && item.durationMs == null);
    if (!hit) return null;
    hit.durationMs = Math.max(0, atMs - hit.atMs);
    hit.durationErrorMs = hit.targetDurationMs == null ? null : hit.durationMs - hit.targetDurationMs;
    return hit;
  }

  result(){
    const timing = this.hits.map((hit) => Math.abs(hit.errorMs));
    const expectedNotes = this.mode === "midi"
      ? this.expected.reduce((sum,event) => sum + new Set(event.midi).size, 0)
      : this.expected.length;
    const correct = this.mode === "midi" ? this.hits.filter((hit) => hit.pitchOk).length : this.hits.length;
    const accuracy = expectedNotes ? Math.min(1, correct / expectedNotes) : 0;
    const timingMedianMs = median(timing);
    const duration = this.hits.map((hit) => hit.durationErrorMs).filter(Number.isFinite).map(Math.abs);
    const durationMedianMs = median(duration);
    const pitchErrors = this.mode === "midi" ? this.hits.filter((hit) => !hit.pitchOk).length : 0;
    const missed = Math.max(0, expectedNotes - correct);
    const timingErrors = this.hits.filter((hit) => Math.abs(hit.errorMs) > 260).length;
    const durationErrors = duration.filter((value) => value > 300).length;
    const durationOk = durationMedianMs == null || durationMedianMs <= 300;
    const rating = accuracy >= 0.9 && (timingMedianMs ?? 999) <= 120 && durationOk ? "smooth"
      : (accuracy >= 0.65 && (timingMedianMs ?? 999) <= 260 ? "stumble" : "collapse");
    const errorTags = [];
    if (pitchErrors) errorTags.push("pitch-error");
    if (missed) errorTags.push("missed-note");
    if (timingErrors) errorTags.push("timing-error");
    if (durationErrors) errorTags.push("duration-error");
    return {source:this.mode,expected:expectedNotes,hits:this.hits.length,correct,accuracy,
            missed,pitchErrors,timingErrors,durationErrors,errorTags,
            medianTimingMs:timingMedianMs, timingMedianMs,
            medianDurationMs:durationMedianMs, durationMedianMs, rating};
  }
}
