/**
 * Weapons.js — the three weapons of the descent.
 *
 * Each weapon owns its own view model (a small procedural mesh parented to
 * the camera), its own firing behaviour, reload timing and ammunition
 * economy. The three are deliberately unbalanced against each other:
 *
 *  - Gravebound Crossbow : accurate, deliberate, needs bolts and time.
 *  - Occult Hand Cannon   : devastating, slow, catastrophically scarce.
 *  - Soulwick             : cheap to fire, drains the wielder's own vitality.
 */

import * as THREE from 'three';

export const WEAPON_IDS = ['crossbow', 'cannon', 'soulwick'];

/** How long the weapon-swap animation lasts, in seconds. */
const SWAP_DURATION = 0.32;

/**
 * How far in front of the camera the view model is anchored.
 *
 * The procedural weapon geometry extends to roughly z = +0.16 in its own
 * local space, so the anchor must be at least that far forward for the whole
 * weapon to stay between the camera and the near plane.
 */
const VIEW_MODEL_Z = 0.56;

/**
 * The view model's overall size.
 *
 * The weapon is held about half a metre from the eye, so the raw geometry
 * would fill a large part of the screen. This scales it down to a believable
 * first person presence.
 */
const VIEW_MODEL_SCALE = 0.56;

/**
 * Materials for the view model.
 *
 * The view model is rendered in its own scene, so it cannot use the world's
 * MeshStandardMaterials (which are lit by torches and would be blown out or
 * lost in the dark). These are plain, readable and slightly self-lit.
 */
const VIEW_MATERIALS = {
  wood: new THREE.MeshStandardMaterial({ color: 0x8a6440, roughness: 0.72, metalness: 0.04 }),
  woodDark: new THREE.MeshStandardMaterial({ color: 0x4b3722, roughness: 0.8, metalness: 0.03 }),
  iron: new THREE.MeshStandardMaterial({ color: 0x9fa6ad, roughness: 0.42, metalness: 0.78 }),
  ironDark: new THREE.MeshStandardMaterial({ color: 0x565c64, roughness: 0.55, metalness: 0.7 }),
  bone: new THREE.MeshStandardMaterial({ color: 0xd6cbb0, roughness: 0.66, metalness: 0.0 }),
  gold: new THREE.MeshStandardMaterial({
    color: 0xc39c52,
    roughness: 0.3,
    metalness: 0.85,
    emissive: 0x2a1d06,
    emissiveIntensity: 0.6,
  }),
  soul: new THREE.MeshBasicMaterial({ color: 0x9cffb0 }),
};

/**
 * Builds the procedural view model for a weapon.
 *
 * The view model is drawn in its own scene, so it gets its own materials.
 * They are lighter and less rough than the world materials: a weapon held in
 * the player's hands must stay readable even in an unlit crypt.
 */
function buildViewModel(id) {
  const g = new THREE.Group();
  const m = VIEW_MATERIALS;

  if (id === 'crossbow') {
    // Stock
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.66), m.wood);
    stock.position.set(0, -0.07, -0.2);
    g.add(stock);
    // A dark grip wrap, so the weapon has readable detail at a glance.
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.145, 0.16), m.woodDark);
    grip.position.set(0, -0.07, 0.02);
    g.add(grip);
    // Limbs
    for (const s of [-1, 1]) {
      const limb = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.04, 0.055), m.iron);
      limb.position.set(s * 0.17, 0.015, -0.48);
      limb.rotation.z = s * 0.26;
      g.add(limb);
      // Nock
      const nock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.07), m.ironDark);
      nock.position.set(s * 0.325, 0.05, -0.52);
      g.add(nock);
    }
    // String
    const string = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.014, 0.014), m.bone);
    string.position.set(0, 0.06, -0.44);
    g.add(string);
    // Rail
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.035, 0.54), m.ironDark);
    rail.position.set(0, 0.025, -0.22);
    g.add(rail);
    // Loaded bolt
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.38, 6), m.bone);
    bolt.rotation.x = Math.PI / 2;
    bolt.position.set(0, 0.045, -0.3);
    g.add(bolt);
    // Occult charm hanging from the stock.
    const charm = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.01, 5, 10), m.gold);
    charm.position.set(0.06, -0.12, -0.12);
    charm.rotation.y = Math.PI / 2;
    g.add(charm);
    g.userData.muzzle = new THREE.Vector3(0, 0.045, -0.56);
  } else if (id === 'cannon') {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.062, 0.72, 12), m.iron);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, -0.02, -0.34);
    g.add(barrel);
    const muzzleRing = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 12), m.ironDark);
    muzzleRing.rotation.x = Math.PI / 2;
    muzzleRing.position.set(0, -0.02, -0.68);
    g.add(muzzleRing);
    const breech = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.16, 0.24), m.ironDark);
    breech.position.set(0, -0.05, 0.04);
    g.add(breech);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.24, 0.1), m.wood);
    grip.position.set(0, -0.18, 0.11);
    grip.rotation.x = 0.3;
    g.add(grip);
    // Occult sigil ring, faintly lit.
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.014, 6, 16), m.gold);
    ring.position.set(0, -0.02, -0.5);
    g.add(ring);
    g.userData.muzzle = new THREE.Vector3(0, -0.02, -0.72);
  } else {
    // Soulwick: a gnarled censer of bone on a handle.
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.036, 0.46, 8), m.bone);
    handle.rotation.x = Math.PI / 2;
    handle.position.set(0, -0.05, -0.18);
    g.add(handle);
    const cage = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 0), m.gold);
    cage.position.set(0, -0.05, -0.46);
    g.add(cage);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.058, 12, 10), m.soul);
    core.position.copy(cage.position);
    g.add(core);
    g.userData.core = core;
    g.userData.muzzle = new THREE.Vector3(0, -0.05, -0.54);
  }

  g.traverse((c) => {
    if (c.isMesh) {
      c.castShadow = false;
      c.receiveShadow = false;
    }
  });
  return g;
}

/**
 * A single weapon instance.
 */
export class Weapon {
  constructor(id, materials) {
    this.id = id;
    this.materials = materials;
    this.model = buildViewModel(id, materials);

    this.magazine = 0;
    this.reserve = 0;
    this.reloading = false;
    this.reloadTimer = 0;
    this.reloadDuration = 1;
    this.cooldown = 0;
    this.charges = 0;
    this.chargeTimer = 0;
    this.charging = false;
    this.equipped = true;

    this.recoil = 0;
    this._swayX = 0;
    this._swayY = 0;
    this._bobPhase = 0;
    this._kick = 0;

    switch (id) {
      case 'crossbow':
        this.name = 'Gravebound Crossbow';
        this.kind = 'bolts';
        this.magazineSize = 1;
        this.damage = 58;
        this.pellets = 1;
        this.fireDelay = 0.55;
        this.reloadDuration = 2.1;
        this.range = 90;
        this.spread = 0.004;
        this.chargeable = false;
        break;
      case 'cannon':
        this.name = 'Occult Hand Cannon';
        this.kind = 'powder';
        this.magazineSize = 1;
        this.damage = 145;
        this.pellets = 1;
        this.fireDelay = 1.25;
        this.reloadDuration = 3.0;
        this.range = 120;
        this.spread = 0.012;
        this.chargeable = false;
        break;
      case 'soulwick':
        this.name = 'Soulwick';
        this.kind = 'souls';
        this.magazineSize = 8;
        this.damage = 24;
        this.pellets = 1;
        this.fireDelay = 0.42;
        this.reloadDuration = 1.6;
        this.range = 60;
        this.spread = 0.01;
        this.chargeable = true;
        this.chargeTime = 0.75;
        this.selfCost = 5;
        break;
      default:
        break;
    }
  }

  get isReady() {
    return !this.reloading && this.cooldown <= 0 && this.magazine > 0;
  }

  get chargeRatio() {
    if (!this.chargeable) return 0;
    return this.charging ? Math.min(1, this.chargeTimer / this.chargeTime) : 0;
  }

  addAmmo(amount) {
    this.reserve += amount;
  }

  /** Begins a reload if there is ammunition to load. */
  startReload() {
    if (this.reloading) return false;
    if (this.magazine >= this.magazineSize) return false;
    if (this.reserve <= 0) return false;
    this.reloading = true;
    this.reloadTimer = this.reloadDuration;
    this.charging = false;
    return true;
  }

  /** Consumes one unit of ammunition. */
  consume() {
    if (this.magazine > 0) this.magazine--;
  }
}

/**
 * The weapon rack: owns all three weapons, switching and firing.
 */
export class WeaponSystem {
  /**
   * @param {object} opts { materials, player, camera, world, audio, particles, onFire, onHit, onReload }
   */
  constructor(opts) {
    this.materials = opts.materials;
    this.player = opts.player;
    this.camera = opts.camera;
    this.world = opts.world;
    this.audio = opts.audio;
    this.particles = opts.particles;
    this.onFire = opts.onFire || null;
    this.onHit = opts.onHit || null;
    this.onReload = opts.onReload || null;

    this.enemies = opts.enemies || null;
    // The view camera belongs to the player's view-model scene; it is needed
    // to map the muzzle point back into world space.
    this.viewCamera = opts.viewCamera || null;
    this.weapons = WEAPON_IDS.map((id) => new Weapon(id, this.materials));
    this.index = 0;
    this.switching = 0;

    for (const w of this.weapons) {
      w.model.visible = false;
      this.player.viewModel.add(w.model);
    }
    this.weapons[0].model.visible = true;

    this._dir = new THREE.Vector3();
    this._origin = new THREE.Vector3();
    this._muzzleWorld = new THREE.Vector3();
    this._bob = 0;
    this._sway = new THREE.Vector2();
    this._swayTarget = new THREE.Vector2();
  }

  get current() {
    return this.weapons[this.index];
  }

  /** Selects a weapon by index. */
  select(index) {
    if (index === this.index || index < 0 || index >= this.weapons.length) return;
    // A new selection interrupts any swap already in progress, so the player
    // is never locked out of a weapon they asked for.
    this.weapons[this.index].model.visible = false;
    this.weapons[this.index].charging = false;
    this.index = index;
    this.weapons[index].model.visible = true;
    this.switching = SWAP_DURATION;
    if (this.audio) this.audio.play('menuSelect', { volume: 0.4 });
  }

  /** Cycles to the next weapon. */
  cycle(dir = 1) {
    const n = this.weapons.length;
    this.select((this.index + dir + n) % n);
  }

  /** Attempts to fire. Returns true when a shot was produced. */
  tryFire() {
    const w = this.current;
    if (this.switching > 0) return false;

    if (w.chargeable) {
      // Hold to charge, release to fire.
      if (!w.charging) {
        if (w.magazine <= 0) {
          this.startReload();
          return false;
        }
        w.charging = true;
        w.chargeTimer = 0;
        return false;
      }
    }

    if (!w.isReady) {
      if (!w.reloading && w.magazine <= 0 && w.reserve > 0) this.startReload();
      return false;
    }

    w.consume();
    w.cooldown = w.fireDelay;
    w.recoil = Math.min(1, w.recoil + 0.85);
    this._kick = 1;

    const damage = w.damage * (w.chargeable ? 0.45 + w.chargeRatio * 0.9 : 1);
    this._fireHitscan(w, damage);

    if (w.chargeable) {
      w.charging = false;
      w.chargeTimer = 0;
    }

    if (this.onFire) this.onFire(w, damage);
    return true;
  }

  /** Releases a charged shot (called when fire is released). */
  releaseCharge() {
    const w = this.current;
    if (!w.chargeable || !w.charging) return;
    w.charging = false;
    w.chargeTimer = 0;
  }

  /** Performs the hitscan trace and applies damage. */
  _fireHitscan(weapon, damage) {
    const origin = this.camera.getWorldPosition(this._origin);
    const dir = this.camera.getWorldDirection(this._dir);

    // A small amount of spread, applied per pellet.
    for (let p = 0; p < weapon.pellets; p++) {
      const d = this._dir.clone();
      if (weapon.spread > 0) {
        d.x += (Math.random() - 0.5) * weapon.spread * 2;
        d.y += (Math.random() - 0.5) * weapon.spread * 2;
        d.z += (Math.random() - 0.5) * weapon.spread * 2;
        d.normalize();
      }

      // Find the closest thing the ray meets: an enemy or the world.
      const wallHit = this.world.raycast(origin, d, weapon.range, []);
      const wallDistance = wallHit ? wallHit.distance : weapon.range;
      const enemyHit = this.enemies
        ? this.enemies.raycast(origin, d, Math.min(wallDistance, weapon.range))
        : null;

      if (enemyHit) {
        if (this.onHit) {
          this.onHit(enemyHit.point, enemyHit.normal, damage, weapon, true, enemyHit);
        }
      } else if (wallHit) {
        if (this.onHit) this.onHit(wallHit.point, wallHit.normal, damage, weapon, true, null);
      } else {
        const end = origin.clone().addScaledVector(d, weapon.range);
        if (this.onHit) this.onHit(end, d.clone().negate(), damage, weapon, false, null);
      }
    }
  }

  /** Attempts to reload the current weapon. */
  startReload() {
    const w = this.current;
    if (w.startReload()) {
      if (this.audio) {
        this.audio.play(w.id === 'crossbow' ? 'crossbowReload' : w.id === 'cannon' ? 'handcannonReload' : 'soulwickCharge', {
          volume: 0.8,
        });
      }
      if (this.onReload) this.onReload(w);
      return true;
    }
    return false;
  }

  /** Per-frame update: cooldowns, reloads, charge, sway and bob. */
  update(dt, input) {
    for (const w of this.weapons) {
      if (w.cooldown > 0) w.cooldown -= dt;
      if (w.reloading) {
        w.reloadTimer -= dt;
        if (w.reloadTimer <= 0) {
          const need = w.magazineSize - w.magazine;
          const take = Math.min(need, w.reserve);
          w.magazine += take;
          w.reserve -= take;
          w.reloading = false;
          if (this.audio) {
            this.audio.play(
              w.id === 'crossbow' ? 'crossbowReloadEnd' : w.id === 'cannon' ? 'handcannonReloadEnd' : 'soulwickCast',
              { volume: 0.7 }
            );
          }
        }
      }
      if (w.chargeable && w.charging) {
        w.chargeTimer += dt;
        if (w.chargeTimer > w.chargeTime) w.chargeTimer = w.chargeTime;
      }
      if (w.recoil > 0) w.recoil = Math.max(0, w.recoil - dt * 3.4);
    }

    if (this.switching > 0) this.switching -= dt;

    // Sway follows the look delta for weight.
    this._swayTarget.x += (-input.lookX * 2.2 - this._swayTarget.x) * Math.min(1, dt * 9);
    this._swayTarget.y += (input.lookY * 2.2 - this._swayTarget.y) * Math.min(1, dt * 9);
    this._sway.lerp(this._swayTarget, Math.min(1, dt * 8));

    const speed = Math.hypot(this.player.velocity.x, this.player.velocity.z);
    this._bob += dt * speed * 1.9;

    this._kick = Math.max(0, this._kick - dt * 6);

    // Place the view model in the camera space.
    const w = this.current;
    const model = w.model;
    const bobX = Math.cos(this._bob) * 0.011 * Math.min(1, speed / 6);
    const bobY = Math.abs(Math.sin(this._bob)) * 0.014 * Math.min(1, speed / 6);
    const swayX = this._sway.x * 0.045;
    const swayY = this._sway.y * 0.04;
    const recoilZ = w.recoil * 0.07;
    const recoilRot = w.recoil * 0.28;

    // The whole weapon must sit in FRONT of the camera. View model geometry
    // reaches back to roughly z = +0.16 in its own space, so the anchor is
    // pushed far enough forward that no part can clip through the near plane
    // and smear across the screen.
    model.scale.setScalar(VIEW_MODEL_SCALE);
    model.position.set(
      0.21 + bobX + swayX,
      -0.2 + bobY + swayY - w.recoil * 0.012,
      -VIEW_MODEL_Z + recoilZ
    );
    model.rotation.set(
      -recoilRot * 0.5 + swayY * 0.6,
      swayX * 0.8,
      Math.sin(this._bob * 0.5) * 0.01 + swayX * 0.5
    );

    // Swap animation: dip the model while switching.
    if (this.switching > 0) {
      const t = 1 - this.switching / SWAP_DURATION;
      model.position.y -= Math.sin(t * Math.PI) * 0.18;
    }

    // Reload animation: tilt the weapon down.
    if (w.reloading) {
      const t = 1 - w.reloadTimer / w.reloadDuration;
      model.position.y -= Math.sin(t * Math.PI) * 0.12;
      model.rotation.x += Math.sin(t * Math.PI) * 0.5;
    }

    // The soulwick core brightens while charging.
    if (w.id === 'soulwick' && w.model.userData.core) {
      const c = w.model.userData.core;
      const s = 0.7 + w.chargeRatio * 1.1;
      c.scale.setScalar(s);
      c.material.color.setRGB(0.35 + w.chargeRatio * 0.5, 1, 0.5 + w.chargeRatio * 0.3);
    }
  }

  /**
   * World position of the current weapon's muzzle.
   *
   * The view model lives in its own scene, so the muzzle point is mapped
   * through the view camera and then into the world through the main camera.
   */
  getMuzzlePosition(target = new THREE.Vector3()) {
    const m = this.current.model;
    const muzzle = m.userData.muzzle;
    if (muzzle) {
      target.copy(muzzle);
      m.localToWorld(target);
      // view space -> world space
      if (this.viewCamera) {
        this.viewCamera.localToWorld(target);
        this.camera.localToWorld(target);
      }
    } else {
      this.camera.getWorldPosition(target);
    }
    return target;
  }
}
