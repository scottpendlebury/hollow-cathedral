/**
 * Title / pause / settings screens for The Hollow Cathedral.
 *
 * All markup is created in JS inside the supplied root (#ui-root).
 * The CSS bundle is imported here (and only here) so Vite emits it.
 */

import './ui.css';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, loadProgress, formatTime } from './Settings.js';

const CONTROLS = [
  ['W A S D', 'Move'],
  ['MOUSE', 'Look'],
  ['LEFT CLICK', 'Fire'],
  ['RIGHT CLICK', 'Aim'],
  ['SHIFT', 'Sprint'],
  ['R', 'Reload'],
  ['E', 'Interact'],
  ['F', 'Lantern'],
  ['ESC', 'Pause'],
];

const SLIDER_KEYS = ['masterVolume', 'musicVolume', 'sfxVolume', 'mouseSensitivity', 'touchSensitivity', 'fov'];
const CHECK_KEYS = ['muted', 'invertY'];

const TOUCH_HINT = 'TOUCH — LEFT THUMB MOVES, RIGHT THUMB LOOKS, ON-SCREEN BUTTONS FIRE.';

function el(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (parent) parent.appendChild(node);
  return node;
}

export class Menus {
  constructor(root, handlers = {}) {
    this.root = root || (typeof document !== 'undefined' ? document.body : null);
    this.handlers = handlers && typeof handlers === 'object' ? handlers : {};
    this.settings = { ...DEFAULT_SETTINGS, ...loadSettings() };

    this._panel = 'none';
    this._returnPanel = 'title';
    this.controls = {};

    this._build();
  }

  /* ---------------------------------------------------------------- *
   * construction
   * ---------------------------------------------------------------- */

  _build() {
    const wrap = el('div', 'hc-menus is-closed', this.root);
    this.el = wrap;

    // The backdrop swallows every click so that tapping "outside" a menu
    // can never leak through to the game canvas and start a run.
    this.backdrop = el('div', 'hc-menu-backdrop', wrap);
    this.backdrop.addEventListener('click', (event) => event.stopPropagation());
    this.backdrop.addEventListener('pointerdown', (event) => event.stopPropagation());

    const stage = el('div', 'hc-menu-stage', wrap);
    stage.addEventListener('click', (event) => event.stopPropagation());

    this._buildTitle(stage);
    this._buildPause(stage);
    this._buildSettings(stage);

    this._setPanel('none');
  }

  _buildTitle(stage) {
    const panel = el('div', 'hc-panel hc-panel--title', stage);
    this.titleEl = panel;

    el('div', 'hc-panel__eyebrow', panel).textContent = 'THREE BELLS, ONE DESCENT';
    const title = el('h1', 'hc-title', panel);
    title.textContent = 'THE HOLLOW CATHEDRAL';
    el('p', 'hc-tagline', panel).textContent =
      'Beneath the nave the bells still toll for no one. Go down. Bring the light back, or feed the dark.';

    this.titleRecordEl = el('div', 'hc-record', panel);

    const actions = el('div', 'hc-menu-actions', panel);
    this.startBtn = this._button(actions, 'hc-btn hc-btn--primary hc-btn--large', 'BEGIN THE DESCENT', () => {
      this._call('onStart');
    });
    this.titleSettingsBtn = this._button(actions, 'hc-btn', 'SETTINGS', () => {
      this.showSettings();
    });

    const controls = el('div', 'hc-controls', panel);
    el('div', 'hc-controls__heading', controls).textContent = 'RITUAL OF CONTROL';
    const list = el('div', 'hc-controls__list', controls);
    for (const [key, action] of CONTROLS) {
      const row = el('div', 'hc-control', list);
      el('span', 'hc-control__key', row).textContent = key;
      el('span', 'hc-control__action', row).textContent = action;
    }
    el('div', 'hc-touch-hint', panel).textContent = TOUCH_HINT;
  }

  _buildPause(stage) {
    const panel = el('div', 'hc-panel hc-panel--pause', stage);
    this.pauseEl = panel;

    el('div', 'hc-panel__eyebrow', panel).textContent = 'THE CATHEDRAL HOLDS ITS BREATH';
    el('h2', 'hc-panel__title', panel).textContent = 'PAUSED';
    el('p', 'hc-tagline hc-tagline--small', panel).textContent =
      'The dark is patient. It will wait as long as you need.';

    const actions = el('div', 'hc-menu-actions', panel);
    this.resumeBtn = this._button(actions, 'hc-btn hc-btn--primary', 'RESUME', () => {
      this._call('onResume');
    });
    this.pauseSettingsBtn = this._button(actions, 'hc-btn', 'SETTINGS', () => {
      this.showSettings();
    });
    this.restartBtn = this._button(actions, 'hc-btn', 'RESTART LEVEL', () => {
      this._call('onRestart');
    });
    this.quitBtn = this._button(actions, 'hc-btn hc-btn--danger', 'ABANDON — RETURN TO TITLE', () => {
      this._call('onQuitToTitle');
      this.showTitle({});
    });
  }

  _buildSettings(stage) {
    const panel = el('div', 'hc-panel hc-panel--settings', stage);
    this.settingsEl = panel;

    el('div', 'hc-panel__eyebrow', panel).textContent = 'THE LEDGER OF THE KEEPER';
    el('h2', 'hc-panel__title', panel).textContent = 'SETTINGS';

    const body = el('div', 'hc-settings', panel);

    /* audio ------------------------------------------------------- */
    const audio = this._section(body, 'AUDIO');
    this.controls.masterVolume = this._slider(audio, 'masterVolume', 'MASTER VOLUME', 0, 1, 0.01,
      (v) => `${Math.round(v * 100)}%`);
    this.controls.musicVolume = this._slider(audio, 'musicVolume', 'MUSIC VOLUME', 0, 1, 0.01,
      (v) => `${Math.round(v * 100)}%`);
    this.controls.sfxVolume = this._slider(audio, 'sfxVolume', 'SFX VOLUME', 0, 1, 0.01,
      (v) => `${Math.round(v * 100)}%`);
    this.controls.muted = this._checkbox(audio, 'muted', 'MUTE ALL AUDIO');

    /* input ------------------------------------------------------- */
    const input = this._section(body, 'INPUT');
    this.controls.mouseSensitivity = this._slider(input, 'mouseSensitivity', 'MOUSE SENSITIVITY', 0.2, 3, 0.05,
      (v) => `${v.toFixed(2)}x`);
    this.controls.touchSensitivity = this._slider(input, 'touchSensitivity', 'TOUCH SENSITIVITY', 0.2, 3, 0.05,
      (v) => `${v.toFixed(2)}x`);
    this.controls.invertY = this._checkbox(input, 'invertY', 'INVERT VERTICAL AXIS');

    /* display ----------------------------------------------------- */
    const display = this._section(body, 'DISPLAY');
    this.controls.fov = this._slider(display, 'fov', 'FIELD OF VIEW', 60, 100, 1, (v) => `${Math.round(v)}`);
    this.controls.quality = this._select(display, 'quality', 'GRAPHICS QUALITY',
      ['auto', 'low', 'medium', 'high']);

    /* system ------------------------------------------------------ */
    const system = this._section(body, 'SYSTEM');
    const fsRow = el('div', 'hc-setting hc-setting--action', system);
    el('span', 'hc-setting__label', fsRow).textContent = 'FULLSCREEN';
    this.fullscreenBtn = this._button(fsRow, 'hc-btn hc-btn--small', 'TOGGLE', () => {
      if (typeof this.handlers.onFullscreen === 'function') {
        this._call('onFullscreen');
      } else {
        this._nativeFullscreen();
      }
    });

    const footer = el('div', 'hc-settings__footer', panel);
    this.backBtn = this._button(footer, 'hc-btn', 'BACK', () => {
      this.hideSettings();
    });
  }

  _section(parent, title) {
    const section = el('section', 'hc-section', parent);
    el('h3', 'hc-section__title', section).textContent = title;
    const list = el('div', 'hc-section__body', section);
    return list;
  }

  _button(parent, className, label, onClick) {
    const button = el('button', className, parent);
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick(event);
    });
    return button;
  }

  _slider(parent, key, label, min, max, step, format) {
    const row = el('div', 'hc-setting', parent);
    const head = el('div', 'hc-setting__head', row);
    const labelEl = el('label', 'hc-setting__label', head);
    labelEl.textContent = label;
    const valueEl = el('span', 'hc-setting__value', head);

    const input = el('input', 'hc-slider', row);
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.setAttribute('aria-label', label);
    const id = `hc-set-${key}`;
    input.id = id;
    labelEl.setAttribute('for', id);

    const fmt = typeof format === 'function' ? format : (v) => String(v);
    const sync = (v) => { valueEl.textContent = fmt(v); };
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      if (!Number.isFinite(v)) return;
      sync(v);
      this._applySetting(key, v);
    });

    return { input, sync };
  }

  _checkbox(parent, key, label) {
    const row = el('label', 'hc-setting hc-setting--check', parent);
    const input = el('input', 'hc-check', row);
    input.type = 'checkbox';
    input.setAttribute('aria-label', label);
    const box = el('span', 'hc-check__box', row);
    el('span', 'hc-setting__label', row).textContent = label;

    input.addEventListener('change', () => {
      const checked = Boolean(input.checked);
      this._applySetting(key, checked);
      if (key === 'muted' && typeof this.handlers.onToggleMute === 'function') {
        this._call('onToggleMute', checked);
      }
    });

    return input;
  }

  _select(parent, key, label, options) {
    const row = el('div', 'hc-setting', parent);
    const head = el('div', 'hc-setting__head', row);
    el('span', 'hc-setting__label', head).textContent = label;

    const select = el('select', 'hc-select', row);
    select.setAttribute('aria-label', label);
    for (const option of options) {
      const node = el('option', '', select);
      node.value = option;
      node.textContent = option.toUpperCase();
    }
    select.addEventListener('change', () => {
      const value = select.value;
      this._applySetting(key, value);
      if (key === 'quality' && typeof this.handlers.onQualityChange === 'function') {
        this._call('onQualityChange', value);
      }
    });

    return select;
  }

  /* ---------------------------------------------------------------- *
   * settings plumbing
   * ---------------------------------------------------------------- */

  _applySetting(key, value) {
    this.settings[key] = value;
    saveSettings(this.settings);
    if (typeof this.handlers.onSettingsChange === 'function') {
      this._call('onSettingsChange', this.settings);
    }
  }

  /** Push the current in-memory settings into the controls. */
  syncSettings(settings) {
    if (settings && typeof settings === 'object') {
      this.settings = { ...DEFAULT_SETTINGS, ...settings };
    }
    const s = this.settings;
    for (const key of SLIDER_KEYS) {
      const control = this.controls[key];
      if (!control) continue;
      control.input.value = String(s[key]);
      control.sync(s[key]);
    }
    for (const key of CHECK_KEYS) {
      const control = this.controls[key];
      if (control) control.checked = Boolean(s[key]);
    }
    if (this.controls.quality) this.controls.quality.value = s.quality;
  }

  getSettings() {
    return this.settings;
  }

  _call(name, ...args) {
    const fn = this.handlers[name];
    if (typeof fn === 'function') {
      try {
        fn(...args);
      } catch (_) {
        /* a broken handler must never break the menu */
      }
    }
  }

  _nativeFullscreen() {
    try {
      const doc = document;
      if (doc.fullscreenElement) {
        if (doc.exitFullscreen) doc.exitFullscreen();
      } else if (doc.documentElement && doc.documentElement.requestFullscreen) {
        doc.documentElement.requestFullscreen();
      }
    } catch (_) {
      /* fullscreen unavailable (iOS Safari) — ignore */
    }
  }

  /* ---------------------------------------------------------------- *
   * panels
   * ---------------------------------------------------------------- */

  showTitle(options = {}) {
    const opts = options && typeof options === 'object' ? options : {};
    const progress = loadProgress();
    const bestTimeMs = Number.isFinite(Number(opts.bestTimeMs))
      ? Number(opts.bestTimeMs)
      : progress.bestTimeMs;
    const hasProgress = opts.hasProgress !== undefined
      ? Boolean(opts.hasProgress)
      : (progress.runs > 0 || progress.victories > 0 || bestTimeMs > 0);

    this.titleRecordEl.textContent = hasProgress
      ? `BEST DESCENT   ${formatTime(bestTimeMs)}`
      : 'NO DESCENT RECORDED';
    this.titleRecordEl.classList.toggle('is-empty', !hasProgress);
    this._setPanel('title');
  }

  showPause() {
    this._setPanel('pause');
  }

  showSettings() {
    if (this._panel !== 'settings') {
      this._returnPanel = this._panel === 'none' ? 'title' : this._panel;
    }
    this.syncSettings(this.settings);
    this._setPanel('settings');
  }

  hideSettings() {
    if (this._panel !== 'settings') return;
    const back = this._returnPanel || 'title';
    this._setPanel(back);
  }

  showAll() {
    this._setPanel('none');
  }

  get isOpen() {
    return this._panel !== 'none';
  }

  get currentPanel() {
    return this._panel;
  }

  _setPanel(name) {
    this._panel = name;
    this.titleEl.classList.toggle('is-active', name === 'title');
    this.pauseEl.classList.toggle('is-active', name === 'pause');
    this.settingsEl.classList.toggle('is-active', name === 'settings');
    const open = name !== 'none';
    this.el.classList.toggle('is-open', open);
    this.el.classList.toggle('is-closed', !open);
  }
}

export default Menus;
