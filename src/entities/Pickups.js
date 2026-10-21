/**
 * Pickups.js — ammunition, healing draughts and quest items.
 *
 * Pickups are small procedural meshes that float and spin slowly, with a
 * faint glow so they read in the gloom.
 */

import * as THREE from 'three';

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

    let mesh;
    if (o.type === 'health') {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshStandardMaterial({
        color: 0x8e1f1f,
        roughness: 0.35,
        metalness: 0.1,
        emissive: 0x3a0808,
        emissiveIntensity: 0.8,
      }));
      const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.09, 8), m.woodDark);
      cork.position.y = 0.17;
      group.add(cork);
    } else if (o.type === 'key') {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.05), m.bone);
      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.022, 5, 12), m.bone);
      bow.position.y = 0.24;
      group.add(bow);
      const bit = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.05), m.bone);
      bit.position.set(0.06, -0.16, 0);
      group.add(bit);
    } else if (o.kind === 'powder') {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.22, 8), m.ironDark);
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.04, 8), m.iron);
      lid.position.y = 0.12;
      group.add(lid);
    } else if (o.kind === 'souls') {
      mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 0), new THREE.MeshBasicMaterial({
        color: 0x7ee89a,
      }));
    } else {
      // A bundle of bolts.
      mesh = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.44, 5), m.bone);
        b.position.set((i - 1.5) * 0.035, 0, (i % 2) * 0.03);
        b.rotation.z = (i - 1.5) * 0.06;
        mesh.add(b);
      }
    }
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
