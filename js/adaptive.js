/* Six independent difficulty axes shared by reading, masking and KPI data. */

export const AXES = ["pitchRange", "keySignature", "rhythm", "texture", "eyeHand", "tempo"];

/* 節奏軸的階數比別的軸多：音符長短是視奏最需要「一小步一小步」的地方，
   長音直接跳到八分中間少了太多。其餘各軸維持六階。 */
export const AXIS_INFO = {
  pitchRange:  {label:"音高音域", levels:["五指", "八度", "十二度", "加線 1", "加線 2", "加線 3"]},
  keySignature:{label:"調號", levels:["0", "1", "2", "3", "5", "7"]},
  rhythm:      {label:"節奏", levels:["長音", "長音＋四分", "四分", "四分＋八分", "八分",
                                      "附點與切分", "八分＋十六分", "十六分"]},
  /* 織度其實是「左手相對右手的速率」階梯：4:1 → 2:1 → 1:1 → 各走各的。
     合手讀譜的難度主要來自這個比例，不是來自左手彈幾個音。 */
  texture:     {label:"織度", levels:["單手", "雙手長音 4:1", "二分音符 2:1", "雙手塊狀",
                                      "雙手分解", "兩手齊動", "對位"]},
  eyeHand:     {label:"眼手距離", levels:["關閉", "當前拍", "+0.5 拍", "+1 拍", "+2 拍", "+3 拍"]},
  tempo:       {label:"速度", levels:["♩=40", "♩=52", "♩=60", "♩=72", "♩=88", "♩=104"]},
};

export const KEY_ACCIDENTALS = [0, 1, 2, 3, 5, 7];
export const EYE_HAND_BEATS = [null, 0, 0.5, 1, 2, 3];
export const TEMPO_VALUES = [40, 52, 60, 72, 88, 104];
/* 索引即節奏軸的值；每一階對應 rhythm.js 裡的一組窄語彙 */
export const RHYTHM_DENSITIES = [
  "long", "longQuarter", "quarter", "quarterEighth",
  "eighth", "dotted", "eighthSixteenth", "16th"
];

/* 每一級的預設落點。第 3 級刻意停在「右手四分音符＋左手二分音符」——
   那是合手視奏最站得住的起點：左手的落點可預測，眼睛才騰得出餘裕上下一起讀。 */
const PRESETS = [
  {pitchRange:0,keySignature:0,rhythm:0,texture:0,eyeHand:0,tempo:0},
  {pitchRange:1,keySignature:1,rhythm:1,texture:1,eyeHand:0,tempo:1},
  {pitchRange:2,keySignature:2,rhythm:2,texture:2,eyeHand:1,tempo:2},
  {pitchRange:3,keySignature:3,rhythm:3,texture:3,eyeHand:2,tempo:3},
  {pitchRange:4,keySignature:4,rhythm:5,texture:4,eyeHand:3,tempo:4},
  {pitchRange:5,keySignature:5,rhythm:7,texture:6,eyeHand:4,tempo:5},
];

export function axisMax(axis){
  return (AXIS_INFO[axis]?.levels?.length || 6) - 1;
}

function clamp(value, axis){
  return Math.max(0, Math.min(axis ? axisMax(axis) : 5, Math.round(Number(value) || 0)));
}

export function presetVector(level = 1){
  return {...PRESETS[Math.max(0, Math.min(5, Number(level) - 1))]};
}

export function normaliseVector(value, fallbackLevel = 1){
  const base = presetVector(fallbackLevel);
  for (const axis of AXES) if (value?.[axis] != null) base[axis] = clamp(value[axis], axis);
  return base;
}

export function stepVector(value, axis, direction){
  const next = normaliseVector(value);
  if (!AXES.includes(axis)) return next;
  next[axis] = clamp(next[axis] + (direction === "down" ? -1 : 1), axis);
  return next;
}

export function axisValueLabel(axis, level){
  return AXIS_INFO[axis]?.levels?.[clamp(level, axis)] || "—";
}

export function vectorSummary(value){
  const vector = normaliseVector(value);
  return AXES.map((axis) => ({axis, label:AXIS_INFO[axis].label, value:axisValueLabel(axis, vector[axis])}));
}

export function emptyAxisStats(){
  return Object.fromEntries(AXES.map((axis) => [axis, {rated:0,smooth:0,stumble:0,collapse:0}]));
}

export function normaliseAxisStats(raw){
  const stats = emptyAxisStats();
  for (const axis of AXES){
    const item = raw?.[axis] || {};
    stats[axis] = {
      rated:Math.max(0, Number(item.rated) || 0),
      smooth:Math.max(0, Number(item.smooth) || 0),
      stumble:Math.max(0, Number(item.stumble) || 0),
      collapse:Math.max(0, Number(item.collapse) || 0),
    };
  }
  return stats;
}

/* Raise the strongest eligible axis. With little evidence, rotate so a single
   axis cannot monopolise the staircase. Collapse lowers the current target. */
export function chooseAxis(statsRaw, vectorRaw, direction, currentAxis, cursor = 0){
  const stats = normaliseAxisStats(statsRaw);
  const vector = normaliseVector(vectorRaw);
  if (direction === "down" && AXES.includes(currentAxis) && vector[currentAxis] > 0) return currentAxis;

  const eligible = AXES.filter((axis) => direction === "down" ? vector[axis] > 0 : vector[axis] < axisMax(axis));
  if (!eligible.length) return null;
  const withEvidence = eligible.filter((axis) => stats[axis].rated >= 2);
  if (withEvidence.length){
    return withEvidence.sort((a, b) => {
      const rateA = stats[a].smooth / stats[a].rated;
      const rateB = stats[b].smooth / stats[b].rated;
      return direction === "down" ? rateA - rateB : rateB - rateA;
    })[0];
  }
  for (let i = 0; i < AXES.length; i++){
    const axis = AXES[(cursor + i) % AXES.length];
    if (eligible.includes(axis)) return axis;
  }
  return eligible[0];
}

export function generatorLevels(vectorRaw){
  const vector = normaliseVector(vectorRaw);
  return {
    rangeLevel:vector.pitchRange + 1,
    keyLevel:vector.keySignature + 1,
    // 節奏有 8 階，但和聲密度與伴奏只認 1..6 —— 換算回去再交給它們
    rhythmLevel:Math.max(1, Math.round((vector.rhythm + 1) * 6 / RHYTHM_DENSITIES.length)),
    textureLevel:vector.texture + 1,
    bpm:TEMPO_VALUES[vector.tempo],
    maskLead:EYE_HAND_BEATS[vector.eyeHand],
    density:RHYTHM_DENSITIES[vector.rhythm],
  };
}
