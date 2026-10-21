/**
 * Enemies.js — the three archetypes that walk the cathedral.
 *
 *  - Husk   : shambling melee ghoul. Slow, relentless, swarms.
 *  - Archer : skeletal archer. Keeps distance, fires bone bolts, retreats.
 *  - Knight : armoured revenant. Slow, heavy, telegraphs a devastating slam.
 *
 * All three share a small state machine (idle -> alert -> chase -> attack ->
 * stagger -> dead) and a shared steering routine that keeps them off walls.
 * Models are procedural and animated by transforming a small hierarchy of
 * parts, so no skeletal animation system is needed.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Shared geometry cache.
 *
 * Every husk used to allocate its own copy of the same cylinder, sphere and
 * torus. With a dozen enemies on screen that was hundreds of redundant GPU
 * buffers. The geometry is identical for every enemy of a type, so it is
 * built once and reused.
 */
const GEO_CACHE = new Map();

/**
 * The single material every enemy body is drawn with.
 *
 * Body parts carry their colour in their vertices, so one husk or knight
 * costs a handful of draw calls instead of a dozen.
 */
const ENEMY_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.92,
  metalness: 0.05,
});

/**
 * Returns a cached geometry for the given key, building it on first use.
 * @param {string} key
 * @param {() => THREE.BufferGeometry} factory
 */
function geo(key, factory) {
  let g = GEO_CACHE.get(key);
  if (!g) {
    g = factory();
    GEO_CACHE.set(key, g);
  }
  return g;
}

/**
 * Collects geometry and its transform so a body part can be assembled from
 * many primitives and then merged into one mesh per material.
 */
class PartBuilder {
  /**
   * @param {THREE.Vector3|null} pivot the point the part rotates about.
   *   Geometry is baked relative to it and the group is placed on it.
   */
  constructor(pivot) {
    this.entries = [];
    this.pivot = pivot ? pivot.clone() : null;
  }

  /**
   * Adds a geometry with a position, rotation and scale.
   *
   * The material's colour is baked into the vertices, so the whole part can
   * be drawn with one shared material.
   */
  add(geometry, material, position, rotation, scale) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        rotation ? rotation[0] : 0,
        rotation ? rotation[1] : 0,
        rotation ? rotation[2] : 0
      )
    );
    const pos = new THREE.Vector3(position[0], position[1], position[2]);
    if (this.pivot) pos.sub(this.pivot);
    m.compose(pos, q, new THREE.Vector3(scale[0], scale[1], scale[2]));
    const g = geometry.clone();
    g.applyMatrix4(m);
    this.entries.push({ geometry: g, color: material.color });
    return this;
  }

  /**
   * Produces one mesh per material, merging the geometry for each. The
   * returned group's children can be animated independently.
   */
  build() {
    const group = new THREE.Group();
    if (this.pivot) group.position.copy(this.pivot);
    const list = [];

    for (const e of this.entries) {
      // Merging requires a consistent attribute set.
      let g = e.geometry.index ? e.geometry.toNonIndexed() : e.geometry;
      for (const name of Object.keys(g.attributes)) {
        if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') {
          g.deleteAttribute(name);
        }
      }
      if (!g.attributes.uv) {
        g.setAttribute(
          'uv',
          new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)
        );
      }
      // Bake the material colour into the vertices.
      const count = g.attributes.position.count;
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        colors[i * 3] = e.color.r;
        colors[i * 3 + 1] = e.color.g;
        colors[i * 3 + 2] = e.color.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      g.clearGroups();
      list.push(g);
    }

    const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
    if (!merged) {
      // Fall back to individual meshes if the merge fails.
      for (const g of list) {
        const mesh = new THREE.Mesh(g, ENEMY_MATERIAL);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        group.add(mesh);
      }
      return group;
    }
    if (list.length > 1) for (const g of list) g.dispose();

    const mesh = new THREE.Mesh(merged, ENEMY_MATERIAL);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
    return group;
  }
}

/**
 * Builds a procedural body for an archetype.
 *
 * Each animated part (torso, head, arms, legs) is assembled from several
 * primitives and then merged into one mesh per material, so a full enemy
 * costs a handful of draw calls rather than twenty.
 */
function buildBody(type, materials) {
  const g = new THREE.Group();
  const parts = {};

  const cyl = (r1, r2, h, seg) => geo(`${r1}_${r2}_${h}_${seg}`, () => new THREE.CylinderGeometry(r1, r2, h, seg));
  const sph = (r, w, h) => geo(`s${r}_${w}_${h}`, () => new THREE.SphereGeometry(r, w, h));
  const box = (x, y, z) => geo(`b${x}_${y}_${z}`, () => new THREE.BoxGeometry(x, y, z));
  const tor = (r, t, rs, ts, arc) => geo(`t${r}_${t}_${rs}_${ts}_${arc}`, () => new THREE.TorusGeometry(r, t, rs, ts, arc));
  const ico = (r, d) => geo(`i${r}_${d}`, () => new THREE.IcosahedronGeometry(r, d));

  /**
   * Builds one animated part and registers it under a name.
   *
   * @param {string|null} name
   * @param {number[]} pivot the joint the part rotates about
   * @param {(b: PartBuilder) => void} fill
   */
  const part = (name, pivot, fill) => {
    const b = new PartBuilder(new THREE.Vector3(pivot[0], pivot[1], pivot[2]));
    fill(b);
    const node = b.build();
    node.userData.baseY = pivot[1];
    g.add(node);
    if (name) parts[name] = node;
    return node;
  };

  if (type === 'husk') {
    // --- torso: a stooped, emaciated body with exposed ribs ------------
    part('torso', [0, 1.1, 0.05], (b) => {
      b.add(cyl(0.26, 0.17, 0.74, 8), materials.flesh, [0, 1.1, 0.05], [0.22, 0, 0], [1, 1, 1]);
      b.add(sph(0.26, 9, 7), materials.fleshDark, [0, 1.45, 0.02], null, [1.5, 0.62, 0.85]);
      // Ribs, the clearest read on what this thing used to be.
      for (let i = 0; i < 4; i++) {
        b.add(
          tor(0.21 - i * 0.012, 0.024, 4, 10, Math.PI),
          materials.bone,
          [0, 1.32 - i * 0.11, 0.07],
          [Math.PI / 2 - 0.25, 0, 0],
          [1, 1, 1]
        );
      }
      // A spine of vertebrae.
      for (let i = 0; i < 4; i++) {
        b.add(sph(0.038, 6, 5), materials.bone, [0, 1.34 - i * 0.11, -0.14], null, [1, 1, 1]);
      }
      // A tattered shroud.
      b.add(cyl(0.24, 0.3, 0.62, 8), materials.cloth, [0, 0.94, 0.02], null, [1, 1, 1]);
    });

    // --- head: lolling forward and to one side --------------------------
    part('head', [0.05, 1.62, 0.16], (b) => {
      b.add(sph(0.16, 10, 8), materials.flesh, [0.05, 1.62, 0.16], [0.5, 0.2, 0.28], [0.82, 1.15, 0.92]);
      b.add(sph(0.1, 7, 6), materials.fleshDark, [0.05, 1.5, 0.24], null, [0.9, 0.7, 1.1]);
    });

    // --- arms: long, thin, reaching forward -----------------------------
    for (const side of [-1, 1]) {
      const key = side < 0 ? 'armL' : 'armR';
      part(key, [side * 0.3, 1.16, 0.18], (b) => {
        b.add(cyl(0.065, 0.042, 0.72, 6), materials.flesh, [side * 0.3, 1.16, 0.18], [-1.15, 0, 0], [1, 1, 1]);
        b.add(sph(0.075, 6, 5), materials.fleshDark, [side * 0.32, 0.88, 0.44], [-0.6, 0, 0], [0.8, 1.3, 0.6]);
      });
    }

    // --- legs -------------------------------------------------------------
    for (const side of [-1, 1]) {
      const key = side < 0 ? 'legL' : 'legR';
      part(key, [side * 0.14, 0.43, 0], (b) => {
        b.add(cyl(0.095, 0.07, 0.86, 6), materials.flesh, [side * 0.14, 0.43, 0], null, [1, 1, 1]);
      });
    }
  } else if (type === 'archer') {
    // --- torso: a bare skeletal frame ------------------------------------
    part('torso', [0, 1.14, 0], (b) => {
      b.add(cyl(0.19, 0.24, 0.68, 8), materials.bone, [0, 1.14, 0], null, [1, 1, 1]);
      for (let i = 0; i < 4; i++) {
        b.add(
          tor(0.19 - i * 0.008, 0.022, 4, 10, Math.PI),
          materials.bone,
          [0, 1.32 - i * 0.1, 0.02],
          [Math.PI / 2, 0, 0],
          [1, 1, 1]
        );
      }
    });

    // --- head: a long neck and a bare skull ------------------------------
    part('head', [0, 1.66, 0.04], (b) => {
      b.add(cyl(0.05, 0.06, 0.16, 6), materials.bone, [0, 1.52, 0.02], null, [1, 1, 1]);
      b.add(sph(0.145, 9, 8), materials.bone, [0, 1.66, 0.04], null, [0.8, 1, 1.05]);
      // Dark eye sockets, which is what makes a skull read as a skull.
      for (const side of [-1, 1]) {
        b.add(sph(0.04, 6, 5), materials.fleshDark, [side * 0.055, 1.68, 0.12], null, [1, 0.8, 0.6]);
      }
    });

    // --- the long bone bow -----------------------------------------------
    part('bow', [0.3, 1.3, 0.16], (b) => {
      b.add(tor(0.34, 0.02, 4, 12, Math.PI * 1.1), materials.bone, [0.3, 1.3, 0.16], [0, Math.PI / 2, 0.4], [1, 1, 1]);
    });

    // --- arms: one holds the bow, one draws ------------------------------
    for (const side of [-1, 1]) {
      const key = side < 0 ? 'armL' : 'armR';
      part(key, [side * 0.24, 1.18, 0.12], (b) => {
        b.add(cyl(0.05, 0.04, 0.6, 6), materials.bone, [side * 0.24, 1.18, 0.12], [-0.6, 0, 0], [1, 1, 1]);
      });
    }

    // --- legs -------------------------------------------------------------
    for (const side of [-1, 1]) {
      const key = side < 0 ? 'legL' : 'legR';
      part(key, [side * 0.11, 0.4, 0], (b) => {
        b.add(cyl(0.07, 0.05, 0.8, 6), materials.bone, [side * 0.11, 0.4, 0], null, [1, 1, 1]);
      });
    }

    // --- a tattered shroud ------------------------------------------------
    part(null, [0, 0.78, 0], (b) => {
      b.add(cyl(0.28, 0.34, 0.5, 8), materials.cloth, [0, 0.78, 0], null, [1, 1, 1]);
    });
  } else {
    // --- KNIGHT ------------------------------------------------------------
    part('torso', [0, 1.2, 0], (b) => {
      b.add(cyl(0.3, 0.24, 0.76, 8), materials.ironDark, [0, 1.2, 0], null, [1, 1, 1]);
      b.add(cyl(0.26, 0.32, 0.72, 8), materials.cloth, [0, 0.92, 0], null, [1, 1, 1]);
    });

    // --- head: a horned helm ----------------------------------------------
    part('head', [0, 1.72, 0], (b) => {
      b.add(sph(0.19, 10, 8), materials.iron, [0, 1.72, 0], null, [0.9, 1.05, 1]);
      for (const side of [-1, 1]) {
        b.add(cyl(0.05, 0.012, 0.26, 6), materials.iron, [side * 0.13, 1.86, 0], [0, 0, side * 0.55], [1, 1, 1]);
      }
    });

    // --- arms: spiked pauldrons and heavy limbs ---------------------------
    for (const side of [-1, 1]) {
      const key = side < 0 ? 'armL' : 'armR';
      part(key, [side * 0.34, 1.48, 0], (b) => {
        b.add(sph(0.19, 9, 7), materials.iron, [side * 0.34, 1.48, 0], null, [1.15, 0.78, 1.05]);
        b.add(cyl(0.055, 0.012, 0.22, 6), materials.ironDark, [side * 0.42, 1.56, 0], [0, 0, side * 0.75], [1, 1, 1]);
        b.add(cyl(0.09, 0.075, 0.62, 7), materials.ironDark, [side * 0.35, 1.06, 0.04], null, [1, 1, 1]);
      });
    }

    // --- the great sword ---------------------------------------------------
    part('weapon', [0.46, 0.94, 0.36], (b) => {
      b.add(box(0.11, 1.25, 0.035), materials.iron, [0.46, 0.94, 0.36], [-0.45, 0, 0.12], [1, 1, 1]);
      b.add(box(0.34, 0.05, 0.06), materials.ironDark, [0.44, 1.5, 0.14], [-0.45, 0, 0], [1, 1, 1]);
    });

    // --- legs ---------------------------------------------------------------
    for (const side of [-1, 1]) {
      const key = side < 0 ? 'legL' : 'legR';
      part(key, [side * 0.15, 0.43, 0], (b) => {
        b.add(cyl(0.12, 0.1, 0.86, 6), materials.ironDark, [side * 0.15, 0.43, 0], null, [1, 1, 1]);
      });
    }
  }

  g.traverse((c) => {
    if (c.isMesh) {
      c.castShadow = false;
      c.receiveShadow = false;
    }
  });
  return { group: g, parts };
}

const ARCHETYPES = {
  husk: {
    health: 55,
    speed: 1.55,
    chaseSpeed: 2.5,
    damage: 11,
    attackRange: 1.7,
    attackCooldown: 1.35,
    windup: 0.42,
    sightRange: 24,
    fov: 2.0,
    radius: 0.42,
    height: 1.8,
    score: 10,
    groan: 'enemyGrowl',
  },
  archer: {
    health: 42,
    speed: 1.9,
    chaseSpeed: 2.2,
    damage: 14,
    attackRange: 20,
    attackCooldown: 2.5,
    windup: 0.9,
    sightRange: 28,
    fov: 1.7,
    radius: 0.4,
    height: 1.8,
    preferredRange: 9,
    score: 15,
    groan: 'enemyGrowl',
  },
  knight: {
    health: 150,
    speed: 1.1,
    chaseSpeed: 1.9,
    damage: 32,
    attackRange: 2.4,
    attackCooldown: 2.4,
    windup: 0.95,
    sightRange: 26,
    fov: 1.9,
    radius: 0.55,
    height: 2.1,
    score: 30,
    groan: 'enemyScream',
  },
};

export class Enemy {
  /**
   * @param {string} type 'husk' | 'archer' | 'knight'
   * @param {object} opts { world, scene, materials, position, patrol, audio, particles, onAttack, onDeath }
   */
  constructor(type, opts) {
    this.type = type;
    this.stats = ARCHETYPES[type] || ARCHETYPES.husk;
    this.world = opts.world;
    this.materials = opts.materials;
    this.audio = opts.audio;
    this.particles = opts.particles;
    this.onAttack = opts.onAttack || null;
    this.onDeath = opts.onDeath || null;
    this.boss = !!opts.boss;

    const built = buildBody(type, this.materials);
    this.group = built.group;
    this.parts = built.parts;
    if (this.boss) this._scaleUpBoss();
    opts.scene.add(this.group);

    this.position = opts.position.clone();
    this.velocity = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.health = this.stats.health * (this.boss ? 3.2 : 1);
    this.maxHealth = this.health;
    this.alive = true;
    this.dead = false;

    this.state = 'idle';
    this.stateTimer = 0;
    this.attackCooldown = 0;
    this.hasLos = false;
    this.lastKnown = new THREE.Vector3();
    this.patrol = opts.patrol || [opts.position.clone()];
    this.patrolIndex = 0;
    this.patrolWait = 0;

    this.animTime = Math.random() * 10;
    this.hitFlash = 0;
    this.deathTimer = 0;

    this._toPlayer = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._probe = new THREE.Vector3();
    this._probeDir = new THREE.Vector3();
    this._projectileRequest = null;

    this.group.position.copy(this.position);
  }

  _scaleUpBoss() {
    this.group.scale.setScalar(1.65);
    this.stats = { ...this.stats, health: this.stats.health * 3.2, damage: this.stats.damage * 1.6, radius: 0.8, height: 2.8 };
    this.health = this.stats.health;
    this.maxHealth = this.health;
  }

  /** Applies damage. Returns true when the hit was fatal. */
  damage(amount, fromPosition) {
    if (!this.alive) return false;
    this.health -= amount;
    this.hitFlash = 1;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.state = 'dead';
      this.deathTimer = 0;
      this.velocity.set(0, 0, 0);
      if (this.audio) this.audio.play('enemyDeath', { volume: 0.85 });
      if (this.onDeath) this.onDeath(this);
      return true;
    }
    // Being hurt wakes the enemy up.
    if (this.state === 'idle' || this.state === 'patrol') {
      this.state = 'chase';
      if (fromPosition) this.lastKnown.copy(fromPosition);
    }
    if (this.audio) this.audio.play('enemyHurt', { volume: 0.5 });
    return false;
  }

  /** Per-frame update. */
  update(dt, player) {
    if (!this.alive) {
      this._updateDeath(dt);
      return;
    }

    this.animTime += dt;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt * 3);

    this._toPlayer.copy(player.position).sub(this.position);
    const distToPlayer = this._toPlayer.length();

    // Line of sight.
    const eyeY = this.position.y + this.stats.height * 0.8;
    this.hasLos =
      distToPlayer < this.stats.sightRange &&
      this.world.lineOfSight(
        this.position.x,
        eyeY,
        this.position.z,
        player.position.x,
        player.position.y + 1.4,
        player.position.z,
        []
      );

    switch (this.state) {
      case 'idle':
      case 'patrol':
        this._updatePatrol(dt);
        if (this.hasLos && distToPlayer < this.stats.sightRange) {
          this.state = 'alert';
          this.stateTimer = 0.45;
          if (this.audio) this.audio.play(this.stats.groan, { volume: 0.55 });
        }
        break;
      case 'alert':
        this.stateTimer -= dt;
        this._faceTarget(player.position, dt, 6);
        if (this.stateTimer <= 0) this.state = 'chase';
        break;
      case 'chase':
        this._updateChase(dt, player, distToPlayer);
        break;
      case 'attack':
        this._updateAttack(dt, player, distToPlayer);
        break;
      case 'stagger':
        this.stateTimer -= dt;
        this._applyGravity(dt);
        if (this.stateTimer <= 0) this.state = 'chase';
        break;
      default:
        break;
    }

    this._integrate(dt);
    this._animate(dt);
  }

  _updatePatrol(dt) {
    this.stateTimer += dt;
    if (this.patrolWait > 0) {
      this.patrolWait -= dt;
      this._moveToward(this.patrol[this.patrolIndex], this.stats.speed * 0.55, dt);
      return;
    }
    if (this.patrol.length > 1) {
      const target = this.patrol[this.patrolIndex];
      const d = this.position.distanceTo(target);
      if (d < 0.6) {
        this.patrolIndex = (this.patrolIndex + 1) % this.patrol.length;
        this.patrolWait = 1.2 + Math.random() * 2.4;
      } else {
        this._moveToward(target, this.stats.speed * 0.6, dt);
      }
    } else {
      this.velocity.multiplyScalar(Math.max(0, 1 - dt * 4));
    }
  }

  _updateChase(dt, player, distToPlayer) {
    const s = this.stats;
    if (this.hasLos) this.lastKnown.copy(player.position);

    const archer = this.type === 'archer';
    if (archer) {
      const pref = s.preferredRange;
      if (distToPlayer < pref * 0.6) {
        // Too close: back away.
        this._desired.copy(this.position).sub(player.position).setY(0).normalize();
        this._moveDirection(this._desired, s.chaseSpeed, dt);
      } else if (distToPlayer > pref * 1.5) {
        this._moveToward(player.position, s.chaseSpeed, dt);
      } else {
        // Strafe to stay awkward to hit.
        this._desired
          .copy(this.position)
          .sub(player.position)
          .setY(0)
          .normalize()
          .cross(UP)
          .multiplyScalar(Math.sin(this.animTime * 0.7) > 0 ? 1 : -1);
        this._moveDirection(this._desired, s.speed * 0.9, dt);
        if (this.attackCooldown <= 0 && this.hasLos) this._beginAttack();
      }
    } else {
      this._moveToward(this.hasLos ? player.position : this.lastKnown, s.chaseSpeed, dt);
      if (distToPlayer <= s.attackRange && this.attackCooldown <= 0 && this.hasLos) {
        this._beginAttack();
      }
    }

    this._faceTarget(this.hasLos ? player.position : this.lastKnown, dt, 5);
  }

  _beginAttack() {
    this.state = 'attack';
    this.stateTimer = this.stats.windup;
    this.attackCooldown = this.stats.attackCooldown;
    this._attackLanded = false;
  }

  _updateAttack(dt, player, distToPlayer) {
    this.stateTimer -= dt;
    this._faceTarget(player.position, dt, 3);
    this.velocity.x *= 0.8;
    this.velocity.z *= 0.8;

    if (this.stateTimer <= 0) {
      // The swing lands now.
      if (this.type === 'archer') {
        this._fireArrow(player);
      } else {
        const reach = this.stats.attackRange + 0.5;
        if (distToPlayer <= reach) {
          if (this.onAttack) this.onAttack(this.stats.damage, this.position);
          if (this.audio) {
            this.audio.play(this.type === 'knight' ? 'knightAttack' : 'meleeHit', { volume: 0.8 });
          }
        } else if (this.audio) {
          this.audio.play('meleeSwing', { volume: 0.5 });
        }
      }
      this.state = 'chase';
    }
  }

  _fireArrow(player) {
    if (this.audio) this.audio.play('archerShoot', { volume: 0.7 });
    const origin = this.position.clone();
    origin.y += this.stats.height * 0.72;
    const target = player.position.clone();
    target.y += 1.1;
    if (this._projectileRequest) this._projectileRequest(this, origin, target);
  }

  _updateDeath(dt) {
    this.deathTimer += dt;
    // Sink and topple.
    const t = Math.min(1, this.deathTimer / 1.2);
    this.group.rotation.x = t * 1.5;
    this.group.position.y = this.position.y - t * 0.25;
    const fade = 1 - Math.max(0, (t - 0.6) / 0.4);
    this.group.traverse((c) => {
      if (c.isMesh && c.material && c.material.transparent !== undefined) {
        if (!c.material.userData.__origOpacity) {
          c.material = c.material.clone();
          c.material.userData.__origOpacity = c.material.opacity;
        }
        c.material.transparent = true;
        c.material.opacity = c.material.userData.__origOpacity * fade;
      }
    });
    if (this.deathTimer > 1.25) this.dead = true;
  }

  /** Steering: move toward a world point while avoiding walls. */
  _moveToward(target, speed, dt) {
    this._desired.copy(target).sub(this.position).setY(0);
    const d = this._desired.length();
    if (d < 0.05) return;
    this._desired.multiplyScalar(1 / d);
    this._moveDirection(this._desired, speed, dt);
  }

  _moveDirection(dir, speed, dt) {
    // Probe forward: if the path ahead is blocked, slide along the wall.
    this._probeDir.copy(dir);
    const probeDist = 0.9;
    this._probe
      .copy(this.position)
      .addScaledVector(dir, probeDist)
      .setY(this.position.y + 0.9);

    const blocked = !this.world.lineOfSight(
      this.position.x,
      this.position.y + 0.9,
      this.position.z,
      this._probe.x,
      this._probe.y,
      this._probe.z,
      []
    );

    if (blocked) {
      // Try rotating the desired direction left and right.
      const left = this._desired
        .copy(dir)
        .applyAxisAngle(UP, 0.9)
        .clone();
      const right = this._desired
        .copy(dir)
        .applyAxisAngle(UP, -0.9)
        .clone();
      const leftClear = this._isClear(left, probeDist);
      const rightClear = this._isClear(right, probeDist);
      if (leftClear && !rightClear) dir = left;
      else if (rightClear && !leftClear) dir = right;
      else if (leftClear && rightClear) dir = Math.random() > 0.5 ? left : right;
      else dir = left;
    }

    this.velocity.x += (dir.x * speed - this.velocity.x) * Math.min(1, dt * 7);
    this.velocity.z += (dir.z * speed - this.velocity.z) * Math.min(1, dt * 7);
  }

  _isClear(dir, dist) {
    const x = this.position.x + dir.x * dist;
    const z = this.position.z + dir.z * dist;
    return this.world.lineOfSight(
      this.position.x,
      this.position.y + 0.9,
      this.position.z,
      x,
      this.position.y + 0.9,
      z,
      []
    );
  }

  _faceTarget(target, dt, rate) {
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const desired = Math.atan2(dx, dz);
    let diff = desired - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * Math.min(1, dt * rate);
  }

  _applyGravity(dt) {
    this.velocity.y -= 20 * dt;
  }

  _integrate(dt) {
    this._applyGravity(dt);
    const delta = {
      x: this.velocity.x * dt,
      y: this.velocity.y * dt,
      z: this.velocity.z * dt,
    };
    const res = this.world.moveCylinder(
      this.position,
      this.stats.radius,
      this.stats.height,
      delta,
      true
    );
    this.position.set(res.x, res.y, res.z);
    if (res.grounded) this.velocity.y = 0;
    if (res.hitWall) {
      this.velocity.x *= 0.5;
      this.velocity.z *= 0.5;
    }
  }

  /**
   * Animates the body.
   *
   * Each part is a group whose rest pose is baked into its geometry and
   * which sits on its joint, so the rotations below are deltas applied on
   * top of that rest pose.
   */
  _animate(dt) {
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const t = this.animTime;
    const p = this.parts;
    const gait = t * (3 + speed * 2.2);

    this.group.position.copy(this.position);
    this.group.rotation.y = this.yaw;

    if (p.legL && p.legR) {
      const swing = Math.sin(gait) * Math.min(0.7, 0.18 + speed * 0.16);
      p.legL.rotation.x = swing;
      p.legR.rotation.x = -swing;
    }

    if (p.armL && p.armR) {
      if (this.state === 'attack') {
        // Wind up, then swing through.
        const w = this.stats.windup;
        const k = 1 - Math.max(0, this.stateTimer) / w;
        if (this.type === 'archer') {
          // The bow arm holds; the draw arm pulls back and releases.
          p.armR.rotation.x = k * 0.35;
          p.armL.rotation.x = -k * 0.5;
        } else {
          const swing = k < 0.5 ? -1.4 * (k * 2) : 1.9 * ((k - 0.5) * 2);
          p.armR.rotation.x = swing;
          p.armL.rotation.x = swing * 0.5;
        }
      } else if (this.type === 'archer') {
        // A slow, steady draw.
        p.armR.rotation.x = Math.sin(t * 1.4) * 0.08;
        p.armL.rotation.x = Math.sin(t * 1.4 + 0.6) * 0.05;
      } else {
        const swing = Math.sin(gait) * Math.min(0.5, 0.1 + speed * 0.1);
        p.armR.rotation.x = swing;
        p.armL.rotation.x = -swing;
      }
    }

    if (p.torso) {
      p.torso.rotation.z = Math.sin(gait) * 0.05;
      p.torso.position.y =
        (p.torso.userData.baseY ?? 1.16) + Math.abs(Math.sin(gait)) * 0.03;
    }
    if (p.head) {
      p.head.rotation.y = Math.sin(t * 0.6) * 0.25;
    }
    if (p.weapon) {
      p.weapon.rotation.z = Math.sin(t * 1.1) * 0.08;
    }
    if (p.bow) {
      p.bow.rotation.z = Math.sin(t * 0.9) * 0.06;
    }
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.group.traverse((c) => {
      if (c.isMesh) c.geometry.dispose();
    });
  }
}

/**
 * Manages the enemy population.
 */
export class EnemyManager {
  constructor(opts) {
    this.scene = opts.scene;
    this.world = opts.world;
    this.materials = opts.materials;
    this.audio = opts.audio;
    this.particles = opts.particles;
    this.onAttack = opts.onAttack || null;
    this.onDeath = opts.onDeath || null;
    this.enemies = [];
    this.killCount = 0;
    this._projectileHandler = opts.onProjectile || null;
  }

  spawn(type, position, patrol, opts = {}) {
    const e = new Enemy(type, {
      world: this.world,
      scene: this.scene,
      materials: this.materials,
      position,
      patrol,
      audio: this.audio,
      particles: this.particles,
      onAttack: this.onAttack,
      onDeath: this.onDeath,
      boss: opts.boss,
    });
    e._projectileRequest = this._projectileHandler;
    this.enemies.push(e);
    return e;
  }

  /**
   * Finds the first enemy hit by a ray.
   *
   * Each enemy is approximated by a vertical capsule: a cylinder spanning the
   * body, closed by a sphere at the top (the head) and one at the bottom (the
   * feet). Using a capsule rather than a plain cylinder means a shot aimed at
   * the head still connects.
   *
   * The nearest hit wins, and hits beyond `maxDist` are ignored so a wall in
   * front of the enemy takes precedence.
   *
   * @param {{x,y,z}} origin
   * @param {{x,y,z}} dir normalised
   * @param {number} maxDist
   * @returns {null | {enemy, distance, point, normal}}
   */
  raycast(origin, dir, maxDist) {
    let best = null;
    let bestT = maxDist;

    for (const e of this.enemies) {
      if (!e.alive) continue;
      const r = e.stats.radius + 0.2; // a little forgiveness
      const h = e.stats.height;
      const ax = e.position.x;
      const az = e.position.z;
      const ay = e.position.y + r; // bottom sphere centre
      const by = e.position.y + h - r; // top sphere centre

      let t = Infinity;
      let hitY = 0;

      // --- the cylindrical body ---------------------------------------
      const ox = origin.x - ax;
      const oz = origin.z - az;
      const a = dir.x * dir.x + dir.z * dir.z;
      if (a > 1e-8) {
        const b = 2 * (ox * dir.x + oz * dir.z);
        const c = ox * ox + oz * oz - r * r;
        const disc = b * b - 4 * a * c;
        if (disc >= 0) {
          const sq = Math.sqrt(disc);
          let t0 = (-b - sq) / (2 * a);
          let t1 = (-b + sq) / (2 * a);
          if (t0 < 0) t0 = 0;
          // The body is valid between the two sphere centres.
          const y0 = origin.y + dir.y * t0;
          const y1 = origin.y + dir.y * t1;
          if (y0 >= ay && y0 <= by) {
            t = t0;
            hitY = y0;
          } else if (y1 >= ay && y1 <= by) {
            t = t1;
            hitY = y1;
          }
        }
      }

      // --- the head and foot spheres -----------------------------------
      const sphereT = this._raySphere(origin, dir, ax, by, az, r);
      if (sphereT !== null && sphereT < t) {
        t = sphereT;
        hitY = origin.y + dir.y * sphereT;
      }
      const footT = this._raySphere(origin, dir, ax, ay, az, r);
      if (footT !== null && footT < t) {
        t = footT;
        hitY = origin.y + dir.y * footT;
      }

      if (t === Infinity || t < 0 || t >= bestT) continue;
      // A shot that passes over the head must not connect.
      if (hitY < e.position.y || hitY > e.position.y + h) continue;

      bestT = t;
      best = {
        enemy: e,
        distance: t,
        point: {
          x: origin.x + dir.x * t,
          y: hitY,
          z: origin.z + dir.z * t,
        },
        normal: {
          x: (origin.x + dir.x * t - ax) / r,
          y: 0,
          z: (origin.z + dir.z * t - az) / r,
        },
      };
    }
    return best;
  }

  /**
   * Ray/sphere intersection.
   * @returns {number|null} the distance along the ray, or null
   */
  _raySphere(origin, dir, cx, cy, cz, r) {
    const ox = origin.x - cx;
    const oy = origin.y - cy;
    const oz = origin.z - cz;
    const b = 2 * (ox * dir.x + oy * dir.y + oz * dir.z);
    const c = ox * ox + oy * oy + oz * oz - r * r;
    const disc = b * b - 4 * c;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    let t = (-b - sq) / 2;
    if (t < 0) t = (-b + sq) / 2;
    return t < 0 ? null : t;
  }

  update(dt, player) {
    for (const e of this.enemies) {
      if (e.dead) continue;
      e.update(dt, player);
    }
  }

  /**
   * Hides enemies that are far from the player.
   *
   * A distant undead still needs to think (so it is ready when the player
   * arrives) but does not need to be drawn. This keeps the draw call count
   * low in the large open areas of the cathedral.
   *
   * @param {THREE.Vector3} cameraPos
   * @param {number} maxDist
   */
  cull(cameraPos, maxDist = 34) {
    const limitSq = maxDist * maxDist;
    for (const e of this.enemies) {
      if (e.dead) {
        e.group.visible = false;
        continue;
      }
      const dx = e.position.x - cameraPos.x;
      const dz = e.position.z - cameraPos.z;
      const dy = e.position.y - cameraPos.y;
      e.group.visible = dx * dx + dz * dz + dy * dy < limitSq;
    }
  }

  /** Applies damage to every enemy within a small radius of a point. */
  damageAt(point, radius, damage, exclude) {
    let hits = 0;
    for (const e of this.enemies) {
      if (!e.alive || e === exclude) continue;
      const dx = e.position.x - point.x;
      const dz = e.position.z - point.z;
      const dy = e.position.y - point.y;
      if (dx * dx + dz * dz + dy * dy <= radius * radius) {
        e.damage(damage, point);
        hits++;
      }
    }
    return hits;
  }

  get aliveCount() {
    let n = 0;
    for (const e of this.enemies) if (e.alive) n++;
    return n;
  }

  /** Finds the nearest living enemy to a point. */
  nearest(point, maxDist = Infinity) {
    let best = null;
    let bestD = maxDist;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = e.position.distanceTo(point);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  clear() {
    for (const e of this.enemies) e.dispose();
    this.enemies.length = 0;
  }
}

export { ARCHETYPES };
