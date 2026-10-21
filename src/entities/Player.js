/**
 * Player.js — first person character controller.
 *
 * Handles movement (walk/sprint/crouch/jump), the camera, health, stamina,
 * head bob, footstep events and the view-model (weapon) anchor.
 *
 * The controller works entirely from the Input abstraction, so desktop and
 * mobile share exactly the same movement code.
 */

import * as THREE from 'three';

const EYE_STAND = 1.68;
const EYE_CROUCH = 1.06;
const RADIUS = 0.34;
const HEIGHT = 1.8;
const CROUCH_HEIGHT = 1.15;

const WALK_SPEED = 3.5;
const SPRINT_SPEED = 6.3;
const CROUCH_SPEED = 1.9;
const ACCEL = 14;
const AIR_ACCEL = 3.5;
const FRICTION = 11;
const GRAVITY = 22;
const JUMP_VELOCITY = 7.2;
const MAX_PITCH = Math.PI / 2 - 0.02;

export class Player {
  constructor(world, camera, input) {
    this.world = world;
    this.camera = camera;
    this.input = input;

    this.position = new THREE.Vector3(0, 0, 0);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;

    this.health = 100;
    this.maxHealth = 100;
    this.alive = true;

    this.crouching = false;
    this.sprinting = false;
    this.grounded = false;
    this.height = HEIGHT;

    this.stamina = 1;
    this.staminaLocked = false;

    /** Head bob phase, advanced with distance travelled. */
    this._bob = 0;
    this._bobAmount = 0;
    this._stepDistance = 0;
    this._hurtFlash = 0;
    this._damageDir = new THREE.Vector3();

    /** Invulnerability frames after taking a hit. */
    this.invuln = 0;
    /** Callbacks: onFootstep, onLand, onDeath, onDamage */
    this.onFootstep = null;
    this.onLand = null;
    this.onDeath = null;
    this.onDamage = null;

    /**
     * View model (weapon) anchor.
     *
     * The weapon is rendered in its own scene with its own lighting, so the
     * braziers and torches in the world cannot blow it out. The pass is
     * drawn after the world with the depth buffer cleared, which is the
     * standard way to keep a first person weapon from clipping into
     * geometry.
     */
    this.viewScene = new THREE.Scene();
    this.viewCamera = new THREE.PerspectiveCamera(70, 1, 0.01, 5);
    this.viewScene.add(this.viewCamera);

    const viewKey = new THREE.DirectionalLight(0xffe0b8, 1.5);
    viewKey.position.set(-0.6, 1.0, 0.9);
    this.viewScene.add(viewKey);
    const viewRim = new THREE.DirectionalLight(0x6a7fb0, 0.75);
    viewRim.position.set(0.9, -0.3, -0.8);
    this.viewScene.add(viewRim);
    this.viewScene.add(new THREE.AmbientLight(0x4a4458, 0.7));

    this.viewModel = new THREE.Group();
    this.viewScene.add(this.viewModel);

    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._wish = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
  }

  /** Places the player at a spawn point. */
  spawn(position, yaw = 0) {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.health = this.maxHealth;
    this.alive = true;
    this.crouching = false;
    this.height = HEIGHT;
    this.stamina = 1;
    this.invuln = 0;
    this._bob = 0;
    this._stepDistance = 0;
    this.camera.position.set(0, 0, 0);
    this._updateCamera(0);
  }

  get eyeHeight() {
    return this.crouching ? EYE_CROUCH : EYE_STAND;
  }

  /** Direction the player is looking, in world space. */
  getLookDirection(target = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return target
      .set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp)
      .normalize();
  }

  /** Applies damage. Returns true if the hit landed. */
  damage(amount, fromPosition) {
    if (!this.alive || this.invuln > 0) return false;
    this.health -= amount;
    this.invuln = 0.35;
    this._hurtFlash = Math.min(1, this._hurtFlash + amount / 40);
    if (fromPosition) {
      this._damageDir
        .copy(fromPosition)
        .sub(this.position)
        .setY(0)
        .normalize();
    }
    if (this.onDamage) this.onDamage(amount);
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      if (this.onDeath) this.onDeath();
    }
    return true;
  }

  heal(amount) {
    const before = this.health;
    this.health = Math.min(this.maxHealth, this.health + amount);
    return this.health - before;
  }

  /** Applies a knockback impulse. */
  impulse(x, y, z) {
    this.velocity.x += x;
    this.velocity.y += y;
    this.velocity.z += z;
  }

  /**
   * Per-frame update.
   * @param {number} dt seconds
   */
  update(dt) {
    if (!this.alive) {
      this._updateCamera(dt);
      return;
    }

    const input = this.input;

    // ---- look ---------------------------------------------------------
    if (input.pointerLocked || input.usingTouch) {
      this.yaw -= input.lookX;
      this.pitch -= input.lookY;
      if (this.input.invertY) this.pitch = this.pitch + input.lookY * 2;
    }
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch));
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;

    // ---- crouch -------------------------------------------------------
    const wantCrouch = input.isDown('crouch');
    if (wantCrouch !== this.crouching) {
      if (wantCrouch) {
        this.crouching = true;
      } else {
        // Only stand up if there is headroom.
        const test = this._tmp.set(this.position.x, this.position.y, this.position.z);
        const res = this.world.moveCylinder(test, RADIUS, HEIGHT, { x: 0, y: 0, z: 0 }, false);
        if (res.y > this.position.y - 0.02) this.crouching = false;
      }
    }
    const targetHeight = this.crouching ? CROUCH_HEIGHT : HEIGHT;
    this.height += (targetHeight - this.height) * Math.min(1, dt * 12);

    // ---- sprint & stamina ---------------------------------------------
    const moving = Math.abs(input.moveX) > 0.05 || Math.abs(input.moveY) > 0.05;
    const canSprint = this.grounded && !this.crouching && moving && this.stamina > 0.02;
    this.sprinting = input.isDown('sprint') && canSprint;
    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - dt * 0.28);
      if (this.stamina <= 0) this.staminaLocked = true;
    } else {
      this.stamina = Math.min(1, this.stamina + dt * (this.staminaLocked ? 0.14 : 0.4));
      if (this.staminaLocked && this.stamina > 0.32) this.staminaLocked = false;
    }

    // ---- movement ------------------------------------------------------
    this._forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    this._wish.set(0, 0, 0);
    this._wish.addScaledVector(this._right, input.moveX);
    this._wish.addScaledVector(this._forward, input.moveY);
    if (this._wish.lengthSq() > 1) this._wish.normalize();

    const speed = this.crouching
      ? CROUCH_SPEED
      : this.sprinting
        ? SPRINT_SPEED
        : WALK_SPEED;

    const accel = this.grounded ? ACCEL : AIR_ACCEL;
    const targetVx = this._wish.x * speed;
    const targetVz = this._wish.z * speed;

    this.velocity.x += (targetVx - this.velocity.x) * Math.min(1, accel * dt);
    this.velocity.z += (targetVz - this.velocity.z) * Math.min(1, accel * dt);

    if (this.grounded && this._wish.lengthSq() < 0.001) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      this.velocity.x *= damp;
      this.velocity.z *= damp;
    }

    // ---- jump & gravity ------------------------------------------------
    if (input.wasPressed('jump') && this.grounded && !this.crouching) {
      this.velocity.y = JUMP_VELOCITY;
      this.grounded = false;
    }
    this.velocity.y -= GRAVITY * dt;
    if (this.velocity.y < -45) this.velocity.y = -45;

    // ---- integrate & collide --------------------------------------------
    const delta = {
      x: this.velocity.x * dt,
      y: this.velocity.y * dt,
      z: this.velocity.z * dt,
    };
    const wasGrounded = this.grounded;
    const res = this.world.moveCylinder(this.position, RADIUS, this.height, delta, true);

    this.position.set(res.x, res.y, res.z);
    this.grounded = res.grounded;
    if (res.hitWall) {
      // Kill the velocity component into the wall so we do not build up
      // momentum against a surface.
      this.velocity.x *= 0.86;
      this.velocity.z *= 0.86;
    }
    if (res.hitCeiling) this.velocity.y = 0;
    if (this.grounded) {
      if (this.velocity.y < 0) this.velocity.y = 0;
      if (!wasGrounded) {
        const impact = Math.min(1, Math.abs(this.velocity.y) / 18);
        this._bobAmount = 0.4;
        if (this.onLand) this.onLand(impact);
      }
    }

    // ---- head bob & footsteps -------------------------------------------
    const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.grounded && horizSpeed > 0.4) {
      this._bob += dt * horizSpeed * 1.75;
      this._stepDistance += horizSpeed * dt;
      const stride = this.crouching ? 1.5 : this.sprinting ? 2.1 : 1.8;
      if (this._stepDistance >= stride) {
        this._stepDistance = 0;
        if (this.onFootstep) this.onFootstep(this.crouching ? 0.35 : this.sprinting ? 1 : 0.7);
      }
    } else {
      this._stepDistance = Math.min(this._stepDistance, 1.2);
    }
    this._bobAmount += ((this.grounded ? Math.min(horizSpeed / SPRINT_SPEED, 1) : 0) - this._bobAmount) * Math.min(1, dt * 8);

    if (this.invuln > 0) this.invuln -= dt;
    if (this._hurtFlash > 0) this._hurtFlash = Math.max(0, this._hurtFlash - dt * 1.8);

    this._updateCamera(dt);
  }

  /** Applies bob, sway and crouch offset to the camera. */
  _updateCamera(dt) {
    const bobX = Math.cos(this._bob) * 0.035 * this._bobAmount;
    const bobY = Math.abs(Math.sin(this._bob)) * 0.045 * this._bobAmount;
    const eye = this.eyeHeight;

    this.camera.position.set(
      this.position.x + bobX * 0.4,
      this.position.y + eye + bobY,
      this.position.z
    );
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);
    this.camera.rotateZ(bobX * 0.8);
  }

  /** Screen-space damage direction, for the HUD indicator. */
  getDamageDirection() {
    return this._damageDir;
  }

  get hurtFlash() {
    return this._hurtFlash;
  }
}
