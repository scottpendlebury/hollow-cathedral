/**
 * Game.js — the orchestrator.
 *
 * Owns the renderer, the scene graph, the game state machine (title, playing,
 * paused, dead, victory) and the frame loop. Everything else is a module that
 * this file drives.
 */

import * as THREE from 'three';

import { Input } from './Input.js';
import { CollisionWorld } from './Physics.js';
import { createMaterials } from './Textures.js';
import { Level } from '../world/Level.js';
import { Player } from '../entities/Player.js';
import { EnemyManager } from '../entities/Enemies.js';
import { WeaponSystem } from '../entities/Weapons.js';
import { ProjectileSystem } from '../entities/Projectiles.js';
import { PickupManager } from '../entities/Pickups.js';
import { ParticleSystem, AmbientMotes } from '../fx/Particles.js';
import { AudioSystem } from '../systems/AudioSystem.js';
import { HUD } from '../ui/HUD.js';
import { Menus } from '../ui/Menus.js';
import { loadSettings, saveSettings, loadProgress, saveProgress, formatTime } from '../ui/Settings.js';

const QUALITY_PRESETS = {
  low: { pixelRatio: 0.7, shadows: false, fogDensity: 0.055, lightDistance: 9, maxLights: 4 },
  medium: { pixelRatio: 1.0, shadows: false, fogDensity: 0.042, lightDistance: 12, maxLights: 6 },
  high: { pixelRatio: 1.5, shadows: true, fogDensity: 0.034, lightDistance: 15, maxLights: 8 },
};

export class Game {
  constructor(options = {}) {
    this.container = options.container || document.getElementById('app');
    this.uiRoot = options.uiRoot || document.getElementById('ui-root');
    this.onStateChange = options.onStateChange || null;
    this.onProgress = options.onProgress || null;

    this.settings = loadSettings();
    this.progress = loadProgress();

    this.state = 'title';
    this.time = 0;
    this.runTime = 0;
    this.kills = 0;
    this.secrets = 0;
    this.hasKey = false;
    this.bossDefeated = false;
    this.frameTimes = [];
    this.fps = 0;
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this._paused = false;
    this._lastTime = 0;
    this._raf = 0;
    this._ambientAccum = 0;
    this._disposed = false;
  }

  // ------------------------------------------------------------- lifecycle

  /**
   * Builds the renderer, scene and all game systems.
   */
  init() {
    this._createRenderer();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x08070a);
    this.scene.fog = new THREE.FogExp2(0x0a0810, 0.042);

    this.camera = new THREE.PerspectiveCamera(this.settings.fov, 1, 0.05, 220);
    this.scene.add(this.camera);

    this.materials = createMaterials();
    this.world = new CollisionWorld(4);
    this.input = new Input(this.renderer.domElement);

    this.level = new Level(this.scene, this.world, this.materials);
    this.level.build();

    this._setupLighting();
    this._setupPlayer();
    this._setupSystems();
    this._setupUI();
    this._applySettings();
    this._bindEvents();

    this._resize();
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
    document.addEventListener('visibilitychange', this._onVisibility);

    this._lastTime = performance.now();
    return this;
  }

  _createRenderer() {
    const canvas = document.createElement('canvas');
    this.canvas = canvas;
    this.container.appendChild(canvas);

    const gl = this._detectWebGL();
    if (!gl) {
      throw new Error('WebGL is unavailable in this browser.');
    }

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this._isMobile() ? false : true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setClearColor(0x08070a, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.shadowMap.enabled = false;
    this.renderer.info.autoReset = true;
  }

  _detectWebGL() {
    try {
      const c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (err) {
      return false;
    }
  }

  _isMobile() {
    return (
      /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
      (navigator.maxTouchPoints > 1 && window.innerWidth < 1100)
    );
  }

  _setupLighting() {
    this.ambient = new THREE.AmbientLight(0x413a52, 1.75);
    this.scene.add(this.ambient);

    this.hemi = new THREE.HemisphereLight(0x565070, 0x1d151c, 1.35);
    this.scene.add(this.hemi);

    // A dim cold key light standing in for moonlight through the windows.
    this.moon = new THREE.DirectionalLight(0x7d92bd, 0.45);
    this.moon.position.set(-18, 26, 14);
    this.scene.add(this.moon);

    // A dim lantern that travels with the player. Without it, enemies
    // standing between torches are invisible, which makes the game unfair.
    this.lantern = new THREE.PointLight(0xffd0a0, 6.5, 17, 1.55);
    this.scene.add(this.lantern);

    // A small pool of point lights that follow the nearest emitters.
    this.lightPool = [];
    for (let i = 0; i < 10; i++) {
      const l = new THREE.PointLight(0xffa04a, 0, 20, 1.6);
      l.castShadow = false;
      this.scene.add(l);
      this.lightPool.push(l);
    }
  }

  _setupPlayer() {
    this.player = new Player(this.world, this.camera, this.input);

    this.player.onFootstep = (intensity) => {
      if (this.audio) this.audio.play('meleeSwing', { volume: 0.16 * intensity, rate: 0.8 + Math.random() * 0.4 });
    };
    this.player.onLand = (impact) => {
      if (this.audio) this.audio.play('impactStone', { volume: 0.2 * impact, rate: 0.7 + Math.random() * 0.3 });
    };
    this.player.onDamage = (amount) => {
      if (this.hud) this.hud.flashDamage(amount);
      if (this.audio) this.audio.play('playerHurt', { volume: 0.7 });
      if (this.particles) {
        this.particles.emitBlood(this.camera.position, this._camForward(), 6);
      }
    };
    this.player.onDeath = () => this._onPlayerDeath();
  }

  _setupSystems() {
    this.audio = new AudioSystem();
    this.particles = new ParticleSystem(this.scene, { maxParticles: 900, quality: 'high' });

    this.enemies = new EnemyManager({
      scene: this.scene,
      world: this.world,
      materials: this.materials,
      audio: this.audio,
      particles: this.particles,
      onAttack: (damage, from) => this._onEnemyAttack(damage, from),
      onDeath: (enemy) => this._onEnemyDeath(enemy),
      onProjectile: (enemy, origin, target) => this._spawnEnemyBolt(enemy, origin, target),
    });

    this.weapons = new WeaponSystem({
      materials: this.materials,
      player: this.player,
      camera: this.camera,
      world: this.world,
      audio: this.audio,
      particles: this.particles,
      enemies: this.enemies,
      viewCamera: this.player.viewCamera,
      onFire: (weapon, damage) => this._onWeaponFired(weapon, damage),
      onHit: (point, normal, damage, weapon, didHit, enemyHit) =>
        this._onWeaponHit(point, normal, damage, weapon, didHit, enemyHit),
    });

    this.projectiles = new ProjectileSystem({
      scene: this.scene,
      world: this.world,
      materials: this.materials,
      audio: this.audio,
      particles: this.particles,
    });

    this.pickups = new PickupManager({
      scene: this.scene,
      materials: this.materials,
      onCollect: (pickup) => this._onPickupCollected(pickup),
    });

    this._populate();

    // Slow dust drifting through the whole cathedral.
    this.motes = new AmbientMotes(
      this.scene,
      { minX: -30, maxX: 30, minY: 0.2, maxY: 9, minZ: -32, maxZ: 48 },
      this._isMobile() ? 60 : 130
    );
  }

  _setupUI() {
    this.hud = new HUD(this.uiRoot);
    this.hud.onRestart = () => this.restart();
    this.hud.onMenu = () => this.toTitle();

    this.menus = new Menus(this.uiRoot, {
      onStart: () => this.start(),
      onResume: () => this.resume(),
      onRestart: () => this.restart(),
      onQuitToTitle: () => this.toTitle(),
      onSettingsChange: (s) => this._applySettings(s),
      onQualityChange: (q) => this._applySettings(),
    });

    this.menus.showTitle({
      bestTimeMs: this.progress.bestTimeMs,
      hasProgress: this.progress.victories > 0,
    });
    this.hud.setVisible(false);
  }

  _bindEvents() {
    // Only treat losing pointer lock as a pause when the lock was actually
    // held. A browser that refuses the lock outright (or an environment with
    // no pointer lock at all) must not leave the player stuck on the pause
    // screen the instant the game starts.
    this._hadPointerLock = false;
    this.input.onLockChange((locked) => {
      if (locked) {
        this._hadPointerLock = true;
        return;
      }
      if (this._hadPointerLock && this.state === 'playing') {
        this._hadPointerLock = false;
        this.pause();
      }
    });

    this._onResize = () => this._resize();
    this._onVisibility = () => {
      if (document.hidden && this.state === 'playing') this.pause();
    };

    this.canvas.addEventListener('click', () => {
      if (this.state === 'playing' && !this.input.pointerLocked) {
        this.input.requestPointerLock();
      }
    });
  }

  // -------------------------------------------------------------- populate

  /** Fills the level with enemies, pickups and quest items. */
  _populate() {
    for (const s of this.level.enemySpawns) {
      this.enemies.spawn(s.type, s.position, s.patrol, { boss: s.boss });
    }
    for (const p of this.level.pickupSpawns) {
      this.pickups.add(p.type, p.kind, p.amount, p.position);
    }
    // The Bone Key, on its pedestal in the ossuary.
    this.pickups.add('key', 'key', 1, this.level.markers.keyPedestal.clone().setY(1.05));
  }

  // --------------------------------------------------------------- state

  /** Starts a fresh run from the title screen. */
  start() {
    this.audio.init();
    this.audio.resume();
    this.audio.startAmbient('cathedral');
    this.audio.startMusic('explore');

    this._resetRun();
    this.state = 'playing';
    this.menus.showAll();
    this.hud.setVisible(true);
    this.hud.hideOverlays();
    this.input.enabled = true;
    this.input.requestPointerLock();
    this._notify();
  }

  /** Restarts the level after death or from the pause menu. */
  restart() {
    this.start();
  }

  /** Pauses the game and releases pointer lock. */
  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this._paused = true;
    this.input.exitPointerLock();
    this.input.enabled = false;
    this.menus.showPause();
    this.hud.setVisible(false);
    if (this.audio) this.audio.setMusicIntensity(0.2);
    this._notify();
  }

  /** Resumes from pause. */
  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this._paused = false;
    this.menus.showAll();
    this.hud.setVisible(true);
    this.input.enabled = true;
    this.input.requestPointerLock();
    if (this.audio) this.audio.setMusicIntensity(1);
    this._notify();
  }

  /** Returns to the title screen. */
  toTitle() {
    this.state = 'title';
    this._paused = false;
    this.input.exitPointerLock();
    this.input.enabled = false;
    this.menus.showTitle({
      bestTimeMs: this.progress.bestTimeMs,
      hasProgress: this.progress.victories > 0,
    });
    this.hud.setVisible(false);
    this.hud.hideOverlays();
    if (this.audio) {
      this.audio.stopMusic();
      this.audio.startAmbient('cathedral');
    }
    this._notify();
  }

  _resetRun() {
    this.enemies.clear();
    this.projectiles.clear();
    this.pickups.clear();
    if (this.particles) this.particles.clear();
    this.world.boxes.length = 0;
    this.world.grid.clear();

    // Tear the old level down before building the new one. Leaving the
    // previous cathedral in the scene would double the geometry on every
    // restart and eventually choke the renderer.
    this._disposeLevel();

    this.level = new Level(this.scene, this.world, this.materials);
    this.level.build();

    this.runTime = 0;
    this.kills = 0;
    this.secrets = 0;
    this.hasKey = false;
    this.bossDefeated = false;

    this._populate();

    const spawn = this.level.getSpawn();
    this.player.spawn(spawn.position, spawn.yaw);

    // Starting kit.
    this.weapons.weapons[0].reserve = 24;
    this.weapons.weapons[0].magazine = 1;
    this.weapons.weapons[1].reserve = 6;
    this.weapons.weapons[1].magazine = 1;
    this.weapons.weapons[2].reserve = 12;
    this.weapons.weapons[2].magazine = 8;
    this.weapons.index = 0;
    for (const w of this.weapons.weapons) w.model.visible = w === this.weapons.weapons[0];

    this.hud.setObjective('Descend into the cathedral');
    this._updateHud();
  }

  _notify() {
    if (this.onStateChange) this.onStateChange(this.state);
  }

  /**
   * Removes the current level from the scene and releases its GPU resources.
   *
   * The level's geometry is merged into a handful of large buffers, so
   * disposing them is what actually frees the memory. Materials are shared
   * across levels and must not be disposed here.
   */
  _disposeLevel() {
    if (!this.level) return;
    if (this.level.root && this.level.root.parent) {
      this.level.root.parent.remove(this.level.root);
    }
    this.level.root.traverse((obj) => {
      if (obj.isMesh && obj.geometry) obj.geometry.dispose();
    });
    this.level.interactables.length = 0;
    this.level.lightEmitters.length = 0;
    this.level.enemySpawns.length = 0;
    this.level.pickupSpawns.length = 0;
    this.level = null;
  }

  // ---------------------------------------------------------------- combat

  _onWeaponFired(weapon, damage) {
    if (weapon.id === 'crossbow') this.audio.play('crossbowShoot', { volume: 0.9 });
    else if (weapon.id === 'cannon') this.audio.play('handcannonShoot', { volume: 1 });
    else this.audio.play('soulwickCast', { volume: 0.7 });

    if (this.particles) {
      const muzzle = this.weapons.getMuzzlePosition();
      const dir = this._camForward();
      if (weapon.id === 'cannon') {
        this.particles.emitSparks(muzzle, dir, 14, 0xffc070);
        this.particles.emitSmoke(muzzle, 5);
      } else if (weapon.id === 'soulwick') {
        this.particles.emitSoul(muzzle, 10);
      } else {
        this.particles.emitSparks(muzzle, dir, 5, 0xd8c090);
      }
    }
  }

  _onWeaponHit(point, normal, damage, weapon, didHit, enemyHit) {
    if (this.particles) {
      if (weapon.id === 'soulwick') {
        this.particles.emitSoul(point, 8);
      } else {
        this.particles.emitSparks(point, normal, 4, 0xffb060);
        this.particles.emitDebris(point, 3);
      }
    }
    if (!didHit || !enemyHit) return;

    const killed = enemyHit.enemy.damage(damage, this.camera.position);
    if (this.hud) this.hud.showHitmarker(killed);
    if (this.particles) {
      this.particles.emitBlood(enemyHit.point, normal, killed ? 20 : 10);
    }
  }

  _onEnemyAttack(damage, from) {
    this.player.damage(damage, from);
  }

  _onEnemyDeath(enemy) {
    this.kills++;
    if (this.particles) {
      this.particles.emitBlood(enemy.position, this._camForward(), 24);
      this.particles.emitSoul(enemy.position, 10);
    }
    if (enemy.boss) {
      this.bossDefeated = true;
      this._openExit();
      this.hud.setObjective('Leave the cathedral');
      if (this.audio) {
        this.audio.play('bossRoar', { volume: 0.9 });
        this.audio.stopMusic();
        this.audio.startMusic('victory');
      }
    }
  }

  _spawnEnemyBolt(enemy, origin, target) {
    this.projectiles.spawn({
      origin,
      target,
      speed: 22,
      damage: enemy.stats.damage,
      radius: 0.08,
      color: 0xcfd8b0,
      hostile: true,
      life: 5,
      onHit: (point, normal, p, hitPlayer) => {
        if (hitPlayer) {
          this.player.damage(p.damage, p.position);
        }
        if (this.particles) this.particles.emitDebris(point, 4);
      },
    });
  }

  _onPickupCollected(pickup) {
    if (this.audio) {
      this.audio.play(pickup.type === 'health' ? 'pickupHealth' : pickup.type === 'key' ? 'pickupItem' : 'pickupAmmo', {
        volume: 0.8,
      });
    }
    if (pickup.type === 'health') {
      const healed = this.player.heal(pickup.amount);
      if (healed <= 0 && this.hud) this.hud.flashDamage(0);
    } else if (pickup.type === 'key') {
      this.hasKey = true;
      this.hud.setObjective('Unlock the sanctum gate');
      if (this.audio) this.audio.play('objectiveChime', { volume: 0.9 });
    } else {
      const w = this.weapons.weapons.find((x) => x.kind === pickup.kind);
      if (w) w.addAmmo(pickup.amount);
    }
    this._updateHud();
  }

  _onPlayerDeath() {
    this.state = 'dead';
    this.input.exitPointerLock();
    this.input.enabled = false;
    if (this.audio) {
      this.audio.play('playerDeath', { volume: 1 });
      this.audio.stopMusic();
    }
    this.hud.setVisible(false);
    this.hud.showDeath({
      timeMs: this.runTime,
      kills: this.kills,
      secrets: this.secrets,
      weaponKills: this.kills,
    });
    this.progress.runs = (this.progress.runs || 0) + 1;
    saveProgress(this.progress);
    this._notify();
  }

  _onVictory() {
    this.state = 'victory';
    this.input.exitPointerLock();
    this.input.enabled = false;
    if (this.audio) {
      this.audio.play('victoryStinger', { volume: 1 });
      this.audio.stopMusic();
    }
    this.hud.setVisible(false);
    this.hud.showVictory({
      timeMs: this.runTime,
      kills: this.kills,
      secrets: this.secrets,
    });
    this.progress.victories = (this.progress.victories || 0) + 1;
    if (!this.progress.bestTimeMs || this.runTime < this.progress.bestTimeMs) {
      this.progress.bestTimeMs = this.runTime;
    }
    saveProgress(this.progress);
    this._notify();
  }

  // ------------------------------------------------------------ interaction

  /** Finds the interactable the player is looking at. */
  _findInteraction() {
    const origin = this.camera.getWorldPosition(new THREE.Vector3());
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    let best = null;
    let bestScore = Infinity;

    for (const it of this.level.interactables) {
      if (it.kind === 'tablet' && it.used) continue;
      const dx = it.position.x - origin.x;
      const dy = it.position.y + 0.4 - origin.y;
      const dz = it.position.z - origin.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > (it.radius || 2.2) + 1.2) continue;
      const dot = (dx * dir.x + dy * dir.y + dz * dir.z) / (dist || 1);
      if (dot < 0.55) continue;
      const score = dist * (1.4 - dot);
      if (score < bestScore) {
        bestScore = score;
        best = it;
      }
    }
    return best;
  }

  /** Attempts the current interaction. */
  _interact() {
    const it = this._findInteraction();
    if (!it) return;

    if (it.kind === 'tablet') {
      it.used = true;
      this.hud.setObjective(it.text);
      if (this.audio) this.audio.play('objectiveChime', { volume: 0.7 });
      this._showMessage(it.text);
      return;
    }

    if (it.kind === 'gate' && it.locked) {
      if (it.requires === 'boneKey' && this.hasKey) {
        it.locked = false;
        it.open = true;
        it.collider.enabled = false;
        if (this.audio) this.audio.play('gateOpen', { volume: 1 });
        this.hud.setObjective('Enter the sanctum');
        this._showMessage('The bone key turns. The gate grinds open.');
        this._animateGate(it);
      } else {
        this._showMessage(it.prompt);
        if (this.audio) this.audio.play('uiClick', { volume: 0.5 });
      }
      return;
    }

    if (it.kind === 'exitGate' && it.locked) {
      if (this.bossDefeated) {
        it.locked = false;
        it.open = true;
        it.collider.enabled = false;
        if (this.audio) this.audio.play('gateOpen', { volume: 1 });
        this._animateGate(it);
        this.hud.setObjective('Leave the cathedral');
      } else {
        this._showMessage(it.prompt);
      }
      return;
    }
  }

  /** Slides a gate upward over a short animation. */
  _animateGate(gate) {
    const startY = gate.object.position.y;
    const t0 = performance.now();
    const dur = 900;
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / dur);
      const e = t * t * (3 - 2 * t);
      gate.object.position.y = startY + e * 4.4;
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        gate.object.visible = false;
      }
    };
    step();
  }

  /** Shows a transient message on the HUD objective line. */
  _showMessage(text) {
    this.hud.setObjective(text);
    clearTimeout(this._messageTimer);
    this._messageTimer = setTimeout(() => {
      if (this.state === 'playing') this._updateObjective();
    }, 4200);
  }

  _updateObjective() {
    if (this.bossDefeated) this.hud.setObjective('Leave the cathedral');
    else if (this.hasKey) this.hud.setObjective('Unlock the sanctum gate');
    else this.hud.setObjective('Find the bone key in the ossuary');
  }

  // ---------------------------------------------------------------- frame

  /** Starts the render loop. */
  startLoop() {
    const loop = (now) => {
      if (this._disposed) return;
      this._raf = requestAnimationFrame(loop);
      let dt = (now - this._lastTime) / 1000;
      this._lastTime = now;
      if (dt > 0.1) dt = 0.1; // tab suspension guard
      this._update(dt);
    };
    this._raf = requestAnimationFrame(loop);
  }

  /** Advances the simulation by one frame. */
  _update(dt) {
    this.time += dt;

    this._fpsAccum += dt;
    this._fpsFrames++;
    if (this._fpsAccum >= 0.5) {
      this.fps = Math.round(this._fpsFrames / this._fpsAccum);
      this._fpsAccum = 0;
      this._fpsFrames = 0;
    }

    this.input.update();

    if (this.state === 'playing') {
      this.runTime += dt * 1000;
      this._updatePlaying(dt);
    } else {
      // Menus still animate the world gently behind the overlay.
      this._updateAmbientOnly(dt);
    }

    this.hud.update(dt);
    this.input.endFrame();

    // The world, then the weapon on top with a cleared depth buffer.
    this.renderer.render(this.scene, this.camera);
    if (this.player.viewScene) {
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.player.viewScene, this.player.viewCamera);
      this.renderer.autoClear = true;
    }
  }

  _updatePlaying(dt) {
    const input = this.input;

    // ---- input actions ------------------------------------------------
    if (input.wasPressed('pause')) {
      this.pause();
      return;
    }
    if (input.wasPressed('reload')) this.weapons.startReload();
    if (input.wasPressed('interact')) this._interact();
    if (input.wasPressed('swap')) this.weapons.cycle(1);
    if (input.wheelDelta !== 0) this.weapons.cycle(input.wheelDelta > 0 ? 1 : -1);
    for (let i = 0; i < 3; i++) {
      if (input.wasPressed('weapon' + i)) this.weapons.select(i);
    }

    // Fire / charge.
    const w = this.weapons.current;
    if (w.chargeable) {
      if (input.isDown('fire')) {
        if (!w.charging) {
          w.charging = true;
          w.chargeTimer = 0;
        } else {
          w.chargeTimer = Math.min(w.chargeTime, w.chargeTimer + dt);
        }
      } else if (w.charging) {
        this.weapons.tryFire();
        this.weapons.releaseCharge();
      }
    } else {
      if (input.isDown('fire')) {
        if (!this._fireHeld) {
          // Only latch the trigger when a shot actually left the barrel, so
          // holding fire through a reload fires the moment it completes.
          if (this.weapons.tryFire()) this._fireHeld = true;
        }
      } else {
        this._fireHeld = false;
      }
    }

    // Alt fire: the crossbow braces for a tighter shot.
    if (input.wasPressed('alt')) {
      this.altBraced = !this.altBraced;
    }

    // ---- simulation ----------------------------------------------------
    this.player.update(dt);
    this.weapons.update(dt, input);
    this.enemies.update(dt, this.player);
    this.enemies.cull(this.camera.position);
    this.projectiles.update(dt, this.player, this.enemies.enemies);
    this.pickups.update(dt, this.time, this.player);

    if (this.particles) this.particles.update(dt, this.camera.position);
    if (this.motes) this.motes.update(dt);

    this._updateLightPool();
    this._updateFlames(dt);
    this._updateHud();
    this._checkVictory();
  }

  _updateAmbientOnly(dt) {
    this._updateLightPool();
    this._updateFlames(dt);
    if (this.particles) this.particles.update(dt, this.camera.position);
    if (this.motes) this.motes.update(dt);
  }

  /** Assigns the point light pool to the nearest emitters. */
  _updateLightPool() {
    // Keep the player lantern just below and in front of the eye.
    if (this.lantern) {
      const cam = this.camera;
      this.lantern.position.set(cam.position.x, cam.position.y - 0.2, cam.position.z);
      this.lantern.position.addScaledVector(this._camForward(), 0.4);
    }

    const emitters = this.level.lightEmitters;
    if (!emitters.length) return;
    const maxLights = this._quality.maxLights;
    const cam = this.camera.position;

    // Partial selection of the nearest emitters without allocating.
    const scored = this._lightScore || (this._lightScore = []);
    scored.length = 0;
    for (const e of emitters) {
      const d = e.position.distanceToSquared(cam);
      if (d < 900) scored.push({ e, d });
    }
    scored.sort((a, b) => a.d - b.d);

    for (let i = 0; i < this.lightPool.length; i++) {
      const light = this.lightPool[i];
      if (i < maxLights && i < scored.length) {
        const src = scored[i].e;
        light.position.copy(src.position);
        light.color.setHex(src.color);
        const flicker = src.flicker
          ? 0.82 + Math.sin(this.time * 11 + i * 2.3) * 0.1 + Math.sin(this.time * 27 + i) * 0.08
          : 1;
        light.intensity = src.intensity * flicker * (this._quality.lightDistance / 12);
        light.distance = this._quality.lightDistance;
      } else {
        light.intensity = 0;
      }
    }
  }

  /** Animates the flame meshes. */
  _updateFlames(dt) {
    this._ambientAccum += dt;
    // Emit embers and dust from a couple of nearby emitters at a time.
    if (this._ambientAccum > 0.12 && this.particles) {
      this._ambientAccum = 0;
      const emitters = this.level.lightEmitters;
      if (emitters.length) {
        for (let k = 0; k < 2; k++) {
          const e = emitters[Math.floor(Math.random() * emitters.length)];
          if (Math.random() > 0.5) this.particles.emitEmbers(e.position, 1);
          else this.particles.emitDust(e.position, 1);
        }
      }
    }

    // Flicker the flames. They are drawn as instanced meshes, so the
    // animation writes instance matrices rather than moving individual
    // objects.
    this._flickerFlames();
  }

  /**
   * Animates the level's flames by rewriting their instance matrices.
   */
  _flickerFlames() {
    const level = this.level;
    if (!level || !level.flameMeshes) return;
    const dummy = this._flameDummy || (this._flameDummy = new THREE.Object3D());

    for (const group of level.flameMeshes.values()) {
      const mesh = group.mesh;
      if (!mesh) continue;
      let changed = false;
      group.items.forEach((item, i) => {
        const flicker =
          0.86 +
          Math.sin(this.time * 9 + item.x) * 0.12 +
          Math.sin(this.time * 23 + item.z) * 0.06;
        dummy.position.set(
          item.x,
          item.y + Math.sin(this.time * 7 + item.x) * 0.02,
          item.z
        );
        dummy.scale.set(item.radius * flicker, item.radius * flicker * 1.25, item.radius * flicker);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        changed = true;
      });
      if (changed) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  _updateHud() {
    const w = this.weapons.current;
    this.hud.setHealth(this.player.health, this.player.maxHealth);
    this.hud.setWeapon({
      name: w.name,
      ammo: w.magazine,
      reserve: w.reserve,
      kind: w.kind,
    });

    const it = this._findInteraction();
    if (it) {
      const label =
        it.kind === 'tablet'
          ? 'Read the tablet'
          : it.kind === 'gate' && it.locked
            ? it.requires === 'boneKey' && this.hasKey
              ? 'Unlock the gate'
              : 'Examine the gate'
            : it.kind === 'exitGate'
              ? 'Open the seal'
              : 'Interact';
      this.hud.setPrompt(`${label}`);
      this.hud.setCrosshair('interact');
    } else {
      this.hud.setPrompt(null);
      this.hud.setCrosshair(w.reloading ? 'reload' : 'idle');
    }
  }

  _checkVictory() {
    if (!this.bossDefeated) return;
    const exit = this.level.markers.exit;
    const dx = this.player.position.x - exit.x;
    const dz = this.player.position.z - exit.z;
    if (dx * dx + dz * dz < 4) {
      this._onVictory();
    }
  }

  _camForward() {
    return this.camera.getWorldDirection(new THREE.Vector3());
  }

  // -------------------------------------------------------------- settings

  _applySettings(override) {
    if (override) {
      this.settings = { ...this.settings, ...override };
      saveSettings(this.settings);
    } else {
      this.settings = { ...loadSettings() };
    }
    const s = this.settings;

    this.input.sensitivity = s.mouseSensitivity;
    this.input.touchSensitivity = s.touchSensitivity;
    this.input.invertY = s.invertY;

    if (this.camera) {
      this.camera.fov = s.fov;
      this.camera.updateProjectionMatrix();
    }

    if (this.audio) {
      this.audio.setMasterVolume(s.masterVolume);
      this.audio.setMusicVolume(s.musicVolume);
      this.audio.setSfxVolume(s.sfxVolume);
      this.audio.setMuted(s.muted);
    }

    const preset = this._resolveQuality(s.quality);
    this._quality = preset;
    if (this.renderer) {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatio));
      this.renderer.shadowMap.enabled = preset.shadows;
    }
    if (this.scene && this.scene.fog) {
      this.scene.fog.density = preset.fogDensity;
    }
    this._resize();
  }

  _resolveQuality(quality) {
    if (quality === 'auto') {
      return this._isMobile() ? QUALITY_PRESETS.medium : QUALITY_PRESETS.high;
    }
    return QUALITY_PRESETS[quality] || QUALITY_PRESETS.high;
  }

  _resize() {
    if (!this.renderer) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    if (this.camera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    if (this.player && this.player.viewCamera) {
      this.player.viewCamera.aspect = w / h;
      this.player.viewCamera.updateProjectionMatrix();
    }
  }

  dispose() {
    this._disposed = true;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('orientationchange', this._onResize);
    document.removeEventListener('visibilitychange', this._onVisibility);
    this.input.dispose();
    this.audio.dispose();
    this.renderer.dispose();
  }
}
