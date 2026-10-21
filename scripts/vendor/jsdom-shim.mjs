/**
 * jsdom-shim.mjs — a very small DOM stand-in for the headless smoke test.
 *
 * This is NOT a browser. It implements only the handful of DOM APIs the game
 * modules touch at import time and during the tests: createElement, canvas
 * 2D context, classList, addEventListener, localStorage and matchMedia.
 *
 * Keeping it local avoids adding a dev dependency to the project.
 */

class ClassList {
  constructor(el) {
    this.el = el;
    this.set = new Set();
  }
  add(...names) {
    for (const n of names) this.set.add(n);
  }
  remove(...names) {
    for (const n of names) this.set.delete(n);
  }
  contains(name) {
    return this.set.has(name);
  }
  toggle(name, force) {
    if (force === undefined) {
      if (this.set.has(name)) this.set.delete(name);
      else this.set.add(name);
      return this.set.has(name);
    }
    if (force) this.set.add(name);
    else this.set.delete(name);
    return !!force;
  }
}

class FakeElement {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.style = new Proxy(
      {},
      {
        get(t, k) {
          return t[k] ?? '';
        },
        set(t, k, v) {
          t[k] = v;
          return true;
        },
      }
    );
    this.dataset = {};
    this.classList = new ClassList(this);
    this._listeners = new Map();
    this._html = '';
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.clientWidth = 800;
    this.clientHeight = 600;
    this.offsetWidth = 800;
    this.offsetHeight = 600;
  }

  get className() {
    return [...this.classList.set].join(' ');
  }
  set className(v) {
    this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean));
  }

  get innerHTML() {
    return this._html;
  }
  set innerHTML(v) {
    this._html = String(v);
    this.children = [];
  }

  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    return child;
  }
  append(...nodes) {
    for (const n of nodes) this.appendChild(n);
  }
  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parentNode = null;
    return child;
  }
  remove() {
    this.parentNode?.removeChild(this);
  }
  setAttribute(k, v) {
    this[k] = v;
  }
  getAttribute(k) {
    return this[k];
  }
  removeAttribute(k) {
    delete this[k];
  }
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const list = this._listeners.get(type);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  dispatchEvent(evt) {
    const list = this._listeners.get(evt?.type);
    if (list) for (const fn of list.slice()) fn.call(this, evt);
    return true;
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }
  querySelectorAll() {
    return [];
  }
  getBoundingClientRect() {
    return { x: 0, y: 0, left: 0, top: 0, right: this.clientWidth, bottom: this.clientHeight, width: this.clientWidth, height: this.clientHeight };
  }
  focus() {}
  blur() {}
  click() {
    this.dispatchEvent({ type: 'click', target: this, preventDefault() {}, stopPropagation() {} });
  }
  getContext(type) {
    if (type !== '2d') return null;
    return createFakeContext();
  }
  toDataURL() {
    return 'data:image/png;base64,';
  }
}

/** A 2D context stub good enough for procedural texture generation. */
function createFakeContext() {
  const gradient = { addColorStop() {} };
  const ctx = {
    canvas: { width: 1, height: 1 },
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    globalAlpha: 1,
    font: '10px sans-serif',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => null,
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData() {},
    measureText: (t) => ({ width: (t || '').length * 6 }),
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    setTransform() {},
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    arcTo() {},
    quadraticCurveTo() {},
    bezierCurveTo() {},
    fill() {},
    stroke() {},
    clip() {},
    fillText() {},
    strokeText() {},
    drawImage() {},
    setLineDash() {},
    getLineDash: () => [],
  };
  return ctx;
}

class FakeStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
  key(i) {
    return [...this.map.keys()][i] ?? null;
  }
  get length() {
    return this.map.size;
  }
}

class FakeWindow extends EventTarget {
  constructor() {
    super();
    this.innerWidth = 1280;
    this.innerHeight = 720;
    this.devicePixelRatio = 1;
    this.localStorage = new FakeStorage();
    this.scrollTo = () => {};
    this.open = () => null;
    this.alert = () => {};
    this.addEventListener = super.addEventListener.bind(this);
    this.removeEventListener = super.removeEventListener.bind(this);
  }
  matchMedia(query) {
    return {
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    };
  }
  requestAnimationFrame(cb) {
    return setTimeout(() => cb(Date.now()), 16);
  }
  cancelAnimationFrame(id) {
    clearTimeout(id);
  }
  getComputedStyle() {
    return { getPropertyValue: () => '' };
  }
}

export class JSDOM {
  constructor() {
    this.window = new FakeWindow();
    this.window.document = {
      documentElement: new FakeElement('html'),
      body: new FakeElement('body'),
      head: new FakeElement('head'),
      createElement: (tag) => new FakeElement(tag),
      createElementNS: (ns, tag) => new FakeElement(tag),
      createTextNode: (t) => ({ textContent: t }),
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      removeEventListener() {},
      visibilityState: 'visible',
      hidden: false,
    };
    this.window.document.body.appendChild(new FakeElement('div'));
  }
}

export { FakeElement, FakeStorage, FakeWindow };
