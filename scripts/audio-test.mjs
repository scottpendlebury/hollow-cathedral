/**
 * audio-test.mjs — exercises src/systems/AudioSystem.js with a stubbed
 * AudioContext.
 *
 * Every public method and every one-shot is exercised; any throw is reported.
 * The fake Web Audio implementation lives in this file, so no browser and no
 * real audio device is needed.
 */

const failures = [];
const results = [];

/* ---------------------------------------------------------------- *
 * Minimal fake Web Audio implementation
 * ---------------------------------------------------------------- */

class FakeParam {
  constructor(v = 0) { this.value = v; this.events = []; }
  setValueAtTime(v, t) { this.value = v; this.events.push(['set', v, t]); return this; }
  linearRampToValueAtTime(v, t) { this.value = v; this.events.push(['lin', v, t]); return this; }
  exponentialRampToValueAtTime(v, t) {
    if (v === 0) throw new Error('exponential ramp to zero');
    this.value = v; this.events.push(['exp', v, t]); return this;
  }
  setTargetAtTime(v, t, c) { this.value = v; this.events.push(['tgt', v, t, c]); return this; }
  cancelScheduledValues(t) { this.events.push(['cancel', t]); return this; }
}

class FakeNode {
  constructor(ctx, kind) {
    this.ctx = ctx; this.kind = kind;
    this.connections = []; this.disconnected = false;
    this.started = false; this.stopped = false; this.onended = null;
  }
  connect(dst) { this.connections.push(dst); return dst; }
  disconnect() { this.disconnected = true; this.connections.length = 0; }
}

class FakeGain extends FakeNode {
  constructor(ctx) { super(ctx, 'gain'); this.gain = new FakeParam(1); }
}
class FakeOsc extends FakeNode {
  constructor(ctx) {
    super(ctx, 'osc');
    this.frequency = new FakeParam(440);
    this.detune = new FakeParam(0);
    this.type = 'sine';
  }
  start(t) {
    if (this.started) throw new Error('double start');
    this.started = true;
    this.ctx.log.push({ kind: 'osc', oscType: this.type, freq: this.frequency.value, detune: this.detune.value, at: t, now: this.ctx.currentTime });
  }
  stop(t) { this.stopped = true; this.ctx.log.push({ kind: 'osc-stop', at: t }); }
}
class FakeBufferSource extends FakeNode {
  constructor(ctx) {
    super(ctx, 'bufsrc');
    this.buffer = null; this.loop = false;
    this.playbackRate = new FakeParam(1);
  }
  start(t, off) {
    if (this.started) throw new Error('double start');
    this.started = true;
    this.ctx.log.push({ kind: 'bufsrc', loop: this.loop, rate: this.playbackRate.value, at: t, off, now: this.ctx.currentTime });
  }
  stop(t) { this.stopped = true; }
}
class FakeBiquad extends FakeNode {
  constructor(ctx) {
    super(ctx, 'biquad');
    this.frequency = new FakeParam(350);
    this.Q = new FakeParam(1);
    this.type = 'lowpass';
  }
}
class FakePanner extends FakeNode {
  constructor(ctx) { super(ctx, 'panner'); this.pan = new FakeParam(0); ctx.panners.push(this); }
}
class FakeConvolver extends FakeNode {
  constructor(ctx) { super(ctx, 'convolver'); this.buffer = null; }
}
class FakeCompressor extends FakeNode {
  constructor(ctx) {
    super(ctx, 'comp');
    for (const p of ['threshold', 'knee', 'ratio', 'attack', 'release']) this[p] = new FakeParam(0);
  }
}
class FakeDelay extends FakeNode {
  constructor(ctx) { super(ctx, 'delay'); this.delayTime = new FakeParam(0); }
}
class FakeBuffer {
  constructor(channels, length, rate) {
    this.numberOfChannels = channels; this.length = length; this.sampleRate = rate;
    this._data = new Float32Array(length);
  }
  getChannelData() { return this._data; }
}

let ctxCounter = 0;
class FakeAudioContext {
  constructor() {
    this.sampleRate = 48000;
    this.destination = new FakeNode(this, 'dest');
    this.state = 'running';
    this.log = [];
    this.biquads = [];
    this.panners = [];
    this.startTime = Date.now();
    this.id = ++ctxCounter;
  }
  get currentTime() { return (Date.now() - this.startTime) / 1000; }
  createGain() { return new FakeGain(this); }
  createOscillator() { return new FakeOsc(this); }
  createBufferSource() { return new FakeBufferSource(this); }
  createBiquadFilter() { const f = new FakeBiquad(this); this.biquads.push(f); return f; }
  createStereoPanner() { return new FakePanner(this); }
  createConvolver() { return new FakeConvolver(this); }
  createDynamicsCompressor() { return new FakeCompressor(this); }
  createDelay() { return new FakeDelay(this); }
  createBuffer(ch, len, rate) { return new FakeBuffer(ch, len, rate); }
  resume() { this.state = 'running'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}

/* ---------------------------------------------------------------- *
 * Test harness
 * ---------------------------------------------------------------- */

async function step(name, fn) {
  try {
    const r = await fn();
    results.push({ name, ok: true, note: r === undefined ? '' : String(r) });
    return r;
  } catch (err) {
    failures.push({ name, err: err && err.stack ? err.stack : String(err) });
    results.push({ name, ok: false, note: String((err && err.message) || err) });
    return undefined;
  }
}

const ONESHOTS = [
  'crossbowShoot', 'crossbowReload', 'crossbowReloadEnd',
  'handcannonShoot', 'handcannonReload', 'handcannonReloadEnd',
  'soulwickCast', 'soulwickCharge',
  'meleeSwing', 'meleeHit',
  'impactFlesh', 'impactStone', 'impactMetal',
  'enemyHurt', 'enemyGrowl', 'enemyScream', 'enemyDeath',
  'archerShoot', 'knightAttack',
  'playerHurt', 'playerDeath',
  'pickupHealth', 'pickupAmmo', 'pickupItem',
  'doorOpen', 'brazierLight', 'gateOpen',
  'objectiveChime', 'menuMove', 'menuSelect', 'uiClick',
  'victoryStinger', 'bossRoar', 'bossStep',
];

// Install the stub before importing so the module picks it up.
globalThis.AudioContext = FakeAudioContext;
globalThis.window = {
  AudioContext: FakeAudioContext,
  webkitAudioContext: FakeAudioContext,
};

const mod = await import('/home/scott/hollow-cathedral/src/systems/AudioSystem.js');
const { AudioSystem } = mod;

console.log('--- export shape ---');
console.log('default export:', typeof mod.default);
console.log('named export AudioSystem:', typeof AudioSystem);
console.log('is class:', typeof AudioSystem === 'function');
console.log('static ONE_SHOT_NAMES length:', AudioSystem.ONE_SHOT_NAMES.length);
console.log('');

/* ---- Phase 1: every method safe before init() ---- */
console.log('--- phase 1: pre-init safety (no AudioContext created yet) ---');
const pre = new AudioSystem();
await step('pre.init()', () => `isReady=${pre.isReady()}`);
await step('pre.resume()', () => pre.resume());
await step('pre.setMasterVolume(0.5)', () => pre.setMasterVolume(0.5));
await step('pre.setMusicVolume(0.5)', () => pre.setMusicVolume(0.5));
await step('pre.setSfxVolume(0.5)', () => pre.setSfxVolume(0.5));
await step('pre.setMuted(true)', () => pre.setMuted(true));
await step('pre.getMuted()', () => `muted=${pre.getMuted()}`);
await step('pre.play(crossbowShoot)', () => `played=${pre.play('crossbowShoot')}`);
await step('pre.startAmbient(cathedral)', () => pre.startAmbient('cathedral'));
await step('pre.stopAmbient()', () => pre.stopAmbient());
await step('pre.startMusic(explore)', () => pre.startMusic('explore'));
await step('pre.stopMusic()', () => pre.stopMusic());
await step('pre.setMusicIntensity(0.5)', () => pre.setMusicIntensity(0.5));
await step('pre.stopAll()', () => pre.stopAll());
await step('pre.dispose()', () => pre.dispose());
console.log(`pre-init failures: ${failures.length}`);
console.log('');

/* ---- Phase 2: init and idempotency ---- */
console.log('--- phase 2: init ---');
const sys = new AudioSystem();
const ctxBefore = ctxCounter;
await step('init()', () => `ready=${sys.init()}`);
console.log('AudioContext instances created:', ctxCounter - ctxBefore);
await step('init() again (idempotent)', () => {
  const before = ctxCounter;
  const r = sys.init();
  return `ready=${r} newContexts=${ctxCounter - before}`;
});
await step('isReady()', () => `isReady=${sys.isReady()}`);
await step('resume()', () => `state=${sys.ctx.state}`);
await step('graph wired: master->compressor->destination', () => {
  const comp = sys._compressor;
  const master = sys._master;
  if (!comp.connections.includes(sys.ctx.destination)) throw new Error('compressor not connected to destination');
  if (!master.connections.includes(comp)) throw new Error('master not connected to compressor');
  return 'wired';
});
await step('reverb IR generated procedurally', () => {
  const conv = sys._reverbIn; // graph built lazily; inspect the convolver buffer
  if (!sys._reverbIn) throw new Error('no reverb input');
  // walk the graph to the convolver
  let found = null;
  const walk = (n, depth) => {
    if (depth > 6 || !n) return;
    for (const c of n.connections) {
      if (c.kind === 'convolver') { found = c; return; }
      walk(c, depth + 1);
    }
  };
  walk(sys._reverbIn, 0);
  if (!found || !found.buffer) throw new Error('no impulse response');
  const len = found.buffer.length;
  if (len < 1000) throw new Error('impulse response too short: ' + len);
  return `irChannels=${found.buffer.numberOfChannels} irSamples=${len}`;
});
await step('shared 2s white-noise buffer created', () => {
  if (!sys._noiseBuffer) throw new Error('no noise buffer');
  const expected = Math.floor(sys.ctx.sampleRate * 2);
  if (sys._noiseBuffer.length !== expected) throw new Error(`noise buffer length ${sys._noiseBuffer.length} != ${expected}`);
  const d = sys._noiseBuffer.getChannelData(0);
  let nonZero = 0;
  for (let i = 0; i < d.length; i += 97) if (d[i] !== 0) nonZero++;
  if (nonZero === 0) throw new Error('noise buffer is silent');
  return `samples=${sys._noiseBuffer.length} nonZeroSamples=${nonZero}`;
});
console.log('');

/* ---- Phase 3: every one-shot ---- */
console.log('--- phase 3: one-shots ---');
const signatures = new Map();
for (const name of ONESHOTS) {
  await step(`play(${name})`, () => {
    const logBefore = sys.ctx.log.length;
    const bqBefore = sys.ctx.biquads.length;
    const ok = sys.play(name);
    const slice = sys.ctx.log.slice(logBefore);
    const filters = sys.ctx.biquads.slice(bqBefore)
      .map((f) => `${f.type}:${Math.round(f.frequency.value)}:q${f.Q.value.toFixed(1)}`);
    const sig = JSON.stringify([
      slice.filter((e) => e.kind === 'osc').map((e) => `osc:${e.oscType}:${Math.round(e.freq)}:${Math.round(e.detune)}`),
      slice.filter((e) => e.kind === 'bufsrc').map((e) => `noise:${e.loop}:${e.rate.toFixed(2)}`),
      filters,
    ]);
    if (!signatures.has(name)) signatures.set(name, sig);
    if (slice.length === 0) throw new Error('no audio nodes scheduled');
    return `ok=${ok} nodes=${slice.length} filters=${filters.length}`;
  });
}
console.log(`one-shot failures so far: ${failures.length}`);

/* ---- phase 3b: distinctness ---- */
const sigValues = Array.from(signatures.values());
const unique = new Set(sigValues).size;
console.log(`distinct one-shot signatures: ${unique}/${signatures.size}`);
if (unique !== signatures.size) {
  const seen = new Map();
  for (const [name, sig] of signatures) {
    if (seen.has(sig)) failures.push({ name: 'one-shot distinctness', err: `${name} is identical to ${seen.get(sig)}` });
    else seen.set(sig, name);
  }
}

/* ---- phase 3c: opts ---- */
console.log('');
console.log('--- phase 3c: play() options ---');
await step('play with volume/rate/detune/pan', () => {
  const ok = sys.play('handcannonShoot', { volume: 0.5, rate: 1.4, detune: 120, pan: -0.8 });
  if (!ok) throw new Error('play returned false');
  return 'ok';
});
await step('play with pan creates a StereoPannerNode wired to the sfx bus', () => {
  const before = sys.ctx.panners.length;
  sys.play('handcannonShoot', { pan: -0.8 });
  if (sys.ctx.panners.length <= before) throw new Error('no StereoPannerNode created');
  const p = sys.ctx.panners[sys.ctx.panners.length - 1];
  if (Math.abs(p.pan.value + 0.8) > 1e-6) throw new Error('pan value not applied: ' + p.pan.value);
  if (!p.connections.includes(sys._sfxBus)) throw new Error('panner not connected to sfx bus');
  return `pan=${p.pan.value} connectedToSfxBus=true`;
});
await step('play unknown name returns false', () => {
  const ok = sys.play('notARealSound');
  if (ok !== false) throw new Error('expected false for unknown name');
  return 'ok=false';
});
await step('play with no opts', () => sys.play('uiClick'));
console.log('');

/* ---- Phase 4: volume / mute ---- */
console.log('--- phase 4: mixing ---');
await step('setMasterVolume(0.75)', () => sys.setMasterVolume(0.75));
await step('setMusicVolume(0.4)', () => sys.setMusicVolume(0.4));
await step('setSfxVolume(0.6)', () => sys.setSfxVolume(0.6));
await step('setMasterVolume(5) clamps to 1', () => {
  sys.setMasterVolume(5);
  if (sys._masterVolume !== 1) throw new Error('clamp failed: ' + sys._masterVolume);
  return 'clamped=1';
});
await step('setMuted(true)', () => {
  sys.setMuted(true);
  if (sys.getMuted() !== true) throw new Error('mute failed');
  return `muted=${sys.getMuted()} masterGain=${sys._master.gain.value}`;
});
await step('setMuted(false)', () => {
  sys.setMuted(false);
  if (sys.getMuted() !== false) throw new Error('unmute failed');
  return `muted=${sys.getMuted()}`;
});
console.log('');

/* ---- Phase 5: ambient ---- */
console.log('--- phase 5: ambient ---');
for (const preset of ['cathedral', 'crypt', 'boss']) {
  await step(`startAmbient(${preset})`, () => {
    const r = sys.startAmbient(preset);
    if (!r) throw new Error('startAmbient returned false');
    if (!sys._ambient) throw new Error('no ambient record');
    return `sources=${sys._ambient.sources.length} nodes=${sys._ambient.nodes.length}`;
  });
}
await step('startAmbient(none)', () => {
  const r = sys.startAmbient('none');
  if (sys._ambient) throw new Error('ambient still running');
  return `returned=${r} ambient=${sys._ambient}`;
});
await step('ambient node count stable across restarts (no per-frame alloc)', () => {
  sys.startAmbient('cathedral');
  const a = sys._ambient.nodes.length;
  const b0 = sys.ctx.log.length;
  return new Promise((resolve) => setTimeout(() => {
    const grew = sys.ctx.log.length - b0;
    sys.startAmbient('cathedral');
    const b = sys._ambient.nodes.length;
    if (a !== b) { failures.push({ name: 'ambient stability', err: `node count grew: ${a} -> ${b}` }); resolve(`unstable ${a}->${b}`); return; }
    resolve(`stable=${a} newNodesIn400ms=${grew}`);
  }, 400));
});
await step('stopAmbient()', () => {
  sys.stopAmbient();
  if (sys._ambient) throw new Error('ambient still referenced');
  return 'stopped';
});
console.log('');

/* ---- Phase 6: music ---- */
console.log('--- phase 6: music ---');
for (const mode of ['explore', 'combat', 'boss', 'victory']) {
  await step(`startMusic(${mode})`, () => {
    const r = sys.startMusic(mode);
    if (!r) throw new Error('startMusic returned false');
    if (!sys._music) throw new Error('no music record');
    if (!sys._musicTimer) throw new Error('no scheduler timer');
    return `sources=${sys._music.sources.length} stepDur=${sys._music.cfg.stepDur.toFixed(3)}s bpm=${sys._music.cfg.bpm}`;
  });
}
await step('music scheduler advances (wait 400ms)', async () => {
  const before = sys._music.step;
  await new Promise((r) => setTimeout(r, 400));
  const m = sys._music;
  if (!m) throw new Error('music vanished');
  if (m.step === before) throw new Error('scheduler did not advance');
  return `steps ${before} -> ${m.step}`;
});
await step('scheduler keeps a bounded ~200ms lookahead', () => {
  const m = sys._music;
  if (!m) throw new Error('no music');
  // Measured against the last tick, the next unscheduled step must sit just
  // past the 200ms horizon and never further than one step beyond it.
  const ahead = m.nextTime - m.lastTick;
  const minAhead = 0.2 - 1e-6;
  const maxAhead = 0.2 + m.cfg.stepDur + 1e-6;
  if (ahead < minAhead) throw new Error(`lookahead too short: ${ahead.toFixed(3)} < ${minAhead.toFixed(3)}`);
  if (ahead > maxAhead) throw new Error(`lookahead too long: ${ahead.toFixed(3)} > ${maxAhead.toFixed(3)}`);
  return `lookahead=${ahead.toFixed(3)}s stepDur=${m.cfg.stepDur.toFixed(3)}s`;
});
await step('scheduled notes are never in the past', async () => {
  const before = sys.ctx.log.length;
  await new Promise((r) => setTimeout(r, 900));
  const sched = sys.ctx.log.slice(before).filter((e) => e.kind === 'osc' || e.kind === 'bufsrc');
  if (!sched.length) throw new Error('scheduler produced no notes');
  // `now` is the clock at the moment the note was scheduled: a note is late
  // only if it was scheduled behind the clock it was scheduled against.
  const late = sched.filter((e) => e.at < e.now - 1e-6);
  if (late.length) {
    const worst = Math.min(...late.map((e) => e.at - e.now));
    throw new Error(`${late.length} notes scheduled in the past (worst ${worst.toFixed(4)}s)`);
  }
  const lead = Math.min(...sched.map((e) => e.at - e.now));
  return `${sched.length} notes scheduled, min lead=${lead.toFixed(3)}s`;
});
await step('music keeps its step counter across ticks', async () => {
  const m = sys._music;
  if (!m) throw new Error('no music');
  const before = m.step;
  await new Promise((r) => setTimeout(r, 300));
  if (sys._music !== m) throw new Error('music record was replaced');
  if (m.step <= before) throw new Error(`step counter stalled at ${m.step}`);
  return `step ${before} -> ${m.step}`;
});
await step('setMusicIntensity(0.8)', () => {
  sys.setMusicIntensity(0.8);
  if (Math.abs(sys._musicIntensity - 0.8) > 1e-9) throw new Error('intensity not stored');
  return `intensity=${sys._musicIntensity}`;
});
await step('stopMusic()', () => {
  sys.stopMusic();
  if (sys._music) throw new Error('music still referenced');
  if (sys._musicTimer) throw new Error('timer still pending');
  return 'stopped';
});
await step('setMusicIntensity(0) on stopped music is safe', () => {
  sys.setMusicIntensity(0.2);
  return 'ok';
});
await step('startMusic(none)', () => {
  const r = sys.startMusic('none');
  if (sys._music) throw new Error('music still running');
  return `returned=${r}`;
});
await step('victory music self-terminates', async () => {
  sys.startMusic('victory');
  const m = sys._music;
  const limit = m.cfg.length + 1.5;
  const started = Date.now();
  while (sys._music && Date.now() - started < limit * 1000) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (sys._music) { sys.stopMusic(); throw new Error('victory music did not stop itself'); }
  return `stopped after ~${((Date.now() - started) / 1000).toFixed(1)}s`;
});
console.log('');

/* ---- Phase 7: stopAll / dispose ---- */
console.log('--- phase 7: stopAll + dispose ---');
await step('stopAll()', () => {
  sys.startAmbient('crypt');
  sys.startMusic('combat');
  sys.play('bossRoar');
  sys.stopAll();
  if (sys._ambient) throw new Error('ambient survived stopAll');
  if (sys._music) throw new Error('music survived stopAll');
  if (sys._voices.size !== 0) throw new Error('voices survived stopAll: ' + sys._voices.size);
  return 'all clear';
});
await step('dispose()', () => {
  sys.dispose();
  if (sys.isReady()) throw new Error('still ready after dispose');
  if (sys.ctx !== null) throw new Error('ctx not nulled');
  return `isReady=${sys.isReady()} ctx=${sys.ctx}`;
});
await step('post-dispose calls are safe', () => {
  sys.play('crossbowShoot');
  sys.startAmbient('cathedral');
  sys.startMusic('explore');
  sys.stopAll();
  sys.resume();
  sys.setMasterVolume(0.5);
  return 'no throw';
});
await step('re-init after dispose works', () => {
  const s2 = new AudioSystem();
  s2.init();
  s2.play('uiClick');
  s2.dispose();
  return 'ok';
});
console.log('');

/* ---- Phase 8: no AudioContext at all ---- */
console.log('--- phase 8: graceful degradation without Web Audio ---');
const savedCtx = globalThis.AudioContext;
const savedWindow = globalThis.window;
delete globalThis.AudioContext;
delete globalThis.window;
await step('init() with no AudioContext', () => {
  const s3 = new AudioSystem();
  const r = s3.init();
  if (s3.isReady()) throw new Error('should not be ready');
  if (r !== false) throw new Error('init should return false');
  s3.play('crossbowShoot');
  s3.startAmbient('crypt');
  s3.startMusic('boss');
  s3.stopAll();
  s3.dispose();
  return 'no-op as expected';
});
globalThis.AudioContext = savedCtx;
globalThis.window = savedWindow;
console.log('');

/* ---- Report ---- */
console.log('=== RESULTS ===');
const okCount = results.filter((r) => r.ok).length;
console.log(`checks run: ${results.length}, passed: ${okCount}, failed: ${failures.length}`);
if (failures.length) {
  console.log('--- failures ---');
  for (const f of failures) console.log(`FAIL ${f.name}: ${f.err}`);
  process.exitCode = 1;
} else {
  console.log('ALL CHECKS PASSED - zero exceptions');
}
console.log('');
console.log('--- one-shot node graph summary ---');
for (const [name, sig] of signatures) {
  const [oscs, noises, filters] = JSON.parse(sig);
  console.log(`  ${name.padEnd(20)} ${[...oscs, ...noises, ...filters].join('  ')}`);
}
