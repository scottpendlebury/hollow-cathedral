/**
 * Pickups.js — ammunition, healing draughts and quest items.
 *
 * Pickups are small procedural meshes that float and spin slowly, with a
 * faint glow so they read in the gloom.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const KINDS = {
  bolts: { color: 0xc9b88a, label: 'Crossbow Bolts' },
  powder: { color: 0x4a4038, label: 'Black Powder' },
  souls: { color: 0x7ee89a, label: 'Soul Essence' },
  health: { color: 0xc03a3a, label: 'Blood Tonic' },
  key: { color: 0xe8dcc0, label: 'Bone Key' },
};

export class Pickup {
  /**
   * @param {object} o { type, kind, amount, position, materials, text }
   */
  constructor(o) {
    this.type = o.type;
    this.kind = o.kind;
    this.amount = o.amount ?? 1;
    this.text = o.text || null;
    this.collected = false;
    this.position = o.position.clone();

    const m = o.materials;
    const group = new THREE.Group();
    group.position.copy(this.position);

    const palette = KINDS[o.kind] || KINDS.bolts;
    this.color = palette.color;

    // Each solid piece is collected as geometry plus a colour, then merged
    // into a single vertex-coloured mesh so a pickup costs one draw call.
    const pieces = [];
    const push = (geometry, material, position, rotation) => {
      const mesh = new THREE.Mesh(geometry, material);
      if (position) mesh.position.set(position[0], position[1], position[2]);
      if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
      mesh.updateMatrix();
      const g = geometry.clone();
      g.applyMatrix4(mesh.matrix);
      const count = g.attributes.position.count;
      const colors = new Float32Array(count * 3);
      for (let k = 0; k < count; k++) {
        colors[k * 3] = material.color.r;
        colors[k * 3 + 1] = material.color.g;
        colors[k * 3 + 2] = material.color.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      if (g.index) {
        const flat = g.toNonIndexed();
        g.dispose();
        pieces.push(flat);
      } else {
        pieces.push(g);
      }
    };

    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.62,
      metalness: 0.14,
    });

    if (o.type === 'health') {
      const blood = new THREE.MeshStandardMaterial({
        color: 0x8e1f1f,
        roughness: 0.35,
        metalness: 0.1,
      });
      push(new THREE.SphereGeometry(0.16, 10, 8), blood, [0, 0, 0]);
      push(new THREE.CylinderGeometry(0.05, 0.06, 0.09, 8), m.woodDark, [0, 0.17, 0]);
    } else if (o.type === 'key') {
      push(new THREE.BoxGeometry(0.05, 0.42, 0.05), m.bone, [0, 0, 0]);
      push(new THREE.TorusGeometry(0.1, 0.022, 5, 12), m.bone, [0, 0.24, 0]);
      push(new THREE.BoxGeometry(0.12, 0.05, 0.05), m.bone, [0.06, -0.16, 0]);
    } else if (o.kind === 'powder') {
      push(new THREE.CylinderGeometry(0.12, 0.12, 0.22, 8), m.ironDark, [0, 0, 0]);
      push(new THREE.CylinderGeometry(0.13, 0.13, 0.04, 8), m.iron, [0, 0.12, 0]);
    } else if (o.kind === 'souls') {
      const soul = new THREE.MeshBasicMaterial({ color: 0x7ee89a });
      push(new THREE.IcosahedronGeometry(0.14, 0), soul, [0, 0, 0]);
    } else {
      // A bundle of bolts.
      for (let k = 0; k < 4; k++) {
        push(
          new THREE.CylinderGeometry(0.018, 0.018, 0.44, 5),
          m.bone,
          [(k - 1.5) * 0.035, 0, (k % 2) * 0.03],
          [0, 0, (k - 1.5) * 0.06]
        );
      }
    }

    const merged = pieces.length === 1 ? pieces[0] : mergeGeometries(pieces, false);
    const mesh = new THREE.Mesh(merged || pieces[0], bodyMaterial);
    group.add(mesh);
    this.mesh = mesh;
    this.group = group;

    // A faint halo so pickups read in the dark.
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 10, 8),
      new THREE.MeshBasicMaterial({
        color: palette.color,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
      })
    );
    group.add(halo);
    this.halo = halo;

    this.baseY = this.position.y + 0.5;
    this.phase = Math.random() * Math.PI * 2;
  }

  update(dt, time) {
    this.group.position.y = this.baseY + Math.sin(time * 1.6 + this.phase) * 0.09;
    this.mesh.rotation.y = time * 0.9 + this.phase;
  }
}

export class PickupManager {
  constructor(opts) {
    this.scene = opts.scene;
    this.materials = opts.materials;
    this.pickups = [];
    this.onCollect = opts.onCollect || null;
  }

  add(type, kind, amount, position, text) {
    const p = new Pickup({
      type,
      kind,
      amount,
      position,
      materials: this.materials,
      text,
    });
    this.scene.add(p.group);
    this.pickups.push(p);
    return p;
  }

  update(dt, time, player) {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.update(dt, time);
      if (p.collected) continue;
      const dx = p.position.x - player.position.x;
      const dz = p.position.z - player.position.z;
      const dy = p.position.y - player.position.y;
      if (dx * dx + dz * dz < 1.1 * 1.1 && dy > -1.5 && dy < 2.5) {
        p.collected = true;
        this.scene.remove(p.group);
        this.pickups.splice(i, 1);
        if (this.onCollect) this.onCollect(p);
      }
    }
  }

  clear() {
    for (const p of this.pickups) this.scene.remove(p.group);
    this.pickups.length = 0;
  }
}
