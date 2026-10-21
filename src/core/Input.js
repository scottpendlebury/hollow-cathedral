/**
 * Input.js — unified input abstraction.
 *
 * One class serves desktop (keyboard + mouse + pointer lock) and mobile
 * (virtual stick + touch look area + on-screen buttons). Gameplay code only
 * ever reads the normalised state exposed here, so there is a single code path
 * for both platforms.
 */

const KEY_MAP = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  Space: 'jump',
  ControlLeft: 'crouch',
  ControlRight: 'crouch',
  KeyC: 'crouch',
  KeyR: 'reload',
  KeyE: 'interact',
  KeyF: 'interact',
  KeyQ: 'alt',
  KeyM: 'map',
  Escape: 'pause',
};

export class Input {
  /**
   * @param {HTMLElement} domElement element that receives pointer events
   */
  constructor(domElement) {
    this.dom = domElement;

    /** Continuous analogue axes. */
    this.moveX = 0; // strafe, -1 left .. 1 right
    this.moveY = 0; // forward, -1 back .. 1 forward
    this.lookX = 0; // yaw delta accumulated this frame (radians)
    this.lookY = 0; // pitch delta accumulated this frame (radians)

    /** Held button state. */
    this.held = Object.create(null);

    /** Edge-triggered actions consumed once per frame. */
    this.pressed = Object.create(null);

    this.wheelDelta = 0;
    this.pointerLocked = false;
    this.sensitivity = 1;
    this.touchSensitivity = 1;
    this.invertY = false;
    this.enabled = true;
    this.usingTouch = false;

    this._touchLookId = null;
    this._touchLookX = 0;
    this._touchLookY = 0;
    this._keys = new Set();
    this._listeners = [];
    this._onLockChange = null;

    this._bind();
  }

  // ---------------------------------------------------------------- setup

  _add(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this._listeners.push([target, type, fn, opts]);
  }

  _bind() {
    this._add(window, 'keydown', (e) => {
      const action = KEY_MAP[e.code];
      if (!action) return;
      // Never swallow browser shortcuts the user may need (reload, devtools).
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!this._keys.has(e.code)) {
        this._keys.add(e.code);
        this._press(action);
      }
    });

    this._add(window, 'keyup', (e) => {
      const action = KEY_MAP[e.code];
      this._keys.delete(e.code);
      if (action) this._release(action);
    });

    this._add(window, 'blur', () => {
      this._keys.clear();
      for (const k in this.held) this.held[k] = false;
    });

    // ---- mouse -------------------------------------------------------
    this._add(this.dom, 'mousedown', (e) => {
      if (!this.enabled) return;
      if (e.button === 0) {
        this._press('fire');
        this._dragging = true;
      } else if (e.button === 2) this._press('alt');
      else if (e.button === 1) this._press('map');
    });

    this._add(window, 'mouseup', (e) => {
      if (e.button === 0) this._release('fire');
      else if (e.button === 2) this._release('alt');
      else if (e.button === 1) this._release('map');
      this._dragging = false;
    });

    this._add(this.dom, 'contextmenu', (e) => e.preventDefault());

    this._add(window, 'mousemove', (e) => {
      if (!this.enabled) return;
      if (this.pointerLocked) {
        const mx = e.movementX || 0;
        const my = e.movementY || 0;
        this.lookX += mx * 0.0022 * this.sensitivity;
        this.lookY += my * 0.0022 * this.sensitivity;
        return;
      }
      // Fallback for browsers or contexts where pointer lock is unavailable:
      // dragging with the left button steers the camera.
      if (this._dragging) {
        const mx = e.movementX || 0;
        const my = e.movementY || 0;
        this.lookX += mx * 0.0030 * this.sensitivity;
        this.lookY += my * 0.0030 * this.sensitivity;
      }
    });

    this._add(
      this.dom,
      'wheel',
      (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        this.wheelDelta += Math.sign(e.deltaY);
      },
      { passive: false }
    );

    // ---- pointer lock ------------------------------------------------
    this._add(document, 'pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.dom;
      if (this._onLockChange) this._onLockChange(this.pointerLocked);
    });

    this._add(document, 'pointerlockerror', () => {
      this.pointerLocked = false;
      if (this._onLockChange) this._onLockChange(false);
    });

    // ---- touch look ----------------------------------------------------
    this._add(
      this.dom,
      'pointerdown',
      (e) => {
        if (e.pointerType === 'touch') {
          this.usingTouch = true;
          // A touch on the right half of the screen drives the camera.
          if (this._touchLookId === null && e.clientX > window.innerWidth * 0.38) {
            this._touchLookId = e.pointerId;
            this._touchLookX = e.clientX;
            this._touchLookY = e.clientY;
          }
        }
      },
      { passive: true }
    );

    this._add(
      this.dom,
      'pointermove',
      (e) => {
        if (e.pointerType !== 'touch') return;
        if (e.pointerId !== this._touchLookId || !this.enabled) return;
        const dx = e.clientX - this._touchLookX;
        const dy = e.clientY - this._touchLookY;
        this._touchLookX = e.clientX;
        this._touchLookY = e.clientY;
        this.lookX += dx * 0.0050 * this.touchSensitivity;
        this.lookY += dy * 0.0050 * this.touchSensitivity;
      },
      { passive: true }
    );

    const endTouch = (e) => {
      if (e.pointerId === this._touchLookId) this._touchLookId = null;
    };
    this._add(this.dom, 'pointerup', endTouch, { passive: true });
    this._add(this.dom, 'pointercancel', endTouch, { passive: true });
  }

  /** Registers a callback fired when pointer lock is gained or lost. */
  onLockChange(fn) {
    this._onLockChange = fn;
  }

  // ------------------------------------------------------------- public API

  /** Requests pointer lock. Resolves to true when the lock is engaged. */
  requestPointerLock() {
    if (this.pointerLocked) return Promise.resolve(true);
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
      // Some browsers reject when the request is not directly in a user
      // gesture; resolve false instead of throwing.
      try {
        const p = this.dom.requestPointerLock();
        if (p && typeof p.then === 'function') {
          p.then(() => done(true)).catch(() => done(false));
        } else {
          setTimeout(() => done(this.pointerLocked), 350);
        }
      } catch (err) {
        done(false);
      }
    });
  }

  exitPointerLock() {
    if (document.pointerLockElement) {
      try {
        document.exitPointerLock();
      } catch (err) {
        /* ignore */
      }
    }
  }

  /** True while the action is held down. */
  isDown(action) {
    return !!this.held[action];
  }

  /** True once, on the frame the action began. */
  wasPressed(action) {
    return !!this.pressed[action];
  }

  /** Clears the one-shot flag for an action. */
  consume(action) {
    this.pressed[action] = false;
  }

  _press(action) {
    this.held[action] = true;
    this.pressed[action] = true;
  }

  _release(action) {
    this.held[action] = false;
  }

  /**
   * Called by the touch control layer.
   * @param {number} x strafe axis -1..1
   * @param {number} y forward axis -1..1
   */
  setVirtualMove(x, y) {
    this.moveX = x;
    this.moveY = y;
  }

  /** Called by the touch control layer for a virtual button. */
  setVirtualButton(action, down) {
    if (down) this._press(action);
    else this._release(action);
  }

  /** Feeds an external look delta (e.g. device orientation). */
  addLook(dx, dy) {
    this.lookX += dx;
    this.lookY += dy;
  }

  /**
   * Resolves keyboard movement into the analogue axes, combining with any
   * virtual (touch) stick position.
   */
  update() {
    let kx = 0;
    let ky = 0;
    if (this.enabled) {
      if (this.held.forward) ky += 1;
      if (this.held.back) ky -= 1;
      if (this.held.right) kx += 1;
      if (this.held.left) kx -= 1;
    }
    const len = Math.hypot(kx, ky);
    if (len > 1) {
      kx /= len;
      ky /= len;
    }
    this.moveX += kx;
    this.moveY += ky;
    const mLen = Math.hypot(this.moveX, this.moveY);
    if (mLen > 1) {
      this.moveX /= mLen;
      this.moveY /= mLen;
    }
  }

  /** Clears per-frame accumulators. Call at the end of each frame. */
  endFrame() {
    this.lookX = 0;
    this.lookY = 0;
    this.wheelDelta = 0;
    for (const k in this.pressed) this.pressed[k] = false;
  }

  dispose() {
    for (const [target, type, fn, opts] of this._listeners) {
      target.removeEventListener(type, fn, opts);
    }
    this._listeners.length = 0;
  }
}
