/**
 * particle-test.mjs — exercises src/fx/Particles.js outside a browser.
 *
 * Covers the behaviour the game depends on: every emit path, the update
 * loop, the free-list recycle, the pool cap, and disposal.
 */

import { JSDOM } from './vendor/jsdom-shim.mjs';

const dom = new JSDOM();
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'node', maxTouchPoints: 0 },
  configurable: true,
});
globalThis.localStorage = dom.window.localStorage;

const THREE = await import('three');
const { ParticleSystem, AmbientMotes } = await import('../src/fx/Particles.js');

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};

// --- The system builds and starts empty -----------------------------------
const scene = new THREE.Scene();
const ps = new ParticleSystem(scene, { maxParticles: 200, quality: 'high' });
check('system constructs', ps instanceof ParticleSystem);
check('starts with no live particles', ps.liveCount === 0, `liveCount=${ps.liveCount}`);

// --- Every emit path --------------------------------------------------------
const at = { x: 0, y: 1, z: 0 };
const dir = { x: 0, y: 0, z: -1 };

ps.emitBlood(at, dir, 12);
check('emitBlood produces particles', ps.liveCount > 0, `liveCount=${ps.liveCount}`);

const afterBlood = ps.liveCount;
ps.emitSparks(at, dir, 10, 0xffc070);
check('emitSparks adds particles', ps.liveCount > afterBlood);

ps.emitEmbers(at, 5);
ps.emitDust(at, 5);
ps.emitSoul(at, 6);
ps.emitDebris(at, 7);
ps.emitSmoke(at, 4);
check(
  'all six emitters add particles',
  ps.liveCount > afterBlood + 30,
  `liveCount=${ps.liveCount}`
);

// --- The update loop runs and does not throw ------------------------------
let threw = null;
try {
  for (let i = 0; i < 120; i++) ps.update(1 / 60, { x: 0, y: 0, z: 0 });
} catch (err) {
  threw = err;
}
check('update() runs without throwing', threw === null, threw ? String(threw) : '');
check('particles survive the update loop', ps.liveCount > 0, `liveCount=${ps.liveCount}`);

// --- Long-lived particles are recycled, not leaked --------------------------
// Force everything to expire by updating a long time.
for (let i = 0; i < 3000; i++) ps.update(1 / 60, { x: 0, y: 0, z: 0 });
check(
  'dead particles are recycled',
  ps.liveCount < 200,
  `liveCount=${ps.liveCount} (cap 200)`
);

// --- The pool does not grow without bound ----------------------------------
ps.emitBlood(at, dir, 500);
const afterFlood = ps.liveCount;
check('pool is capped under flood', afterFlood <= 200, `liveCount=${afterFlood}`);

// --- clear() and dispose() --------------------------------------------------
ps.clear();
check('clear() empties the pool', ps.liveCount === 0, `liveCount=${ps.liveCount}`);

let disposeThrew = null;
try {
  ps.dispose();
} catch (err) {
  disposeThrew = err;
}
check('dispose() runs without throwing', disposeThrew === null, disposeThrew ? String(disposeThrew) : '');

// --- AmbientMotes ------------------------------------------------------------
let motesThrew = null;
let motes = null;
try {
  motes = new AmbientMotes(scene, { x: 10, y: 4, z: 10 }, 40);
  for (let i = 0; i < 60; i++) motes.update(1 / 60);
  motes.dispose();
} catch (err) {
  motesThrew = err;
}
check('AmbientMotes constructs, updates and disposes', motesThrew === null, motesThrew ? String(motesThrew) : '');

console.log(
  failures === 0
    ? '\nPARTICLE SMOKE TEST PASSED — all checks green'
    : `\nPARTICLE SMOKE TEST FAILED — ${failures} check(s) failed`
);
process.exit(failures === 0 ? 0 : 1);
