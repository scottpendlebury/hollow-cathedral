/**
 * Smoke test for The Hollow Cathedral UI layer.
 * Stubs a minimal DOM + localStorage, then exercises Settings.js.
 */
/**
 * ui-test.mjs — exercises src/ui/Settings.js against a stubbed DOM.
 *
 * Covers the settings and progress round-trips, corrupt-JSON handling, a
 * disabled localStorage, a throwing localStorage, and the time formatting.
 */

import assert from 'node:assert/strict';

const SRC = new URL('../src/ui/Settings.js', import.meta.url).href;

/* ---------------- minimal DOM stub ---------------- */
function makeNode(tag = 'div') {
  const node = {
    tagName: String(tag).toUpperCase(),
    className: '',
    style: {},
    children: [],
    textContent: '',
    _attrs: {},
    appendChild(child) { this.children.push(child); return child; },
    removeChild(child) { this.children = this.children.filter((c) => c !== child); },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); },
    removeEventListener() {},
    querySelectorAll() { return []; },
    querySelector() { return null; },
    _listeners: {},
  };
  return node;
}

const fakeDocument = {
  createElement: (tag) => makeNode(tag),
  createTextNode: (t) => ({ textContent: t }),
  body: makeNode('body'),
  documentElement: makeNode('html'),
  addEventListener() {},
  removeEventListener() {},
  querySelectorAll: () => [],
  querySelector: () => null,
};

globalThis.document = fakeDocument;
globalThis.window = {
  addEventListener() {}, removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 16),
  cancelAnimationFrame: (id) => clearTimeout(id),
  innerWidth: 1280, innerHeight: 720,
};

/* ---------------- localStorage stub ---------------- */
const store = new Map();
const fakeLocalStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
  key: (i) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; },
};
globalThis.localStorage = fakeLocalStorage;

/* ---------------- run assertions ---------------- */
const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(`PASS  ${name}`);
  } catch (err) {
    results.push(`FAIL  ${name} :: ${err.message}`);
    process.exitCode = 1;
  }
}

const mod = await import(SRC);
const {
  SETTINGS_KEY, PROGRESS_KEY, DEFAULT_SETTINGS,
  loadSettings, saveSettings, loadProgress, saveProgress, formatTime, clearProgress,
} = mod;

/* exports present */
check('exports the documented API', () => {
  for (const key of ['SETTINGS_KEY', 'PROGRESS_KEY', 'DEFAULT_SETTINGS', 'loadSettings',
    'saveSettings', 'loadProgress', 'saveProgress', 'formatTime', 'clearProgress']) {
    assert.ok(key in mod, `missing export ${key}`);
  }
  assert.equal(SETTINGS_KEY, 'hollow-cathedral:settings');
  assert.equal(PROGRESS_KEY, 'hollow-cathedral:progress');
  assert.deepEqual(DEFAULT_SETTINGS, {
    masterVolume: 0.8, musicVolume: 0.45, sfxVolume: 0.8, muted: false,
    mouseSensitivity: 1.0, touchSensitivity: 1.0, invertY: false, quality: 'auto', fov: 75,
  });
});

/* formatTime */
check('formatTime(65000) === "1:05"', () => assert.equal(formatTime(65000), '1:05'));
check('formatTime(0) === "--"', () => assert.equal(formatTime(0), '--'));
check('formatTime(null) === "--"', () => assert.equal(formatTime(null), '--'));
check('formatTime(undefined) === "--"', () => assert.equal(formatTime(undefined), '--'));
// spec: "--" only for 0/null. A sub-second duration is still a duration.
check('formatTime(999) === "0:00"', () => assert.equal(formatTime(999), '0:00'));
check('formatTime(-5000) === "--"', () => assert.equal(formatTime(-5000), '--'));
check('formatTime(1000) === "0:01"', () => assert.equal(formatTime(1000), '0:01'));
check('formatTime(61000) === "1:01"', () => assert.equal(formatTime(61000), '1:01'));
check('formatTime(3600000) === "60:00"', () => assert.equal(formatTime(3600000), '60:00'));
check('formatTime(65432) === "1:05" (truncates)', () => assert.equal(formatTime(65432), '1:05'));

/* loadSettings on empty storage */
check('loadSettings() returns defaults when storage is empty', () => {
  assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
});

/* save + load round trip */
check('saveSettings persists and loadSettings reads it back', () => {
  const saved = saveSettings({ masterVolume: 0.25, quality: 'high', invertY: true, fov: 90 });
  assert.equal(saved.masterVolume, 0.25);
  assert.ok(store.has(SETTINGS_KEY), 'nothing written to storage');
  const loaded = loadSettings();
  assert.equal(loaded.masterVolume, 0.25);
  assert.equal(loaded.quality, 'high');
  assert.equal(loaded.invertY, true);
  assert.equal(loaded.fov, 90);
  assert.equal(loaded.musicVolume, DEFAULT_SETTINGS.musicVolume, 'unspecified key should fall back to default');
});

check('saveSettings merges over defaults', () => {
  const merged = saveSettings({ sfxVolume: 0.1 });
  assert.equal(merged.masterVolume, DEFAULT_SETTINGS.masterVolume);
  assert.equal(merged.sfxVolume, 0.1);
  assert.equal(merged.quality, 'auto');
});

check('loadSettings never throws on corrupt JSON', () => {
  store.set(SETTINGS_KEY, '{not json');
  assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
});

check('loadSettings never throws when storage is disabled', () => {
  const original = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('SecurityError'); } };
  try {
    assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
  } finally {
    globalThis.localStorage = original;
  }
});

check('saveSettings never throws when storage is disabled', () => {
  const original = globalThis.localStorage;
  globalThis.localStorage = { setItem() { throw new Error('QuotaExceededError'); } };
  try {
    assert.doesNotThrow(() => saveSettings({ masterVolume: 0.4 }));
  } finally {
    globalThis.localStorage = original;
  }
});

/* progress */
check('loadProgress() defaults', () => {
  assert.deepEqual(loadProgress(), { bestTimeMs: 0, runs: 0, victories: 0, bestTimeLabel: '--' });
});

check('saveProgress persists and derives the label', () => {
  saveProgress({ bestTimeMs: 65432, runs: 3, victories: 1 });
  const p = loadProgress();
  assert.equal(p.bestTimeMs, 65432);
  assert.equal(p.runs, 3);
  assert.equal(p.victories, 1);
  assert.equal(p.bestTimeLabel, '1:05');
});

check('clearProgress wipes the store', () => {
  clearProgress();
  assert.deepEqual(loadProgress(), { bestTimeMs: 0, runs: 0, victories: 0, bestTimeLabel: '--' });
  assert.ok(!store.has(PROGRESS_KEY));
});

check('progress survives a disabled-storage environment', () => {
  const original = globalThis.localStorage;
  globalThis.localStorage = undefined;
  try {
    assert.doesNotThrow(() => saveProgress({ bestTimeMs: 1000 }));
    assert.deepEqual(loadProgress(), { bestTimeMs: 0, runs: 0, victories: 0, bestTimeLabel: '--' });
  } finally {
    globalThis.localStorage = original;
  }
});

console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
