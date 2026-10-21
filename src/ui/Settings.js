/**
 * Settings & progress persistence for The Hollow Cathedral.
 *
 * Everything here is defensive: localStorage can be missing, disabled
 * (private browsing, sandboxed iframes, file:// quirks) or throw on access.
 * No function in this module is allowed to throw.
 */

export const SETTINGS_KEY = 'hollow-cathedral:settings';
export const PROGRESS_KEY = 'hollow-cathedral:progress';

export const DEFAULT_SETTINGS = {
  masterVolume: 0.8,
  musicVolume: 0.45,
  sfxVolume: 0.8,
  muted: false,
  mouseSensitivity: 1.0,
  touchSensitivity: 1.0,
  invertY: false,
  quality: 'auto',
  fov: 75,
};

const QUALITY_VALUES = ['auto', 'low', 'medium', 'high'];

const DEFAULT_PROGRESS = {
  bestTimeMs: 0,
  runs: 0,
  victories: 0,
  bestTimeLabel: '--',
};

/* ------------------------------------------------------------------ *
 * storage helpers
 * ------------------------------------------------------------------ */

function readRaw(key) {
  try {
    const store = globalThis.localStorage;
    if (!store || typeof store.getItem !== 'function') return null;
    const raw = store.getItem(key);
    if (raw === null || raw === undefined || raw === '') return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function writeRaw(key, value) {
  try {
    const store = globalThis.localStorage;
    if (!store || typeof store.setItem !== 'function') return false;
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch (_) {
    return false;
  }
}

function removeRaw(key) {
  try {
    const store = globalThis.localStorage;
    if (!store || typeof store.removeItem !== 'function') return false;
    store.removeItem(key);
    return true;
  } catch (_) {
    return false;
  }
}

function clampNum(value, fallback, min, max) {
  const n = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/* ------------------------------------------------------------------ *
 * settings
 * ------------------------------------------------------------------ */

function sanitizeSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    masterVolume: clampNum(src.masterVolume, DEFAULT_SETTINGS.masterVolume, 0, 1),
    musicVolume: clampNum(src.musicVolume, DEFAULT_SETTINGS.musicVolume, 0, 1),
    sfxVolume: clampNum(src.sfxVolume, DEFAULT_SETTINGS.sfxVolume, 0, 1),
    muted: Boolean(src.muted),
    mouseSensitivity: clampNum(src.mouseSensitivity, DEFAULT_SETTINGS.mouseSensitivity, 0.1, 4),
    touchSensitivity: clampNum(src.touchSensitivity, DEFAULT_SETTINGS.touchSensitivity, 0.1, 4),
    invertY: Boolean(src.invertY),
    quality: QUALITY_VALUES.indexOf(src.quality) >= 0 ? src.quality : DEFAULT_SETTINGS.quality,
    fov: Math.round(clampNum(src.fov, DEFAULT_SETTINGS.fov, 60, 100)),
  };
}

/** Merged settings over the defaults. Never throws. */
export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...sanitizeSettings(readRaw(SETTINGS_KEY)) };
}

/** Merges over the defaults, persists, never throws. Returns what was stored. */
export function saveSettings(s) {
  const merged = { ...DEFAULT_SETTINGS, ...sanitizeSettings(s) };
  writeRaw(SETTINGS_KEY, merged);
  return merged;
}

/* ------------------------------------------------------------------ *
 * progress
 * ------------------------------------------------------------------ */

/** { bestTimeMs, runs, victories, bestTimeLabel }. Never throws. */
export function loadProgress() {
  const src = readRaw(PROGRESS_KEY) || {};
  const bestTimeMs = Math.max(0, Math.floor(clampNum(src.bestTimeMs, 0, 0, 1e12)));
  const storedLabel = typeof src.bestTimeLabel === 'string' ? src.bestTimeLabel : '';
  return {
    bestTimeMs,
    runs: Math.max(0, Math.floor(clampNum(src.runs, 0, 0, 1e9))),
    victories: Math.max(0, Math.floor(clampNum(src.victories, 0, 0, 1e9))),
    bestTimeLabel: bestTimeMs > 0 ? formatTime(bestTimeMs) : (storedLabel || DEFAULT_PROGRESS.bestTimeLabel),
  };
}

/** Merges over the current progress, persists, never throws. */
export function saveProgress(p) {
  const current = loadProgress();
  const src = p && typeof p === 'object' ? p : {};
  const bestTimeMs = Math.max(0, Math.floor(clampNum(src.bestTimeMs, current.bestTimeMs, 0, 1e12)));
  const merged = {
    bestTimeMs,
    runs: Math.max(0, Math.floor(clampNum(src.runs, current.runs, 0, 1e9))),
    victories: Math.max(0, Math.floor(clampNum(src.victories, current.victories, 0, 1e9))),
    bestTimeLabel: bestTimeMs > 0 ? formatTime(bestTimeMs) : DEFAULT_PROGRESS.bestTimeLabel,
  };
  writeRaw(PROGRESS_KEY, merged);
  return merged;
}

/** Wipes the stored run history. Never throws. */
export function clearProgress() {
  return removeRaw(PROGRESS_KEY);
}

/* ------------------------------------------------------------------ *
 * formatting
 * ------------------------------------------------------------------ */

/** "M:SS" for a millisecond duration, "--" for 0 / null / invalid. */
export function formatTime(ms) {
  const n = typeof ms === 'number' ? ms : parseFloat(ms);
  if (!Number.isFinite(n) || n <= 0) return '--';
  const total = Math.floor(n / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
