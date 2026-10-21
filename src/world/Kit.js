/**
 * Kit.js — procedural gothic architecture.
 *
 * Every piece of the cathedral is generated from primitives at load time.
 * Reusable builders are composed into larger structures (aisles, arcades,
 * vaults) so the level can be authored as data while still looking hand-made.
 *
 * Shared geometry and materials are reused aggressively to keep draw calls low.
 */

import * as THREE from 'three';

/**
 * Shared materials for the emissive props.
 *
 * Every torch, brazier, candle and window used to allocate its own
 * material. That gave the level dozens of one-mesh draw calls that could
 * not be batched with anything else. Sharing them lets the whole set of
 * flames merge into a single mesh.
 */
const FLAME_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0xffb055,
  transparent: true,
  opacity: 0.92,
});
const CANDLE_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xffc070 });
const GLASS_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0x2c4a6b,
  transparent: true,
  opacity: 0.85,
  side: THREE.DoubleSide,
});

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
const CYL_LO = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
const CONE = new THREE.ConeGeometry(0.5, 1, 10);
const SPHERE = new THREE.SphereGeometry(0.5, 12, 8);
const PLANE = new THREE.PlaneGeometry(1, 1);

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

/**
 * Creates a mesh from shared geometry, scaled and positioned.
 */
export function part(geometry, material, x, y, z, sx, sy, sz, rotY = 0) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  if (rotY) mesh.rotation.y = rotY;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

export function box(material, x, y, z, sx, sy, sz, rotY = 0) {
  return part(BOX, material, x, y, z, sx, sy, sz, rotY);
}

export function cylinder(material, x, y, z, radius, height, segments = 12) {
  const geo = segments <= 8 ? CYL_LO : CYL;
  return part(geo, material, x, y, z, radius * 2, height, radius * 2);
}

export function cone(material, x, y, z, radius, height) {
  return part(CONE, material, x, y, z, radius * 2, height, radius * 2);
}

export function sphere(material, x, y, z, radius) {
  return part(SPHERE, material, x, y, z, radius * 2, radius * 2, radius * 2);
}

/**
 * A pointed (lancet) gothic arch, extruded. Used for doorways, window
 * openings and arcade bays.
 *
 * @param {number} width  inner opening width
 * @param {number} height springing line height (where the point begins)
 * @param {number} depth  extrusion depth
 * @param {number} thickness wall thickness of the arch band
 */
export function lancetArch(width, height, depth, thickness = 0.35) {
  const shape = new THREE.Shape();
  const halfW = width / 2;
  const r = halfW;
  // Pointed arch: two circular arcs meeting at the apex.
  const apex = height + r * 0.62;
  shape.moveTo(-halfW, 0);
  shape.lineTo(-halfW, height);
  shape.quadraticCurveTo(-halfW * 0.55, apex * 0.97, 0, apex);
  shape.quadraticCurveTo(halfW * 0.55, apex * 0.97, halfW, height);
  shape.lineTo(halfW, 0);
  shape.lineTo(-halfW, 0);

  const hole = new THREE.Path();
  const innerHalf = halfW - thickness;
  const innerApex = height + innerHalf * 0.62;
  hole.moveTo(-innerHalf, 0);
  hole.lineTo(-innerHalf, height);
  hole.quadraticCurveTo(-innerHalf * 0.55, innerApex * 0.97, 0, innerApex);
  hole.quadraticCurveTo(innerHalf * 0.55, innerApex * 0.97, innerHalf, height);
  hole.lineTo(innerHalf, 0);
  hole.lineTo(-innerHalf, 0);
  shape.holes.push(hole);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 6,
  });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

/**
 * A ribbed arch spanning between two points (used for vault ribs and
 * arcade mouldings).
 */
export function ribArch(width, rise, depth, thickness = 0.18) {
  const shape = new THREE.Shape();
  const halfW = width / 2;
  const r = halfW;
  const apex = rise + r * 0.62;
  shape.moveTo(-halfW, 0);
  shape.lineTo(-halfW, rise);
  shape.quadraticCurveTo(-halfW * 0.55, apex * 0.97, 0, apex);
  shape.quadraticCurveTo(halfW * 0.55, apex * 0.97, halfW, rise);
  shape.lineTo(halfW, 0);
  shape.lineTo(-halfW, 0);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 5,
  });
  geo.translate(0, 0, -thickness / 2);
  return geo;
}

/**
 * Clustered gothic column: base, shaft, capital and a carved abacus.
 */
export function column(materials, x, z, height, radius = 0.42) {
  const g = new THREE.Group();
  const m = materials;
  // Plinth
  g.add(box(m.stoneDark, x, 0.16, z, radius * 2.5, 0.32, radius * 2.5));
  g.add(box(m.stone, x, 0.42, z, radius * 2.1, 0.2, radius * 2.1));
  // Shaft, slightly tapered via scale illusion using two stacked cylinders
  g.add(cylinder(m.stone, x, 0.52 + height / 2, z, radius, height, 12));
  // Capital
  g.add(cylinder(m.stoneDark, x, 0.52 + height + 0.12, z, radius * 1.35, 0.26, 12));
  g.add(box(m.stone, x, 0.52 + height + 0.38, z, radius * 2.7, 0.28, radius * 2.7));
  return g;
}

/**
 * Wall section pierced by one or more arched openings.
 *
 * @param {object} opts
 *  - minX,minZ,maxX,maxZ  the wall footprint
 *  - axis 'x' walls run along X, 'z' walls run along Z
 *  - height wall height
 *  - thickness wall thickness
 *  - openings: [{ at, width, height, sill }] positions along the wall axis
 * @param {Array} out array that receives created meshes
 */
export function piercedWall(materials, opts, out) {
  const { minX, minZ, maxX, maxZ, axis, height, thickness = 0.5 } = opts;
  const openings = (opts.openings || []).slice().sort((a, b) => a.at - b.at);

  const along = axis === 'x' ? 'x' : 'z';
  const lo = along === 'x' ? minX : minZ;
  const hi = along === 'x' ? maxX : maxZ;
  const fixed = along === 'x' ? (minZ + maxZ) / 2 : (minX + maxX) / 2;

  // Helper to emit a solid span between two along-axis coordinates.
  const span = (a, b, y0, y1) => {
    const len = b - a;
    if (len <= 0.01 || y1 - y0 <= 0.01) return;
    const mid = (a + b) / 2;
    const cx = along === 'x' ? mid : fixed;
    const cz = along === 'x' ? fixed : mid;
    const sx = along === 'x' ? len : thickness;
    const sz = along === 'x' ? thickness : len;
    out.push(box(materials.stone, cx, (y0 + y1) / 2, cz, sx, y1 - y0, sz));
  };

  let cursor = lo;
  for (const op of openings) {
    const a = op.at - op.width / 2;
    const b = op.at + op.width / 2;
    span(cursor, a, 0, height);
    const sill = op.sill || 0;
    const head = op.height !== undefined ? op.height : height;
    // Wall above the opening (spandrel), including the arch curve.
    if (head < height) {
      const archH = head;
      // Approximate the arch with a stepped set of blocks: the pointed head
      // is implied by the lancet mesh placed below.
      span(a, b, head, height);
      // Corner infill around the arch point.
      const r = op.width / 2;
      const apex = archH + r * 0.62;
      if (apex < height) {
        const steps = 4;
        for (let i = 0; i < steps; i++) {
          const t0 = i / steps;
          const t1 = (i + 1) / steps;
          const y0 = archH + (apex - archH) * t0;
          const y1 = archH + (apex - archH) * t1;
          const inset = (r * 0.55) * (1 - Math.abs(t0 + t1 - 1) / 1);
          const w = Math.max(0.05, op.width - inset * 2);
          span(op.at - w / 2, op.at + w / 2, y0, y1);
        }
      }
    }
    // Below the sill (a window ledge, typically).
    if (sill > 0) span(a, b, 0, sill);
    // The arch band itself.
    const archGeo = lancetArch(op.width, head - sill, thickness + 0.16, 0.3);
    const archMesh = new THREE.Mesh(archGeo, materials.stoneDark);
    archMesh.position.set(
      along === 'x' ? op.at : fixed,
      sill,
      along === 'x' ? fixed : op.at
    );
    if (along === 'z') archMesh.rotation.y = Math.PI / 2;
    out.push(archMesh);
    cursor = b;
  }
  span(cursor, hi, 0, height);
}

/**
 * A wall torch: iron bracket, wooden shaft and an emissive flame.
 * The flame is a sprite so it reads as light without extra geometry.
 */
export function wallTorch(materials, x, y, z, rotY = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rotY;

  const bracket = box(materials.ironDark, 0, 0, 0.12, 0.08, 0.08, 0.3);
  g.add(bracket);
  const shaft = cylinder(materials.woodDark, 0, 0.2, 0.34, 0.05, 0.42, 8);
  shaft.rotation.x = Math.PI / 5;
  g.add(shaft);
  const cup = cone(materials.ironDark, 0, 0.42, 0.42, 0.16, 0.22);
  cup.rotation.x = Math.PI;
  g.add(cup);

  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), FLAME_MATERIAL);
  flame.position.set(0, 0.56, 0.42);
  flame.name = 'flame';
  g.add(flame);

  g.userData.flame = flame;
  g.userData.lightAnchor = new THREE.Vector3(x, y + 0.56, z);
  return g;
}

/**
 * A standing brazier: tripod legs, iron bowl, coals and flame.
 */
export function brazier(materials, x, z, y = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = box(materials.ironDark, Math.cos(a) * 0.24, 0.42, Math.sin(a) * 0.24, 0.07, 0.86, 0.07);
    leg.rotation.set(Math.sin(a) * 0.14, 0, -Math.cos(a) * 0.14);
    g.add(leg);
  }
  const bowl = cone(materials.iron, 0, 0.95, 0, 0.42, 0.34);
  bowl.rotation.x = Math.PI;
  g.add(bowl);
  const rim = cylinder(materials.ironDark, 0, 1.11, 0, 0.44, 0.07, 12);
  g.add(rim);

  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), FLAME_MATERIAL);
  flame.position.y = 1.28;
  flame.name = 'flame';
  g.add(flame);
  g.userData.flame = flame;
  g.userData.lightAnchor = new THREE.Vector3(x, y + 1.3, z);
  return g;
}

/**
 * A pew: bench, backrest and end posts.
 */
export function pew(materials, x, z, rotY = 0, length = 2.6) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  const seat = box(materials.woodDark, 0, 0.46, 0, length, 0.1, 0.42);
  g.add(seat);
  const back = box(materials.woodDark, 0, 0.78, -0.2, length, 0.62, 0.08);
  g.add(back);
  for (const s of [-1, 1]) {
    g.add(box(materials.woodDark, (s * length) / 2 - s * 0.07, 0.23, 0, 0.1, 0.46, 0.4));
    g.add(box(materials.woodDark, (s * length) / 2 - s * 0.07, 0.78, -0.2, 0.12, 0.66, 0.12));
  }
  return g;
}

/**
 * A hanging chandelier: iron ring with candle stubs.
 */
export function chandelier(materials, x, y, z, radius = 0.9) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  const chain = cylinder(materials.ironDark, 0, 1.4, 0, 0.035, 2.8, 6);
  g.add(chain);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.05, 6, 18),
    materials.ironDark
  );
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const cx = Math.cos(a) * radius;
    const cz = Math.sin(a) * radius;
    g.add(cylinder(materials.bone, cx, 0.14, cz, 0.05, 0.3, 6));
    const fl = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), CANDLE_MATERIAL);
    fl.position.set(cx, 0.32, cz);
    g.add(fl);
  }
  return g;
}

/**
 * A shattered saint statue — the landmark at the crossing.
 */
export function brokenSaint(materials, x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = -0.35;

  g.add(box(materials.stoneDark, 0, 0.2, 0, 1.9, 0.4, 1.9));
  g.add(box(materials.stone, 0, 0.52, 0, 1.5, 0.28, 1.5));

  // Robed body, tapering upward.
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.72, 1.9, 10), materials.stone);
  body.position.y = 1.6;
  g.add(body);

  // Shoulders.
  const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), materials.stone);
  shoulders.scale.set(1.35, 0.7, 0.9);
  shoulders.position.y = 2.5;
  g.add(shoulders);

  // Headless neck stump — the statue is broken at the neck.
  const neck = cylinder(materials.stoneDark, 0, 2.66, 0, 0.16, 0.26, 8);
  g.add(neck);

  // One surviving arm, raised.
  const arm = box(materials.stone, 0.52, 2.75, 0.05, 0.2, 0.95, 0.2);
  arm.rotation.z = -0.32;
  g.add(arm);

  // The severed head lies on the plinth, tilted.
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), materials.stone);
  head.scale.set(0.9, 1.15, 0.95);
  head.position.set(-0.55, 0.86, 0.34);
  head.rotation.set(1.2, 0.4, 0.2);
  g.add(head);

  // Broken hand near it.
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.1, 7, 6), materials.stone);
  hand.scale.set(1, 0.7, 1.4);
  hand.position.set(-0.2, 0.7, 0.5);
  g.add(hand);

  return g;
}

/**
 * Stained glass window: emissive panel behind a stone tracery.
 */
export function stainedWindow(materials, x, y, z, width, height, rotY = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rotY;

  const glass = new THREE.Mesh(new THREE.PlaneGeometry(width, height), GLASS_MATERIAL);
  g.add(glass);

  // Mullions.
  const mull = materials.stoneDark;
  g.add(box(mull, 0, 0, 0.02, 0.1, height, 0.08));
  g.add(box(mull, 0, 0, 0.02, width, 0.1, 0.08));
  g.add(box(mull, 0, height * 0.22, 0.02, width, 0.08, 0.08));
  return g;
}

/**
 * A cobwebbed corner / rubble scatter.
 */
export function rubble(materials, x, z, count = 5, spread = 1.2) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  let seed = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453);
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let i = 0; i < count; i++) {
    const s = 0.16 + rnd() * 0.34;
    const r = box(materials.stoneDark, (rnd() - 0.5) * spread * 2, s * 0.4, (rnd() - 0.5) * spread * 2, s, s * 0.8, s * (0.7 + rnd() * 0.6));
    r.rotation.set(rnd() * 0.6, rnd() * Math.PI, rnd() * 0.6);
    g.add(r);
  }
  return g;
}

/**
 * An iron portcullis / gate frame. Doors are interactive and open on a hinge.
 */
export function gate(materials, x, z, width, height, axis = 'x') {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const bars = Math.max(3, Math.round(width / 0.38));
  for (let i = 0; i < bars; i++) {
    const t = (i + 0.5) / bars - 0.5;
    const b = box(materials.ironDark, axis === 'x' ? t * width : 0, height / 2, axis === 'x' ? 0 : t * width, 0.09, height, 0.09);
    g.add(b);
  }
  for (let i = 0; i < 3; i++) {
    const y = 0.25 + (i * (height - 0.5)) / 2;
    g.add(box(materials.iron, axis === 'x' ? 0 : 0, y, axis === 'x' ? 0 : 0, axis === 'x' ? width : 0.08, 0.09, axis === 'x' ? 0.08 : width));
  }
  g.userData.hinge = g;
  return g;
}

/**
 * A lectern with a tattered book.
 */
export function lectern(materials, x, z, rotY = 0) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  g.add(cylinder(materials.woodDark, 0, 0.55, 0, 0.11, 1.1, 8));
  g.add(cylinder(materials.woodDark, 0, 0.05, 0, 0.34, 0.1, 10));
  const top = box(materials.woodDark, 0, 1.16, 0, 0.62, 0.08, 0.42);
  top.rotation.x = -0.34;
  g.add(top);
  const book = box(materials.parchment, 0, 1.26, 0.02, 0.4, 0.06, 0.3);
  book.rotation.x = -0.34;
  g.add(book);
  return g;
}

/**
 * A sarcophagus.
 */
export function sarcophagus(materials, x, z, rotY = 0) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  g.add(box(materials.stoneDark, 0, 0.28, 0, 1.1, 0.56, 2.4));
  g.add(box(materials.stone, 0, 0.62, 0, 1.2, 0.14, 2.5));
  // Effigy: a crude recumbent figure.
  g.add(box(materials.stone, 0, 0.76, -0.3, 0.62, 0.2, 1.2));
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 6), materials.stone));
  const head = g.children[g.children.length - 1];
  head.position.set(0, 0.9, 0.85);
  return g;
}

/**
 * Bone piles and skulls for the ossuary.
 */
export function bonePile(materials, x, z, scale = 1) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  let seed = Math.abs(Math.sin(x * 91.7 + z * 47.3) * 23421.631);
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let i = 0; i < 9; i++) {
    const s = (0.14 + rnd() * 0.2) * scale;
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.5, 7, 6), materials.bone);
    b.scale.set(s * 1.4, s, s * 1.7);
    b.position.set((rnd() - 0.5) * 1.4 * scale, s * 0.5, (rnd() - 0.5) * 1.4 * scale);
    b.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    g.add(b);
  }
  for (let i = 0; i < 5; i++) {
    const s = (0.1 + rnd() * 0.12) * scale;
    const b = box(materials.bone, (rnd() - 0.5) * 1.6 * scale, s * 0.6, (rnd() - 0.5) * 1.6 * scale, s * 3.2, s, s * 0.7);
    b.rotation.y = rnd() * 3;
    b.rotation.z = (rnd() - 0.5) * 0.6;
    g.add(b);
  }
  return g;
}

/**
 * A hanging chain of links.
 */
export function chain(materials, x, y, z, length = 2.2) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  const links = Math.floor(length / 0.16);
  for (let i = 0; i < links; i++) {
    const link = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.022, 4, 8), materials.ironDark);
    link.position.y = -i * 0.16;
    link.rotation.y = i % 2 === 0 ? 0 : Math.PI / 2;
    g.add(link);
  }
  return g;
}

/**
 * A tattered banner hanging from a wall.
 */
export function banner(materials, x, y, z, rotY = 0, height = 3.2) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  const cloth = box(materials.cloth, 0, -height / 2, 0, 1.3, height, 0.06);
  g.add(cloth);
  // Ragged hem.
  for (let i = 0; i < 4; i++) {
    const w = 0.28;
    const t = box(materials.cloth, -0.48 + i * 0.32, -height - 0.1 - (i % 2) * 0.12, 0, w, 0.3, 0.05);
    g.add(t);
  }
  g.add(box(materials.ironDark, 0, 0.06, 0, 1.5, 0.07, 0.09));
  return g;
}

export { BOX, CYL, PLANE, SPHERE, CONE };
