/**
 * Physics.js — collision world and movement solver.
 *
 * The level is built from axis-aligned box colliders (walls, pillars, doors).
 * Entities are treated as vertical cylinders (a player-sized radius capsule
 * approximated by a circle in plan view), which makes resolution stable and
 * cheap: no physics engine, no per-frame allocation, no tunnelling.
 *
 * Broadphase is a uniform spatial hash over the XZ plane. Narrowphase resolves
 * penetration by pushing the circle out of the box along the shallowest axis,
 * which gives natural wall sliding.
 */

export class Box {
  /**
   * @param {number} minX @param {number} minY @param {number} minZ
   * @param {number} maxX @param {number} maxY @param {number} maxZ
   * @param {string} tag   semantic label, e.g. 'wall', 'door', 'prop'
   */
  constructor(minX, minY, minZ, maxX, maxY, maxZ, tag = 'solid') {
    this.minX = minX;
    this.minY = minY;
    this.minZ = minZ;
    this.maxX = maxX;
    this.maxY = maxY;
    this.maxZ = maxZ;
    this.tag = tag;
    this.enabled = true;
    // Doorways and gates toggle `enabled` to open/close the space.
    this.object = null;
  }

  get min() {
    return { x: this.minX, y: this.minY, z: this.minZ };
  }

  containsPoint(x, y, z) {
    return (
      x >= this.minX && x <= this.maxX &&
      y >= this.minY && y <= this.maxY &&
      z >= this.minZ && z <= this.maxZ
    );
  }
}

export class CollisionWorld {
  constructor(cellSize = 4) {
    this.cellSize = cellSize;
    this.boxes = [];
    this.grid = new Map();
    this._scratch = [];
  }

  /** Registers a collider and inserts it into the broadphase grid. */
  add(box) {
    this.boxes.push(box);
    this._index(box);
    return box;
  }

  _key(cx, cz) {
    return cx * 73856093 ^ cz * 19349663;
  }

  _index(box) {
    const cs = this.cellSize;
    const x0 = Math.floor(box.minX / cs);
    const x1 = Math.floor(box.maxX / cs);
    const z0 = Math.floor(box.minZ / cs);
    const z1 = Math.floor(box.maxZ / cs);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const k = this._key(cx, cz);
        let list = this.grid.get(k);
        if (!list) {
          list = [];
          this.grid.set(k, list);
        }
        list.push(box);
      }
    }
  }

  /**
   * Collects colliders overlapping a world-space region.
   * @param {number} minX @param {number} minZ @param {number} maxX @param {number} maxZ
   * @param {boolean} yFilter @param {number} yLow @param {number} yHigh
   */
  query(minX, minZ, maxX, maxZ, yFilter = false, yLow = -Infinity, yHigh = Infinity) {
    const cs = this.cellSize;
    const out = this._scratch;
    out.length = 0;
    const x0 = Math.floor(minX / cs);
    const x1 = Math.floor(maxX / cs);
    const z0 = Math.floor(minZ / cs);
    const z1 = Math.floor(maxZ / cs);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const list = this.grid.get(this._key(cx, cz));
        if (!list) continue;
        for (const b of list) {
          if (!b.enabled) continue;
          // Vertical overlap test: skip boxes entirely above or below the
          // queried band before they enter the result set.
          if (yFilter && (b.maxY < yLow || b.minY > yHigh)) continue;
          if (out.indexOf(b) === -1) out.push(b);
        }
      }
    }
    return out;
  }

  /**
   * Moves a cylinder entity and resolves collisions.
   *
   * @param {{x:number,y:number,z:number}} pos  entity position (feet on floor)
   * @param {number} radius
   * @param {number} height
   * @param {{x:number,y:number,z:number}} delta desired movement
   * @param {boolean} applyGravity
   * @returns {{x:number,y:number,z:number,grounded:boolean,hitWall:boolean,hitCeiling:boolean}}
   */
  moveCylinder(pos, radius, height, delta, applyGravity = true) {
    const result = { x: pos.x, y: pos.y, z: pos.z, grounded: false, hitWall: false, hitCeiling: false };

    // --- horizontal, axis separated so we slide along walls -------------
    // Each axis resolves against the union of its old and new coordinate, so
    // a large step cannot tunnel straight through a wall.
    const prevX = pos.x;
    const prevZ = pos.z;
    result.x += delta.x;
    this._resolveAxis(result, radius, height, 'x', delta.x, prevX, prevZ);
    result.z += delta.z;
    this._resolveAxis(result, radius, height, 'z', delta.z, prevZ, prevX);

    // --- vertical ------------------------------------------------------
    // Surfaces are detected by *crossing* them between the previous and the
    // new position, so a body resting exactly on a floor stays grounded and a
    // fast fall cannot tunnel through thin geometry.
    const prevY = pos.y;
    const prevHead = prevY + height;
    result.y += delta.y;
    const headY = result.y + height;
    const near = this.query(
      result.x - radius, result.z - radius,
      result.x + radius, result.z + radius,
      true, Math.min(prevY, result.y) - 0.05, Math.max(prevHead, headY) + 0.05
    );
    if (delta.y <= 0) {
      let groundY = -Infinity;
      for (const b of near) {
        if (result.x + radius <= b.minX || result.x - radius >= b.maxX) continue;
        if (result.z + radius <= b.minZ || result.z - radius >= b.maxZ) continue;
        if (b.maxY <= prevY + 0.02 && b.maxY >= result.y - 0.02 && b.maxY > groundY) {
          groundY = b.maxY;
        }
      }
      if (groundY > -Infinity) {
        result.y = groundY;
        result.grounded = true;
      }
    } else {
      let ceilY = Infinity;
      for (const b of near) {
        if (result.x + radius <= b.minX || result.x - radius >= b.maxX) continue;
        if (result.z + radius <= b.minZ || result.z - radius >= b.maxZ) continue;
        if (b.minY >= prevHead - 0.02 && b.minY <= headY + 0.02 && b.minY < ceilY) {
          ceilY = b.minY;
        }
      }
      if (ceilY < Infinity) {
        result.y = ceilY - height;
        result.hitCeiling = true;
      }
    }
    return result;
  }

  /**
   * Resolves penetration along a single horizontal axis.
   *
   * @param {number} prevCoord  the previous value of the axis being resolved
   * @param {number} prevOther  the previous value of the other horizontal axis
   */
  _resolveAxis(result, radius, height, axis, amount, prevCoord, prevOther) {
    if (amount === 0) return;
    let minX;
    let maxX;
    let minZ;
    let maxZ;
    if (axis === 'x') {
      minX = Math.min(result.x, prevCoord) - radius;
      maxX = Math.max(result.x, prevCoord) + radius;
      minZ = result.z - radius;
      maxZ = result.z + radius;
    } else {
      minX = result.x - radius;
      maxX = result.x + radius;
      minZ = Math.min(result.z, prevCoord) - radius;
      maxZ = Math.max(result.z, prevCoord) + radius;
    }
    const feet = result.y;
    const head = result.y + height;
    const near = this.query(minX, minZ, maxX, maxZ, true, feet, head);

    for (const b of near) {
      if (maxX <= b.minX || minX >= b.maxX) continue;
      if (maxZ <= b.minZ || minZ >= b.maxZ) continue;
      if (b.maxY <= feet + 0.001) continue; // step over low geometry
      if (b.minY >= head - 0.001) continue; // pass under overhead geometry

      if (axis === 'x') {
        if (amount > 0) result.x = b.minX - radius;
        else result.x = b.maxX + radius;
        result.hitWall = true;
      } else {
        if (amount > 0) result.z = b.minZ - radius;
        else result.z = b.maxZ + radius;
        result.hitWall = true;
      }
      return;
    }
  }

  /**
   * Ray vs world test used for hitscan weapons.
   *
   * @param {THREE.Vector3} origin
   * @param {THREE.Vector3} dir normalised
   * @param {number} maxDist
   * @param {string[]} ignoreTags tags to skip
   * @returns {null | {distance:number, point:{x,y,z}, normal:{x,y,z}, box:Box}}
   */
  raycast(origin, dir, maxDist, ignoreTags = []) {
    let best = null;
    let bestT = maxDist;
    // Walk the ray through the grid conservatively: sample the AABB of the
    // segment and test every candidate box.
    const ex = origin.x + dir.x * maxDist;
    const ez = origin.z + dir.z * maxDist;
    const minX = Math.min(origin.x, ex) - 0.5;
    const maxX = Math.max(origin.x, ex) + 0.5;
    const minZ = Math.min(origin.z, ez) - 0.5;
    const maxZ = Math.max(origin.z, ez) + 0.5;
    const candidates = this.query(minX, minZ, maxX, maxZ, true, origin.y - 0.5, origin.y + maxDist + 0.5);

    for (const b of candidates) {
      if (ignoreTags.indexOf(b.tag) !== -1) continue;
      const hit = rayBox(origin, dir, b, bestT);
      if (hit) {
        bestT = hit.t;
        best = { distance: hit.t, point: hit.point, normal: hit.normal, box: b };
      }
    }
    return best;
  }

  /**
   * Line of sight test between two points.
   * @returns {boolean} true when nothing blocks the segment
   */
  lineOfSight(ax, ay, az, bx, by, bz, ignoreTags = []) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return true;
    const dir = { x: dx / len, y: dy / len, z: dz / len };
    const origin = { x: ax, y: ay, z: az };
    const hit = this.raycast(origin, dir, len - 0.05, ignoreTags);
    return !hit;
  }
}

/**
 * Slab-method ray/AABB intersection.
 * @returns {null | {t:number, point:{x,y,z}, normal:{x,y,z}}}
 */
export function rayBox(origin, dir, box, maxT) {
  let tmin = 0;
  let tmax = maxT;
  let axis = 0;
  let sign = 1;

  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  const lo = [box.minX, box.minY, box.minZ];
  const hi = [box.maxX, box.maxY, box.maxZ];

  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-8) {
      if (o[i] < lo[i] || o[i] > hi[i]) return null;
      continue;
    }
    const inv = 1 / d[i];
    let t1 = (lo[i] - o[i]) * inv;
    let t2 = (hi[i] - o[i]) * inv;
    let s = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      s = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      axis = i;
      sign = s;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmin < 0 || tmin > maxT) return null;

  const normal = { x: 0, y: 0, z: 0 };
  if (axis === 0) normal.x = sign;
  else if (axis === 1) normal.y = sign;
  else normal.z = sign;

  return {
    t: tmin,
    point: {
      x: origin.x + dir.x * tmin,
      y: origin.y + dir.y * tmin,
      z: origin.z + dir.z * tmin,
    },
    normal,
  };
}
