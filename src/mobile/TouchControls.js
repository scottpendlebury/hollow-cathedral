/* =====================================================================
   The Hollow Cathedral — mobile touch controls
   ---------------------------------------------------------------------
   On-screen controls for touch devices: a floating virtual stick for
   movement plus a forged-iron button cluster for actions.
   - Pointer events only; every control tracks its own pointerId so the
     player can hold the stick, drag to look and press FIRE at once.
   - The container is inert (pointer-events: none); only the controls
     capture pointers, so the right-hand look/aim area stays free.
   - Self contained: the co-located stylesheet is the only import.
   ===================================================================== */

import './touch.css';

/** Every action the overlay can report through onButton(action, down). */
export const TOUCH_ACTIONS = Object.freeze([
  'fire', 'alt', 'jump', 'crouch', 'reload', 'interact', 'sprint', 'swap',
]);

/** Short labels painted on the buttons — never colour alone. */
const ACTION_LABEL = Object.freeze({
  fire: 'FIRE', alt: 'ALT', jump: 'JUMP', crouch: 'CROUCH',
  reload: 'RELOAD', interact: 'USE', sprint: 'SPRINT', swap: 'SWAP',
});

const DEFAULTS = Object.freeze({
  // Fraction of the viewport width reserved for movement. Everything to
  // the right of this line belongs to the look/aim area and is left
  // completely alone by the overlay.
  lookSplit: 0.38,
  stickRadius: 56, // thumb travel (px) for a full deflection
  stickMode: 'dynamic', // 'dynamic' (under the thumb) | 'fixed' (bottom-left)
  hintDuration: 7000, // ms before the onboarding panel fades away
  showHintOnStart: true,
});

/** Creates an element with a class and (optionally) text content. */
function makeNode(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.setAttribute('class', className);
  if (text != null) node.textContent = text;
  return node;
}

/** Calls a callback defensively — a throwing callback must not take the
 *  whole overlay down with it. */
function safeCall(fn, ...args) {
  if (typeof fn !== 'function') return;
  try {
    fn(...args);
  } catch (err) {
    /* the game layer owns its own errors */
  }
}

export class TouchControls {
  /**
   * True when the device should be driven by touch.
   *
   * A primary coarse pointer is the reliable signal: it is true on phones and
   * tablets and false on desktops. Touch *capability* alone is not enough,
   * because a touchscreen laptop also reports `ontouchstart` and a non-zero
   * `maxTouchPoints` while being driven by a mouse.
   */
  static isTouchDevice() {
    if (typeof window === 'undefined') return false;
    try {
      if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
      // A fine primary pointer means a mouse or trackpad is in charge.
      if (window.matchMedia && window.matchMedia('(pointer: fine)').matches) return false;
    } catch (err) {
      /* fall through to the capability checks */
    }
    if ('ontouchstart' in window) return true;
    if (typeof navigator !== 'undefined' && (navigator.maxTouchPoints || 0) > 0) return true;
    return false;
  }

  /**
   * @param {HTMLElement} root container the overlay is appended to.
   * @param {object} [opts] onMove(x,y) | onButton(action,down) | onPause()
   */
  constructor(root, opts = {}) {
    const options = opts || {};
    this.opts = Object.assign({}, DEFAULTS, options);
    this.onMove = typeof options.onMove === 'function' ? options.onMove : null;
    this.onButton = typeof options.onButton === 'function' ? options.onButton : null;
    this.onPause = typeof options.onPause === 'function' ? options.onPause : null;

    this.root = root && typeof root.appendChild === 'function' ? root : null;
    /** True when the overlay was actually built for this device. */
    this.supported = !!this.root && TouchControls.isTouchDevice();
    this.enabled = true;
    this.visible = true;
    this.disposed = false;

    this._held = Object.create(null); // action -> true while held
    this._pointerAction = new Map(); // pointerId -> action
    this._buttons = new Map(); // action -> button element
    this._listeners = []; // [target, type, fn, opts] for a clean dispose()
    this._stickId = null;
    this._stickOriginX = 0;
    this._stickOriginY = 0;
    this._stickRadiusPx = this.opts.stickRadius;
    this._moveX = 0;
    this._moveY = 0;
    this._hintTimer = 0;
    this._pauseArmed = null;

    // Inert on desktop: no DOM, no listeners, no side effects.
    if (!this.supported) return;
    this._build();
    this._bind();
    if (this.opts.showHintOnStart) this.showHint();
  }

  /** True when this device supports the touch overlay. */
  isSupported() {
    return this.supported === true;
  }

  // -- DOM construction --

  _build() {
    const el = makeNode('div', 'tc-root');
    el.setAttribute('data-tc-root', '1');
    this._el = el;

    // Floating stick — purely visual, driven by the window listeners.
    const stick = makeNode('div', 'tc-stick');
    stick.appendChild(makeNode('div', 'tc-stick__base'));
    const knob = makeNode('div', 'tc-stick__knob');
    stick.appendChild(knob);
    this._stick = stick;
    this._knob = knob;

    // Resting hint ring in the bottom-left corner.
    const ring = makeNode('div', 'tc-stick-hint');
    ring.appendChild(makeNode('div', 'tc-stick-hint__ring'));
    ring.appendChild(makeNode('div', 'tc-stick-hint__label', 'MOVE'));
    this._hintRing = ring;

    // Action cluster.
    const cluster = makeNode('div', 'tc-cluster');
    cluster.setAttribute('role', 'group');
    cluster.setAttribute('aria-label', 'Actions');
    const order = ['sprint', 'jump', 'reload', 'alt', 'crouch', 'interact', 'swap', 'fire'];
    for (const action of order) cluster.appendChild(this._makeButton(action));

    // Pause plate, top-left corner.
    const pause = makeNode('button', 'tc-btn tc-btn--pause', 'PAUSE');
    pause.setAttribute('type', 'button');
    pause.setAttribute('data-action', 'pause');
    pause.setAttribute('aria-label', 'Pause');
    pause.__tcControl = true;
    this._add(pause, 'pointerdown', (e) => this._onPauseDown(e));
    this._add(pause, 'pointerup', (e) => this._onPauseUp(e));
    this._add(pause, 'pointercancel', () => this._disarmPause());
    this._add(pause, 'pointerleave', () => this._disarmPause());
    this._pauseBtn = pause;

    this._hint = this._buildHint();
    el.appendChild(stick);
    el.appendChild(ring);
    el.appendChild(cluster);
    el.appendChild(pause);
    el.appendChild(this._hint);
    this.root.appendChild(el);
  }

  /** Creates one virtual button. */
  _makeButton(action) {
    const label = ACTION_LABEL[action] || action.toUpperCase();
    const btn = makeNode('button', 'tc-btn tc-btn--' + action, label);
    btn.setAttribute('type', 'button');
    btn.setAttribute('data-action', action);
    btn.setAttribute('aria-label', label);
    btn.__tcControl = true;
    this._add(btn, 'pointerdown', (e) => this._onButtonDown(e, action));
    this._add(btn, 'pointerup', (e) => this._onButtonUp(e, action));
    this._add(btn, 'pointercancel', (e) => this._onButtonUp(e, action));
    this._add(btn, 'pointerleave', (e) => this._onButtonUp(e, action));
    this._buttons.set(action, btn);
    return btn;
  }

  /** Builds the compact onboarding panel. */
  _buildHint() {
    const hint = makeNode('div', 'tc-hint');
    hint.setAttribute('role', 'dialog');
    hint.setAttribute('aria-label', 'Controls');
    hint.appendChild(makeNode('div', 'tc-hint__title', 'The Hollow Cathedral'));
    const list = makeNode('ul', 'tc-hint__list');
    const rows = [
      ['Left stick', 'move'], ['Right side', 'look / aim'],
      ['Buttons', 'fire · reload · use · swap'], ['Pause', 'top-left corner'],
    ];
    for (const [key, desc] of rows) {
      const row = makeNode('li', 'tc-hint__row');
      row.appendChild(makeNode('span', 'tc-hint__key', key));
      row.appendChild(makeNode('span', 'tc-hint__desc', desc));
      list.appendChild(row);
    }
    hint.appendChild(list);
    hint.appendChild(makeNode('div', 'tc-hint__dismiss', 'tap to dismiss'));
    hint.__tcControl = true;
    this._add(hint, 'pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.hideHint();
    });
    return hint;
  }

  _add(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this._listeners.push([target, type, fn, opts]);
  }

  _bind() {
    // Capture phase on window: the stick has to work even though the
    // overlay container itself never receives pointers.
    this._add(window, 'pointerdown', (e) => this._onPointerDown(e), true);
    this._add(window, 'pointermove', (e) => this._onPointerMove(e), true);
    this._add(window, 'pointerup', (e) => this._endPointer(e), true);
    this._add(window, 'pointercancel', (e) => this._endPointer(e), true);
    this._add(window, 'blur', () => this._releaseAll());
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      this._add(document, 'visibilitychange', () => {
        if (document.hidden) this._releaseAll();
      });
    }
    // The controls must never raise native gestures.
    for (const type of ['contextmenu', 'click', 'dblclick', 'dragstart', 'selectstart']) {
      this._add(this._el, type, (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    }
  }

  _onPointerDown(e) {
    if (this.disposed || !this.enabled) return;
    if (this._isMouse(e)) return;
    if (this._isOwnControl(e.target)) return; // buttons own their pointers
    if (this._stickId !== null) return; // one finger drives the stick
    const v = this._viewport();
    if (!v.w) return;
    // Everything right of the split belongs to the look/aim area.
    if (e.clientX > v.w * this.opts.lookSplit) return;
    this._startStick(e);
  }

  _onPointerMove(e) {
    if (this.disposed) return;
    if (this._stickId === null || e.pointerId !== this._stickId) return;
    this._updateStick(e);
  }

  // Safety net: a button can never stay stuck down.
  _endPointer(e) {
    if (this.disposed) return;
    if (e.pointerId === this._stickId) this._endStick();
    const action = this._pointerAction.get(e.pointerId);
    if (action) {
      this._pointerAction.delete(e.pointerId);
      this._setHeld(action, false);
    }
    if (this._pauseArmed === e.pointerId) this._disarmPause();
  }

  _startStick(e) {
    this._stickId = e.pointerId;
    this._stickRadiusPx = this._stickRadius(this._viewport());
    if (this.opts.stickMode === 'fixed') {
      const origin = this._fixedOrigin();
      this._stickOriginX = origin.x;
      this._stickOriginY = origin.y;
    } else {
      // Dynamic: the stick springs up under the thumb.
      this._stickOriginX = e.clientX;
      this._stickOriginY = e.clientY;
    }
    this._showStick(this._stickOriginX, this._stickOriginY);
    this._reportMove(0, 0, true);
  }

  _updateStick(e) {
    const dx = e.clientX - this._stickOriginX;
    const dy = e.clientY - this._stickOriginY;
    const r = this._stickRadiusPx;
    const len = Math.hypot(dx, dy);
    let nx = 0;
    let ny = 0;
    if (len > 0.0001) {
      const scale = Math.min(len, r) / r;
      nx = (dx / len) * scale;
      ny = (dy / len) * scale;
    }
    // The knob saturates before the finger does so the ring keeps its
    // shape, but the direction keeps tracking all the way out.
    const knobMax = r * 0.6;
    this._knob.style.transform =
      'translate(' + (nx * knobMax).toFixed(1) + 'px,' + (ny * knobMax).toFixed(1) + 'px)';
    // Screen y grows downwards, forward is up.
    this._reportMove(nx, -ny);
  }

  _endStick() {
    this._stickId = null;
    if (this._stick) this._stick.classList.remove('is-active');
    if (this._knob) this._knob.style.transform = 'translate(0px,0px)';
    this._reportMove(0, 0, true);
  }

  _showStick(x, y) {
    if (!this._stick) return;
    this._stick.style.left = x + 'px';
    this._stick.style.top = y + 'px';
    this._stick.classList.add('is-active');
  }

  /** Reports a normalised stick vector: x = strafe, y = forward. */
  _reportMove(x, y, force) {
    if (!force && Math.abs(x - this._moveX) < 0.0005 && Math.abs(y - this._moveY) < 0.0005) {
      return;
    }
    this._moveX = x;
    this._moveY = y;
    safeCall(this.onMove, x, y);
  }

  _onButtonDown(e, action) {
    if (this.disposed || !this.enabled) return;
    if (this._pointerAction.has(e.pointerId)) return; // one pointer per button
    e.preventDefault();
    e.stopPropagation();
    const btn = this._buttons.get(action);
    // Pointer capture keeps the button informed even if the thumb slides
    // off the plate; the global pointerup is the backstop.
    this._capture(btn, e.pointerId, true);
    this._pointerAction.set(e.pointerId, action);
    this._setHeld(action, true);
  }

  _onButtonUp(e, action) {
    if (this.disposed) return;
    if (this._pointerAction.get(e.pointerId) !== action) return;
    e.preventDefault();
    this._pointerAction.delete(e.pointerId);
    this._capture(this._buttons.get(action), e.pointerId, false);
    this._setHeld(action, false);
  }

  /** Applies the pressed state and reports the change. */
  _setHeld(action, down) {
    const btn = this._buttons.get(action);
    if (down) {
      if (this._held[action]) return;
      this._held[action] = true;
      if (btn) btn.classList.add('is-pressed');
      if (action === 'fire' && this._el) this._el.classList.add('is-firing');
      safeCall(this.onButton, action, true);
    } else {
      if (!this._held[action]) return;
      this._held[action] = false;
      if (btn) btn.classList.remove('is-pressed');
      if (action === 'fire' && this._el) this._el.classList.remove('is-firing');
      safeCall(this.onButton, action, false);
    }
  }

  /** Releases every held button and reports it as released. */
  _releaseAll() {
    for (const action of Object.keys(this._held)) this._setHeld(action, false);
    this._pointerAction.clear();
    this._disarmPause();
    if (this._stickId !== null) {
      this._stickId = null;
      if (this._stick) this._stick.classList.remove('is-active');
      if (this._knob) this._knob.style.transform = 'translate(0px,0px)';
      this._reportMove(0, 0, true);
    }
  }

  _onPauseDown(e) {
    if (this.disposed || !this.enabled) return;
    e.preventDefault();
    e.stopPropagation();
    this._pauseArmed = e.pointerId;
    if (this._pauseBtn) this._pauseBtn.classList.add('is-pressed');
  }
  _onPauseUp(e) {
    if (this.disposed) return;
    if (this._pauseArmed !== e.pointerId) return;
    e.preventDefault();
    this._disarmPause();
    safeCall(this.onPause);
  }

  _disarmPause() {
    this._pauseArmed = null;
    if (this._pauseBtn) this._pauseBtn.classList.remove('is-pressed');
  }

  /** Enabling/disabling; disabling releases every held button. */
  setEnabled(enabled) {
    const next = !!enabled;
    this.enabled = next;
    if (!next) {
      this._releaseAll();
      this._reportMove(0, 0, true);
    }
    if (this._el) {
      this._el.classList.toggle('is-disabled', !next);
      this._el.setAttribute('data-tc-enabled', next ? 'true' : 'false');
    }
  }

  /** Shows the onboarding panel and restarts the auto-hide timer. */
  showHint() {
    if (!this._hint) return;
    this._hint.classList.remove('is-hidden');
    if (this._hintTimer) {
      clearTimeout(this._hintTimer);
      this._hintTimer = 0;
    }
    const duration = this.opts.hintDuration;
    if (duration > 0) {
      this._hintTimer = setTimeout(() => {
        this._hintTimer = 0;
        this.hideHint();
      }, duration);
    }
  }

  /** Hides the onboarding panel and cancels the auto-hide timer. */
  hideHint() {
    if (this._hintTimer) {
      clearTimeout(this._hintTimer);
      this._hintTimer = 0;
    }
    if (this._hint) this._hint.classList.add('is-hidden');
  }

  /** Shows or hides the whole overlay. */
  setVisible(visible) {
    const next = !!visible;
    this.visible = next;
    if (!next) this._releaseAll();
    if (this._el) {
      this._el.classList.toggle('is-hidden', !next);
      this._el.setAttribute('data-tc-visible', next ? 'true' : 'false');
    }
  }

  /** True while the given action is held down. */
  isDown(action) {
    return !!this._held[action];
  }

  /** Removes every listener and the overlay DOM. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._releaseAll();
    if (this._hintTimer) {
      clearTimeout(this._hintTimer);
      this._hintTimer = 0;
    }
    for (const [target, type, fn, opts] of this._listeners) {
      target.removeEventListener(type, fn, opts);
    }
    this._listeners.length = 0;
    if (this._el) {
      const parent = this._el.parentNode;
      try {
        if (parent && typeof parent.removeChild === 'function') parent.removeChild(this._el);
        else if (typeof this._el.remove === 'function') this._el.remove();
      } catch (err) {
        /* ignore */
      }
    }
    this._buttons.clear();
    for (const key of ['_el', '_stick', '_knob', '_hint', '_hintRing', '_pauseBtn']) {
      this[key] = null;
    }
  }

  _isMouse(e) {
    return e && e.pointerType === 'mouse';
  }

  /** Pointer capture is a nicety, not a requirement — never throw on it. */
  _capture(btn, pointerId, capture) {
    const fn = capture ? btn.setPointerCapture : btn.releasePointerCapture;
    if (typeof fn !== 'function') return;
    try {
      fn.call(btn, pointerId);
    } catch (err) {
      /* ignore */
    }
  }

  /** True when the event target belongs to one of our own controls. */
  _isOwnControl(target) {
    let node = target;
    let guard = 0;
    while (node && guard++ < 32) {
      if (node.__tcControl) return true;
      node = node.parentNode;
    }
    return false;
  }

  _viewport() {
    const w = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 0;
    const h = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 0;
    return { w, h };
  }

  /** Thumb travel for a full deflection, scaled to the viewport. */
  _stickRadius(v) {
    const base = this.opts.stickRadius;
    const shortest = Math.min(v.w || base, v.h || base) || base;
    return Math.max(36, Math.min(base, shortest * 0.24));
  }

  /** Origin of the stick when it is pinned to the resting ring. */
  _fixedOrigin() {
    const ring = this._hintRing;
    if (ring && typeof ring.getBoundingClientRect === 'function') {
      const r = ring.getBoundingClientRect();
      if (r && r.width > 0) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    const v = this._viewport();
    return { x: 92, y: Math.max(92, (v.h || 240) - 92) };
  }
}

export default TouchControls;
