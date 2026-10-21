/**
 * Heads-up display for The Hollow Cathedral.
 *
 * All DOM is built once inside the given root (#ui-root). Nothing is
 * created per frame: update() only mutates text / width / opacity of
 * nodes that already exist.
 */

import { formatTime } from './Settings.js';

const KIND_LABELS = {
  bolts: 'BOLTS',
  powder: 'POWDER',
  souls: 'SOULS',
};

const CROSSHAIR_STATES = ['idle', 'hostile', 'reload', 'interact'];

const DAMAGE_DECAY = 1.7;        // intensity units per second
const DAMAGE_MAX = 0.85;         // peak opacity of the red vignette
const HITMARKER_TIME = 0.32;
const HITMARKER_CRIT_TIME = 0.48;

function el(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (parent) parent.appendChild(node);
  return node;
}

function num(value, fallback = 0) {
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

export class HUD {
  constructor(root) {
    /** @type {HTMLElement} */
    this.root = root || (typeof document !== 'undefined' ? document.body : null);
    this.onRestart = null;
    this.onMenu = null;

    this._visible = true;
    this._overlay = null;          // 'death' | 'victory' | null
    this._damage = 0;
    this._damageShown = -1;
    this._hitTime = 0;
    this._hitCrit = false;
    this._crosshairState = 'idle';
    this._health = { cur: 100, max: 100 };

    this._build();
  }

  /* ---------------------------------------------------------------- *
   * construction
   * ---------------------------------------------------------------- */

  _build() {
    const wrap = el('div', 'hc-hud', this.root);
    this.el = wrap;

    el('div', 'hc-hud__vignette', wrap);
    this.damageEl = el('div', 'hc-damage', wrap);
    this.damageEl.setAttribute('aria-hidden', 'true');

    /* crosshair ---------------------------------------------------- */
    const cross = el('div', 'hc-crosshair', wrap);
    cross.setAttribute('aria-hidden', 'true');
    this.crossEl = cross;
    this.ticks = {
      t: el('i', 'hc-cross__tick hc-cross__tick--t', cross),
      r: el('i', 'hc-cross__tick hc-cross__tick--r', cross),
      b: el('i', 'hc-cross__tick hc-cross__tick--b', cross),
      l: el('i', 'hc-cross__tick hc-cross__tick--l', cross),
    };
    this.hitmarkerEl = el('div', 'hc-hitmarker', cross);
    this.hitmarkerEl.setAttribute('aria-hidden', 'true');

    /* objective ---------------------------------------------------- */
    this.objectiveEl = el('div', 'hc-objective', wrap);
    this.objectiveEl.setAttribute('aria-live', 'polite');

    /* interaction prompt ------------------------------------------- */
    this.promptEl = el('div', 'hc-prompt is-hidden', wrap);
    this.promptKeyEl = el('span', 'hc-prompt__key', this.promptEl);
    this.promptTextEl = el('span', 'hc-prompt__text', this.promptEl);

    /* health ------------------------------------------------------- */
    const health = el('div', 'hc-health', wrap);
    const healthHead = el('div', 'hc-health__head', health);
    el('span', 'hc-health__label', healthHead).textContent = 'HEALTH';
    this.healthValueEl = el('span', 'hc-health__value', healthHead);
    const bar = el('div', 'hc-health__bar', health);
    bar.setAttribute('role', 'progressbar');
    this.healthFillEl = el('div', 'hc-health__fill', bar);

    /* weapon / ammo ------------------------------------------------ */
    const weapon = el('div', 'hc-weapon', wrap);
    this.weaponNameEl = el('div', 'hc-weapon__name', weapon);
    const ammoRow = el('div', 'hc-weapon__ammo-row', weapon);
    this.ammoEl = el('span', 'hc-weapon__ammo', ammoRow);
    this.reserveEl = el('span', 'hc-weapon__reserve', ammoRow);
    this.kindEl = el('span', 'hc-weapon__kind', ammoRow);

    /* overlays ------------------------------------------------------ */
    const overlayRoot = el('div', 'hc-overlays', wrap);
    this.deathEl = this._buildOverlay(overlayRoot, 'hc-overlay--death', 'YOU HAVE PERISHED', [
      ['time', 'TIME'], ['kills', 'KILLS'], ['secrets', 'SECRETS'], ['weaponKills', 'WEAPON KILLS'],
    ], 'RETRY', 'MENU');
    this.victoryEl = this._buildOverlay(overlayRoot, 'hc-overlay--victory', 'THE CATHEDRAL IS SILENT', [
      ['time', 'TIME'], ['kills', 'KILLS'], ['secrets', 'SECRETS'],
    ], 'PLAY AGAIN', 'MENU');

    this.setCrosshair('idle');
    this._applyVisibility();
  }

  _buildOverlay(parent, modifier, title, statDefs, primaryLabel, secondaryLabel) {
    const panel = el('div', `hc-overlay ${modifier}`, parent);
    const card = el('div', 'hc-overlay__card', panel);
    el('div', 'hc-overlay__eyebrow', card).textContent = 'THE HOLLOW CATHEDRAL';
    el('h2', 'hc-overlay__title', card).textContent = title;
    el('div', 'hc-overlay__rule', card);

    const stats = el('div', 'hc-overlay__stats', card);
    const values = {};
    for (const [key, label] of statDefs) {
      const row = el('div', 'hc-overlay__stat', stats);
      el('span', 'hc-overlay__stat-label', row).textContent = label;
      values[key] = el('span', 'hc-overlay__stat-value', row);
    }

    const actions = el('div', 'hc-overlay__actions', card);
    const primary = el('button', 'hc-btn hc-btn--primary', actions);
    primary.type = 'button';
    primary.textContent = primaryLabel;
    primary.addEventListener('click', (event) => {
      event.preventDefault();
      if (typeof this.onRestart === 'function') this.onRestart();
    });

    const secondary = el('button', 'hc-btn', actions);
    secondary.type = 'button';
    secondary.textContent = secondaryLabel;
    secondary.addEventListener('click', (event) => {
      event.preventDefault();
      if (typeof this.onMenu === 'function') this.onMenu();
    });

    return { panel, values };
  }

  /* ---------------------------------------------------------------- *
   * readouts
   * ---------------------------------------------------------------- */

  setHealth(cur, max) {
    const maxV = Math.max(1, num(max, 100));
    const curV = Math.min(maxV, Math.max(0, num(cur, 0)));
    this._health = { cur: curV, max: maxV };
    const pct = (curV / maxV) * 100;
    this.healthFillEl.style.width = `${pct.toFixed(1)}%`;
    this.healthValueEl.textContent = `${Math.ceil(curV)} / ${Math.round(maxV)}`;
    this.el.classList.toggle('hc-hud--low', pct <= 30 && curV > 0);
  }

  setWeapon(weapon) {
    const w = weapon && typeof weapon === 'object' ? weapon : {};
    const kind = Object.prototype.hasOwnProperty.call(KIND_LABELS, w.kind) ? w.kind : 'bolts';
    this.weaponNameEl.textContent = String(w.name || 'UNARMED').toUpperCase();

    const ammo = Math.max(0, Math.floor(num(w.ammo, 0)));
    const hasReserve = w.reserve !== null && w.reserve !== undefined && w.reserve !== '';
    const reserve = hasReserve ? Math.max(0, Math.floor(num(w.reserve, 0))) : 0;

    this.ammoEl.textContent = String(ammo);
    this.reserveEl.textContent = hasReserve ? `/ ${reserve}` : '/ --';
    this.kindEl.textContent = KIND_LABELS[kind];
    this.el.classList.toggle('hc-hud--dry', ammo === 0);
  }

  setObjective(text) {
    const value = text === null || text === undefined ? '' : String(text);
    this.objectiveEl.textContent = value;
    this.objectiveEl.classList.toggle('is-hidden', value.length === 0);
  }

  setPrompt(text) {
    const value = text === null || text === undefined ? '' : String(text);
    if (!value.length) {
      this.promptEl.classList.add('is-hidden');
      this.promptTextEl.textContent = '';
      this.promptKeyEl.textContent = '';
      return;
    }
    // "E  Light the ward brazier" -> key cap + label
    const match = /^(\S{1,3})\s+(\S.*)$/.exec(value.trim());
    if (match) {
      this.promptKeyEl.textContent = match[1].toUpperCase();
      this.promptTextEl.textContent = match[2];
      this.promptEl.classList.add('hc-prompt--keyed');
    } else {
      this.promptKeyEl.textContent = '';
      this.promptTextEl.textContent = value.trim();
      this.promptEl.classList.remove('hc-prompt--keyed');
    }
    this.promptEl.classList.remove('is-hidden');
  }

  setCrosshair(state) {
    const next = CROSSHAIR_STATES.indexOf(state) >= 0 ? state : 'idle';
    this._crosshairState = next;
    for (const s of CROSSHAIR_STATES) this.crossEl.classList.remove(`hc-cross--${s}`);
    this.crossEl.classList.add(`hc-cross--${next}`);
  }

  /* ---------------------------------------------------------------- *
   * feedback
   * ---------------------------------------------------------------- */

  flashDamage(amount) {
    const raw = num(amount, 0);
    if (raw <= 0) return;
    // >1 is treated as damage points (50 points == full intensity), <=1 as a fraction
    const fraction = raw > 1 ? Math.min(1, raw / 50) : raw;
    this._damage = Math.max(this._damage, Math.min(DAMAGE_MAX, fraction * DAMAGE_MAX));
  }

  showHitmarker(crit) {
    this._hitCrit = Boolean(crit);
    this._hitTime = this._hitCrit ? HITMARKER_CRIT_TIME : HITMARKER_TIME;
    this.hitmarkerEl.classList.toggle('is-crit', this._hitCrit);
    this.hitmarkerEl.classList.add('is-active');
  }

  /* ---------------------------------------------------------------- *
   * overlays
   * ---------------------------------------------------------------- */

  showDeath(stats) {
    const s = stats && typeof stats === 'object' ? stats : {};
    this.deathEl.values.time.textContent = formatTime(s.timeMs);
    this.deathEl.values.kills.textContent = String(Math.max(0, Math.floor(num(s.kills, 0))));
    this.deathEl.values.secrets.textContent = String(Math.max(0, Math.floor(num(s.secrets, 0))));
    this.deathEl.values.weaponKills.textContent = String(Math.max(0, Math.floor(num(s.weaponKills, 0))));
    this.deathEl.panel.classList.add('is-active');
    this.victoryEl.panel.classList.remove('is-active');
    this._overlay = 'death';
    this._applyVisibility();
  }

  showVictory(stats) {
    const s = stats && typeof stats === 'object' ? stats : {};
    this.victoryEl.values.time.textContent = formatTime(s.timeMs);
    this.victoryEl.values.kills.textContent = String(Math.max(0, Math.floor(num(s.kills, 0))));
    this.victoryEl.values.secrets.textContent = String(Math.max(0, Math.floor(num(s.secrets, 0))));
    this.victoryEl.panel.classList.add('is-active');
    this.deathEl.panel.classList.remove('is-active');
    this._overlay = 'victory';
    this._applyVisibility();
  }

  hideOverlays() {
    this.deathEl.panel.classList.remove('is-active');
    this.victoryEl.panel.classList.remove('is-active');
    this._overlay = null;
    this._applyVisibility();
  }

  setVisible(visible) {
    this._visible = Boolean(visible);
    this._applyVisibility();
  }

  _applyVisibility() {
    const shown = this._visible || this._overlay !== null;
    this.el.classList.toggle('is-hidden', !shown);
  }

  /* ---------------------------------------------------------------- *
   * frame update
   * ---------------------------------------------------------------- */

  update(dt) {
    const step = Math.max(0, num(dt, 0));

    if (this._damage > 0 && step > 0) {
      this._damage = Math.max(0, this._damage - step * DAMAGE_DECAY);
      const shown = Math.round(this._damage * 1000) / 1000;
      if (shown !== this._damageShown) {
        this._damageShown = shown;
        this.damageEl.style.opacity = String(shown);
      }
    }

    if (this._hitTime > 0 && step > 0) {
      this._hitTime = Math.max(0, this._hitTime - step);
      if (this._hitTime === 0) this.hitmarkerEl.classList.remove('is-active');
    }
  }
}

export default HUD;
