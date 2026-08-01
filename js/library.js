/* Practice history stored on this device.
 *
 * IndexedDB is the primary store. localStorage is kept only as a fallback and
 * as the source of the one-time v1 migration. The public API stays mostly
 * synchronous by keeping an in-memory snapshot and queueing durable writes.
 */

import { AXES, emptyAxisStats, normaliseAxisStats, normaliseVector, chooseAxis, stepVector } from "./adaptive.js";
import { fingerprintKey } from "./fingerprint.js";

const LEGACY_KEY = "putai.library.v1";
const FALLBACK_KEY = "putai.library.v2";
const DB_NAME = "putai.practice";
const DB_VERSION = 1;
const STORE_NAME = "snapshots";
const SNAPSHOT_KEY = "library";
const MAX_ENTRIES = 2000;
const MAX_ATTEMPTS = 20000;
const MAX_DRILLS = 5000;
const MAX_WEEKLY_TESTS = 520;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function uid(prefix = "id") {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isoDate(value, fallback = new Date().toISOString()) {
  const ms = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : fallback;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function hashCfg(cfg) {
  const s = stableStringify(cfg || {});
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function emptyStore(deviceId) {
  return {
    v: 2,
    deviceId: deviceId || uid("device"),
    entries: [],
    attempts: [],
    weaknesses: [],
    drills: [],
    weeklyTests: [],
    adaptive: {
      enabled: true,
      smoothStreak: 0,
      level: null,
      density: null,
      vector: normaliseVector(null, 1),
      axisStats: emptyAxisStats(),
      axisCursor: 0,
      lastAxis: "pitchRange",
    },
    seconds: 0,
    startedAt: new Date().toISOString(),
  };
}

function normaliseEntry(raw = {}) {
  const attemptCount = Math.max(0, Number(raw.attemptCount) || 0);
  const completedCount = Math.min(attemptCount, Math.max(0, Number(raw.completedCount) || 0));
  const at = isoDate(raw.at);
  const updatedAt = isoDate(raw.updatedAt, at);
  return {
    id: String(raw.id || hashCfg(raw.cfg)),
    cfg: clone(raw.cfg || {}),
    key: raw.key || raw.cfg?.key || null,
    keyName: raw.keyName || raw.key || raw.cfg?.key || "—",
    level: raw.level ?? raw.cfg?.level ?? null,
    ts: raw.ts || raw.cfg?.ts || null,
    hands: raw.hands || raw.cfg?.hands || null,
    bars: Math.max(0, Number(raw.bars ?? raw.cfg?.bars) || 0),
    roman: raw.roman || "",
    cadence: raw.cadence || null,
    lh: raw.lh || null,
    at,
    updatedAt,
    presentedCount: Math.max(0, Number(raw.presentedCount) || 0),
    attemptCount,
    completedCount,
    markEvents: Math.max(0, Number(raw.markEvents) || (raw.marked ? 1 : 0)),
    legacyGeneratedCount: Math.max(0, Number(raw.legacyGeneratedCount) || 0),
    marked: !!raw.marked,
    markedAt: raw.marked ? isoDate(raw.markedAt, updatedAt) : null,
  };
}

function normaliseAttempt(raw = {}) {
  const planned = Math.max(0, Number(raw.barsPlanned) || 0);
  const completedBars = Math.max(0, Math.min(planned || Infinity, Number(raw.barsCompleted) || 0));
  return {
    id: String(raw.id || uid("attempt")),
    exerciseId: String(raw.exerciseId || ""),
    generatorVersion: raw.generatorVersion ?? null,
    startedAt: isoDate(raw.startedAt),
    endedAt: raw.endedAt ? isoDate(raw.endedAt) : null,
    completed: !!raw.completed,
    barsPlanned: planned,
    barsCompleted: completedBars,
    bpm: Math.max(0, Number(raw.bpm) || 0),
    mode: raw.mode || "read",
    flow: raw.flow || "manual",
    hands: raw.hands || null,
    key: raw.key || null,
    level: raw.level ?? null,
    density: raw.density || null,
    difficulty: raw.difficulty ? normaliseVector(raw.difficulty) : null,
    targetAxis: AXES.includes(raw.targetAxis) ? raw.targetAxis : null,
    weaknessId: raw.weaknessId || null,
    ts: raw.ts || null,
    rating: raw.rating ?? null,
    errorTags: Array.isArray(raw.errorTags) ? [...new Set(raw.errorTags.map(String))] : [],
    reason: raw.reason || null,
    metrics: raw.metrics && typeof raw.metrics === "object" ? clone(raw.metrics) : null,
    syncState: "local",
  };
}

function normaliseWeakness(raw = {}) {
  const now = new Date().toISOString();
  const fingerprint = clone(raw.fingerprint || {});
  return {
    id:String(raw.id || `weak-${fingerprintKey(fingerprint) || uid("weak")}`),
    fingerprint,
    sourceExerciseId:raw.sourceExerciseId || null,
    capturedAt:isoDate(raw.capturedAt, now),
    updatedAt:isoDate(raw.updatedAt, now),
    dueAt:isoDate(raw.dueAt, now),
    stage:Math.max(0, Math.min(3, Number(raw.stage) || 0)),
    successes:Math.max(0, Number(raw.successes) || 0),
    attempts:Math.max(0, Number(raw.attempts) || 0),
    lastRating:raw.lastRating || null,
    status:raw.status === "graduated" ? "graduated" : "active",
  };
}

function normaliseDrill(raw = {}) {
  return {
    id:String(raw.id || uid("drill")),
    kind:String(raw.kind || "unknown"),
    correct:raw.correct == null ? null : !!raw.correct,
    responseMs:Math.max(0, Number(raw.responseMs) || 0),
    rating:raw.rating || null,
    details:raw.details && typeof raw.details === "object" ? clone(raw.details) : null,
    ts:isoDate(raw.ts),
  };
}

function normaliseWeeklyTest(raw = {}) {
  return {
    id:String(raw.id || uid("week")),
    week:String(raw.week || ""),
    startedAt:isoDate(raw.startedAt),
    endedAt:raw.endedAt ? isoDate(raw.endedAt) : null,
    segments:Math.max(0, Number(raw.segments) || 0),
    completed:Math.max(0, Number(raw.completed) || 0),
    accuracy:raw.accuracy == null ? null : Math.max(0, Math.min(1, Number(raw.accuracy) || 0)),
    medianTimingMs:raw.medianTimingMs == null ? null : Math.max(0, Number(raw.medianTimingMs) || 0),
    smoothRate:raw.smoothRate == null ? null : Math.max(0, Math.min(1, Number(raw.smoothRate) || 0)),
    eyeHandBeats:raw.eyeHandBeats == null ? null : Math.max(0, Number(raw.eyeHandBeats) || 0),
    noteMedianMs:raw.noteMedianMs == null ? null : Math.max(0, Number(raw.noteMedianMs) || 0),
    details:Array.isArray(raw.details) ? clone(raw.details) : [],
  };
}

function migrateV1(raw) {
  const next = emptyStore();
  next.seconds = Math.max(0, Number(raw?.seconds) || 0);
  next.startedAt = isoDate(raw?.startedAt, next.startedAt);
  next.entries = Array.isArray(raw?.entries)
    ? raw.entries.map((entry) => normaliseEntry({
        id: entry.id,
        cfg: entry.cfg,
        key: entry.key,
        keyName: entry.keyName,
        level: entry.level,
        ts: entry.ts,
        hands: entry.hands,
        bars: entry.bars,
        roman: entry.roman,
        cadence: entry.cadence,
        lh: entry.lh,
        at: entry.at,
        updatedAt: entry.at,
        // v1 counted generated cards, not completed practice. Preserve the
        // number for audit/migration but do not turn it into fake attempts.
        legacyGeneratedCount: Math.max(0, Number(entry.count) || 0),
        marked: !!entry.marked,
        markedAt: entry.markedAt,
        markEvents: entry.marked ? 1 : 0,
      }))
    : [];
  return next;
}

function normaliseStore(raw) {
  if (!raw || typeof raw !== "object") return emptyStore();
  if (raw.v === 1) return migrateV1(raw);

  const next = emptyStore(raw.deviceId);
  next.startedAt = isoDate(raw.startedAt, next.startedAt);
  next.seconds = Math.max(0, Number(raw.seconds) || 0);
  next.entries = Array.isArray(raw.entries) ? raw.entries.map(normaliseEntry) : [];
  next.attempts = Array.isArray(raw.attempts) ? raw.attempts.map(normaliseAttempt) : [];
  next.weaknesses = Array.isArray(raw.weaknesses) ? raw.weaknesses.map(normaliseWeakness) : [];
  next.drills = Array.isArray(raw.drills) ? raw.drills.map(normaliseDrill) : [];
  next.weeklyTests = Array.isArray(raw.weeklyTests) ? raw.weeklyTests.map(normaliseWeeklyTest) : [];
  next.adaptive = {
    enabled: raw.adaptive?.enabled !== false,
    smoothStreak: Math.max(0, Number(raw.adaptive?.smoothStreak) || 0),
    level: raw.adaptive?.level == null ? null : Math.max(1, Math.min(6, Number(raw.adaptive.level) || 1)),
    density: raw.adaptive?.density || null,
    vector: normaliseVector(raw.adaptive?.vector, raw.adaptive?.level || 1),
    axisStats: normaliseAxisStats(raw.adaptive?.axisStats),
    axisCursor:Math.max(0, Number(raw.adaptive?.axisCursor) || 0),
    lastAxis:AXES.includes(raw.adaptive?.lastAxis) ? raw.adaptive.lastAxis : "pitchRange",
  };
  return trimStore(next);
}

function trimStore(store) {
  if (store.entries.length > MAX_ENTRIES) {
    const removable = store.entries
      .filter((entry) => !entry.marked)
      .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
    const removeIds = new Set(removable.slice(0, store.entries.length - MAX_ENTRIES).map((entry) => entry.id));
    store.entries = store.entries.filter((entry) => !removeIds.has(entry.id));
  }
  if (store.attempts.length > MAX_ATTEMPTS) {
    store.attempts = store.attempts.slice(-MAX_ATTEMPTS);
  }
  if (store.drills.length > MAX_DRILLS) store.drills = store.drills.slice(-MAX_DRILLS);
  if (store.weeklyTests.length > MAX_WEEKLY_TESTS) store.weeklyTests = store.weeklyTests.slice(-MAX_WEEKLY_TESTS);
  return store;
}

function readLocal(key) {
  try {
    const text = localStorage.getItem(key);
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

let dbPromise = null;

function openDb() {
  if (!globalThis.indexedDB) return Promise.reject(new Error("IndexedDB unavailable"));
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Cannot open IndexedDB"));
    request.onblocked = () => reject(new Error("IndexedDB upgrade blocked"));
  });
  return dbPromise;
}

async function idbRead() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(SNAPSHOT_KEY);
    request.onsuccess = () => resolve(request.result?.data || null);
    request.onerror = () => reject(request.error || new Error("Cannot read IndexedDB"));
  });
}

async function idbWrite(data) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put({ key: SNAPSHOT_KEY, data });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Cannot write IndexedDB"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB write aborted"));
  });
}

function closeOpenAttempts(store) {
  let changed = false;
  for (const attempt of store.attempts) {
    if (!attempt.endedAt) {
      attempt.endedAt = attempt.startedAt;
      attempt.completed = false;
      attempt.reason = attempt.reason || "interrupted";
      changed = true;
    }
  }
  return changed;
}

export const Library = {
  data: emptyStore(),
  loaded: false,
  available: true,
  backend: "memory",
  activeAttemptId: null,
  _saveQueue: Promise.resolve(),

  async load() {
    let raw = null;

    try {
      raw = await idbRead();
      this.backend = "indexeddb";
      this.available = true;
      if (!raw) raw = readLocal(FALLBACK_KEY) || readLocal(LEGACY_KEY);
    } catch {
      raw = readLocal(FALLBACK_KEY) || readLocal(LEGACY_KEY);
      this.backend = raw !== null || writeLocal(FALLBACK_KEY, emptyStore()) ? "localstorage" : "memory";
      this.available = this.backend !== "memory";
    }

    this.data = normaliseStore(raw);
    const repaired = closeOpenAttempts(this.data);
    this.loaded = true;
    this.activeAttemptId = null;

    // Also performs the one-time localStorage -> IndexedDB migration.
    if (raw || repaired) await this.save();
    return this.data;
  },

  save() {
    const snapshot = clone(trimStore(this.data));
    this._saveQueue = this._saveQueue
      .catch(() => {})
      .then(async () => {
        if (this.backend === "indexeddb") {
          try {
            await idbWrite(snapshot);
            return;
          } catch {
            this.backend = "localstorage";
          }
        }
        if (this.backend === "localstorage" && !writeLocal(FALLBACK_KEY, snapshot)) {
          this.backend = "memory";
          this.available = false;
        }
      });
    return this._saveQueue;
  },

  async flush() {
    await this._saveQueue.catch(() => {});
  },

  idOf(cfg) {
    return cfg ? hashCfg(cfg) : null;
  },

  _entry(ex) {
    if (!ex?.usedCfg) return null;
    const id = this.idOf(ex.usedCfg);
    let entry = this.data.entries.find((item) => item.id === id);
    if (!entry) {
      entry = normaliseEntry({
        id,
        cfg: ex.usedCfg,
        key: ex.key?.id,
        keyName: ex.key?.displayName,
        level: ex.cfg?.level,
        ts: ex.ts,
        hands: ex.hands,
        bars: ex.cfg?.bars,
        roman: Array.isArray(ex.roman) ? ex.roman.join(" │ ") : "",
        cadence: ex.cadence,
        lh: ex.lhLabel || null,
        at: new Date().toISOString(),
      });
      this.data.entries.push(entry);
    } else {
      entry.key = entry.key || ex.key?.id || null;
      entry.keyName = entry.keyName === "—" ? (ex.key?.displayName || entry.keyName) : entry.keyName;
      entry.roman = entry.roman || (Array.isArray(ex.roman) ? ex.roman.join(" │ ") : "");
    }
    return entry;
  },

  present(ex) {
    const entry = this._entry(ex);
    if (!entry) return null;
    entry.presentedCount += 1;
    entry.updatedAt = new Date().toISOString();
    this.save();
    return entry;
  },

  // Compatibility alias for older call sites. "log" now records a presented
  // exercise only; it deliberately does not count as completed practice.
  log(ex) {
    return this.present(ex);
  },

  startAttempt(ex, context = {}) {
    if (!ex?.usedCfg) return null;
    if (this.activeAttemptId) this.finishAttempt({ completed: false, reason: "replaced" });

    const entry = this._entry(ex);
    const cfg = ex.usedCfg || {};
    const attempt = normaliseAttempt({
      id: uid("attempt"),
      exerciseId: entry.id,
      generatorVersion: ex.generatorVersion ?? cfg.generatorVersion ?? null,
      startedAt: new Date().toISOString(),
      barsPlanned: context.barsPlanned ?? ex.bars ?? cfg.bars ?? 0,
      bpm: context.bpm,
      mode: context.mode,
      flow: context.flow,
      hands: cfg.hands,
      key: ex.key?.id || cfg.key || null,
      level: cfg.level,
      density: cfg.density,
      difficulty:cfg.difficulty,
      targetAxis:context.targetAxis || this.data.adaptive.lastAxis,
      weaknessId:context.weaknessId || null,
      ts: cfg.ts,
      syncState: "local",
    });

    entry.attemptCount += 1;
    entry.updatedAt = attempt.startedAt;
    this.data.attempts.push(attempt);
    this.activeAttemptId = attempt.id;
    this.save();
    return attempt;
  },

  finishAttempt(result = {}) {
    if (!this.activeAttemptId) return null;
    const attempt = this.data.attempts.find((item) => item.id === this.activeAttemptId);
    this.activeAttemptId = null;
    if (!attempt || attempt.endedAt) return attempt || null;

    const completed = !!result.completed;
    attempt.endedAt = new Date().toISOString();
    attempt.completed = completed;
    attempt.barsCompleted = Math.max(
      0,
      Math.min(attempt.barsPlanned || Infinity, Number(result.barsCompleted) || (completed ? attempt.barsPlanned : 0)),
    );
    attempt.reason = result.reason || (completed ? "completed" : "stopped");
    if (result.rating !== undefined) attempt.rating = result.rating;
    if (result.metrics && typeof result.metrics === "object") attempt.metrics = clone(result.metrics);
    if (Array.isArray(result.errorTags)) {
      attempt.errorTags = [...new Set([...attempt.errorTags, ...result.errorTags.map(String)])];
    }

    const entry = this.data.entries.find((item) => item.id === attempt.exerciseId);
    if (entry) {
      if (completed) entry.completedCount += 1;
      entry.updatedAt = attempt.endedAt;
    }
    this.save();
    return attempt;
  },

  rateAttempt(id, rating) {
    const allowed = new Set(["smooth", "stumble", "collapse"]);
    if (!allowed.has(rating)) return null;
    const attempt = this.data.attempts.find((item) => item.id === id);
    if (!attempt || !attempt.completed) return null;

    const firstRating = !attempt.rating;
    attempt.rating = rating;
    let direction = null;
    let axis = attempt.targetAxis || this.data.adaptive.lastAxis;
    if (firstRating) {
      if (AXES.includes(axis)) {
        const stats = this.data.adaptive.axisStats[axis];
        stats.rated += 1;
        stats[rating] += 1;
        this.data.adaptive.lastAxis = axis;
      }
      if (this.data.adaptive.enabled) {
        if (rating === "smooth") {
          this.data.adaptive.smoothStreak += 1;
          if (this.data.adaptive.smoothStreak >= 2) {
            direction = "up";
            this.data.adaptive.smoothStreak = 0;
          }
        } else {
          this.data.adaptive.smoothStreak = 0;
          if (rating === "collapse") direction = "down";
        }
      } else {
        this.data.adaptive.smoothStreak = 0;
      }

      if (direction) {
        axis = chooseAxis(
          this.data.adaptive.axisStats,
          this.data.adaptive.vector,
          direction,
          axis,
          this.data.adaptive.axisCursor,
        );
        if (axis) {
          this.data.adaptive.vector = stepVector(this.data.adaptive.vector, axis, direction);
          this.data.adaptive.lastAxis = axis;
          if (direction === "up") this.data.adaptive.axisCursor += 1;
        }
      }

      if (attempt.weaknessId) this._rateWeakness(attempt.weaknessId, rating);
    }
    this.save();
    return {attempt, firstRating, direction, axis, vector:clone(this.data.adaptive.vector)};
  },

  _rateWeakness(id, rating) {
    const weakness = this.data.weaknesses.find((item) => item.id === id);
    if (!weakness || weakness.status === "graduated") return null;
    weakness.attempts += 1;
    weakness.lastRating = rating;
    weakness.updatedAt = new Date().toISOString();
    if (rating === "smooth") {
      weakness.successes += 1;
      weakness.stage = Math.min(3, weakness.stage + 1);
      if (weakness.stage >= 3) {
        weakness.status = "graduated";
        weakness.dueAt = weakness.updatedAt;
      } else {
        const delayDays = weakness.stage === 1 ? 3 : 7;
        weakness.dueAt = new Date(Date.now() + delayDays * 86400000).toISOString();
      }
    } else {
      weakness.stage = rating === "collapse" ? 0 : Math.max(0, weakness.stage - 1);
      weakness.dueAt = new Date(Date.now() + 86400000).toISOString();
    }
    return weakness;
  },

  setAdaptive(patch = {}) {
    if (patch.enabled !== undefined) this.data.adaptive.enabled = !!patch.enabled;
    if (patch.level !== undefined) {
      this.data.adaptive.level = Math.max(1, Math.min(6, Number(patch.level) || 1));
    }
    if (patch.density !== undefined) this.data.adaptive.density = patch.density || null;
    if (patch.vector !== undefined) this.data.adaptive.vector = normaliseVector(patch.vector, this.data.adaptive.level || 1);
    if (patch.lastAxis !== undefined && AXES.includes(patch.lastAxis)) this.data.adaptive.lastAxis = patch.lastAxis;
    this.save();
    return this.data.adaptive;
  },

  get(value) {
    const id = typeof value === "string" ? value : (value?.usedCfg ? this.idOf(value.usedCfg) : null);
    if (!id) return null;
    return this.data.entries.find((entry) => entry.id === id) || null;
  },

  toggleMark(value) {
    const entry = this.get(value) || (value?.usedCfg ? this._entry(value) : null);
    if (!entry) return false;
    entry.marked = !entry.marked;
    entry.updatedAt = new Date().toISOString();
    if (entry.marked) {
      entry.markEvents += 1;
      entry.markedAt = new Date().toISOString();
      const active = this.data.attempts.find((attempt) => attempt.id === this.activeAttemptId);
      if (active && !active.errorTags.includes("marked")) active.errorTags.push("marked");
    } else {
      entry.markedAt = null;
    }
    this.save();
    return entry.marked;
  },

  captureWeakness(fingerprint, sourceExerciseId = null) {
    if (!fingerprint) return null;
    const key = fingerprintKey(fingerprint);
    let weakness = this.data.weaknesses.find((item) =>
      item.status === "active" && fingerprintKey(item.fingerprint) === key);
    const now = new Date();
    if (!weakness) {
      weakness = normaliseWeakness({
        id:`weak-${key || uid("weak")}`,
        fingerprint,
        sourceExerciseId,
        capturedAt:now.toISOString(),
        updatedAt:now.toISOString(),
        dueAt:new Date(now.getTime() + 86400000).toISOString(),
      });
      this.data.weaknesses.push(weakness);
    } else {
      weakness.fingerprint = clone(fingerprint);
      weakness.sourceExerciseId = sourceExerciseId || weakness.sourceExerciseId;
      weakness.updatedAt = now.toISOString();
      const tomorrow = now.getTime() + 86400000;
      if (Date.parse(weakness.dueAt) > tomorrow) weakness.dueAt = new Date(tomorrow).toISOString();
    }
    this.save();
    return weakness;
  },

  weakness(id) {
    return this.data.weaknesses.find((item) => item.id === id) || null;
  },

  dueWeaknesses(now = Date.now()) {
    return this.data.weaknesses
      .filter((item) => item.status === "active" && Date.parse(item.dueAt) <= now)
      .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  },

  activeWeaknesses() {
    return this.data.weaknesses
      .filter((item) => item.status === "active")
      .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  },

  recordDrill(kind, result = {}) {
    const drill = normaliseDrill({...result, kind, id:uid("drill"), ts:new Date().toISOString()});
    this.data.drills.push(drill);
    this.save();
    return drill;
  },

  drillStats(kind = null) {
    const drills = kind ? this.data.drills.filter((item) => item.kind === kind) : this.data.drills;
    const answered = drills.filter((item) => item.correct !== null);
    const correct = answered.filter((item) => item.correct).length;
    const response = answered.map((item) => item.responseMs).filter((value) => value > 0).sort((a, b) => a - b);
    return {
      attempts:drills.length,
      accuracy:answered.length ? correct / answered.length : null,
      medianResponseMs:response.length ? response[Math.floor(response.length / 2)] : null,
    };
  },

  notePositionStats() {
    const groups = new Map();
    for (const drill of this.data.drills) {
      if (drill.kind !== "note" || !drill.details?.position) continue;
      const position = String(drill.details.position);
      if (!groups.has(position)) groups.set(position, []);
      groups.get(position).push(drill);
    }
    return [...groups].map(([position, drills]) => {
      const response = drills.map((item) => item.responseMs).filter((value) => value > 0).sort((a, b) => a - b);
      const correct = drills.filter((item) => item.correct).length;
      return {
        position, attempts:drills.length, correct,
        accuracy:drills.length ? correct / drills.length : null,
        medianResponseMs:response.length ? response[Math.floor(response.length / 2)] : null,
      };
    }).sort((a, b) => (b.medianResponseMs || 0) - (a.medianResponseMs || 0)
      || (a.accuracy ?? 1) - (b.accuracy ?? 1));
  },

  recordWeeklyTest(result = {}) {
    const test = normaliseWeeklyTest({...result, id:uid("week")});
    this.data.weeklyTests.push(test);
    this.save();
    return test;
  },

  latestWeeklyTest() {
    return this.data.weeklyTests.slice().sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0] || null;
  },

  weeklyHistory(limit = 12) {
    const byWeek = new Map();
    for (const test of this.data.weeklyTests) {
      const prior = byWeek.get(test.week);
      if (!prior || Date.parse(test.startedAt) > Date.parse(prior.startedAt)) byWeek.set(test.week, test);
    }
    return [...byWeek.values()].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)).slice(-limit);
  },

  marked() {
    return this.data.entries.filter((entry) => entry.marked)
      .sort((a, b) => Date.parse(b.markedAt) - Date.parse(a.markedAt));
  },

  recent(n = 10) {
    return this.data.entries.slice()
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, n);
  },

  addSeconds(seconds) {
    this.data.seconds += Math.max(0, Math.round(Number(seconds) || 0));
    this.save();
  },

  async clear() {
    const deviceId = this.data.deviceId;
    this.data = emptyStore(deviceId);
    this.activeAttemptId = null;
    await this.save();
  },

  stats() {
    const attempts = this.data.attempts;
    const completed = attempts.filter((attempt) => attempt.completed);
    const rated = completed.filter((attempt) => attempt.rating);
    const smooth = rated.filter((attempt) => attempt.rating === "smooth").length;
    const objective = completed.filter((attempt) => Number.isFinite(attempt.metrics?.accuracy));
    const timing = completed.map((attempt) => attempt.metrics?.medianTimingMs ?? attempt.metrics?.timingMedianMs)
      .filter(Number.isFinite).sort((a, b) => a - b);
    const byKey = {};
    const keyNames = new Map(this.data.entries.map((entry) => [entry.key, entry.keyName]));
    const attachedMarks = new Map();

    for (const attempt of attempts) {
      const key = attempt.key;
      if (!key) continue;
      byKey[key] ||= { attempts: 0, completed: 0, marked: 0 };
      byKey[key].attempts += 1;
      if (attempt.completed) byKey[key].completed += 1;
      if (attempt.errorTags.includes("marked")) {
        byKey[key].marked += 1;
        attachedMarks.set(attempt.exerciseId, (attachedMarks.get(attempt.exerciseId) || 0) + 1);
      }
    }

    // Marks made outside an active attempt still remain useful evidence. Add
    // only the portion not already attached to attempts.
    for (const entry of this.data.entries) {
      const key = entry.key || entry.cfg?.key;
      if (!key || !entry.markEvents) continue;
      byKey[key] ||= { attempts: 0, completed: 0, marked: 0 };
      const attached = attachedMarks.get(entry.id) || 0;
      byKey[key].marked += Math.max(0, entry.markEvents - attached);
    }

    const weak = Object.entries(byKey)
      .filter(([, value]) => value.attempts >= 3 && value.marked > 0)
      .map(([key, value]) => ({
        key,
        name: keyNames.get(key) || key,
        attempts: value.attempts,
        completed: value.completed,
        marked: value.marked,
        rate: Math.min(1, value.marked / value.attempts),
      }))
      .sort((a, b) => b.rate - a.rate || b.attempts - a.attempts)
      .slice(0, 5);

    const heatmap = {};
    for (const weakness of this.data.weaknesses.filter((item) => item.status === "active")) {
      const fp = weakness.fingerprint || {};
      for (const [dimension, value] of [
        ["調", fp.keyName || fp.key], ["拍號", fp.ts], ["節奏", fp.density],
        ["技巧", fp.focus], ["織度", fp.texture || fp.hands],
      ]) {
        if (!value) continue;
        const label = `${dimension}：${value}`;
        heatmap[label] = (heatmap[label] || 0) + 1;
      }
    }
    const weaknessHeatmap = Object.entries(heatmap).map(([label, count]) => ({label, count}))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, 12);

    return {
      segments: completed.length,
      attempts: attempts.length,
      ratings: rated.length,
      smoothRate: rated.length ? smooth / rated.length : null,
      objectiveAccuracy:objective.length
        ? objective.reduce((sum, attempt) => sum + attempt.metrics.accuracy, 0) / objective.length : null,
      medianTimingMs:timing.length ? timing[Math.floor(timing.length / 2)] : null,
      minutes: Math.round(this.data.seconds / 60),
      marked: this.marked().length,
      keys: Object.keys(byKey).filter((key) => byKey[key].completed > 0),
      byKey,
      weak,
      weaknessActive:this.activeWeaknesses().length,
      weaknessDue:this.dueWeaknesses().length,
      weaknessHeatmap,
      drills:this.drillStats(),
      notePositions:this.notePositionStats(),
      latestWeekly:this.latestWeeklyTest(),
      weeklyHistory:this.weeklyHistory(),
      adaptive:clone(this.data.adaptive),
      legacyEntries: this.data.entries.filter((entry) => entry.legacyGeneratedCount > 0).length,
    };
  },

  untouched(allKeys) {
    const practiced = new Set(
      this.data.attempts.filter((attempt) => attempt.completed && attempt.key).map((attempt) => attempt.key),
    );
    return allKeys.filter((key) => !practiced.has(key.id));
  },

  backup() {
    return JSON.stringify({
      format: "putai-practice-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      data: clone(this.data),
    }, null, 2);
  },

  async restore(text) {
    let parsed;
    try {
      parsed = typeof text === "string" ? JSON.parse(text) : text;
    } catch {
      throw new Error("這不是有效的 JSON 備份檔。");
    }

    let raw;
    if (parsed?.format === "putai-practice-backup" && parsed.version === 1) raw = parsed.data;
    else if (parsed?.v === 1 || parsed?.v === 2) raw = parsed;
    else throw new Error("無法辨識這個練習紀錄備份檔。");

    this.data = normaliseStore(raw);
    closeOpenAttempts(this.data);
    this.activeAttemptId = null;
    await this.save();
    return this.data;
  },

  async requestPersistence() {
    try {
      if (!navigator.storage?.persist) return false;
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  },
};
