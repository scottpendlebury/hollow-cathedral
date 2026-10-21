/**
 * Projectiles.js — enemy bolts and the player's soul projectiles.
 *
 * Both use the same pooled travelling sphere: a position, a velocity and a
 * radius. Collisions are tested against the collision world (for walls) and
 * against the entity list (for the player or enemies).
 */

import * as THREE from 'three';

export class ProjectileSystem {
  /**
   * @param {object} opts { scene, world, materials, audio, particles }
   */
  constructor(opts) {
    this.scene = opts.scene;
    this.world = opts.world;
    this.materials = opts.materials;
    this.audio = opts.audio;
    this.particles = opts.particles;

    this.projectiles = [];
    this._geo = new THREE.SphereGeometry(1, 8, 6);
    this._tmp = new THREE.Vector3();
  }

  /**
   * Spawns a travelling projectile.
   * @param {object} o { origin, target, speed, damage, radius, color, hostile, onHit }
   */
  spawn(o) {
    const mesh = new THREE.Mesh(this._geo, new THREE.MeshBasicMaterial({ color: o.color ?? 0x9cffb0 }));
    mesh.scale.setScalar(o.radius ?? 0.09);
    this.scene.add(mesh);

    const dir = this._tmp.copy(o.target).sub(o.origin).normalize();
    const p = {
      mesh,
      position: o.origin.clone(),
      velocity: dir.clone().multiplyScalar(o.speed ?? 24),
      damage: o.damage ?? 10,
      radius: o.radius ?? 0.09,
      life: o.life ?? 4,
      hostile: !!o.hostile,
      onHit: o.onHit || null,
      color: o.color ?? 0x9cffb0,
      gravity: o.gravity ?? 0,
    };
    this.projectiles.push(p);
    return p;
  }

  /**
   * Updates all projectiles.
   * @param {number} dt
   * @param {object} player
   * @param {Array} enemies
   */
  update(dt, player, enemies) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      if (p.gravity) p.velocity.y -= p.gravity * dt;

      const step = p.velocity.clone().multiplyScalar(dt);
      const next = p.position.clone().add(step);

      // Wall test along the step.
      const dir = step.clone().normalize();
      const hit = this.world.raycast(p.position, dir, step.length() + p.radius, []);

      let consumed = false;
      if (hit && hit.distance <= step.length() + p.radius) {
        if (p.onHit) p.onHit(hit.point, hit.normal, p, false);
        consumed = true;
      } else if (p.hostile && player.alive) {
        // Sphere test against the player capsule.
        const dx = next.x - player.position.x;
        const dz = next.z - player.position.z;
        const dy = next.y - (player.position.y + player.height * 0.5);
        const r = p.radius + 0.45;
        if (dx * dx + dz * dz + dy * dy <= r * r) {
          if (p.onHit) p.onHit(next, dir.clone().negate(), p, true);
          consumed = true;
        }
      } else if (!p.hostile && enemies) {
        for (const e of enemies) {
          if (!e.alive) continue;
          const dx = next.x - e.position.x;
          const dz = next.z - e.position.z;
          const dy = next.y - (e.position.y + e.stats.height * 0.5);
          const r = p.radius + e.stats.radius + 0.2;
          if (dx * dx + dz * dz + dy * dy <= r * r) {
            if (p.onHit) p.onHit(next, dir.clone().negate(), p, false, e);
            consumed = true;
            break;
          }
        }
      }

      p.position.copy(next);
      p.mesh.position.copy(next);

      if (consumed || p.life <= 0) {
        this._remove(i);
      }
    }
  }

  _remove(i) {
    const p = this.projectiles[i];
    this.scene.remove(p.mesh);
    p.mesh.material.dispose();
    this.projectiles.splice(i, 1);
  }

  clear() {
    while (this.projectiles.length) this._remove(this.projectiles.length - 1);
  }
}
