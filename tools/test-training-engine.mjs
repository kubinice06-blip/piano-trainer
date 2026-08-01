import assert from "node:assert/strict";
import { AXES, normaliseVector, stepVector, generatorLevels } from "../js/adaptive.js";
import { generateExercise, GENERATOR_VERSION } from "../js/gen/exercise.js";
import { fingerprintExercise, cfgFromFingerprint } from "../js/fingerprint.js";
import { PerformanceMatcher } from "../js/input/performance.js";

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

console.log("✓ six-axis generator, fingerprint regeneration, and performance matcher");
