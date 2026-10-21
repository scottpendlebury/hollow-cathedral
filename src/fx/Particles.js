/**
 * Particles.js — a single-draw-call particle system.
 *
 * All particles live in one THREE.Points object with preallocated typed
 * arrays. Nothing is allocated per frame: emitters write into free slots and
 * the update loop integrates in place. A tiny procedurally generated canvas
 * texture provides the sprite, so no image files ship with the game.
 *
 * Blending: NormalBlending with per-particle alpha. Additive-only particles
 * (sparks, embers, souls) are made to read by giving them a bright core that
 * fades to transparent, which keeps one material and one draw call.
 */

import * as THREE from 'three';

const MAX = 900;

const VERT = `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = aSize * (300.0 / max(0.001, -mvPosition.z));
}
`;

const FRAG = `
uniform sampler2D uMap;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 tex = texture2D(uMap, gl_PointCoord);
  if (tex.a < 0.01) discard;
  gl_FragColor = vec4(vColor, tex.a * vAlpha);
}
`;

/** Builds the soft round sprite used by every particle. */
function makeSprite() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.65)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

export class ParticleSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {object} options { maxParticles, quality }
   */
  constructor(scene, options = {}) {
    this.scene = scene;
    this.maxParticles = options.maxParticles || MAX;
    this.quality = options.quality || 'high';

    const n = this.maxParticles;
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);
    this.sizes = new Float32Array(n);
    this.alphas = new Float32Array(n);

    // Per-particle simulation state.
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.gravity = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.baseSize = new Float32Array(n);
    this.grow = new Float32Array(n);
    this.baseR = new Float32Array(n);
    this.baseG = new Float32Array(n);
    this.baseB = new Float32Array(n);

    // Free list of slot indices.
    this.free = new Int32Array(n);
    for (let i = 0; i < n; i++) this.free[i] = n - 1 - i;
    this.freeCount = n;
    this.liveCount = 0;

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    this.geometry.setDrawRange(0, 0);
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 400);

    this.texture = makeSprite();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: this.texture },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);

    // Scratch vectors, reused everywhere.
    this._v = new THREE.Vector3();
  }

  /** Adjusts the particle budget for the given quality level. */
  setQuality(q) {
    this.quality = q;
    const limits = { low: 180, medium: 420, high: 700, auto: 420 };
    const limit = limits[q] ?? 420;
    this.budget = Math.min(this.maxParticles, limit);
  }

  get budget() {
    return this._budget ?? this.maxParticles;
  }

  set budget(v) {
    this._budget = v;
  }

  /**
   * Claims a slot from the free list.
   * @returns {number} slot index, or -1 when the pool is exhausted
   */
  _claim() {
    if (this.freeCount === 0) return -1;
    this.freeCount--;
    return this.free[this.freeCount];
  }

  _release(slot) {
    this.free[this.freeCount] = slot;
    this.freeCount++;
  }

  /**
   * Spawns one particle.
   */
  _spawn(x, y, z, vx, vy, vz, r, g, b, size, life, gravity, drag, grow) {
    if (this.liveCount >= this.budget) return false;
    const i = this._claim();
    if (i < 0) return false;
    const i3 = i * 3;
    this.positions[i3] = x;
    this.positions[i3 + 1] = y;
    this.positions[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.baseR = r;
    this.baseG = g;
    this.baseB = b;
    this.colors[i3] = r;
    this.colors[i3 + 1] = g;
    this.colors[i3 + 2] = b;
    this.baseSize[i] = size;
    this.sizes[i] = size;
    this.grow[i] = grow || 0;
    this.alphas[i] = 1;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.gravity[i] = gravity;
    this.drag[i] = drag;
    this.liveCount++;
    return true;
  }

  // --------------------------------------------------------------- emitters

  /** Dark red droplets that arc and fall. */
  emitBlood(pos, dir, count = 10) {
    const n = Math.min(count, Math.floor(this.budget * 0.25));
    for (let i = 0; i < n; i++) {
      const spread = 0.55;
      const vx = dir.x * 2.2 + (Math.random() - 0.5) * spread * 4;
      const vy = dir.y * 2.2 + Math.random() * 2.4;
      const vz = dir.z * 2.2 + (Math.random() - 0.5) * spread * 4;
      // A bright core keeps the blood readable against dark stone.
      const bright = Math.random() * 0.25;
      this._spawn(
        pos.x, pos.y, pos.z,
        vx, vy, vz,
        0.62 + bright, 0.07, 0.09,
        0.055 + Math.random() * 0.05,
        0.5 + Math.random() * 0.5,
        13, 0.6, 0
      );
    }
  }

  /** Hot sparks that fly fast and fade quickly. */
  emitSparks(pos, dir, count = 8, color = 0xffc070) {
    const n = Math.min(count, Math.floor(this.budget * 0.25));
    const r = ((color >> 16) & 255) / 255;
    const g = ((color >> 8) & 255) / 255;
    const b = (color & 255) / 255;
    for (let i = 0; i < n; i++) {
      const vx = dir.x * 3.5 + (Math.random() - 0.5) * 5;
      const vy = dir.y * 3.5 + (Math.random() - 0.5) * 5 + 1.4;
      const vz = dir.z * 3.5 + (Math.random() - 0.5) * 5;
      this._spawn(
        pos.x, pos.y, pos.z,
        vx, vy, vz,
        Math.min(1, r + 0.2), Math.min(1, g + 0.15), Math.min(1, b + 0.1),
        0.04 + Math.random() * 0.04,
        0.25 + Math.random() * 0.35,
        9, 1.2, 0
      );
    }
  }

  /** Slow warm motes rising from fire. */
  emitEmbers(pos, count = 3) {
    const n = Math.min(count, Math.floor(this.budget * 0.12));
    for (let i = 0; i < n; i++) {
      this._spawn(
        pos.x + (Math.random() - 0.5) * 0.3,
        pos.y + Math.random() * 0.2,
        pos.z + (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 0.35,
        0.5 + Math.random() * 0.7,
        (Math.random() - 0.5) * 0.35,
        1.0, 0.62, 0.22,
        0.035 + Math.random() * 0.03,
        1.4 + Math.random() * 1.4,
        -0.35, 0.7, 0
      );
    }
  }

  /** Grey motes drifting through the air. */
  emitDust(pos, count = 3) {
    const n = Math.min(count, Math.floor(this.budget * 0.12));
    for (let i = 0; i < n; i++) {
      this._spawn(
        pos.x + (Math.random() - 0.5) * 1.2,
        pos.y + (Math.random() - 0.5) * 0.8,
        pos.z + (Math.random() - 0.5) * 1.2,
        (Math.random() - 0.5) * 0.18,
        (Math.random() - 0.2) * 0.14,
        (Math.random() - 0.5) * 0.18,
        0.42, 0.4, 0.38,
        0.028 + Math.random() * 0.025,
        3 + Math.random() * 3,
        0, 0.25, 0
      );
    }
  }

  /** Sickly green motes rising from drained souls. */
  emitSoul(pos, count = 6) {
    const n = Math.min(count, Math.floor(this.budget * 0.2));
    for (let i = 0; i < n; i++) {
      this._spawn(
        pos.x + (Math.random() - 0.5) * 0.5,
        pos.y + Math.random() * 0.6,
        pos.z + (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 0.5,
        0.7 + Math.random() * 0.9,
        (Math.random() - 0.5) * 0.5,
        0.4, 1.0, 0.55,
        0.05 + Math.random() * 0.05,
        0.9 + Math.random() * 0.7,
        -0.6, 0.9, 0
      );
    }
  }

  /** Grey stone chips. */
  emitDebris(pos, count = 5) {
    const n = Math.min(count, Math.floor(this.budget * 0.2));
    for (let i = 0; i < n; i++) {
      this._spawn(
        pos.x, pos.y, pos.z,
        (Math.random() - 0.5) * 3.5,
        Math.random() * 2.6,
        (Math.random() - 0.5) * 3.5,
        0.5, 0.48, 0.45,
        0.035 + Math.random() * 0.04,
        0.6 + Math.random() * 0.5,
        15, 0.4, 0
      );
    }
  }

  /** Dark puffs that expand and fade. */
  emitSmoke(pos, count = 4) {
    const n = Math.min(count, Math.floor(this.budget * 0.2));
    for (let i = 0; i < n; i++) {
      this._spawn(
        pos.x + (Math.random() - 0.5) * 0.2,
        pos.y + (Math.random() - 0.5) * 0.2,
        pos.z + (Math.random() - 0.5) * 0.2,
        (Math.random() - 0.5) * 0.6,
        0.5 + Math.random() * 0.7,
        (Math.random() - 0.5) * 0.6,
        0.22, 0.2, 0.2,
        0.12,
        0.9 + Math.random() * 0.8,
        -0.5, 1.4, 0.16
      );
    }
  }

  // ---------------------------------------------------------------- update

  /**
   * Integrates every live particle.
   * @param {number} dt
   */
  update(dt, cameraPos) {
    if (dt <= 0) return;
    let live = 0;

    for (let i = 0; i < this.maxParticles; i++) {
      if (this.life[i] <= 0) {
        this.alphas[i] = 0;
        continue;
      }

      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alphas[i] = 0;
        this.sizes[i] = 0;
        this._release(i);
        continue;
      }

      const i3 = i * 3;
      const d = this.drag[i];
      const damp = Math.max(0, 1 - d * dt);
      this.vel[i3] *= damp;
      this.vel[i3 + 1] *= damp;
      this.vel[i3 + 2] *= damp;
      this.vel[i3 + 1] -= this.gravity[i] * dt;

      this.positions[i3] += this.vel[i3] * dt;
      this.positions[i3 + 1] += this.vel[i3 + 1] * dt;
      this.positions[i3 + 2] += this.vel[i3 + 2] * dt;

      // Fade out over the particle's life, and shrink or grow the sprite.
      const t = this.life[i] / this.maxLife[i];
      this.alphas[i] = t > 0.75 ? (1 - t) / 0.25 : Math.min(1, t / 0.75);
      this.sizes[i] = this.baseSize[i] * (1 + this.grow[i] * (1 - t));

      // Colour cools slightly as it ages.
      this.colors[i3] = this.baseR[i];
      this.colors[i3 + 1] = this.baseG[i];
      this.colors[i3 + 2] = this.baseB[i];

      live++;
    }

    this.liveCount = live;
    this.geometry.setDrawRange(0, this.maxParticles);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aColor.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
  }

  clear() {
    for (let i = 0; i < this.maxParticles; i++) {
      this.life[i] = 0;
      this.alphas[i] = 0;
      this.sizes[i] = 0;
    }
    this.freeCount = this.maxParticles;
    for (let i = 0; i < this.maxParticles; i++) this.free[i] = this.maxParticles - 1 - i;
    this.liveCount = 0;
    this.geometry.attributes.aAlpha.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
    if (this.texture) this.texture.dispose();
  }
}

/**
 * AmbientMotes — a slow, persistent drift of dust in a volume.
 *
 * Uses its own lightweight Points object rather than the main pool so the
 * atmosphere keeps drifting even when the pool is busy.
 */
export class AmbientMotes {
  /**
   * @param {THREE.Scene} scene
   * @param {object} bounds { minX, maxX, minY, maxY, minZ, maxZ }
   * @param {number} count
   */
  constructor(scene, bounds, count = 120) {
    this.bounds = bounds;
    this.count = count;
    this.time = 0;

    const positions = new Float32Array(count * 3);
    this.base = new Float32Array(count * 3);
    this.phase = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      this.base[i3] = bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
      this.base[i3 + 1] = bounds.minY + Math.random() * (bounds.maxY - bounds.minY);
      this.base[i3 + 2] = bounds.minZ + Math.random() * (bounds.maxZ - bounds.minZ);
      positions[i3] = this.base[i3];
      positions[i3 + 1] = this.base[i3 + 1];
      positions[i3 + 2] = this.base[i3 + 2];
      this.phase[i] = Math.random() * Math.PI * 2;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const tex = makeSprite();
    this.material = new THREE.PointsMaterial({
      size: 0.05,
      map: tex,
      color: 0x8a8272,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(dt) {
    this.time += dt;
    const pos = this.geometry.attributes.position.array;
    const b = this.bounds;
    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;
      const p = this.phase[i];
      pos[i3] = this.base[i3] + Math.sin(this.time * 0.22 + p) * 0.6;
      pos[i3 + 1] = this.base[i3 + 1] + Math.sin(this.time * 0.16 + p * 1.7) * 0.45;
      pos[i3 + 2] = this.base[i3 + 2] + Math.cos(this.time * 0.19 + p) * 0.6;
      // Wrap the mote back inside the volume when it drifts out.
      if (pos[i3 + 1] < b.minY) this.base[i3 + 1] = b.maxY;
    }
    this.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    this.points.parent?.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
    if (this.material.map) this.material.map.dispose();
  }
}
