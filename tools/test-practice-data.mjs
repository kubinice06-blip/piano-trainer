import assert from "node:assert/strict";

class MemoryStorage {
  constructor(){ this.items = new Map(); }
  getItem(key){ return this.items.has(key) ? this.items.get(key) : null; }
  setItem(key, value){ this.items.set(key, String(value)); }
  removeItem(key){ this.items.delete(key); }
}

globalThis.localStorage = new MemoryStorage();
localStorage.setItem("putai.library.v1", JSON.stringify({
  v: 1,
  seconds: 125,
  entries: [{
    id: "legacy-entry",
    cfg: {level:2, keyPool:"C", ts:"4/4", hands:"rh", bars:2, seed:7},
    key: "C",
    keyName: "C 大調",
    level: 2,
    ts: "4/4",
    hands: "rh",
    bars: 2,
    roman: "I │ V │ I",
    count: 9,
    marked: true,
    at: Date.now(),
  }],
}));

const {Library} = await import("../js/library.js");
await Library.load();

assert.equal(Library.data.v, 2);
assert.equal(Library.data.entries[0].legacyGeneratedCount, 9);
assert.equal(Library.stats().segments, 0, "legacy generations must not become completions");
assert.equal(Library.marked().length, 1, "legacy review marks must survive migration");

const exercise = {
  usedCfg: {level:3, keyPool:"level", ts:"4/4", hands:"both", bars:4, density:"auto", seed:42, generatorVersion:1},
  generatorVersion: 1,
  key: {id:"G", displayName:"G 大調"},
  cfg: {level:3, bars:4},
  ts: "4/4",
  hands: "both",
  roman: ["I", "IV", "V", "I"],
  cadence: "authentic",
};

Library.present(exercise);
assert.equal(Library.stats().attempts, 0, "presenting a generated score is not practice");

let attempt = Library.startAttempt(exercise, {barsPlanned:4, bpm:60, mode:"read", flow:"flow"});
assert.ok(attempt.id);
assert.equal(Library.stats().attempts, 1);
assert.equal(Library.stats().segments, 0);
Library.finishAttempt({completed:true, barsCompleted:4});
assert.equal(Library.stats().segments, 1);
assert.equal(Library.rateAttempt(attempt.id, "smooth").direction, null);

attempt = Library.startAttempt(exercise, {barsPlanned:4, bpm:60, mode:"read", flow:"flow"});
Library.finishAttempt({completed:true, barsCompleted:4});
assert.equal(Library.rateAttempt(attempt.id, "smooth").direction, "up", "two smooth ratings should raise difficulty");

attempt = Library.startAttempt(exercise, {barsPlanned:4, bpm:60, mode:"read", flow:"flow"});
Library.finishAttempt({completed:true, barsCompleted:4});
assert.equal(Library.rateAttempt(attempt.id, "collapse").direction, "down", "one collapse should lower difficulty");

attempt = Library.startAttempt(exercise, {barsPlanned:4, bpm:60, mode:"read", flow:"flow"});
Library.toggleMark(exercise);
Library.finishAttempt({completed:false, barsCompleted:1.5});
Library.toggleMark(exercise);
assert.equal(Library.get(exercise).markEvents, 1, "unmarking must not erase failure evidence");
assert.equal(Library.stats().attempts, 4);
assert.equal(Library.stats().segments, 3);

const weakness = Library.captureWeakness({
  key:"G", keyName:"G 大調", ts:"4/4", level:3, hands:"both",
  rhythmFamily:"eighth", texture:"block", harmonyBars:[["I"], ["IV"], ["V"], ["I"]],
}, Library.get(exercise).id);
assert.equal(Library.activeWeaknesses().length, 1);
assert.equal(Library.dueWeaknesses().length, 0, "new weaknesses return tomorrow, not immediately");
for (let i = 0; i < 3; i++) {
  attempt = Library.startAttempt(exercise, {barsPlanned:4, bpm:60, mode:"read", weaknessId:weakness.id});
  Library.finishAttempt({completed:true, barsCompleted:4, metrics:{accuracy:0.95, timingMedianMs:80}});
  Library.rateAttempt(attempt.id, "smooth");
}
assert.equal(Library.weakness(weakness.id).status, "graduated", "1/3/7 review should graduate after three smooth passes");

Library.recordDrill("note", {correct:true, responseMs:480, details:{position:"C4"}});
Library.recordDrill("note", {correct:false, responseMs:720, details:{position:"C4"}});
assert.equal(Library.drillStats("note").accuracy, 0.5);
assert.equal(Library.notePositionStats()[0].position, "C4");
Library.recordWeeklyTest({week:"2026-W31", segments:5, completed:5, accuracy:0.8, medianTimingMs:140,
  smoothRate:0.8, eyeHandBeats:1, noteMedianMs:920});
assert.equal(Library.latestWeeklyTest().completed, 5);
assert.equal(Library.weeklyHistory()[0].eyeHandBeats, 1);

const backup = Library.backup();
await Library.clear();
assert.equal(Library.stats().attempts, 0);
await Library.restore(backup);
assert.equal(Library.stats().attempts, 7);
assert.equal(Library.stats().segments, 6);
assert.equal(Library.weakness(weakness.id).status, "graduated");
assert.equal(Library.drillStats("note").attempts, 2);
assert.equal(Library.latestWeeklyTest().completed, 5);
assert.equal(Library.untouched([{id:"C"}, {id:"G"}]).length, 1);

await Library.flush();
console.log("✓ practice data migration, attempts, ratings, marks, and backup restore");
