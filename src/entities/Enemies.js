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

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Builds a procedural body for an archetype.
 */
function buildBody(type, materials) {
  const g = new THREE.Group();
  const parts = {};

  if (type === 'husk') {
    // A stooped, emaciated thing: narrow shoulders, a lolling head and a
    // shambling forward lean.
    const torso = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.17, 0.74, 8),
      materials.flesh
    );
    torso.position.set(0, 1.1, 0.05);
    torso.rotation.x = 0.22;
    g.add(torso);
    parts.torso = torso;

    // A hunched shoulder yoke.
    const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.26, 9, 7), materials.fleshDark);
    shoulders.scale.set(1.5, 0.62, 0.85);
    shoulders.position.set(0, 1.45, 0.02);
    g.add(shoulders);

    // The head hangs forward and to one side.
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), materials.flesh);
    head.scale.set(0.82, 1.15, 0.92);
    head.position.set(0.05, 1.62, 0.16);
    head.rotation.set(0.5, 0.2, 0.28);
    g.add(head);
    parts.head = head;

    // A jaw that hangs open.
    const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.1, 7, 6), materials.fleshDark);
    jaw.scale.set(0.9, 0.7, 1.1);
    jaw.position.set(0.05, 1.5, 0.24);
    g.add(jaw);

    for (const s of [-1, 1]) {
      // Long, thin arms that reach forward.
      const arm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.065, 0.042, 0.72, 6),
        materials.flesh
      );
      arm.position.set(s * 0.3, 1.16, 0.18);
      arm.rotation.x = -1.15;
      g.add(arm);
      parts[s < 0 ? 'armL' : 'armR'] = arm;

      // Splayed hands.
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.075, 6, 5), materials.fleshDark);
      hand.scale.set(0.8, 1.3, 0.6);
      hand.position.set(s * 0.32, 0.88, 0.44);
      hand.rotation.x = -0.6;
      g.add(hand);

      const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.095, 0.07, 0.86, 6),
        materials.flesh
      );
      leg.position.set(s * 0.14, 0.43, 0);
      g.add(leg);
      parts[s < 0 ? 'legL' : 'legR'] = leg;
    }

    // Exposed ribs, the clearest read on what this thing used to be.
    for (let i = 0; i < 4; i++) {
      const rib = new THREE.Mesh(
        new THREE.TorusGeometry(0.21 - i * 0.012, 0.024, 4, 10, Math.PI),
        materials.bone
      );
      rib.position.set(0, 1.32 - i * 0.11, 0.07);
      rib.rotation.set(Math.PI / 2 - 0.25, 0, 0);
      g.add(rib);
    }
    // A spine of vertebrae.
    for (let i = 0; i < 4; i++) {
      const v = new THREE.Mesh(new THREE.SphereGeometry(0.038, 6, 5), materials.bone);
      v.position.set(0, 1.34 - i * 0.11, -0.14);
      g.add(v);
    }

    // A tattered shroud hanging from the shoulders.
    const rag = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.3, 0.62, 8, 1, true),
      materials.cloth
    );
    rag.position.set(0, 0.94, 0.02);
    g.add(rag);
  } else if (type === 'archer') {
    // A skeletal frame: narrow ribcage, long neck, exposed skull.
    const torso = new THREE.Mesh(
      new THREE.CylinderGeometry(0.19, 0.24, 0.68, 8),
      materials.bone
    );
    torso.position.y = 1.14;
    g.add(torso);
    parts.torso = torso;

    // Ribs on a bare frame.
    for (let i = 0; i < 4; i++) {
      const rib = new THREE.Mesh(
        new THREE.TorusGeometry(0.19 - i * 0.008, 0.022, 4, 10, Math.PI),
        materials.bone
      );
      rib.position.set(0, 1.32 - i * 0.1, 0.02);
      rib.rotation.set(Math.PI / 2, 0, 0);
      g.add(rib);
    }

    // A long neck.
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.16, 6), materials.bone);
    neck.position.set(0, 1.52, 0.02);
    g.add(neck);

    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.145, 9, 8), materials.bone);
    skull.scale.set(0.8, 1, 1.05);
    skull.position.set(0, 1.66, 0.04);
    g.add(skull);
    parts.head = skull;

    // A dark eye socket pair, which is what makes a skull read as a skull.
    for (const s of [-1, 1]) {
      const socket = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 5), materials.fleshDark);
      socket.scale.set(1, 0.8, 0.6);
      socket.position.set(s * 0.055, 1.68, 0.12);
      g.add(socket);
    }

    // A long bone bow.
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.02, 4, 12, Math.PI * 1.1), materials.bone);
    bow.position.set(0.3, 1.3, 0.16);
    bow.rotation.set(0, Math.PI / 2, 0.4);
    g.add(bow);
    parts.bow = bow;

    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.04, 0.6, 6),
        materials.bone
      );
      arm.position.set(s * 0.24, 1.18, 0.12);
      arm.rotation.x = -0.6;
      g.add(arm);
      parts[s < 0 ? 'armL' : 'armR'] = arm;

      const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.05, 0.8, 6),
        materials.bone
      );
      leg.position.set(s * 0.11, 0.4, 0);
      g.add(leg);
      parts[s < 0 ? 'legL' : 'legR'] = leg;
    }
    // Tattered shroud.
    const shroud = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.5, 8, 1, true), materials.cloth);
    shroud.position.y = 0.78;
    g.add(shroud);
  } else {
    // Knight
    const torso = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.24, 0.76, 8),
      materials.ironDark
    );
    torso.position.y = 1.2;
    g.add(torso);
    parts.torso = torso;

    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), materials.iron);
    helm.scale.set(0.9, 1.05, 1);
    helm.position.set(0, 1.72, 0);
    g.add(helm);
    parts.head = helm;

    // Horned crown.
    for (const s of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.26, 6), materials.iron);
      horn.position.set(s * 0.13, 1.86, 0);
      horn.rotation.z = s * 0.55;
      g.add(horn);
    }

    // Pauldrons, spiked.
    for (const s of [-1, 1]) {
      const pad = new THREE.Mesh(new THREE.SphereGeometry(0.19, 9, 7), materials.iron);
      pad.scale.set(1.15, 0.78, 1.05);
      pad.position.set(s * 0.34, 1.48, 0);
      g.add(pad);
      parts[s < 0 ? 'armL' : 'armR'] = pad;

      // A spike on each pauldron, for a clear silhouette at distance.
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.22, 6), materials.ironDark);
      spike.position.set(s * 0.42, 1.56, 0);
      spike.rotation.z = s * 0.75;
      g.add(spike);

      // A heavy arm below the pauldron.
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.075, 0.62, 7), materials.ironDark);
      arm.position.set(s * 0.35, 1.06, 0.04);
      g.add(arm);
    }

    // A tattered tabard over the plate.
    const tabard = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.32, 0.72, 8, 1, true),
      materials.cloth
    );
    tabard.position.set(0, 0.92, 0);
    g.add(tabard);

    // A great sword, held low and ready.
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.11, 1.25, 0.035), materials.iron);
    blade.position.set(0.46, 0.94, 0.36);
    blade.rotation.x = -0.45;
    blade.rotation.z = 0.12;
    g.add(blade);
    parts.weapon = blade;

    // Crossguard and pommel.
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.06), materials.ironDark);
    guard.position.set(0.44, 1.5, 0.14);
    guard.rotation.x = -0.45;
    g.add(guard);

    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.1, 0.86, 6),
        materials.ironDark
      );
      leg.position.set(s * 0.15, 0.43, 0);
      g.add(leg);
      parts[s < 0 ? 'legL' : 'legR'] = leg;
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

  _animate(dt) {
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const t = this.animTime;
    const p = this.parts;

    this.group.position.copy(this.position);
    this.group.rotation.y = this.yaw;

    if (p.legL && p.legR) {
      const swing = Math.sin(t * (3 + speed * 2.2)) * Math.min(0.7, 0.18 + speed * 0.16);
      p.legL.rotation.x = swing;
      p.legR.rotation.x = -swing;
    }
    if (p.armL && p.armR) {
      if (this.state === 'attack') {
        // Wind up then swing.
        const w = this.stats.windup;
        const k = 1 - Math.max(0, this.stateTimer) / w;
        const swing = k < 0.5 ? -1.4 * (k * 2) : 1.9 * ((k - 0.5) * 2);
        if (this.type === 'archer') {
          p.armR.rotation.x = -1.5 + k * 0.3;
          p.armL.rotation.x = -1.2 - k * 0.5;
        } else {
          p.armR.rotation.x = swing;
          p.armL.rotation.x = swing * 0.5;
        }
      } else if (this.type === 'archer') {
        p.armR.rotation.x = -1.4 + Math.sin(t * 1.4) * 0.1;
        p.armL.rotation.x = -1.1;
      } else {
        const swing = Math.sin(t * (3 + speed * 2.2)) * Math.min(0.5, 0.1 + speed * 0.1);
        p.armR.rotation.x = -0.6 + swing;
        p.armL.rotation.x = -0.5 - swing;
      }
    }
    if (p.torso) {
      p.torso.rotation.z = Math.sin(t * (3 + speed * 2.2)) * 0.05;
      p.torso.position.y = 1.16 + Math.abs(Math.sin(t * (3 + speed * 2.2))) * 0.03;
    }
    if (p.head) {
      p.head.rotation.y = Math.sin(t * 0.6) * 0.25;
    }
    if (p.weapon) {
      p.weapon.rotation.z = Math.sin(t * 1.1) * 0.08;
    }
    if (p.bow) {
      p.bow.rotation.z = 0.4 + Math.sin(t * 0.9) * 0.06;
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
