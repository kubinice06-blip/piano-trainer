import assert from "node:assert/strict";
import { AXES, normaliseVector, stepVector, generatorLevels } from "../js/adaptive.js";
import { generateExercise, GENERATOR_VERSION } from "../js/gen/exercise.js";
import { fingerprintExercise, cfgFromFingerprint } from "../js/fingerprint.js";
import { PerformanceMatcher } from "../js/input/performance.js";
import { buildTapEvents, pianoRange, TapSightMatcher } from "../js/drills/tap-piano.js";
import { exercisePlaybackPlan } from "../js/render/score.js";
import { playbackVoiceProfile } from "../js/audio/sound.js";

assert.equal(AXES.length, 6);
const highRhythm = stepVector(normaliseVector(null, 2), "rhythm", "up");
assert.equal(highRhythm.rhythm, 2);
assert.equal(generatorLevels(highRhythm).rhythmLevel, 3);

const cfg = {
  level:3, difficulty:{pitchRange:2,keySignature:2,rhythm:2,texture:2,eyeHand:1,tempo:2},
  keyPool:"level", ts:"4/4", hands:"both", lhPattern:"block", density:"eighth",
  focus:"none", inversion:"auto", bars:4, seed:123456,
};
const original = generateExercise(cfg);
original.usedCfg = {...cfg, seed:original.seed, generatorVersion:GENERATOR_VERSION};
assert.equal(original.generatorVersion, 2);
assert.equal(original.measures.length, 4);
const answerPlan = exercisePlaybackPlan(original);
assert.ok(answerPlan.events.some((event) => event.part === "right"), "answer audio includes right hand");
assert.ok(answerPlan.events.some((event) => event.part === "left"), "answer audio includes left hand");
assert.ok(answerPlan.events.filter((event) => event.part === "left").every((event) => event.midi.length > 0));
assert.equal(playbackVoiceProfile({part:"left"}).tone, "bass");
assert.ok(playbackVoiceProfile({part:"left"}).velocity > playbackVoiceProfile({part:"right"}).velocity);
const leftOnly = generateExercise({...cfg, hands:"lh", lhPattern:null, seed:123457});
const leftOnlyPlan = exercisePlaybackPlan(leftOnly);
assert.ok(leftOnlyPlan.events.length > 0);
assert.ok(leftOnlyPlan.events.every((event) => event.part === "left"), "left-hand-only answer is audible");
const swappedHands = generateExercise({...cfg, hands:"swap", seed:123458});
const swappedPlan = exercisePlaybackPlan(swappedHands);
assert.ok(swappedPlan.events.some((event) => event.part === "right"));
assert.ok(swappedPlan.events.some((event) => event.part === "left"));

const fingerprint = fingerprintExercise(original);
const reviewCfg = cfgFromFingerprint(fingerprint, {...cfg, seed:654321});
reviewCfg.seed = 654321;
const review = generateExercise(reviewCfg);
assert.deepEqual(review.harmony.bars.map((bar) => bar.slots.map((slot) => slot.token)), fingerprint.harmonyBars);
assert.notEqual(review.seed, original.seed);

for (let axis = 0; axis < 6; axis++){
  const vector = Object.fromEntries(AXES.map((name) => [name, axis]));
  for (let seed = 1; seed <= 8; seed++){
    const exercise = generateExercise({...cfg, difficulty:vector, seed:axis * 100 + seed});
    assert.equal(exercise.measures.length, 4);
  }
}

const matcher = new PerformanceMatcher({events:[
  {t:0,d:1,midi:[60]}, {t:1,d:1,midi:[62]}, {t:2,d:1,midi:[64]},
]}, 60, 1000, "midi");
matcher.hit(60, 1020);
matcher.hit(60, 1040); // repeated key must not inflate accuracy
matcher.noteOff(60, 2000);
matcher.hit(62, 2010);
matcher.hit(64, 2980);
const matched = matcher.result();
assert.equal(matched.accuracy, 1);
assert.equal(matched.rating, "smooth");
assert.equal(matched.correct, 3);
assert.equal(matched.hits, 4);
assert.equal(matched.medianTimingMs, 20);
assert.equal(matched.medianDurationMs, 20);
assert.deepEqual(matched.errorTags, ["pitch-error"]);

const tapEvents = buildTapEvents({events:[
  {t:0,d:1,midi:[60],gid:"n1"},
  {t:1,d:1,midi:[62],gid:"n2"},
  {t:2,d:1,midi:[64],gid:"n3"},
]});
assert.deepEqual(tapEvents.map((event) => event.midi), [[60], [62], [64]]);
const keyboard = pianoRange(tapEvents);
assert.ok(keyboard.whiteCount >= 8);
assert.ok(keyboard.start <= 60 && keyboard.end >= 64);

const tapMatcher = new TapSightMatcher(tapEvents, 60, 1000, 300);
assert.equal(tapMatcher.tap(60, 1020).correct, true);
assert.equal(tapMatcher.tap(65, 2010).correct, false); // wrong key must not advance
assert.equal(tapMatcher.events[1].status, "pending");
assert.equal(tapMatcher.tap(62, 2020).correct, true);
const tapResult = tapMatcher.result(3400);
assert.equal(tapResult.correct, 2);
assert.equal(tapResult.missed, 1);
assert.equal(tapResult.wrongTaps, 1);
assert.equal(tapResult.accuracy, 2 / 3);
assert.equal(tapResult.medianTimingMs, 20);

console.log("✓ generator, performance matcher, and continuous tap-piano matcher");
