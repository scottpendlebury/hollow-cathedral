/**
 * Textures.js — procedural texture generation.
 *
 * Every texture in the game is generated at runtime on a 2D canvas. No image
 * files ship with the build, which keeps the production download tiny and
 * guarantees the project contains no third-party art assets.
 *
 * Textures are cached by key so repeated calls share one GPU upload.
 */

import * as THREE from 'three';

const cache = new Map();

/** Deterministic pseudo-random generator so textures are stable between runs. */
function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return function rng() {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

function finish(c, { repeat = 1, srgb = true, aniso = 4 } = {}) {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = aniso;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Value-noise field sampled with bilinear interpolation. */
function valueNoise(size, cells, seed) {
  const rng = makeRng(seed);
  const grid = new Float32Array((cells + 1) * (cells + 1));
  for (let i = 0; i < grid.length; i++) grid[i] = rng();
  const out = new Float32Array(size * size);
  const scale = cells / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = x * scale;
      const fy = y * scale;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const i00 = grid[y0 * (cells + 1) + x0];
      const i10 = grid[y0 * (cells + 1) + x0 + 1];
      const i01 = grid[(y0 + 1) * (cells + 1) + x0];
      const i11 = grid[(y0 + 1) * (cells + 1) + x0 + 1];
      const top = i00 + (i10 - i00) * sx;
      const bot = i01 + (i11 - i01) * sx;
      out[y * size + x] = top + (bot - top) * sy;
    }
  }
  return out;
}

/** Sum several octaves of value noise into a single field. */
function fbm(size, baseCells, octaves, seed) {
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const field = valueNoise(size, baseCells * Math.pow(2, o), seed + o * 977);
    for (let i = 0; i < out.length; i++) out[i] += field[i] * amp;
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/**
 * Weathered stone: blocky masonry courses, chipped edges, grime in the joints.
 */
function makeStone(size = 256, seed = 11) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const rng = makeRng(seed);
  const grain = fbm(size, 8, 4, seed);
  const grime = fbm(size, 3, 3, seed + 500);

  const courseH = size / 8;
  const blockW = size / 4;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const g = grain[i];
      const dirt = grime[i];
      // Base cool grey with warm undertone in the wear.
      let v = 0.30 + g * 0.30;
      v -= Math.pow(dirt, 2.2) * 0.24;
      const r = v * 255 * 1.02;
      const gg = v * 255 * 0.99;
      const b = v * 255 * 0.94;
      ctx.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }

  // Mortar joints and per-block tonal variation.
  const rowOffset = [0, blockW * 0.5, 0, blockW * 0.25];
  for (let row = 0; row < 8; row++) {
    const y = row * courseH;
    for (let col = -1; col < 5; col++) {
      const x = col * blockW + rowOffset[row % 4];
      const tone = (rng() - 0.5) * 0.10;
      ctx.fillStyle = `rgba(${tone > 0 ? 255 : 0},${tone > 0 ? 250 : 0},${tone > 0 ? 235 : 0},${Math.abs(tone)})`;
      ctx.fillRect(x + 1, y + 1, blockW - 2, courseH - 2);
      // Recessed joint.
      ctx.fillStyle = 'rgba(0,0,0,0.42)';
      ctx.fillRect(x, y, blockW, 2);
      ctx.fillRect(x, y, 2, courseH);
      ctx.fillStyle = 'rgba(255,245,225,0.05)';
      ctx.fillRect(x + 2, y + 2, blockW - 4, 1);
    }
  }

  // Cracks and pitting.
  ctx.strokeStyle = 'rgba(0,0,0,0.30)';
  for (let i = 0; i < 26; i++) {
    ctx.lineWidth = 0.6 + rng() * 1.2;
    ctx.beginPath();
    let x = rng() * size;
    let y = rng() * size;
    ctx.moveTo(x, y);
    const steps = 3 + (rng() * 5) | 0;
    for (let s = 0; s < steps; s++) {
      x += (rng() - 0.5) * 26;
      y += (rng() - 0.5) * 26;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 220; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 0.5 + rng() * 1.8;
    ctx.fillStyle = `rgba(0,0,0,${0.05 + rng() * 0.12})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

/** Damp flagstone floor with cracks, stains and scattered grit. */
function makeFloor(size = 256, seed = 29) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const rng = makeRng(seed);
  const grain = fbm(size, 6, 4, seed);
  const stain = fbm(size, 2, 3, seed + 91);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const v = 0.20 + grain[i] * 0.22 - Math.pow(stain[i], 3) * 0.20;
      ctx.fillStyle = `rgb(${(v * 246) | 0},${(v * 240) | 0},${(v * 226) | 0})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }

  const tile = size / 2;
  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      const x = tx * tile;
      const y = ty * tile;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(x, y, tile, 2);
      ctx.fillRect(x, y, 2, tile);
      ctx.fillStyle = `rgba(255,250,235,${0.02 + rng() * 0.03})`;
      ctx.fillRect(x + 3, y + 3, tile - 6, 1);
    }
  }

  // Blood-ish and water pooling near the joints.
  for (let i = 0; i < 12; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 6 + rng() * 26;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dark = rng() > 0.55;
    grad.addColorStop(0, dark ? 'rgba(48,8,8,0.34)' : 'rgba(18,20,24,0.32)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

/** Rough, splintered timber for pews, doors and coffins. */
function makeWood(size = 128, seed = 71) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const rng = makeRng(seed);
  const grain = fbm(size, 4, 4, seed);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const rings = Math.sin((x * 0.28 + grain[i] * 9) * 1.6) * 0.5 + 0.5;
      const v = 0.16 + rings * 0.10 + grain[i] * 0.10;
      ctx.fillStyle = `rgb(${(v * 255) | 0},${(v * 196) | 0},${(v * 132) | 0})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  for (let i = 0; i < 18; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const len = 12 + rng() * 50;
    ctx.strokeStyle = `rgba(0,0,0,${0.10 + rng() * 0.22})`;
    ctx.lineWidth = 0.5 + rng();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng() - 0.5) * 6, y + len);
    ctx.stroke();
  }
  return c;
}

/** Tarnished, pitted iron for armour, gates and weapons. */
function makeIron(size = 128, seed = 137) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const rng = makeRng(seed);
  const grain = fbm(size, 5, 4, seed);
  const rust = fbm(size, 3, 3, seed + 313);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const r = Math.pow(rust[i], 2.4);
      const base = 0.16 + grain[i] * 0.20;
      const rr = (base + r * 0.30) * 255;
      const gg = (base + r * 0.13) * 255;
      const bb = (base + r * 0.05) * 255;
      ctx.fillStyle = `rgb(${rr | 0},${gg | 0},${bb | 0})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  for (let i = 0; i < 140; i++) {
    const x = rng() * size;
    const y = rng() * size;
    ctx.fillStyle = `rgba(${120 + rng() * 60 | 0},${50 + rng() * 30 | 0},20,${0.06 + rng() * 0.18})`;
    ctx.beginPath();
    ctx.arc(x, y, 0.6 + rng() * 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

/** Mottled bone and leathery flesh for the undead. */
function makeBone(size = 128, seed = 211) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const rng = makeRng(seed);
  const grain = fbm(size, 5, 4, seed);
  const bruise = fbm(size, 3, 3, seed + 77);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const b = Math.pow(bruise[i], 2.6);
      const v = 0.52 + grain[i] * 0.26 - b * 0.34;
      ctx.fillStyle = `rgb(${(v * 236) | 0},${(v * 224) | 0},${(v * 196) | 0})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  for (let i = 0; i < 60; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 2 + rng() * 9;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(52,40,30,0.45)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

/** Grimy cloth / banner weave. */
function makeCloth(size = 128, seed = 307) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const rng = makeRng(seed);
  const grain = fbm(size, 4, 3, seed);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const weave = (Math.sin(x * 1.7) * 0.5 + 0.5) * (Math.sin(y * 1.7) * 0.5 + 0.5);
      const v = 0.13 + grain[i] * 0.14 + weave * 0.07;
      ctx.fillStyle = `rgb(${(v * 200) | 0},${(v * 60) | 0},${(v * 56) | 0})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  for (let i = 0; i < 40; i++) {
    const x = rng() * size;
    const y = rng() * size;
    ctx.fillStyle = `rgba(0,0,0,${0.08 + rng() * 0.2})`;
    ctx.fillRect(x, y, 1 + rng() * 3, 1 + rng() * 3);
  }
  return c;
}

/** Soft radial sprite used for dust motes, embers and glow points. */
function makeGlow(size = 64) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,240,200,0.55)');
  g.addColorStop(1, 'rgba(255,180,80,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

/** Irregular splatter used for blood decals. */
function makeBloodDecal(size = 128, seed = 419) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const rng = makeRng(seed);
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2;
  const cy = size / 2;
  ctx.fillStyle = 'rgba(74,8,10,0.88)';
  ctx.beginPath();
  const pts = 14;
  for (let i = 0; i <= pts; i++) {
    const a = (i / pts) * Math.PI * 2;
    const r = size * (0.16 + rng() * 0.16);
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  for (let i = 0; i < 22; i++) {
    const a = rng() * Math.PI * 2;
    const d = size * (0.16 + rng() * 0.3);
    const r = 1 + rng() * 4.5;
    ctx.fillStyle = `rgba(${70 + rng() * 30 | 0},6,8,${0.5 + rng() * 0.4})`;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

/** Grimy parchment for the lore tablets. */
function makeParchment(size = 128, seed = 523) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const rng = makeRng(seed);
  const grain = fbm(size, 4, 4, seed);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const v = 0.42 + grain[i] * 0.24;
      ctx.fillStyle = `rgb(${(v * 214) | 0},${(v * 196) | 0},${(v * 150) | 0})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  // Faint illegible script lines.
  ctx.strokeStyle = 'rgba(40,26,12,0.42)';
  for (let i = 0; i < 14; i++) {
    const y = 8 + i * 8 + rng() * 3;
    ctx.lineWidth = 0.6 + rng() * 0.5;
    ctx.beginPath();
    ctx.moveTo(10, y);
    for (let x = 10; x < size - 10; x += 3) {
      ctx.lineTo(x, y + Math.sin(x * 0.9 + i) * 1.4);
    }
    ctx.stroke();
  }
  return c;
}

/**
 * Public accessor. Every call with the same key returns the same texture.
 */
function tex(key, factory) {
  if (cache.has(key)) return cache.get(key);
  const t = finish(factory(), {});
  cache.set(key, t);
  return t;
}

export const Textures = {
  stone: () => tex('stone', () => makeStone()),
  floor: () => tex('floor', () => makeFloor()),
  wood: () => tex('wood', () => makeWood()),
  iron: () => tex('iron', () => makeIron()),
  bone: () => tex('bone', () => makeBone()),
  cloth: () => tex('cloth', () => makeCloth()),
  glow: () => tex('glow', () => makeGlow()),
  blood: () => tex('blood', () => makeBloodDecal()),
  parchment: () => tex('parchment', () => makeParchment()),
};

/**
 * Builds the shared material set. Materials are reused across the level so the
 * renderer can batch them and keep the draw call count low.
 */
export function createMaterials() {
  const stoneMap = Textures.stone();
  const floorMap = Textures.floor();
  const woodMap = Textures.wood();
  const ironMap = Textures.iron();
  const boneMap = Textures.bone();
  const clothMap = Textures.cloth();

  const stone = new THREE.MeshStandardMaterial({
    map: stoneMap,
    color: 0x8c8a84,
    roughness: 0.95,
    metalness: 0.02,
  });

  const stoneDark = stone.clone();
  stoneDark.color = new THREE.Color(0x5d5c58);

  const floor = new THREE.MeshStandardMaterial({
    map: floorMap,
    color: 0x7d7a72,
    roughness: 0.92,
    metalness: 0.03,
  });

  const wood = new THREE.MeshStandardMaterial({
    map: woodMap,
    color: 0x8a6a44,
    roughness: 0.88,
    metalness: 0.02,
  });

  const woodDark = wood.clone();
  woodDark.color = new THREE.Color(0x4a3722);

  const iron = new THREE.MeshStandardMaterial({
    map: ironMap,
    color: 0x9aa0a6,
    roughness: 0.62,
    metalness: 0.72,
  });

  const ironDark = iron.clone();
  ironDark.color = new THREE.Color(0x4a4e54);
  ironDark.metalness = 0.6;
  ironDark.roughness = 0.78;

  const bone = new THREE.MeshStandardMaterial({
    map: boneMap,
    color: 0x9a9584,
    roughness: 0.92,
    metalness: 0.0,
  });

  // Sickly, corpse-grey flesh: greenish where it is cold, ruddy where
  // the blood has not yet settled.
  const flesh = new THREE.MeshStandardMaterial({
    color: 0x5c5a48,
    roughness: 0.94,
    metalness: 0.0,
  });

  const fleshDark = new THREE.MeshStandardMaterial({
    color: 0x35332a,
    roughness: 0.97,
    metalness: 0.0,
  });

  const cloth = new THREE.MeshStandardMaterial({
    map: clothMap,
    color: 0x7a2b26,
    roughness: 0.95,
    metalness: 0.0,
  });

  const gold = new THREE.MeshStandardMaterial({
    color: 0xb08d4a,
    roughness: 0.36,
    metalness: 0.85,
  });

  const parchment = new THREE.MeshStandardMaterial({
    map: Textures.parchment(),
    color: 0xbfae87,
    roughness: 0.94,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });

  const emissive = new THREE.MeshBasicMaterial({ color: 0xffb765 });

  return {
    stone,
    stoneDark,
    floor,
    wood,
    woodDark,
    iron,
    ironDark,
    bone,
    flesh,
    fleshDark,
    cloth,
    gold,
    parchment,
    emissive,
  };
}

export { makeGlow, makeBloodDecal };
