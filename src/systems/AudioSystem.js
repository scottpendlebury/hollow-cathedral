/**
 * AudioSystem.js — a fully procedural Web Audio engine for "The Hollow Cathedral".
 *
 * Every sound is synthesized at runtime from oscillators, a shared white-noise
 * buffer, biquad filters and a procedurally generated convolution impulse
 * response. No audio files, no network calls, no external dependencies.
 *
 * Every public method is safe to call before {@link AudioSystem#init}; without
 * the Web Audio API the object degrades to a permanent no-op.
 *
 * Signal flow:
 *   one-shots -> sfxBus ---\
 *   ambient   -> ambientBus +-> master -> compressor -> destination
 *   music     -> musicBus --/        \
 *                                      +-> delay -> damping LP -> convolver -> master
 *                              (reverb send)
 */

const MAX_GAIN = 4;

/** Clamp a value into a range. */
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Convert a MIDI note number to a frequency in Hz. */
const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

/** Aeolian (natural minor) scale in semitones. */
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

/*
 * One-shot layer recipes. A recipe is [reverbSend, ...layers], and a layer is
 * a compact tuple: b(wave, f0, f1, dur, peak, opts?) is an oscillator blip
 * (f1 = 0 holds pitch), n(type, f0, f1, dur, peak, opts?) is a filtered noise
 * burst, p(wave, freqs, dur, peak, decay) is an inharmonic partial stack.
 * opts may carry t (offset seconds), q (filter Q), fBack (sweep-back),
 * detune (cents) and attack (seconds).
 */

const b = (wave, f0, f1, dur, peak, opts) => ['b', wave, f0, f1, dur, peak, opts];
const n = (type, f0, f1, dur, peak, opts) => ['n', type, f0, f1, dur, peak, opts];
const p = (wave, freqs, dur, peak, decay) => ['p', wave, freqs, dur, peak, decay];

/** Every one-shot this engine can synthesize. */
const ONE_SHOT_NAMES = Object.freeze([
  'crossbowShoot', 'crossbowReload', 'crossbowReloadEnd', 'handcannonShoot',
  'handcannonReload', 'handcannonReloadEnd', 'soulwickCast', 'soulwickCharge',
  'meleeSwing', 'meleeHit', 'impactFlesh', 'impactStone', 'impactMetal',
  'enemyHurt', 'enemyGrowl', 'enemyScream', 'enemyDeath', 'archerShoot',
  'knightAttack', 'playerHurt', 'playerDeath', 'pickupHealth', 'pickupAmmo',
  'pickupItem', 'doorOpen', 'brazierLight', 'gateOpen', 'objectiveChime',
  'menuMove', 'menuSelect', 'uiClick', 'victoryStinger', 'bossRoar', 'bossStep',
]);

/** The sound library: one recipe per one-shot name. */
const SOUNDS = {
  crossbowShoot: [0.34, n('bandpass', 2400, 700, 0.13, 0.5, { q: 0.9 }), b('sawtooth', 320, 90, 0.18, 0.34), b('sine', 1500, 620, 0.1, 0.2), b('sine', 92, 44, 0.3, 0.5)],  // Crossbow: string snap, wood thwack, low body thud
  crossbowReload: [0.26, n('bandpass', 3400, 0, 0.035, 0.28, { t: 0, q: 2.2 }), b('triangle', 210, 110, 0.09, 0.3, { t: 0 }), n('bandpass', 3400, 0, 0.035, 0.28, { t: 0.135, q: 2.2 }), b('triangle', 210, 110, 0.09, 0.3, { t: 0.135 }), n('bandpass', 3400, 0, 0.035, 0.28, { t: 0.275, q: 2.2 }), b('triangle', 210, 110, 0.09, 0.3, { t: 0.275 }), n('bandpass', 2600, 0, 0.035, 0.4, { t: 0.42, q: 2.2 }), b('triangle', 260, 110, 0.09, 0.44, { t: 0.42 })],  // Crossbow reload: four-stage winding mechanism, the last one seating
  crossbowReloadEnd: [0.3, n('bandpass', 2200, 0, 0.05, 0.45, { q: 1.8 }), b('triangle', 300, 90, 0.22, 0.48), b('sine', 900, 470, 0.25, 0.22), b('sine', 80, 40, 0.3, 0.5)],  // Crossbow reload end: the final click as the string seats
  handcannonShoot: [0.5, b('sine', 110, 38, 0.45, 0.85), b('triangle', 180, 60, 0.25, 0.45), n('lowpass', 5000, 600, 0.35, 0.55, { q: 0.7 }), n('bandpass', 3800, 0, 0.06, 0.5, { q: 1.1 }), b('sine', 2600, 1400, 0.2, 0.1)],  // Hand cannon: deep boom, blast noise, crack and a metal ring
  handcannonReload: [0.3, n('bandpass', 1600, 700, 0.18, 0.28, { q: 1.6 }), n('bandpass', 2800, 0, 0.04, 0.42, { t: 0.2, q: 2.4 }), b('square', 420, 240, 0.06, 0.22, { t: 0.2 }), n('bandpass', 3200, 0, 0.05, 0.46, { t: 0.42, q: 2 }), b('square', 520, 300, 0.08, 0.26, { t: 0.42 }), b('triangle', 900, 380, 0.2, 0.2, { t: 0.6 }), b('sine', 120, 60, 0.16, 0.38, { t: 0.6 })],  // Hand cannon reload: lever pull, two clicks, a spring twang
  handcannonReloadEnd: [0.34, n('bandpass', 2400, 0, 0.07, 0.52, { q: 1.5 }), b('sine', 150, 45, 0.35, 0.72), b('triangle', 700, 220, 0.18, 0.28), b('sine', 2400, 1100, 0.28, 0.12)],  // Hand cannon reload end: the heavy slam of the breech closing
  soulwickCast: [0.55, b('sine', 220, 440, 0.6, 0.32), b('sine', 330, 660, 0.6, 0.2, { detune: 9 }), b('triangle', 147, 294, 0.7, 0.18), n('bandpass', 3000, 8000, 0.6, 0.18, { q: 3 }), b('sine', 60, 30, 0.5, 0.4)],  // Soulwick: occult cast, a rising cluster with a shimmer tail
  soulwickCharge: [0.45, b('sawtooth', 110, 880, 1.1, 0.22), b('sawtooth', 110, 880, 1.1, 0.15, { detune: 16 }), n('bandpass', 400, 6000, 1.1, 0.16, { q: 4 }), b('sine', 55, 110, 1.2, 0.32)],  // Soulwick: charging, a rising shimmer that swells
  meleeSwing: [0.3, n('bandpass', 500, 3200, 0.32, 0.38, { fBack: 600, q: 1.4 }), n('highpass', 2000, 0, 0.2, 0.13, { t: 0.05, q: 0.7 })],  // Melee swing: a fast filtered whoosh
  meleeHit: [0.4, b('sine', 150, 45, 0.35, 0.75), n('bandpass', 1600, 400, 0.14, 0.45, { q: 0.9 }), b('triangle', 620, 300, 0.16, 0.18)],  // Melee hit: heavy impact with a blade ring
  impactFlesh: [0.24, n('lowpass', 1400, 300, 0.13, 0.48, { q: 1.1 }), b('sine', 120, 48, 0.22, 0.58), n('bandpass', 700, 0, 0.07, 0.2, { t: 0.03, q: 1.6 })],  // Flesh impact: wet, short, percussive
  impactStone: [0.32, n('bandpass', 3200, 0, 0.045, 0.42, { fBack: 2200, q: 2.6 }), b('sine', 320, 160, 0.09, 0.28), b('sine', 95, 55, 0.12, 0.26)],  // Stone impact: a dry, sharp click
  impactMetal: [0.45, p('sine', [1420, 2130, 3310, 4680], 0.5, 0.24, 0.8), n('highpass', 3000, 0, 0.05, 0.36, { q: 1 }), b('sine', 110, 60, 0.16, 0.32)],  // Metal impact: inharmonic partials that ring
  enemyHurt: [0.3, b('sawtooth', 190, 95, 0.22, 0.38), n('bandpass', 900, 400, 0.14, 0.22, { q: 1.4 }), b('sine', 85, 45, 0.2, 0.38)],  // Enemy hurt: a short guttural grunt
  enemyGrowl: [0.42, b('sawtooth', 62, 48, 1.1, 0.36), b('square', 58, 44, 1.1, 0.18, { detune: 26 }), n('bandpass', 380, 220, 1.0, 0.16, { q: 2.2 }), b('sine', 40, 30, 1.2, 0.32)],  // Enemy growl: a low, sustained rumbling growl
  enemyScream: [0.5, b('sawtooth', 640, 380, 0.75, 0.32), b('sawtooth', 960, 520, 0.75, 0.16, { detune: 22 }), n('bandpass', 2200, 1200, 0.7, 0.2, { q: 2.4 })],  // Enemy scream: a high, pained shriek
  enemyDeath: [0.55, b('sawtooth', 320, 42, 1.3, 0.36), n('bandpass', 1200, 260, 1.2, 0.22, { q: 1.6 }), b('sine', 70, 26, 1.5, 0.36)],  // Enemy death: a long descending rattle
  archerShoot: [0.3, n('bandpass', 4200, 0, 0.05, 0.32, { q: 2.2 }), b('triangle', 980, 420, 0.16, 0.36), b('sine', 1900, 900, 0.12, 0.16), b('sine', 85, 48, 0.14, 0.28)],  // Skeletal archer: a lighter, higher bowstring twang
  knightAttack: [0.45, b('sine', 120, 50, 0.3, 0.65), n('bandpass', 2600, 1200, 0.09, 0.42, { q: 1.4 }), p('sine', [1100, 1730, 2610], 0.4, 0.2, 0.8), n('lowpass', 900, 300, 0.16, 0.22, { t: 0.08 })],  // Corrupted knight: an armored lunge with clanging plate
  playerHurt: [0.28, b('sine', 150, 60, 0.22, 0.55), b('triangle', 420, 190, 0.16, 0.2), n('bandpass', 1100, 500, 0.1, 0.2, { q: 1.5 })],  // Player hurt: a short percussive grunt
  playerDeath: [0.6, b('sine', 220, 38, 1.4, 0.55), b('sawtooth', 160, 40, 1.2, 0.2), n('lowpass', 1800, 300, 0.5, 0.22)],  // Player death: a long collapse into a low drone
  pickupHealth: [0.4, b('sine', 523.25, 0, 0.3, 0.28), b('sine', 784, 0, 0.4, 0.2), b('sine', 130, 70, 0.16, 0.28)],  // Health pickup: a warm two-note chime with a soft thump
  pickupAmmo: [0.35, b('sine', 2100, 2050, 0.14, 0.18), b('sine', 2650, 2600, 0.12, 0.14, { t: 0.09 }), n('bandpass', 3400, 0, 0.03, 0.18, { q: 2.4 })],  // Ammo pickup: two small metallic clinks
  pickupItem: [0.4, b('sine', 880, 0, 0.35, 0.2), b('sine', 1320, 0, 0.28, 0.12), n('bandpass', 4800, 0, 0.03, 0.14, { q: 2 })],  // Item pickup: a glassy chime
  doorOpen: [0.5, n('bandpass', 500, 180, 1.4, 0.26, { q: 1.2, attack: 0.2 }), b('sine', 70, 42, 1.5, 0.38), b('triangle', 180, 110, 0.9, 0.16), n('lowpass', 800, 200, 0.12, 0.28, { t: 1.2 })],  // Stone door: a slow grinding groan that ends in a slam
  brazierLight: [0.35, n('bandpass', 700, 3000, 0.5, 0.32, { fBack: 900, q: 0.8, attack: 0.05 }), n('highpass', 2200, 0, 0.4, 0.12, { t: 0.1, q: 0.6 })],  // Brazier: a flame whoosh with a short crackle
  gateOpen: [0.6, b('sine', 95, 40, 1.8, 0.55), n('bandpass', 900, 260, 1.6, 0.28, { q: 1.4, attack: 0.25 }), n('bandpass', 3000, 0, 0.05, 0.24, { t: 0.2, q: 3 }), n('bandpass', 3300, 0, 0.05, 0.24, { t: 0.31, q: 3 }), n('bandpass', 3600, 0, 0.05, 0.24, { t: 0.42, q: 3 }), n('bandpass', 3900, 0, 0.05, 0.24, { t: 0.53, q: 3 }), n('bandpass', 4200, 0, 0.05, 0.24, { t: 0.64, q: 3 }), b('sine', 130, 45, 0.5, 0.65, { t: 1.6 })],  // Iron gate: a deep groan, a chain rattle and a boom
  objectiveChime: [0.55, p('sine', [523.25, 1046.5, 1567.98, 2093], 1.6, 0.22, 0.875), n('bandpass', 5200, 0, 0.04, 0.18, { q: 2 })],  // Objective: a struck bell with long decay
  menuMove: [0.2, n('bandpass', 1400, 0, 0.035, 0.15, { q: 1.6 }), b('sine', 320, 220, 0.06, 0.11)],  // Menu move: a soft, low tick
  menuSelect: [0.28, b('triangle', 392, 0, 0.16, 0.18), b('triangle', 587.33, 0, 0.24, 0.16, { t: 0.09 }), n('bandpass', 2200, 0, 0.03, 0.1, { q: 2 })],  // Menu select: a low two-note confirm
  uiClick: [0.12, n('highpass', 2800, 0, 0.02, 0.18, { q: 0.8 })],  // UI click: a dry, tiny tick
  victoryStinger: [0.6, b('sawtooth', 146.83, 0, 1.4, 0.16), b('triangle', 174.61, 0, 1.4, 0.16, { detune: 4, t: 0 }), b('triangle', 220, 0, 1.4, 0.16, { detune: 8, t: 0 }), b('sawtooth', 174.61, 0, 1.4, 0.16, { t: 0.42 }), b('triangle', 220, 0, 1.4, 0.16, { detune: 4, t: 0.42 }), b('triangle', 261.63, 0, 1.4, 0.16, { detune: 8, t: 0.42 }), b('sawtooth', 146.83, 0, 1.4, 0.16, { t: 0.84 }), b('triangle', 185, 0, 1.4, 0.16, { detune: 4, t: 0.84 }), b('triangle', 220, 0, 1.4, 0.16, { detune: 8, t: 0.84 }), b('sine', 146.83, 0, 2.2, 0.28, { t: 1.26 }), n('bandpass', 4200, 0, 0.05, 0.16, { t: 1.26, q: 1.6 })],  // Victory stinger: a short, resolved cadence
  bossRoar: [0.65, b('sawtooth', 78, 44, 1.8, 0.55), b('sawtooth', 82, 46, 1.8, 0.35, { detune: 30 }), b('square', 40, 30, 2.0, 0.28), n('bandpass', 700, 240, 1.6, 0.28, { q: 1.8, attack: 0.2 }), b('sine', 55, 28, 2.0, 0.45)],  // Boss roar: a huge, layered bellow
  bossStep: [0.5, b('sine', 85, 34, 0.4, 0.8), n('lowpass', 1400, 260, 0.16, 0.32), b('sine', 1900, 1800, 0.35, 0.09), b('sine', 2750, 2700, 0.28, 0.06)],  // Boss footstep: an armoured, ground-shaking stomp
};

/** Tuning / voicing for the looping ambient beds. */
const AMBIENT_PRESETS = Object.freeze({
  cathedral: {
    root: 55.0, fifth: 82.41, third: 65.41, cutoff: 320, gain: 0.5, send: 0.55,
    windFreq: 480, windQ: 1.2, windGain: 0.16, lfo: 0.055, fade: 3.2, groan: [11, 22] },
  crypt: {
    root: 43.65, fifth: 65.41, third: 51.91, cutoff: 210, gain: 0.42, send: 0.8,
    windFreq: 300, windQ: 2.6, windGain: 0.1, lfo: 0.04, fade: 3.6, groan: [7, 15] },
  boss: {
    root: 49.0, fifth: 73.42, third: 58.27, cutoff: 430, gain: 0.6, send: 0.4,
    windFreq: 700, windQ: 0.9, windGain: 0.22, lfo: 0.09, fade: 2.4, groan: [6, 12] },
});

/**
 * Musical modes: tempo, chord progression and per-layer levels. The scheduler
 * grid is a 16th note (stepDiv = 4 subdivisions per beat) so the lookahead
 * window stays tight even in the slow modes.
 */
const MUSIC_MODES = Object.freeze({
  explore: {
    bpm: 74, stepDiv: 4, root: 50, chords: [0, 5, 3, 4], stepsPerBar: 16, noteEvery: 2,
    noteStack: 1, degrees: [0, 2, 4], noteDur: 1.1, level: 0.5, pulseEvery: 8, pulseLevel: 0.4,
    wave: 'triangle', cutoff: 1900, droneLevel: 0.5, length: 0 },
  combat: {
    bpm: 104, stepDiv: 4, root: 45, chords: [0, 0, 6, 5], stepsPerBar: 16, noteEvery: 1,
    noteStack: 1, degrees: [0, 2, 4, 6], noteDur: 0.55, level: 0.55, pulseEvery: 4, pulseLevel: 0.8,
    wave: 'sawtooth', cutoff: 2500, droneLevel: 0.55, length: 0 },
  boss: {
    bpm: 128, stepDiv: 4, root: 38, chords: [0, 1, 0, 6], stepsPerBar: 16, noteEvery: 1,
    noteStack: 2, degrees: [0, 2, 4, 6, 1], noteDur: 0.3, level: 0.6, pulseEvery: 4, pulseLevel: 1.0,
    wave: 'sawtooth', cutoff: 3200, droneLevel: 0.6, length: 0 },
  victory: {
    bpm: 68, stepDiv: 4, root: 50, chords: [0, 4, 0, 0], stepsPerBar: 8, noteEvery: 2,
    noteStack: 2, degrees: [0, 2, 4], noteDur: 1.8, level: 0.6, pulseEvery: 8, pulseLevel: 0.25,
    wave: 'triangle', cutoff: 2600, droneLevel: 0.4, length: 7.4 },
});

/**
 * Procedural audio engine for The Hollow Cathedral.
 *
 * The constructor takes no arguments. Call {@link AudioSystem#init} from a
 * user gesture (pointerdown / keydown) so the browser allows playback.
 */
export class AudioSystem {
  /** Every one-shot name understood by {@link AudioSystem#play}. */
  static ONE_SHOT_NAMES = ONE_SHOT_NAMES;

  /** Create an engine. Nothing is allocated until {@link AudioSystem#init}. */
  constructor() {
    /** @type {AudioContext|null} */
    this.ctx = null;
    this._ready = false;
    this._available = true;
    this._muted = false;
    this._masterVolume = 1;
    this._musicVolume = 0.75;
    this._sfxVolume = 1;
    this._musicIntensity = 0.35;
    /** @type {AudioBuffer|null} shared 2 second white noise buffer */
    this._noiseBuffer = null;
    // Master, buses and reverb nodes (null until init()).
    this._master = null;
    this._compressor = null;
    this._sfxBus = null;
    this._musicBus = null;
    this._ambientBus = null;
    this._reverbIn = null;
    this._reverbOut = null;
    /** @type {Set<object>} live one-shot voices, cleaned up on stopAll */
    this._voices = new Set();
    /** @type {Set<any>} pending timers so dispose() can clear them */
    this._timers = new Set();
    this._ambient = null;
    this._music = null;
    this._musicTimer = null;
  }

  // -------------------------------------------------------- lifecycle

  /**
   * Create the AudioContext and build the master graph. Call from a user
   * gesture; safe to call more than once.
   * @returns {boolean} true when the engine is ready.
   */
  init() {
    if (this._ready) return true;
    if (!this._available) return false;
    try {
      const Ctor = this._ctxConstructor();
      if (!Ctor) {
        this._available = false;
        return false;
      }
      if (this.ctx) {
        try { this.ctx.close(); } catch { /* ignore */ }
        this.ctx = null;
      }
      const ctx = new Ctor();
      this.ctx = ctx;
      this._buildGraph(ctx);
      this._ready = true;
      if (ctx.state === 'suspended') this.resume();
      return true;
    } catch (err) {
      console.warn('[AudioSystem] init failed:', err);
      this.ctx = null;
      this._ready = false;
      return false;
    }
  }

  /**
   * Resume a suspended AudioContext (autoplay policy).
   * @returns {boolean} true when the context is running.
   */
  resume() {
    try {
      const ctx = this.ctx;
      if (!ctx) return false;
      if (ctx.state === 'suspended') {
        const p = ctx.resume();
        if (p && typeof p.catch === 'function') p.catch(() => { /* ignore */ });
      }
      return ctx.state !== 'suspended';
    } catch (err) {
      console.warn('[AudioSystem] resume failed:', err);
      return false;
    }
  }

  /**
   * @returns {boolean} true when the audio graph exists and can play sounds.
   */
  isReady() {
    return this._ready && !!this.ctx;
  }

  /** Tear the engine down: stop every voice and close the context. */
  dispose() {
    try { this.stopAll(); } catch { /* ignore */ }
    for (const id of this._timers) clearTimeout(id);
    this._timers.clear();
    if (this._musicTimer) { clearTimeout(this._musicTimer); this._musicTimer = null; }
    this._music = null;
    this._ambient = null;
    if (this.ctx) {
      try { this.ctx.close(); } catch { /* ignore */ }
    }
    this.ctx = null;
    this._ready = false;
    for (const key of ['_noiseBuffer', '_master', '_compressor', '_sfxBus', '_musicBus',
      '_ambientBus', '_reverbIn', '_reverbOut']) {
      this[key] = null;
    }
    this._voices.clear();
  }

  // ----------------------------------------------------------- mixing

  /** Set the master output volume. @param {number} v 0..1 */
  setMasterVolume(v) {
    this._masterVolume = clamp(Number(v) || 0, 0, 1);
    this._applyGain(this._master, this._muted ? 0 : this._masterVolume);
  }

  /** Set the music bus volume. @param {number} v 0..1 */
  setMusicVolume(v) {
    this._musicVolume = clamp(Number(v) || 0, 0, 1);
    this._applyGain(this._musicBus, this._musicVolume);
  }

  /** Set the sound-effect bus volume. @param {number} v 0..1 */
  setSfxVolume(v) {
    this._sfxVolume = clamp(Number(v) || 0, 0, 1);
    this._applyGain(this._sfxBus, this._sfxVolume);
  }

  /** Mute or unmute the whole engine. @param {boolean} muted */
  setMuted(muted) {
    this._muted = !!muted;
    this._applyGain(this._master, this._muted ? 0 : this._masterVolume);
  }

  /** @returns {boolean} true when the engine is muted. */
  getMuted() {
    return this._muted;
  }

  /** Silence every one-shot, the ambient bed and the music. */
  stopAll() {
    try { this.stopAmbient(); } catch { /* ignore */ }
    try { this.stopMusic(); } catch { /* ignore */ }
    for (const v of Array.from(this._voices)) {
      for (const n of v.nodes) {
        if (n && typeof n.stop === 'function') this._stop(n, undefined, true);
      }
      this._endVoice(v);
    }
    this._voices.clear();
  }

  // --------------------------------------------------------- one-shots

  /**
   * Play a one-shot sound by name.
   * @param {string} name One of {@link AudioSystem.ONE_SHOT_NAMES}.
   * @param {{volume?:number, rate?:number, detune?:number, pan?:number}} [opts]
   * @returns {boolean} true when the sound was scheduled.
   */
  play(name, opts = {}) {
    if (!this.isReady()) return false;
    const recipe = SOUNDS[name];
    if (!recipe) return false;
    try {
      const o = {
        volume: clamp(Number(opts.volume ?? 1), 0, MAX_GAIN),
        rate: clamp(Number(opts.rate ?? 1) || 1, 0.1, 4),
        detune: Number(opts.detune ?? 0) || 0,
        pan: clamp(Number(opts.pan ?? 0) || 0, -1, 1),
      };
      const out = this._voice(o, recipe[0]);
      for (let i = 1; i < recipe.length; i++) this._layer(out, recipe[i]);
      return true;
    } catch (err) {
      console.warn(`[AudioSystem] play("${name}") failed:`, err);
      return false;
    }
  }

  // ---------------------------------------------------------- ambient

  /**
   * Start (or cross-fade to) a looping ambient bed.
   * @param {'cathedral'|'crypt'|'boss'|'none'} preset
   * @returns {boolean} true when a bed is playing.
   */
  startAmbient(preset) {
    if (!this.isReady()) return false;
    const key = String(preset || 'none').toLowerCase();
    this.stopAmbient();
    if (key === 'none' || !key) return false;
    const cfg = AMBIENT_PRESETS[key] || AMBIENT_PRESETS.cathedral;
    try {
      const ctx = this.ctx;
      const t0 = ctx.currentTime;
      const { osc, gain, filt, nodes, sources } = this._factories(t0);
      const out = gain(0);
      out.gain.setValueAtTime(0.0001, t0);
      out.gain.exponentialRampToValueAtTime(cfg.gain, t0 + cfg.fade);
      out.connect(this._ambientBus);
      const send = gain(cfg.send);
      out.connect(send);
      send.connect(this._reverbIn);
      // Damping low-pass shaping the whole bed.
      const filter = filt('lowpass', cfg.cutoff, 0.9);
      filter.connect(out);
      // Detuned drone stack: root, fifth, minor third.
      const droneOscs = [];
      [cfg.root, cfg.fifth, cfg.third].forEach((f, i) => {
        const o = osc(i === 2 ? 'triangle' : 'sine', f, (i - 1) * 7);
        const g = gain(i === 0 ? 0.5 : 0.22);
        o.connect(g);
        g.connect(filter);
        droneOscs.push(o);
      });
      // A slow LFO on detune + cutoff makes the drone breathe without any
      // per-frame JavaScript.
      // Slow LFO -> detune + cutoff, so the drone breathes with no per-frame JS.
      const lfo = osc('sine', cfg.lfo);
      const lfoDepth = gain(16);
      lfo.connect(lfoDepth);
      for (const o of droneOscs) lfoDepth.connect(o.detune);
      lfoDepth.connect(filter.frequency);
      // Wind: looping noise through a wandering band-pass with gusts.
      const wind = ctx.createBufferSource();
      wind.buffer = this._noiseBuffer;
      wind.loop = true;
      wind.playbackRate.value = 0.65;
      nodes.push(wind);
      sources.push(wind);
      this._start(wind, t0);
      const windFilter = filt('bandpass', cfg.windFreq, cfg.windQ);
      const windGain = gain(cfg.windGain);
      wind.connect(windFilter);
      windFilter.connect(windGain);
      windGain.connect(out);
      // Two slow LFOs give the wind its gusts and its wandering pitch.
      for (const [hz, depth, target] of [[cfg.lfo * 1.7, cfg.windGain * 0.85, windGain.gain],
        [0.09, cfg.windFreq * 0.5, windFilter.frequency]]) {
        const l = osc('sine', hz);
        const d = gain(depth);
        l.connect(d);
        d.connect(target);
      }
      const ambient = { key, out, nodes, sources, timer: null, cleanupTimer: null };
      this._ambient = ambient;
      // Occasional distant groan, scheduled on a timer (not per frame).
      const scheduleGroan = () => {
        if (this._ambient !== ambient) return;
        const [lo, hi] = cfg.groan;
        ambient.timer = setTimeout(() => {
          if (this._ambient !== ambient) return;
          try { this._ambientGroan(ambient, cfg); } catch { /* ignore */ }
          scheduleGroan();
        }, (lo + Math.random() * (hi - lo)) * 1000);
      };
      scheduleGroan();
      return true;
    } catch (err) {
      console.warn('[AudioSystem] startAmbient failed:', err);
      return false;
    }
  }

  /** Fade the ambient bed out and release its nodes. */
  stopAmbient() {
    const amb = this._ambient;
    if (!amb) return;
    this._ambient = null;
    if (amb.timer) { clearTimeout(amb.timer); amb.timer = null; }
    const ctx = this.ctx;
    const t = ctx ? ctx.currentTime : 0;
    try {
      amb.out.gain.cancelScheduledValues(t);
      amb.out.gain.setValueAtTime(Math.max(0.0001, amb.out.gain.value), t);
      amb.out.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    } catch { /* ignore */ }
    for (const s of amb.sources) this._stop(s, t + 1.1);
    amb.cleanupTimer = this._later(() => {
      for (const n of amb.nodes) {
        try { n.disconnect(); } catch { /* ignore */ }
      }
      amb.nodes.length = 0;
      amb.sources.length = 0;
    }, 1300);
  }

  // -------------------------------------------------------------- music

  /**
   * Start a music mode, replacing anything already playing.
   * @param {'explore'|'combat'|'boss'|'victory'|'none'} name
   * @returns {boolean} true when music is playing.
   */
  startMusic(name) {
    if (!this.isReady()) return false;
    const key = String(name || 'none').toLowerCase();
    this.stopMusic();
    if (key === 'none' || !key) return false;
    const cfg = MUSIC_MODES[key] || MUSIC_MODES.explore;
    try {
      const ctx = this.ctx;
      const t0 = ctx.currentTime;
      const { osc, gain, nodes, sources } = this._factories(t0);
      const root = gain(0);
      root.gain.setValueAtTime(0.0001, t0);
      root.gain.exponentialRampToValueAtTime(0.9, t0 + 1.5);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(cfg.cutoff, t0);
      filter.Q.value = 0.8;
      root.connect(filter);
      filter.connect(this._musicBus);
      const layers = {};
      for (const name of ['drone', 'melody', 'pulse', 'tension']) {
        layers[name] = gain(0);
        layers[name].connect(root);
      }
      layers.drone.gain.value = cfg.droneLevel * 0.5;
      layers.tension.gain.value = this._musicIntensity * 0.9;
      // Sustained drone: two detuned saws a fifth apart, slowly detuning.
      const droneOscs = [];
      [cfg.root - 12, cfg.root - 12 + 7].forEach((midi, i) => {
        const o = osc('sawtooth', midiToFreq(midi), i === 0 ? -6 : 6);
        const g = gain(0.16);
        o.connect(g);
        g.connect(layers.drone);
        droneOscs.push(o);
      });
      const lfoDepth = gain(11);
      osc('sine', 0.07).connect(lfoDepth);
      for (const o of droneOscs) lfoDepth.connect(o.detune);
      // Tension layer: a dissonant minor second, tremolo'd.
      const tenGain = gain(0.1);
      for (const semi of [0, 1]) {
        osc('sawtooth', midiToFreq(cfg.root + semi)).connect(tenGain);
      }
      tenGain.connect(layers.tension);
      const trem = osc('sine', 4.6);
      const tremDepth = gain(0.05);
      trem.connect(tremDepth);
      tremDepth.connect(tenGain.gain);
      const music = {
        key, cfg, root, filter, layers, nodes, sources, voices: new Set(),
        nextTime: t0 + 0.12, step: 0, timer: null, lastTick: t0,
        stopAt: cfg.length > 0 ? t0 + cfg.length : null,
      };
      this._music = music;
      this._musicTimer = setTimeout(() => this._musicTick(), 50);
      return true;
    } catch (err) {
      console.warn('[AudioSystem] startMusic failed:', err);
      return false;
    }
  }

  /** Fade the music out and release its nodes. */
  stopMusic() {
    const m = this._music;
    this._music = null;
    if (this._musicTimer) { clearTimeout(this._musicTimer); this._musicTimer = null; }
    if (!m) return;
    const ctx = this.ctx;
    const t = ctx ? ctx.currentTime : 0;
    try {
      m.root.gain.cancelScheduledValues(t);
      m.root.gain.setValueAtTime(Math.max(0.0001, m.root.gain.value), t);
      m.root.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    } catch { /* ignore */ }
    for (const s of m.sources) this._stop(s, t + 0.4, true);
    for (const v of m.voices) this._stop(v, t + 0.4, true);
    m.voices.clear();
    this._later(() => {
      try { m.root.disconnect(); m.filter.disconnect(); } catch { /* ignore */ }
      for (const g of Object.values(m.layers)) {
        try { g.disconnect(); } catch { /* ignore */ }
      }
      for (const n of m.nodes) {
        try { n.disconnect(); } catch { /* ignore */ }
      }
      m.nodes.length = 0;
    }, 600);
  }

  /**
   * Cross-fade the music intensity layer (0 = calm, 1 = maximum tension).
   * @param {number} v 0..1
   */
  setMusicIntensity(v) {
    this._musicIntensity = clamp(Number(v) || 0, 0, 1);
    const m = this._music;
    if (!m || !this.ctx) return;
    this._applyGain(m.layers.tension, this._musicIntensity * 0.9, 0.5);
  }

  // ------------------------------------------------- graph and helpers

  /**
   * Build a small set of node factories for a freshly started bed or track.
   * Every node is registered so it can be released when the bed stops.
   * @param {number} t0 start time
   * @returns {{osc:Function, gain:Function, filt:Function, nodes:any[], sources:any[]}}
   */
  _factories(t0) {
    const ctx = this.ctx;
    const nodes = [];
    const sources = [];
    const keep = (n) => { nodes.push(n); return n; };
    return {
      nodes,
      sources,
      osc: (type, f, detune = 0) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(f, t0);
        o.detune.setValueAtTime(detune, t0);
        sources.push(o);
        nodes.push(o);
        this._start(o, t0);
        return o;
      },
      gain: (v) => { const g = ctx.createGain(); g.gain.value = v; return keep(g); },
      filt: (type, f, q) => {
        const b = ctx.createBiquadFilter();
        b.type = type;
        b.frequency.setValueAtTime(f, t0);
        b.Q.value = q;
        return keep(b);
      },
    };
  }

  /** @returns {Function|null} the AudioContext constructor, if any. */
  _ctxConstructor() {
    if (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) {
      return window.AudioContext || window.webkitAudioContext;
    }
    const g = typeof globalThis !== 'undefined' ? globalThis : null;
    return (g && (g.AudioContext || g.webkitAudioContext)) || null;
  }

  /** Build master -> compressor -> destination plus buses and the reverb. */
  _buildGraph(ctx) {
    const comp = ctx.createDynamicsCompressor();
    for (const [k, v] of [['threshold', -14], ['knee', 24], ['ratio', 6], ['attack', 0.004], ['release', 0.22]]) {
      comp[k].value = v;
    }
    comp.connect(ctx.destination);
    this._compressor = comp;
    const master = ctx.createGain();
    master.gain.value = this._muted ? 0 : this._masterVolume;
    master.connect(comp);
    this._master = master;
    for (const [name, value] of [['sfx', this._sfxVolume], ['music', this._musicVolume], ['ambient', 0.85]]) {
      const bus = ctx.createGain();
      bus.gain.value = value;
      bus.connect(master);
      this[`_${name}Bus`] = bus;
    }
    // Procedural stone-room reverb: pre-delay, damping LP, noise impulse.
    const reverbIn = ctx.createGain();
    const delay = ctx.createDelay(0.5);
    delay.delayTime.value = 0.028;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2600;
    const convolver = ctx.createConvolver();
    convolver.buffer = this._makeImpulseResponse(2.9, 2.7);
    const reverbOut = ctx.createGain();
    reverbOut.gain.value = 0.9;
    reverbIn.connect(delay);
    delay.connect(damp);
    damp.connect(convolver);
    convolver.connect(reverbOut);
    reverbOut.connect(master);
    this._reverbIn = reverbIn;
    this._reverbOut = reverbOut;
    this._noiseBuffer = this._makeNoiseBuffer(2);
  }

  /** Create a white noise buffer of the given length. */
  _makeNoiseBuffer(seconds) {
    const ctx = this.ctx;
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Generate a decaying noise-burst impulse response for the convolver. */
  _makeImpulseResponse(seconds, decay) {
    const ctx = this.ctx;
    const rate = ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const ir = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
      // Sparse early reflections give the tail a roomy, stone-like shape.
      for (let r = 0; r < 14; r++) {
        const idx = Math.floor((0.004 + r * 0.011 + Math.random() * 0.02) * rate);
        if (idx < len) data[idx] += (Math.random() * 2 - 1) * 0.55;
      }
    }
    return ir;
  }

  /** Smoothly push a value onto a gain node. */
  _applyGain(node, value, tc = 0.05) {
    if (!node || !this.ctx) return;
    try {
      node.gain.setTargetAtTime(value, this.ctx.currentTime, tc);
    } catch {
      node.gain.value = value;
    }
  }

  /** Run a callback later and keep the timer handle for disposal. */
  _later(fn, ms) {
    const id = setTimeout(() => {
      this._timers.delete(id);
      try { fn(); } catch { /* ignore */ }
    }, ms);
    this._timers.add(id);
    return id;
  }

  /** Start an AudioScheduledSourceNode exactly once. */
  _start(src, when, offset) {
    if (!src || src.__hcStarted) return;
    src.__hcStarted = true;
    try {
      if (offset === undefined) src.start(when);
      else src.start(when, offset);
    } catch { /* ignore */ }
  }

  /** Stop a source; `force` re-issues the call so a pending note is cut. */
  _stop(src, when, force) {
    if (!src) return;
    if (src.__hcStopped && !force) return;
    src.__hcStopped = true;
    try {
      if (when === undefined) src.stop();
      else src.stop(when);
    } catch { /* ignore */ }
  }

  /**
   * Begin a one-shot voice, returning its output node. The node carries the
   * voice so the sound recipes stay terse.
   */
  _voice(opts, send) {
    const ctx = this.ctx;
    // Prune anything that outlived its slot (onended may not fire when the
    // context is suspended).
    const now = ctx.currentTime;
    for (const v of Array.from(this._voices)) {
      if (v.expires !== undefined && now > v.expires) this._endVoice(v);
    }
    const voice = { nodes: [], sources: 0, opts, expires: now + 20 };
    this._voices.add(voice);
    const g = ctx.createGain();
    g.gain.value = opts.volume;
    let tail = g;
    if (Math.abs(opts.pan) > 0.001 && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = opts.pan;
      g.connect(panner);
      tail = panner;
      voice.nodes.push(panner);
    }
    tail.connect(this._sfxBus);
    voice.nodes.push(g);
    if (send > 0 && this._reverbIn) {
      const sendGain = ctx.createGain();
      sendGain.gain.value = send;
      tail.connect(sendGain);
      sendGain.connect(this._reverbIn);
      voice.nodes.push(sendGain);
    }
    g.voice = voice;
    return g;
  }

  /** Release a voice and disconnect every node it created. */
  _endVoice(voice) {
    this._voices.delete(voice);
    for (const n of voice.nodes) {
      try { n.disconnect(); } catch { /* ignore */ }
    }
    voice.nodes.length = 0;
  }

  /**
   * Render one recipe layer into the voice.
   * A layer is [kind, ...args]; see the recipe legend at the top of the file.
   */
  _layer(out, layer) {
    const voice = out.voice;
    const ctx = this.ctx;
    const x = layer[6] || {};
    const t0 = ctx.currentTime + (x.t || 0);
    const dur = layer[4];
    const peak = layer[5];
    const atk = Math.min(x.attack ?? (layer[0] === 'b' ? 0.004 : 0.002), dur * 0.5);
    // Build the source: an oscillator blip or a filtered noise burst.
    let src;
    let flt = null;
    if (layer[0] === 'b') {
      src = ctx.createOscillator();
      src.type = layer[1];
      const rate = voice.opts.rate || 1;
      src.frequency.setValueAtTime(Math.max(1, layer[2] * rate), t0);
      if (layer[3]) src.frequency.exponentialRampToValueAtTime(Math.max(1, layer[3] * rate), t0 + dur * 0.6);
      const detune = (voice.opts.detune || 0) + (x.detune || 0);
      if (detune) src.detune.setValueAtTime(detune, t0);
    } else if (layer[0] === 'n') {
      src = ctx.createBufferSource();
      src.buffer = this._noiseBuffer;
      src.loop = true;
      src.playbackRate.value = (x.rate || 1) * (voice.opts.rate || 1);
      flt = ctx.createBiquadFilter();
      flt.type = layer[1];
      flt.frequency.setValueAtTime(Math.max(20, layer[2]), t0);
      if (layer[3]) flt.frequency.exponentialRampToValueAtTime(Math.max(20, layer[3]), t0 + dur * 0.6);
      if (x.fBack) flt.frequency.exponentialRampToValueAtTime(Math.max(20, x.fBack), t0 + dur);
      flt.Q.value = x.q ?? 1;
    } else {
      // Partial stack: each partial is shorter and quieter than the last.
      const [, wave, freqs, pdur, ppeak, decay] = layer;
      freqs.forEach((f, i) => {
        this._layer(out, b(wave, f, f * 0.96, pdur * Math.pow(decay, i), ppeak * Math.pow(decay, i)));
      });
      return;
    }
    // Shared attack / decay envelope.
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(flt || g);
    if (flt) flt.connect(g);
    g.connect(out);
    voice.nodes.push(src, g);
    if (flt) voice.nodes.push(flt);
    this._start(src, t0, flt ? Math.random() * 1.5 : undefined);
    this._stop(src, t0 + dur + 0.02);
    this._trackSource(voice, src);
  }

  /** Register a source with a voice so the voice is released when it ends. */
  _trackSource(voice, src) {
    voice.sources += 1;
    src.onended = () => {
      voice.sources -= 1;
      if (voice.sources <= 0) this._endVoice(voice);
    };
  }

  // ------------------------------------------ ambient + music internals

  /** Play a distant groan into the active ambient bed. */
  _ambientGroan(amb, cfg) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const dur = 2.2 + Math.random() * 2.2;
    const base = cfg.root * (Math.random() < 0.5 ? 1.5 : 2);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(base, t0);
    osc.frequency.linearRampToValueAtTime(base * (0.85 + Math.random() * 0.3), t0 + dur);
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.setValueAtTime(400, t0);
    flt.frequency.linearRampToValueAtTime(760, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.06, t0 + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(flt);
    flt.connect(g);
    g.connect(amb.out);
    this._start(osc, t0);
    this._stop(osc, t0 + dur + 0.1);
    amb.sources.push(osc);
    amb.nodes.push(osc, flt, g);
  }

  /** The music lookahead scheduler: schedules ~200 ms of notes every 50 ms. */
  _musicTick() {
    const m = this._music;
    if (!m) return;
    this._musicTimer = setTimeout(() => this._musicTick(), 50);
    const ctx = this.ctx;
    if (!ctx) return;
    const horizon = ctx.currentTime + 0.2;
    try {
      // If the event loop stalled (backgrounded tab, long GC) the grid can fall
      // behind the clock. Skip the grid positions that are now in the past
      // rather than firing them late; the step counter keeps running so the
      // chord progression stays in time.
      if (m.nextTime < ctx.currentTime) {
        const skipped = Math.ceil((ctx.currentTime - m.nextTime) / m.cfg.stepDur);
        m.step += skipped;
        m.nextTime += skipped * m.cfg.stepDur;
      }
      let guard = 0;
      while (m.nextTime < horizon && guard < 64) {
        guard += 1;
        this._scheduleMusicStep(m, m.nextTime);
        m.nextTime += m.cfg.stepDur;
        m.step += 1;
        if (m.stopAt !== null && m.nextTime > m.stopAt) {
          this.stopMusic();
          return;
        }
      }
      m.lastTick = ctx.currentTime;
    } catch (err) {
      console.warn('[AudioSystem] music scheduler error:', err);
      this.stopMusic();
    }
  }

  /** Schedule one step of the current music mode. */
  _scheduleMusicStep(m, time) {
    const cfg = m.cfg;
    const chordDeg = cfg.chords[Math.floor(m.step / cfg.stepsPerBar) % cfg.chords.length];
    const inBar = m.step % cfg.stepsPerBar;
    // Only emit a note on the grid positions the mode asks for.
    if (inBar % cfg.noteEvery === 0) {
      const deg = chordDeg + cfg.degrees[Math.floor(inBar / cfg.noteEvery) % cfg.degrees.length];
      for (let s = 0; s < cfg.noteStack; s++) {
        const midi = cfg.root + MINOR_SCALE[deg % 7] + 12 * Math.floor(deg / 7) + s * 12;
        this._musicNote(m, midi, time, cfg.level * 0.17, cfg.wave, cfg.noteDur);
      }
    }
    if (cfg.pulseEvery > 0 && m.step % cfg.pulseEvery === 0) {
      this._musicPulse(m, time, cfg.pulseLevel);
    }
  }

  /**
   * Schedule a sustained voice into a music layer.
   * @param {object} m music record
   * @param {AudioNode} dest destination layer
   * @param {string} wave oscillator type
   * @param {number} f0 start frequency
   * @param {number} f1 end frequency (0 = hold)
   * @param {number} at start time
   * @param {number} dur duration
   * @param {number} level peak gain
   * @param {number} attack attack time
   */
  _musicVoice(m, dest, wave, f0, f1, at, dur, level, attack) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(f0, at);
    if (f1) osc.frequency.exponentialRampToValueAtTime(f1, at + dur * 0.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g);
    g.connect(dest);
    this._start(osc, at);
    this._stop(osc, at + dur + 0.05);
    m.voices.add(osc);
    osc.onended = () => {
      m.voices.delete(osc);
      try { g.disconnect(); } catch { /* ignore */ }
    };
  }

  /** Schedule a single arpeggio note. */
  _musicNote(m, midi, time, level, wave, dur) {
    this._musicVoice(m, m.layers.melody, wave, midiToFreq(midi), 0, time, dur, level, 0.03);
  }

  /** Schedule the percussive heartbeat pulse (a lub-dub). */
  _musicPulse(m, time, level) {
    this._musicVoice(m, m.layers.pulse, 'sine', 96, 38, time, 0.2, level * 0.5, 0.008);
    this._musicVoice(m, m.layers.pulse, 'sine', 96, 38, time + 0.17, 0.2, level * 0.3, 0.008);
  }
}

// Fill in the derived per-step duration for each music mode.
for (const mode of Object.values(MUSIC_MODES)) {
  mode.stepDur = 60 / mode.bpm / mode.stepDiv;
}

export default AudioSystem;
