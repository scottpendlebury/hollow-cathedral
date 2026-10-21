/**
 * Level.js — "The Hollow Cathedral".
 *
 * The level is authored as a set of rooms joined by corridors and doorways.
 * Walls are built from extruded shapes with real arch openings cut into them,
 * so the geometry, the colliders and the sight lines all agree.
 *
 * Layout (looking down, +X east, +Z south):
 *
 *      [ OSSUARY ]---(west door)---[ THE NAVE ]---(sanctum gate)---[ APSE ]
 *                                     ^
 *                                     |
 *                               [ THRESHOLD ]  (player spawn)
 */

import * as THREE from 'three';
import { GeoBatch } from './GeoBatch.js';
import * as Kit from './Kit.js';
import { Box } from '../core/Physics.js';

const WALL_T = 0.7;

/**
 * Flame materials, shared by every torch and brazier in the level.
 *
 * A fresh material per flame meant the level could not batch them: each
 * flame was its own draw call.
 */
const KIT_FLAME_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0xffb055,
  transparent: true,
  opacity: 0.92,
});
const KIT_SICK_FLAME_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0x6fbf5a,
  transparent: true,
  opacity: 0.92,
});

export class Level {
  /**
   * @param {THREE.Scene} scene
   * @param {import('../core/Physics.js').CollisionWorld} world
   * @param {object} materials
   */
  constructor(scene, world, materials) {
    this.scene = scene;
    this.world = world;
    this.materials = materials;
    this.batch = new GeoBatch(2.6);
    this.root = new THREE.Group();
    this.root.name = 'level';
    scene.add(this.root);

    /** Interactable entities registered by the level. */
    this.interactables = [];
    /** Light emitters (flames) that the light pool can service. */
    this.lightEmitters = [];
    /** Enemy spawn descriptors. */
    this.enemySpawns = [];
    /** Pickup descriptors. */
    this.pickupSpawns = [];
    /** Marker positions used for navigation and scripted beats. */
    this.markers = {};

    /**
     * Flames, drawn as instanced meshes.
     *
     * Each flame used to be its own mesh, which meant the level issued a
     * draw call per torch. One InstancedMesh per colour draws them all.
     */
    this.flameMeshes = new Map();
    this.flameInstances = [];

    this._tmpMat = new THREE.Matrix4();
  }

  // ------------------------------------------------------------- building

  /**
   * Builds the whole cathedral. Call once.
   */
  build() {
    this._buildThreshold();
    this._buildNave();
    this._buildOssuary();
    this._buildApse();

    this.batch.build(this.root);
    this._buildFlameMeshes();
    this.root.updateMatrixWorld(true);
    return this;
  }

  /**
   * Records a flame for instanced rendering.
   * @returns {number} the instance index, used to animate the flame
   */
  _addFlame(x, y, z, radius, material) {
    const list = this.flameInstances;
    let group = this.flameMeshes.get(material);
    if (!group) {
      group = { material, radius, items: [] };
      this.flameMeshes.set(material, group);
    }
    group.items.push({ x, y, z, radius, scale: 1 });
    list.push(group);
    return group.items.length - 1;
  }

  /**
   * Creates one InstancedMesh per flame colour and writes the instance
   * transforms. Called once, after the level geometry has been built.
   */
  _buildFlameMeshes() {
    const dummy = new THREE.Object3D();
    for (const group of this.flameMeshes.values()) {
      const geometry = new THREE.SphereGeometry(1, 8, 6);
      const mesh = new THREE.InstancedMesh(geometry, group.material, group.items.length);
      mesh.frustumCulled = false;
      group.items.forEach((item, i) => {
        dummy.position.set(item.x, item.y, item.z);
        dummy.scale.set(item.radius, item.radius * 1.25, item.radius);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.root.add(mesh);
      group.mesh = mesh;
    }
  }

  /** Adds a floor slab and its collider. */
  _floor(minX, maxX, minZ, maxZ, y = 0, material = this.materials.floor) {
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const w = maxX - minX;
    const d = maxZ - minZ;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.6, d), material);
    m.position.set(cx, y - 0.3, cz);
    this.batch.add(m);
    this.world.add(new Box(minX, y - 0.6, minZ, maxX, y, maxZ, 'floor'));
  }

  /** Adds a ceiling slab. */
  _ceiling(minX, maxX, minZ, maxZ, y, material = this.materials.stoneDark) {
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const m = new THREE.Mesh(new THREE.BoxGeometry(maxX - minX, 0.5, maxZ - minZ), material);
    m.position.set(cx, y + 0.25, cz);
    this.batch.add(m);
  }

  /**
   * Builds a wall running along the X axis.
   *
   * @param {number} x0 west end @param {number} x1 east end
   * @param {number} z centre line
   * @param {object} o { height, thickness, base, openings, material, collide }
   *   openings: [{ at, width, height, sill, arched, door }]
   */
  _wallX(x0, x1, z, o) {
    const height = o.height ?? 6;
    const t = o.thickness ?? WALL_T;
    const base = o.base ?? 0;
    const material = o.material ?? this.materials.stone;
    const openings = (o.openings || []).slice().sort((a, b) => a.at - b.at);

    const shape = new THREE.Shape();
    shape.moveTo(x0, base);
    shape.lineTo(x1, base);
    shape.lineTo(x1, base + height);
    shape.lineTo(x0, base + height);
    shape.lineTo(x0, base);

    for (const op of openings) {
      const hole = this._openingPath(op, base);
      shape.holes.push(hole);
    }

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: t,
      bevelEnabled: false,
      curveSegments: 6,
    });
    geo.translate(0, 0, -t / 2);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.z = z;
    this.batch.add(mesh);

    // Colliders: solid spans between openings, plus a cap over each arch.
    if (o.collide !== false) {
      let cursor = x0;
      for (const op of openings) {
        const a = op.at - op.width / 2;
        const b = op.at + op.width / 2;
        if (a > cursor) {
          this.world.add(new Box(cursor, base - 0.5, z - t / 2, a, base + height, z + t / 2, 'wall'));
        }
        // Below the sill.
        if (op.sill > base) {
          this.world.add(new Box(a, base - 0.5, z - t / 2, b, base + op.sill, z + t / 2, 'wall'));
        }
        // Cap over the arch crown so nothing leaks through the spandrel.
        const r = op.width / 2;
        const apex = base + op.sill + (op.height - op.sill) + r * 0.62;
        if (apex < base + height) {
          this.world.add(new Box(a, apex, z - t / 2, b, base + height, z + t / 2, 'wall'));
        }
        cursor = b;
      }
      if (cursor < x1) {
        this.world.add(new Box(cursor, base - 0.5, z - t / 2, x1, base + height, z + t / 2, 'wall'));
      }
    }
  }

  /**
   * Builds a wall running along the Z axis.
   */
  _wallZ(z0, z1, x, o) {
    const height = o.height ?? 6;
    const t = o.thickness ?? WALL_T;
    const base = o.base ?? 0;
    const material = o.material ?? this.materials.stone;
    const openings = (o.openings || []).slice().sort((a, b) => a.at - b.at);

    const shape = new THREE.Shape();
    shape.moveTo(z0, base);
    shape.lineTo(z1, base);
    shape.lineTo(z1, base + height);
    shape.lineTo(z0, base + height);
    shape.lineTo(z0, base);

    for (const op of openings) {
      shape.holes.push(this._openingPath(op, base));
    }

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: t,
      bevelEnabled: false,
      curveSegments: 6,
    });
    geo.translate(0, 0, -t / 2);
    geo.rotateY(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, 0, 0);
    this.batch.add(mesh);

    if (o.collide !== false) {
      let cursor = z0;
      for (const op of openings) {
        const a = op.at - op.width / 2;
        const b = op.at + op.width / 2;
        if (a > cursor) {
          this.world.add(new Box(x - t / 2, base - 0.5, cursor, x + t / 2, base + height, a, 'wall'));
        }
        if (op.sill > base) {
          this.world.add(new Box(x - t / 2, base - 0.5, a, x + t / 2, base + op.sill, b, 'wall'));
        }
        const r = op.width / 2;
        const apex = base + op.sill + (op.height - op.sill) + r * 0.62;
        if (apex < base + height) {
          this.world.add(new Box(x - t / 2, apex, a, x + t / 2, base + height, b, 'wall'));
        }
        cursor = b;
      }
      if (cursor < z1) {
        this.world.add(new Box(x - t / 2, base - 0.5, cursor, x + t / 2, base + height, z1, 'wall'));
      }
    }
  }

  /**
   * Builds the path of an opening cut into a wall.
   * @param {object} op { at, width, height, sill, arched }
   */
  _openingPath(op, base) {
    const halfW = op.width / 2;
    const bottom = base + (op.sill || 0);
    const top = base + op.height;
    const path = new THREE.Path();
    if (op.arched === false) {
      path.moveTo(op.at - halfW, bottom);
      path.lineTo(op.at + halfW, bottom);
      path.lineTo(op.at + halfW, top);
      path.lineTo(op.at - halfW, top);
      path.lineTo(op.at - halfW, bottom);
      return path;
    }
    const r = halfW;
    const apex = top + r * 0.62;
    path.moveTo(op.at - halfW, bottom);
    path.lineTo(op.at - halfW, top);
    path.quadraticCurveTo(op.at - halfW * 0.55, apex * 0.97 - base * 0.03, op.at, apex);
    path.quadraticCurveTo(op.at + halfW * 0.55, apex * 0.97 - base * 0.03, op.at + halfW, top);
    path.lineTo(op.at + halfW, bottom);
    path.lineTo(op.at - halfW, bottom);
    return path;
  }

  /** Adds a solid block to the scene and the collision world. */
  _block(x, y, z, w, h, d, material, tag = 'prop') {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, y + h / 2, z);
    this.batch.add(m);
    this.world.add(new Box(x - w / 2, y, z - d / 2, x + w / 2, y + h, z + d / 2, tag));
    return m;
  }

  // -------------------------------------------------------------- regions

  _buildThreshold() {
    const m = this.materials;
    const minX = -7;
    const maxX = 7;
    const minZ = 32;
    const maxZ = 46;
    const h = 5.2;

    this._floor(minX, maxX, minZ, maxZ);
    this._ceiling(minX, maxX, minZ, maxZ, h);

    this._wallX(minX, maxX, maxZ, { height: h, openings: [] });
    this._wallX(minX, maxX, minZ, {
      height: h,
      openings: [{ at: 0, width: 3.4, height: 3.2, arched: true }],
    });
    this._wallZ(minZ, maxZ, minX, {
      height: h,
      openings: [{ at: 41, width: 2.2, height: 2.6, arched: true }],
    });
    this._wallZ(minZ, maxZ, maxX, {
      height: h,
      openings: [{ at: 37, width: 2.2, height: 2.6, arched: true }],
    });

    // A heavy barred door in the west opening, permanently shut.
    const barred = Kit.gate(m, minX, 41, 2.2, 2.6, 'z');
    this.batch.add(barred);
    this.world.add(new Box(minX - 0.3, 0, 40.2, minX + 0.3, 2.8, 41.8, 'wall'));

    // Braziers flanking the exit to the nave.
    this._brazier(-2.6, 33.4);
    this._brazier(2.6, 33.4);

    // A broken wagon and scattered crates tell the story of a failed escape.
    this.batch.add(Kit.rubble(m, -4.2, 41, 7, 2.2));
    this._block(4.6, 0, 42.5, 1.6, 1.0, 1.6, m.wood, 'prop');
    this._block(-3.4, 0, 36.4, 1.3, 0.8, 1.3, m.woodDark, 'prop');

    // The first signpost of the game: a note nailed to the wall.
    this._tablet(6.2, 1.5, 38, -Math.PI / 2, 'THE DESCENT BEGINS BELOW');

    this.markers.spawn = new THREE.Vector3(0, 0, 42);
    // Yaw 0 looks down -Z, which is north toward the nave exit.
    this.markers.spawnYaw = 0;

    this.enemySpawns.push({
      type: 'husk',
      position: new THREE.Vector3(3.4, 0, 35.5),
      patrol: [
        new THREE.Vector3(3.4, 0, 35.5),
        new THREE.Vector3(-3.4, 0, 37.5),
      ],
    });
  }

  _buildNave() {
    const m = this.materials;
    const minX = -13;
    const maxX = 13;
    const minZ = -2;
    const maxZ = 32;
    const h = 10;

    this._floor(minX, maxX, minZ, maxZ);
    this._ceiling(minX, maxX, minZ, maxZ, h);

    // South wall: doorway back to the threshold.
    this._wallX(minX, maxX, maxZ, {
      height: h,
      openings: [{ at: 0, width: 3.4, height: 3.2, arched: true }],
    });

    // North wall: the sanctum gate.
    this._wallX(minX, maxX, minZ, {
      height: h,
      openings: [{ at: 0, width: 5, height: 4.2, arched: true }],
    });

    // West wall: door into the ossuary.
    this._wallZ(minZ, maxZ, minX, {
      height: h,
      openings: [{ at: 10, width: 2.6, height: 3, arched: true }],
    });

    // East wall: blind arcade, tall windows.
    this._wallZ(minZ, maxZ, maxX, {
      height: h,
      openings: [
        { at: 3, width: 2.4, height: 3.4, sill: 4.2 },
        { at: 13, width: 2.4, height: 3.4, sill: 4.2 },
        { at: 23, width: 2.4, height: 3.4, sill: 4.2 },
      ],
    });

    // West wall high windows too, so the hall is not one-sided.
    this._wallZ(minZ, maxZ, minX, {
      height: h,
      openings: [
        { at: 3, width: 2.4, height: 3.4, sill: 4.2 },
        { at: 23, width: 2.4, height: 3.4, sill: 4.2 },
      ],
    });

    // --- the landmark: the Broken Saint at the crossing ----------------
    this.batch.add(Kit.brokenSaint(m, 0, 16));
    this.world.add(new Box(-1.1, 0, 14.9, 1.1, 0.8, 17.1, 'prop'));
    this.markers.landmark = new THREE.Vector3(0, 0, 16);

    // --- colonnade ------------------------------------------------------
    for (let z = 3; z <= 27; z += 6) {
      for (const cx of [-6.4, 6.4]) {
        this.batch.add(Kit.column(m, cx, z, h - 1.4, 0.44));
        this.world.add(new Box(cx - 0.5, 0, z - 0.5, cx + 0.5, h - 1.4, z + 0.5, 'prop'));
        // Arcade arch between adjacent columns.
        if (z + 6 <= 28) {
          const arch = new THREE.Mesh(Kit.ribArch(6, 3.2, 1.2, 0.4), m.stoneDark);
          arch.position.set(cx, h - 4.6, z + 3);
          arch.rotation.y = Math.PI / 2;
          this.batch.add(arch);
        }
      }
    }

    // --- pews -----------------------------------------------------------
    for (let z = 6; z <= 24; z += 3.2) {
      for (const cx of [-3.2, 3.2]) {
        this.batch.add(Kit.pew(m, cx, z, 0, 4.4));
        this.world.add(new Box(cx - 2.2, 0, z - 0.3, cx + 2.2, 0.95, z + 0.3, 'prop'));
      }
    }

    // --- altar ----------------------------------------------------------
    this._block(0, 0, 1.2, 6.4, 0.5, 2.2, m.stone, 'prop');
    this._block(0, 0.5, 1.2, 4.4, 0.35, 1.6, m.stoneDark, 'prop');
    this.batch.add(Kit.lectern(m, -4.4, 3.4, 0.4));

    // --- lighting -------------------------------------------------------
    for (const z of [3, 9, 21, 27]) {
      this._torch(-12.4, 3.4, z, Math.PI / 2);
      this._torch(12.4, 3.4, z, -Math.PI / 2);
    }
    this._brazier(-8.4, 13);
    this._brazier(8.4, 13);
    this._brazier(-4.5, 5.4);
    this._brazier(4.5, 5.4);

    this.batch.add(Kit.chandelier(m, 0, 6.4, 13, 1.05));
    this.batch.add(Kit.chandelier(m, 0, 6.4, 23, 1.05));

    // --- decoration -----------------------------------------------------
    this.batch.add(Kit.banner(m, -12.5, 7.4, 17, Math.PI / 2, 3.6));
    this.batch.add(Kit.banner(m, 12.5, 7.4, 17, -Math.PI / 2, 3.6));
    this.batch.add(Kit.chain(m, -4.2, 9.2, 8.5, 3.4));
    this.batch.add(Kit.chain(m, 5.6, 9.2, 25.5, 2.8));
    this.batch.add(Kit.rubble(m, -11, 29, 8, 2.6));
    this.batch.add(Kit.rubble(m, 10.6, 6.5, 6, 2.2));
    this.batch.add(Kit.sarcophagus(m, -9.6, 18.5, 0.2));
    this.batch.add(Kit.sarcophagus(m, 9.6, 20.5, -0.15));

    // Stained glass, glowing faintly.
    for (const z of [3, 13, 23]) {
      const win = Kit.stainedWindow(m, 12.4, 5.9, z, 2.3, 3.2, -Math.PI / 2);
      this.batch.addSeparate(win);
    }
    for (const z of [3, 23]) {
      const win = Kit.stainedWindow(m, -12.4, 5.9, z, 2.3, 3.2, Math.PI / 2);
      this.batch.addSeparate(win);
    }

    // --- the sanctum gate (locked until the Bone Key is found) ----------
    this._sanctumGate = this._buildSanctumGate(0, -2, 5, 4.2);

    // --- encounters -----------------------------------------------------
    this.enemySpawns.push(
      {
        type: 'husk',
        position: new THREE.Vector3(-4, 0, 26),
        patrol: [
          new THREE.Vector3(-4, 0, 26),
          new THREE.Vector3(4, 0, 24),
          new THREE.Vector3(0, 0, 21),
        ],
      },
      {
        type: 'husk',
        position: new THREE.Vector3(4.5, 0, 19.5),
        patrol: [
          new THREE.Vector3(4.5, 0, 19.5),
          new THREE.Vector3(4.5, 0, 11),
        ],
      },
      {
        type: 'archer',
        position: new THREE.Vector3(-5.5, 0, 8),
        patrol: [
          new THREE.Vector3(-5.5, 0, 8),
          new THREE.Vector3(-9, 0, 12),
        ],
      },
      {
        type: 'husk',
        position: new THREE.Vector3(0, 0, 5),
        patrol: [
          new THREE.Vector3(0, 0, 5),
          new THREE.Vector3(7, 0, 7),
          new THREE.Vector3(0, 0, 9),
        ],
      },
      {
        type: 'knight',
        position: new THREE.Vector3(0, 0, 20),
        patrol: [
          new THREE.Vector3(0, 0, 20),
          new THREE.Vector3(-8, 0, 20),
        ],
      }
    );

    // --- pickups --------------------------------------------------------
    this.pickupSpawns.push(
      { type: 'ammo', kind: 'bolts', amount: 12, position: new THREE.Vector3(-11.4, 0, 29) },
      { type: 'ammo', kind: 'powder', amount: 3, position: new THREE.Vector3(11.4, 0, 14) },
      { type: 'health', amount: 25, position: new THREE.Vector3(9.6, 0, 19) },
      { type: 'ammo', kind: 'souls', amount: 6, position: new THREE.Vector3(-4.6, 0, 4.6) }
    );
  }

  _buildOssuary() {
    const m = this.materials;
    const minX = -28;
    const maxX = -13;
    const minZ = 4;
    const maxZ = 16;
    const h = 3.9;

    this._floor(minX, maxX, minZ, maxZ);
    this._ceiling(minX, maxX, minZ, maxZ, h);

    this._wallX(minX, maxX, maxZ, { height: h, openings: [] });
    this._wallX(minX, maxX, minZ, { height: h, openings: [] });
    this._wallZ(minZ, maxZ, minX, { height: h, openings: [] });
    this._wallZ(minZ, maxZ, maxX, {
      height: h,
      openings: [{ at: 10, width: 2.6, height: 3, arched: true }],
    });

    // A sealed niche in the far wall holding the Bone Key.
    this._block(-27.2, 0, 9.4, 1.4, 2.6, 2.6, m.stoneDark, 'wall');
    this._block(-26.4, 2.6, 9.4, 1.6, 0.5, 3.0, m.stone, 'prop');

    // Bone piles everywhere.
    this.batch.add(Kit.bonePile(m, -25, 12, 1.2));
    this.batch.add(Kit.bonePile(m, -22, 6.5, 1.0));
    this.batch.add(Kit.bonePile(m, -17.5, 13, 1.3));
    this.batch.add(Kit.bonePile(m, -20.5, 10, 0.9));

    // Sarcophagi stacked against the wall.
    this.batch.add(Kit.sarcophagus(m, -16.4, 6, Math.PI / 2));
    this.batch.add(Kit.sarcophagus(m, -24.4, 14.6, 0.1));

    this._torch(-27.4, 2.6, 6.4, 0);
    this._torch(-27.4, 2.6, 13.4, 0);
    this._brazier(-19, 9);

    this._tablet(-27.4, 1.6, 12, -Math.PI / 2, 'HERE LIE THE NAMELESS');

    this.enemySpawns.push({
      type: 'husk',
      position: new THREE.Vector3(-19, 0, 8),
      patrol: [
        new THREE.Vector3(-19, 0, 8),
        new THREE.Vector3(-23, 0, 12),
      ],
    });
    this.enemySpawns.push({
      type: 'archer',
      position: new THREE.Vector3(-24, 0, 6),
      patrol: [
        new THREE.Vector3(-24, 0, 6),
        new THREE.Vector3(-18, 0, 6),
      ],
    });

    this.pickupSpawns.push(
      { type: 'ammo', kind: 'powder', amount: 3, position: new THREE.Vector3(-16.5, 0, 13.5) },
      { type: 'health', amount: 40, position: new THREE.Vector3(-24.5, 0, 10) }
    );

    this.markers.keyPedestal = new THREE.Vector3(-26.3, 0, 9.4);
  }

  _buildApse() {
    const m = this.materials;
    const minX = -14;
    const maxX = 14;
    const minZ = -30;
    const maxZ = -2;
    const h = 13;

    this._floor(minX, maxX, minZ, maxZ);
    this._ceiling(minX, maxX, minZ, maxZ, h);

    this._wallX(minX, maxX, maxZ, {
      height: h,
      openings: [{ at: 0, width: 5, height: 4.2, arched: true }],
    });
    this._wallX(minX, maxX, minZ, {
      height: h,
      openings: [{ at: 0, width: 3.4, height: 3.6, arched: true }],
    });
    this._wallZ(minZ, maxZ, minX, { height: h, openings: [] });
    this._wallZ(minZ, maxZ, maxX, {
      height: h,
      openings: [
        { at: -20, width: 2.4, height: 3.4, sill: 5 },
        { at: -10, width: 2.4, height: 3.4, sill: 5 },
      ],
    });

    // Ring of columns around the arena.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.4;
      const cx = Math.cos(a) * 10.5;
      const cz = -16 + Math.sin(a) * 10.5;
      if (cz > -3) continue;
      this.batch.add(Kit.column(m, cx, cz, h - 2, 0.5));
      this.world.add(new Box(cx - 0.55, 0, cz - 0.55, cx + 0.55, h - 2, cz + 0.55, 'prop'));
    }

    // The dais at the north end, where the Warden waits.
    this._block(0, 0, -27.4, 9, 0.6, 6, m.stone, 'prop');
    this._block(0, 0.6, -27.6, 5.4, 0.4, 3.4, m.stoneDark, 'prop');
    this.batch.add(Kit.brokenSaint(m, 0, -28.4));

    // The exit door, sealed until the Warden falls.
    this._exitGate = this._buildExitGate(0, -30, 3.4, 3.6);

    // Sickly green braziers — the apse is lit wrong.
    this._brazier(-6, -8, 0x6fbf5a);
    this._brazier(6, -8, 0x6fbf5a);
    this._brazier(-6, -20, 0x6fbf5a);
    this._brazier(6, -20, 0x6fbf5a);
    this._torch(-13.4, 3.6, -12, Math.PI / 2);
    this._torch(13.4, 3.6, -12, -Math.PI / 2);

    this.batch.add(Kit.rubble(m, -12, -6, 9, 3));
    this.batch.add(Kit.rubble(m, 12.5, -24, 8, 2.6));
    this.batch.add(Kit.bonePile(m, -9, -24, 1.4));
    this.batch.add(Kit.bonePile(m, 8.5, -26, 1.2));
    this.batch.add(Kit.chain(m, 0, 12, -18, 4.5));

    for (const z of [-20, -10]) {
      const win = Kit.stainedWindow(m, 13.4, 6.6, z, 2.3, 3.2, -Math.PI / 2);
      this.batch.addSeparate(win);
    }

    this.markers.bossArena = new THREE.Vector3(0, 0, -20);
    this.markers.exit = new THREE.Vector3(0, 0, -33);

    this.enemySpawns.push(
      {
        type: 'knight',
        position: new THREE.Vector3(0, 0, -26),
        patrol: [new THREE.Vector3(0, 0, -26)],
        boss: true,
      },
      {
        type: 'husk',
        position: new THREE.Vector3(-8, 0, -10),
        patrol: [
          new THREE.Vector3(-8, 0, -10),
          new THREE.Vector3(-8, 0, -16),
        ],
      },
      {
        type: 'archer',
        position: new THREE.Vector3(8, 0, -12),
        patrol: [
          new THREE.Vector3(8, 0, -12),
          new THREE.Vector3(8, 0, -18),
        ],
      }
    );

    this.pickupSpawns.push(
      { type: 'ammo', kind: 'bolts', amount: 20, position: new THREE.Vector3(-12, 0, -5) },
      { type: 'ammo', kind: 'souls', amount: 8, position: new THREE.Vector3(12, 0, -24) },
      { type: 'health', amount: 50, position: new THREE.Vector3(0, 0, -8) }
    );
  }

  // ------------------------------------------------------------- fixtures

  /** A wall-mounted torch: bracket, shaft, flame and a light emitter. */
  _torch(x, y, z, rotY) {
    const t = Kit.wallTorch(this.materials, x, y, z, rotY);
    this.batch.add(t);
    // The flame is drawn as one instance of a shared instanced mesh, so
    // every torch in the level costs a single draw call between them.
    const index = this._addFlame(
      x + Math.sin(rotY) * 0.42,
      y + 0.56,
      z + Math.cos(rotY) * 0.42,
      0.13,
      KIT_FLAME_MATERIAL
    );
    this.lightEmitters.push({
      flameIndex: index,
      position: t.userData.lightAnchor.clone(),
      color: 0xffa04a,
      intensity: 26,
      distance: 14,
      flicker: 1,
    });
  }

  /** A standing brazier with coals and a flame. */
  _brazier(x, z, color = 0xff9a3c) {
    const b = Kit.brazier(this.materials, x, z);
    this.batch.add(b);
    const index = this._addFlame(
      x,
      1.28,
      z,
      0.24,
      color === 0x6fbf5a ? KIT_SICK_FLAME_MATERIAL : KIT_FLAME_MATERIAL
    );
    this.lightEmitters.push({
      flameIndex: index,
      position: new THREE.Vector3(x, 1.3, z),
      color,
      intensity: 34,
      distance: 16,
      flicker: 1,
    });
  }

  /** A wall tablet carrying a line of text. */
  _tablet(x, y, z, rotY, text) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = rotY;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.5, 0.12), this.materials.stoneDark);
    g.add(slab);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.25), this.materials.parchment);
    face.position.z = 0.07;
    g.add(face);
    this.batch.add(g);
    this.interactables.push({
      kind: 'tablet',
      position: new THREE.Vector3(x, y, z),
      radius: 2.2,
      text,
      used: false,
      object: g,
    });
  }

  /** The locked sanctum gate; returns a descriptor the game can unlock. */
  _buildSanctumGate(x, z, width, height) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const bars = Math.round(width / 0.34);
    for (let i = 0; i < bars; i++) {
      const t = (i + 0.5) / bars - 0.5;
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, height, 0.1),
        this.materials.ironDark
      );
      bar.position.set(t * width, height / 2, 0);
      g.add(bar);
    }
    for (let i = 0; i < 3; i++) {
      const y = 0.4 + (i * (height - 0.8)) / 2;
      const cross = new THREE.Mesh(
        new THREE.BoxGeometry(width, 0.12, 0.12),
        this.materials.iron
      );
      cross.position.set(0, y, 0);
      g.add(cross);
    }
    // Bone ornaments on the gate face.
    for (let i = 0; i < 5; i++) {
      const skull = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), this.materials.bone);
      skull.position.set(-width / 2 + 0.5 + i * ((width - 1) / 4), height * 0.62, 0.14);
      g.add(skull);
    }
    this.root.add(g);

    const collider = new Box(x - width / 2, 0, z - 0.2, x + width / 2, height, z + 0.2, 'gate');
    this.world.add(collider);

    const gate = {
      kind: 'gate',
      object: g,
      collider,
      locked: true,
      open: false,
      requires: 'boneKey',
      position: new THREE.Vector3(x, 0, z),
      radius: 3.2,
      prompt: 'The gate is sealed. A bone key is required.',
    };
    this.interactables.push(gate);
    return gate;
  }

  /** The exit gate at the north end of the apse. */
  _buildExitGate(x, z, width, height) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, 0.4),
      this.materials.stoneDark
    );
    slab.position.y = height / 2;
    g.add(slab);
    const seal = new THREE.Mesh(
      new THREE.TorusGeometry(0.55, 0.1, 6, 16),
      this.materials.gold
    );
    seal.position.set(0, height * 0.5, 0.24);
    g.add(seal);
    this.root.add(g);

    const collider = new Box(x - width / 2, 0, z - 0.25, x + width / 2, height, z + 0.25, 'gate');
    this.world.add(collider);

    const gate = {
      kind: 'exitGate',
      object: g,
      collider,
      locked: true,
      open: false,
      position: new THREE.Vector3(x, 0, z),
      radius: 3.4,
      prompt: 'The seal holds fast.',
    };
    this.interactables.push(gate);
    return gate;
  }

  // -------------------------------------------------------------- helpers

  /**
   * Returns the spawn transform for the player.
   */
  getSpawn() {
    return {
      position: this.markers.spawn.clone(),
      yaw: this.markers.spawnYaw,
    };
  }
}
